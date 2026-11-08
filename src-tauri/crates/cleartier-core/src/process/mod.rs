//! One authenticated, owned core process per controller. No network RPC listener.
mod controller;
mod diagnostics;
mod platform;
mod wire;
mod worker;

use std::{fmt, path::PathBuf};

use serde::{Deserialize, Serialize};

pub use controller::CoreController;
pub use diagnostics::{ProcessCheckMode, ProcessCheckReport, run_process_check};
pub use worker::run_worker;

pub(crate) fn interface_present(name: &str) -> Option<bool> {
    if name.is_empty() {
        None
    } else {
        platform::tun_exists(name).ok()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidConfig,
    UnsupportedConfig,
    NetworkAlreadyRunning,
    InstanceRunning,
    TunNameInUse,
    AddressInUse,
    OtherController,
    InstanceFailed,
    TunFailed,
    ListenerFailed,
    PeerUnreachable,
    AddressConflict,
    BroadcastFailed,
    InstanceStartTimeout,
    MissingResource,
    ResourceMismatch,
    ElevationCancelled,
    ElevationRequired,
    UnsupportedPlatform,
    LaunchFailed,
    IdentityRejected,
    ProtocolError,
    StartupTimeout,
    RequestTimeout,
    CoreExited,
    CoreFailure,
    Io,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreError {
    pub code: ErrorCode,
    pub message: String,
}

impl CoreError {
    pub(crate) fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for CoreError {}

impl From<std::io::Error> for CoreError {
    fn from(error: std::io::Error) -> Self {
        Self::new(ErrorCode::Io, error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorePaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
}

impl CorePaths {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            config_dir,
            data_dir,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HostState {
    Stopped,
    Starting,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub state: HostState,
    pub pid: Option<u32>,
    pub elevated: bool,
    pub version: Option<String>,
    pub error: Option<CoreError>,
    pub paths: CorePaths,
}

/// File-based configuration and logging stay in the ordinary GUI process.
fn parse_config(toml: &str) -> Result<easytier::common::config::TomlConfigLoader> {
    use easytier::common::config::TomlConfigLoader;
    let value: toml::Table = toml::from_str(toml)
        .map_err(|_| CoreError::new(ErrorCode::InvalidConfig, "Invalid TOML configuration"))?;
    for key in ["credential_file", "source", "file_logger", "console_logger"] {
        if value.contains_key(key) {
            return Err(CoreError::new(
                ErrorCode::InvalidConfig,
                format!("File-based field '{key}' is not accepted by the core process"),
            ));
        }
    }
    // Validate flags before invoking upstream's loader (which unwraps bad types).
    if !crate::configuration::validation_issues(&value).is_empty() {
        return Err(CoreError::new(
            ErrorCode::InvalidConfig,
            "Unsupported EasyTier configuration",
        ));
    }
    TomlConfigLoader::new_from_str(toml)
        .map_err(|_| CoreError::new(ErrorCode::InvalidConfig, "Invalid EasyTier configuration"))
}
