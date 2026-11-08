use std::{
    fs::File,
    path::PathBuf,
    sync::{Arc, RwLock},
    time::Duration,
};

use easytier::common::config::ConfigLoader;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::{
    CoreError, CorePaths, ErrorCode, HostState, HostStatus, Result, parse_config, platform,
    wire::{self, Command, Connection, Data, Hello, Request, Response},
};
use crate::InstanceSnapshot;

#[derive(Clone)]
pub struct CoreController {
    inner: Arc<Inner>,
}

struct Inner {
    executable: PathBuf,
    session: Mutex<Option<Session>>,
    status: RwLock<HostStatus>,
}

struct Session {
    io: Option<Connection>,
    process: Option<platform::Process>,
    elevated: bool,
    sequence: u64,
    resources: Vec<File>,
}

async fn retire(mut session: Session) -> Result<()> {
    drop(session.io.take());
    let process = session.process.as_mut().unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(6);
    while !process.exited()? && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    if !process.exited()? {
        process.terminate()?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(1);
        while !process.exited()? && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        if !process.exited()? {
            return Err(CoreError::new(
                ErrorCode::CoreFailure,
                "Core termination could not be confirmed",
            ));
        }
    }
    drop(session.process.take());
    Ok(())
}

impl Drop for Session {
    fn drop(&mut self) {
        // EOF lets the worker stop its instances. Retain ownership and file locks
        // until it exits, then force termination if graceful cleanup stalls.
        drop(self.io.take());
        if let Some(mut process) = self.process.take() {
            let resources = std::mem::take(&mut self.resources);
            std::thread::spawn(move || {
                let _resources = resources;
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                while !process.exited().unwrap_or(true) && std::time::Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(50));
                }
                drop(process);
            });
        }
    }
}

