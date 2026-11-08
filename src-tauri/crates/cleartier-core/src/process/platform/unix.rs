use std::{
    fs::File,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
};

use tokio::net::{UnixListener, UnixStream};

use super::OwnerGuard;
use crate::process::{CoreError, ErrorCode, Result, wire::Connection};

pub struct Listener {
    listener: UnixListener,
    path: PathBuf,
}

impl Listener {
    pub fn create(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory)?;
        let metadata = std::fs::symlink_metadata(directory)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(CoreError::new(
                ErrorCode::IdentityRejected,
                "Invalid runtime directory",
            ));
        }
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
        let path = directory.join(format!(
            "ct-{}.sock",
            &uuid::Uuid::new_v4().simple().to_string()[..12]
        ));
        let listener = UnixListener::bind(&path)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        Ok(Self { listener, path })
    }

    pub fn endpoint(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    pub async fn accept(&mut self, expected_pid: u32) -> Result<Connection> {
        loop {
            let (io, _) = self.listener.accept().await?;
            let credentials = io.peer_cred()?;
            if credentials.pid() == Some(expected_pid as _)
                && credentials.uid() == unsafe { libc::geteuid() }
            {
                return Ok(Box::new(io));
            }
        }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

pub struct Process(std::process::Child);

impl Process {
    pub fn pid(&self) -> u32 {
        self.0.id()
    }
    pub fn exited(&mut self) -> Result<bool> {
        Ok(self.0.try_wait()?.is_some())
    }
    pub fn terminate(&mut self) -> Result<()> {
        self.0.kill()?;
        Ok(())
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub async fn spawn(
    executable: &Path,
    endpoint: &str,
    elevate: bool,
    resources: Vec<File>,
) -> Result<(Process, Vec<File>)> {
    if elevate {
        return Err(CoreError::new(
            ErrorCode::UnsupportedPlatform,
            "Automatic TUN elevation is currently implemented for Windows only",
        ));
    }
    Ok((
        Process(
            std::process::Command::new(executable)
                .args(["--core-host", endpoint, &std::process::id().to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| CoreError::new(ErrorCode::LaunchFailed, error.to_string()))?,
        ),
        resources,
    ))
}

pub async fn connect(endpoint: &str, owner: u32) -> Result<Connection> {
    let io = UnixStream::connect(endpoint).await?;
    let credentials = io.peer_cred()?;
    if credentials.pid() != Some(owner as _) || credentials.uid() != unsafe { libc::geteuid() } {
        return Err(CoreError::new(
            ErrorCode::IdentityRejected,
            "Unexpected controller process",
        ));
    }
    Ok(Box::new(io))
}

pub fn guard_owner(owner: u32) -> Result<OwnerGuard> {
    #[cfg(target_os = "linux")]
    {
        let image = std::fs::read_link(format!("/proc/{owner}/exe"))?;
        if image != std::env::current_exe()? {
            return Err(CoreError::new(
                ErrorCode::IdentityRejected,
                "Controller image does not match",
            ));
        }
    }
    Ok(OwnerGuard(tokio::spawn(async move {
        loop {
            if unsafe { libc::kill(owner as _, 0) } != 0 {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                std::process::exit(0);
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    })))
}

pub fn elevated() -> Result<bool> {
    Ok(unsafe { libc::geteuid() } == 0)
}
pub fn lock_resources(_executable: &Path) -> Result<Vec<File>> {
    Ok(Vec::new())
}
pub fn tun_exists(name: &str) -> Result<bool> {
    let name = std::ffi::CString::new(name)
        .map_err(|_| CoreError::new(ErrorCode::InvalidConfig, "Invalid interface name"))?;
    // Both Linux and macOS expose real interface names through this POSIX call.
    Ok(unsafe { libc::if_nametoindex(name.as_ptr()) } != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn restricts_socket_and_rejects_a_different_pid() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("run");
        let mut listener = Listener::create(&directory).unwrap();
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(listener.endpoint())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        let _intruder = UnixStream::connect(listener.endpoint()).await.unwrap();
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(100),
                listener.accept(std::process::id() + 1)
            )
            .await
            .is_err()
        );
        let _authorized = UnixStream::connect(listener.endpoint()).await.unwrap();
        assert!(listener.accept(std::process::id()).await.is_ok());
        let path = listener.endpoint();
        drop(listener);
        assert!(!Path::new(&path).exists());
    }
}

pub fn address_exists(address: std::net::Ipv4Addr) -> Result<bool> {
    let mut head = std::ptr::null_mut();
    if unsafe { libc::getifaddrs(&mut head) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut found = false;
    let mut current = head;
    while !current.is_null() {
        let item = unsafe { &*current };
        if !item.ifa_addr.is_null() && unsafe { (*item.ifa_addr).sa_family } as i32 == libc::AF_INET
        {
            let socket = unsafe { &*(item.ifa_addr as *const libc::sockaddr_in) };
            if std::net::Ipv4Addr::from(socket.sin_addr.s_addr.to_ne_bytes()) == address {
                found = true;
                break;
            }
        }
        current = item.ifa_next;
    }
    unsafe {
        libc::freeifaddrs(head);
    }
    Ok(found)
}

#[cfg(test)]
#[test]
fn detects_actual_posix_interfaces_without_a_linux_only_path() {
    let loopback = if cfg!(target_os = "macos") {
        "lo0"
    } else {
        "lo"
    };
    assert!(tun_exists(loopback).unwrap());
    assert!(!tun_exists("ct-no-such-nic").unwrap());
}
