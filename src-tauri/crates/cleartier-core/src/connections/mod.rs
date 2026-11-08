//! The connection Interface owns ordering, running configurations and failures.
//! Disk persistence stays outside this Module; restarting never restores an old
//! connection after a failed new start.
pub(crate) mod config;
use crate::{
    InstanceSnapshot,
    process::{CoreController, CoreError, ErrorCode, Result},
};
use cleartier_config::ConnectionConfig;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    future::Future,
    path::PathBuf,
};
use tokio::sync::Mutex;
use uuid::Uuid;

pub trait Backend: Send + Sync {
    fn start(&self, toml: String) -> impl Future<Output = Result<Uuid>> + Send;
    fn stop(&self, id: Uuid) -> impl Future<Output = Result<()>> + Send;
    fn snapshot(&self) -> impl Future<Output = Result<Vec<InstanceSnapshot>>> + Send;
}
impl Backend for CoreController {
    async fn start(&self, toml: String) -> Result<Uuid> {
        self.start(toml).await
    }
    async fn stop(&self, id: Uuid) -> Result<()> {
        self.stop(id).await
    }
    async fn snapshot(&self) -> Result<Vec<InstanceSnapshot>> {
        let result = self.snapshot().await;
        if result.is_err() && self.status().state == crate::process::HostState::Failed {
            Err(CoreError::new(
                ErrorCode::CoreExited,
                "The owned core is unavailable",
            ))
        } else {
            result
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum Operation {
    Start { id: Uuid, config: ConnectionConfig },
    Restart { id: Uuid, config: ConnectionConfig },
    Stop { id: Uuid },
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSnapshot {
    pub telemetry: Option<crate::TelemetrySnapshot>,
    pub id: Uuid,
    pub state: &'static str,
    pub running_config: Option<ConnectionConfig>,
    pub device_name: String,
    pub virtual_ip: Option<String>,
    pub peer_count: usize,
    pub direct_peer_count: usize,
    pub error: Option<CoreError>,
}
#[derive(Default)]
struct State {
    configs: BTreeMap<Uuid, ConnectionConfig>,
    measurements: BTreeMap<Uuid, crate::TelemetrySnapshot>,
    errors: BTreeMap<Uuid, CoreError>,
    lease: Option<File>,
    order: Vec<Uuid>,
}

pub struct NetworkManager<B = CoreController> {
    backend: B,
    state: Mutex<State>,
    lease_path: PathBuf,
}
impl<B: Backend> NetworkManager<B> {
    pub fn new(backend: B, lease_path: PathBuf) -> Self {
        Self {
            backend,
            state: Mutex::new(State::default()),
            lease_path,
        }
    }

    pub async fn operate(&self, operation: Operation) -> Result<Vec<NetworkSnapshot>> {
        let mut state = self.state.lock().await;
        if state.lease.is_none() {
            state.lease = Some(self.lease()?);
        }
        let id = match &operation {
            Operation::Start { id, .. }
            | Operation::Restart { id, .. }
            | Operation::Stop { id } => *id,
        };
        let result = self.perform(&mut state, operation).await;
        if let Err(error) = &result {
            state.errors.insert(id, error.clone());
        }
        result?;
        self.collect(&mut state).await
    }

    pub async fn snapshot(&self) -> Result<Vec<NetworkSnapshot>> {
        let mut state = self.state.lock().await;
        // Another GUI may edit the same documents, but may not claim ownership
        // of this application's networks or report them as stopped.
        let _probe = if state.lease.is_none() {
            Some(self.lease()?)
        } else {
            None
        };
        self.collect(&mut state).await
    }

    async fn perform(&self, state: &mut State, operation: Operation) -> Result<()> {
        let restarting = matches!(&operation, Operation::Restart { .. });
        let snapshots = match self.backend.snapshot().await {
            Ok(snapshots) => snapshots,
            Err(error) if error.code == ErrorCode::CoreExited => {
                state.configs.clear();
                vec![]
            }
            Err(error) => return Err(error),
        };
        for snapshot in &snapshots {
            if let Some(telemetry) = &snapshot.telemetry {
                state.measurements.insert(snapshot.id, telemetry.clone());
            }
        }
        state
            .configs
            .retain(|id, _| snapshots.iter().any(|snapshot| snapshot.id == *id));
        match operation {
            Operation::Stop { id } => {
                self.backend.stop(id).await?;
                state.configs.remove(&id);
                state.errors.remove(&id);
                Ok(())
            }
            Operation::Start { id, config } | Operation::Restart { id, config } => {
                // Validation and logical conflicts are checked before disturbing
                // an existing session. There is no stop/start rollback path.
                let toml = config::to_core(id, &config)?;
                for (other_id, running) in &state.configs {
                    if *other_id == id {
                        continue;
                    }
                    if config.same_network(running) {
                        return Err(CoreError::new(
                            ErrorCode::NetworkAlreadyRunning,
                            "Another profile for this network is active",
                        ));
                    }
                    if !config.tun_name.is_empty()
                        && running.tun_name.eq_ignore_ascii_case(&config.tun_name)
                    {
                        return Err(CoreError::new(
                            ErrorCode::TunNameInUse,
                            "The interface name is in use",
                        ));
                    }
                    if config.ipv4_mode == "manual"
                        && running.ipv4_mode == "manual"
                        && config.ipv4_address == running.ipv4_address
                    {
                        return Err(CoreError::new(
                            ErrorCode::AddressInUse,
                            "The virtual address is in use",
                        ));
                    }
                }
                if snapshots.iter().any(|snapshot| snapshot.id == id) {
                    if !restarting
                        && snapshots
                            .iter()
                            .any(|snapshot| snapshot.id == id && snapshot.running != Some(false))
                    {
                        return Err(CoreError::new(
                            ErrorCode::InstanceRunning,
                            "The instance is already active",
                        ));
                    }
                    self.backend.stop(id).await?;
                    state.configs.remove(&id);
                }
                state.errors.remove(&id);
                let started = self.backend.start(toml).await?;
                if started != id {
                    return Err(CoreError::new(
                        ErrorCode::ProtocolError,
                        "Unexpected instance ID",
                    ));
                }
                state.configs.insert(id, config);
                state.order.retain(|item| *item != id);
                state.order.push(id);
                // Readiness requires a real TUN-ready event. No peer is required:
                // an empty network is a valid running instance.
                let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(12);
                loop {
                    let snapshots = self.backend.snapshot().await?;
                    if let Some(snapshot) = snapshots.iter().find(|snapshot| snapshot.id == id) {
                        if snapshot.fatal || snapshot.running == Some(false) {
                            let error = CoreError::new(
                                snapshot.issue.unwrap_or(ErrorCode::InstanceFailed),
                                "The instance failed to start",
                            );
                            self.backend.stop(id).await?;
                            state.configs.remove(&id);
                            return Err(error);
                        }
                        if snapshot.ready && snapshot.running == Some(true) {
                            if snapshot.virtual_ip.is_some()
                                && snapshots.iter().any(|other| {
                                    other.id != id
                                        && other.ready
                                        && other.virtual_ip == snapshot.virtual_ip
                                })
                            {
                                self.backend.stop(id).await?;
                                state.configs.remove(&id);
                                return Err(CoreError::new(
                                    ErrorCode::AddressInUse,
                                    "Another network uses this virtual address",
                                ));
                            }
                            return Ok(());
                        }
                    }
                    if tokio::time::Instant::now() >= deadline {
                        self.backend.stop(id).await?;
                        state.configs.remove(&id);
                        return Err(CoreError::new(
                            ErrorCode::InstanceStartTimeout,
                            "The instance did not become ready",
                        ));
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
    }

    async fn collect(&self, state: &mut State) -> Result<Vec<NetworkSnapshot>> {
        let mut snapshots = match self.backend.snapshot().await {
            Ok(snapshots) => snapshots,
            Err(error) if error.code == ErrorCode::CoreExited => {
                for id in state.configs.keys() {
                    state.errors.insert(*id, error.clone());
                }
                state.configs.clear();
                vec![]
            }
            Err(error) => return Err(error),
        };
        // DHCP may assign an address after the initial ready acknowledgement.
        // Keep the earlier network, stop only the newer conflicting instance.
        snapshots.sort_by_key(|snapshot| {
            state
                .order
                .iter()
                .position(|id| *id == snapshot.id)
                .map(|position| position + 1)
                .unwrap_or(0)
        });
        let mut addresses = BTreeMap::new();
        let mut removed = Vec::new();
        for snapshot in &snapshots {
            if !snapshot.ready {
                continue;
            }
            if let Some(address) = &snapshot.virtual_ip {
                if addresses.insert(address.clone(), snapshot.id).is_some()
                    && state.configs.contains_key(&snapshot.id)
                {
                    self.backend.stop(snapshot.id).await?;
                    state.configs.remove(&snapshot.id);
                    state.errors.insert(
                        snapshot.id,
                        CoreError::new(
                            ErrorCode::AddressInUse,
                            "Another network uses this virtual address",
                        ),
                    );
                    removed.push(snapshot.id);
                }
            }
        }
        snapshots.retain(|snapshot| !removed.contains(&snapshot.id));
        state.order.retain(|id| state.configs.contains_key(id));
        let mut result = Vec::new();
        for snapshot in &snapshots {
            if let Some(telemetry) = &snapshot.telemetry {
                state.measurements.insert(snapshot.id, telemetry.clone());
            }
            let observed = snapshot
                .issue
                .map(|code| CoreError::new(code, "A network condition requires attention"));
            let error = if snapshot.fatal {
                observed.or_else(|| state.errors.get(&snapshot.id).cloned())
            } else {
                state.errors.get(&snapshot.id).cloned().or(observed)
            };
            result.push(NetworkSnapshot {
                telemetry: snapshot.telemetry.clone(),
                id: snapshot.id,
                state: if snapshot.fatal || snapshot.running == Some(false) {
                    "failed"
                } else if snapshot.running.is_none() {
                    "unknown"
                } else if snapshot.ready {
                    "running"
                } else {
                    "starting"
                },
                running_config: state.configs.get(&snapshot.id).cloned(),
                device_name: snapshot.device_name.clone(),
                virtual_ip: snapshot.virtual_ip.clone(),
                peer_count: snapshot.peer_count,
                direct_peer_count: snapshot.direct_peer_count,
                error,
            });
        }
        for (id, error) in &state.errors {
            if !snapshots.iter().any(|snapshot| snapshot.id == *id) {
                result.push(NetworkSnapshot {
                    telemetry: state.measurements.get(id).cloned(),
                    id: *id,
                    state: "failed",
                    running_config: None,
                    device_name: String::new(),
                    virtual_ip: None,
                    peer_count: 0,
                    direct_peer_count: 0,
                    error: Some(error.clone()),
                });
            }
        }
        for (id, telemetry) in &state.measurements {
            if !result.iter().any(|snapshot| snapshot.id == *id) {
                result.push(NetworkSnapshot {
                    id: *id,
                    state: "stopped",
                    running_config: None,
                    telemetry: Some(telemetry.clone()),
                    device_name: String::new(),
                    virtual_ip: None,
                    peer_count: 0,
                    direct_peer_count: 0,
                    error: None,
                });
            }
        }
        state
            .configs
            .retain(|id, _| snapshots.iter().any(|snapshot| snapshot.id == *id));
        Ok(result)
    }

    fn lease(&self) -> Result<File> {
        if let Some(parent) = self.lease_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&self.lease_path)?;
        file.try_lock().map_err(|_| {
            CoreError::new(
                ErrorCode::OtherController,
                "Another ClearTier window controls the core",
            )
        })?;
        Ok(file)
    }
}

#[cfg(test)]
mod tests;