impl CoreController {
    /// Construct inside a Tokio runtime. This does not launch a process or request UAC.
    pub fn new(executable: PathBuf, paths: CorePaths) -> Result<Self> {
        let inner = Arc::new(Inner {
            executable,
            session: Mutex::new(None),
            status: RwLock::new(HostStatus {
                state: HostState::Stopped,
                pid: None,
                elevated: false,
                version: None,
                error: None,
                paths,
            }),
        });
        let weak = Arc::downgrade(&inner);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(250)).await;
                let Some(inner) = weak.upgrade() else {
                    break;
                };
                let Ok(mut session) = inner.session.try_lock() else {
                    continue;
                };
                if let Some(current) = session.as_mut() {
                    if current.process.as_mut().unwrap().exited().unwrap_or(true) {
                        drop(session.take());
                        inner.failed(CoreError::new(
                            ErrorCode::CoreExited,
                            "The core process exited unexpectedly",
                        ));
                    }
                }
            }
        });
        Ok(Self { inner })
    }

    pub fn status(&self) -> HostStatus {
        self.inner.status.read().unwrap().clone()
    }

    // Used by the out-of-process recovery check, never exposed over IPC or Tauri.
    pub(super) async fn interrupt_for_check(&self) -> Result<()> {
        if let Some(session) = self.inner.session.lock().await.as_mut() {
            session.process.as_mut().unwrap().terminate()?;
        }
        Ok(())
    }

    pub async fn start(&self, toml: String) -> Result<Uuid> {
        if toml.len() > 256 * 1024 {
            return Err(CoreError::new(
                ErrorCode::InvalidConfig,
                "Configuration exceeds 256 KiB",
            ));
        }
        let config = parse_config(&toml)?;
        let needs_elevation = !config.get_flags().no_tun;
        if needs_elevation {
            let name = config.get_flags().dev_name;
            #[cfg(not(target_os = "macos"))]
            if !name.is_empty() && platform::tun_exists(&name)? {
                return Err(CoreError::new(
                    ErrorCode::TunNameInUse,
                    "The interface name is already used by the system",
                ));
            }
            if let Some(address) = config.get_ipv4() {
                if platform::address_exists(address.address())? {
                    return Err(CoreError::new(
                        ErrorCode::AddressInUse,
                        "The virtual address is already assigned",
                    ));
                }
            }
        }
        let mut session = self.inner.session.lock().await;
        self.ensure_session(&mut session, needs_elevation).await?;
        match self
            .inner
            .request(&mut session, Command::Start { toml })
            .await?
        {
            Data::Started(id) => Ok(id),
            _ => Err(self.inner.protocol_failed(&mut session)),
        }
    }

    pub async fn stop(&self, id: Uuid) -> Result<()> {
        let mut session = self.inner.session.lock().await;
        if session.is_none() {
            return Ok(());
        }
        match self
            .inner
            .request(&mut session, Command::Stop { id })
            .await?
        {
            Data::Done => Ok(()),
            _ => Err(self.inner.protocol_failed(&mut session)),
        }
    }

    pub async fn snapshot(&self) -> Result<Vec<InstanceSnapshot>> {
        let mut session = self.inner.session.lock().await;
        if session.is_none() {
            let status = self.status();
            return if status.state == HostState::Failed {
                Err(status.error.unwrap_or_else(|| {
                    CoreError::new(ErrorCode::CoreExited, "Core is unavailable")
                }))
            } else {
                Ok(Vec::new())
            };
        }
        match self.inner.request(&mut session, Command::Snapshot).await? {
            Data::Snapshot(states) => Ok(states),
            _ => Err(self.inner.protocol_failed(&mut session)),
        }
    }

    pub async fn shutdown(&self) -> Result<()> {
        let mut session = self.inner.session.lock().await;
        let mut result = if session.is_some() {
            match self.inner.request(&mut session, Command::Shutdown).await {
                Ok(Data::Done) => Ok(()),
                Ok(_) => Err(self.inner.protocol_failed(&mut session)),
                Err(error) => Err(error),
            }
        } else {
            Ok(())
        };
        if let Some(current) = session.take() {
            if let Err(error) = retire(current).await {
                result = Err(error);
            }
        }
        self.inner.update(
            if result.is_ok() {
                HostState::Stopped
            } else {
                HostState::Failed
            },
            None,
            false,
            None,
            result.as_ref().err().cloned(),
        );
        self.inner.log("shutdown", None, result.as_ref().err());
        result
    }

    async fn ensure_session(&self, session: &mut Option<Session>, elevated: bool) -> Result<()> {
        if let Some(current) = session.as_mut() {
            if current.process.as_mut().unwrap().exited()? {
                drop(session.take());
            } else if !elevated || current.elevated {
                return Ok(());
            } else {
                let Data::Snapshot(states) = self.inner.request(session, Command::Snapshot).await?
                else {
                    return Err(self.inner.protocol_failed(session));
                };
                if !states.is_empty() {
                    return Err(CoreError::new(
                        ErrorCode::ElevationRequired,
                        "Stop the running non-TUN instances before upgrading core privileges",
                    ));
                }
                self.inner.request(session, Command::Shutdown).await?;
                if let Some(current) = session.take() {
                    retire(current).await?;
                }
            }
        }
        self.inner
            .update(HostState::Starting, None, false, None, None);
        let result = self.launch(elevated).await;
        match result {
            Ok(current) => {
                let pid = current.process.as_ref().unwrap().pid();
                self.inner.update(
                    HostState::Ready,
                    Some(pid),
                    current.elevated,
                    Some(crate::version().to_owned()),
                    None,
                );
                self.inner.log("ready", Some(pid), None);
                *session = Some(current);
                Ok(())
            }
            Err(error) => {
                if error.code == ErrorCode::ElevationCancelled {
                    self.inner
                        .update(HostState::Stopped, None, false, None, Some(error.clone()));
                } else {
                    self.inner.failed(error.clone());
                }
                self.inner.log("launch", None, Some(&error));
                Err(error)
            }
        }
    }

    async fn launch(&self, elevate: bool) -> Result<Session> {
        // A storage problem must be reportable inside the UI, rather than make
        // constructing the application fail before its configuration page opens.
        let paths = self.status().paths;
        let directory = paths.data_dir.join("runtime");
        std::fs::create_dir_all(&directory)?;
        std::fs::create_dir_all(paths.data_dir.join("logs"))?;
        let mut listener = platform::Listener::create(&directory)?;
        let resources = platform::lock_resources(&self.inner.executable)?;
        let (mut process, resources) = platform::spawn(
            &self.inner.executable,
            &listener.endpoint(),
            elevate,
            resources,
        )
        .await?;
        let expected_pid = process.pid();
        let ready = async {
            let mut io = tokio::select! {
                result = listener.accept(expected_pid) => result?,
                _ = async {
                    loop {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        if process.exited().unwrap_or(true) { break; }
                    }
                } => return Err(CoreError::new(ErrorCode::CoreExited, "Core exited before the local connection was ready")),
            };
            let hello: Hello = wire::read(&mut io).await?;
            if hello.protocol != wire::PROTOCOL
                || hello.pid != process.pid()
                || hello.version != crate::version()
            {
                return Err(CoreError::new(
                    ErrorCode::IdentityRejected,
                    "Core identity or protocol does not match",
                ));
            }
            if elevate && !hello.elevated {
                return Err(CoreError::new(
                    ErrorCode::ElevationRequired,
                    "The core did not receive administrator privileges",
                ));
            }
            Ok((io, hello.elevated))
        };
        let (io, elevated) = tokio::time::timeout(Duration::from_secs(15), ready)
            .await
            .map_err(|_| {
                CoreError::new(
                    ErrorCode::StartupTimeout,
                    "Core did not become ready within 15 seconds",
                )
            })??;
        Ok(Session {
            io: Some(io),
            process: Some(process),
            elevated,
            sequence: 0,
            resources,
        })
    }
}

#[cfg(test)]
mod construction_tests {
    use super::*;

    #[tokio::test]
    async fn unavailable_storage_does_not_prevent_opening_the_application() {
        let directory = tempfile::tempdir().unwrap();
        let blocked = directory.path().join("file");
        std::fs::write(&blocked, b"not a directory").unwrap();
        let controller = CoreController::new(
            std::env::current_exe().unwrap(),
            CorePaths::new(blocked.clone(), blocked),
        )
        .unwrap();
        assert_eq!(controller.status().state, HostState::Stopped);
        assert!(controller.snapshot().await.unwrap().is_empty());
        controller.shutdown().await.unwrap();
    }
}

impl Inner {
    fn update(
        &self,
        state: HostState,
        pid: Option<u32>,
        elevated: bool,
        version: Option<String>,
        error: Option<CoreError>,
    ) {
        let mut status = self.status.write().unwrap();
        status.state = state;
        status.pid = pid;
        status.elevated = elevated;
        status.version = version;
        status.error = error;
    }

    fn failed(&self, error: CoreError) {
        self.update(HostState::Failed, None, false, None, Some(error.clone()));
        self.log("failed", None, Some(&error));
    }

    fn protocol_failed(&self, session: &mut Option<Session>) -> CoreError {
        let error = CoreError::new(ErrorCode::ProtocolError, "Unexpected core response");
        drop(session.take());
        self.failed(error.clone());
        error
    }

    async fn request(&self, session: &mut Option<Session>, command: Command) -> Result<Data> {
        let current = session
            .as_mut()
            .ok_or_else(|| CoreError::new(ErrorCode::CoreExited, "Core is unavailable"))?;
        current.sequence += 1;
        let id = current.sequence;
        let operation = match &command {
            Command::Start { .. } => "start",
            Command::Stop { .. } => "stop",
            Command::Snapshot => "snapshot",
            Command::Shutdown => "shutdown",
        };
        let result = tokio::time::timeout(Duration::from_secs(10), async {
            let io = current.io.as_mut().unwrap();
            wire::write(io, &Request { id, command }).await?;
            let response: Response = wire::read(io).await?;
            if response.id != id {
                return Err(CoreError::new(
                    ErrorCode::ProtocolError,
                    "Core response sequence does not match",
                ));
            }
            Ok(response.result)
        })
        .await
        .unwrap_or_else(|_| {
            Err(CoreError::new(
                ErrorCode::RequestTimeout,
                "Core request timed out",
            ))
        });
        match result {
            Ok(result) => {
                if operation != "snapshot" || result.is_err() {
                    self.log(
                        operation,
                        Some(current.process.as_ref().unwrap().pid()),
                        result.as_ref().err(),
                    );
                }
                result
            }
            Err(error) => {
                self.failed(error.clone());
                if let Some(current) = session.take() {
                    let _ = retire(current).await;
                }
                Err(error)
            }
        }
    }

    /// Metadata only. Never write configurations, keys or error excerpts here.
    fn log(&self, operation: &str, pid: Option<u32>, error: Option<&CoreError>) {
        use std::io::Write;
        let path = self
            .status
            .read()
            .unwrap()
            .paths
            .data_dir
            .join("logs/core-process.jsonl");
        if std::fs::metadata(&path).is_ok_and(|metadata| metadata.len() > 512 * 1024) {
            let _ = std::fs::rename(&path, path.with_extension("previous.jsonl"));
        }
        let record = serde_json::json!({ "time": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs(),
            "operation": operation, "pid": pid, "error": error.map(|error| error.code) });
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(file, "{record}");
        }
    }
}
