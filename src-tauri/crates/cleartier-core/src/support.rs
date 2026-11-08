//! Diagnostic exports are constructed from an allowlist. No configuration,
//! path, host name, address, endpoint, UUID or unstructured error is serialized.
use crate::{
    connections::NetworkSnapshot,
    process::{ErrorCode, HostStatus},
};
use easytier::common::config::{ConfigLoader, TomlConfigLoader};
use serde::{Deserialize, Serialize};
use std::{io::Read, path::Path};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentError {
    pub time: u64,
    pub code: ErrorCode,
}
impl RecentError {
    pub fn new(code: ErrorCode) -> Self {
        Self {
            time: timestamp(),
            code,
        }
    }
}
pub fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    schema_version: u32,
    generated_at: u64,
    app_version: String,
    core_version: &'static str,
    platform: &'static str,
    architecture: &'static str,
    configuration_readable: bool,
    preferences_readable: bool,
    core_state: crate::process::HostState,
    core_error: Option<ErrorCode>,
    core_elevated: bool,
    snapshot_error: Option<ErrorCode>,
    networks: Vec<NetworkReport>,
    pub recent_errors: Vec<RecentError>,
    process_events: Vec<ProcessEvent>,
    process_logs_readable: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkReport {
    number: usize,
    state: &'static str,
    virtual_address_assigned: bool,
    interface_expected: Option<bool>,
    interface_present: Option<bool>,
    peer_count: usize,
    direct_peer_count: usize,
    error: Option<ErrorCode>,
    recovery: Option<crate::connections::RecoverySnapshot>,
}
#[derive(Serialize, Deserialize)]
struct ProcessEvent {
    time: u64,
    operation: String,
    error: Option<ErrorCode>,
}
fn events(text: &str) -> Vec<ProcessEvent> {
    text.lines()
        .filter_map(|line| serde_json::from_str::<ProcessEvent>(line).ok())
        .filter(|event| {
            event.time <= timestamp().saturating_add(86400)
                && matches!(
                    event.operation.as_str(),
                    "ready" | "launch" | "start" | "stop" | "snapshot" | "shutdown" | "failed"
                )
        })
        .collect()
}
fn read_events(directory: &Path) -> (Vec<ProcessEvent>, bool) {
    let mut result = Vec::new();
    let mut readable = true;
    for name in ["core-process.previous.jsonl", "core-process.jsonl"] {
        match std::fs::File::open(directory.join(name)) {
            Ok(file) => {
                let mut text = String::new();
                if file.take(1024 * 1024).read_to_string(&mut text).is_ok() {
                    result.extend(events(&text));
                } else {
                    readable = false;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => readable = false,
        }
    }
    if result.len() > 200 {
        result.drain(..result.len() - 200);
    }
    (result, readable)
}
impl Report {
    pub fn collect(
        app_version: String,
        status: &HostStatus,
        snapshots: Result<Vec<NetworkSnapshot>, ErrorCode>,
        configuration_readable: bool,
        preferences_readable: bool,
        mut recent_errors: Vec<RecentError>,
    ) -> Self {
        let (process_events, process_logs_readable) =
            read_events(&status.paths.data_dir.join("logs"));
        let snapshot_error = snapshots.as_ref().err().copied();
        let networks = snapshots
            .unwrap_or_default()
            .into_iter()
            .enumerate()
            .map(|(index, snapshot)| {
                let interface_expected = snapshot
                    .running_config
                    .as_ref()
                    .and_then(|config| {
                        crate::configuration::for_connection(snapshot.id, config).ok()
                    })
                    .and_then(|text| TomlConfigLoader::new_from_str(&text).ok())
                    .map(|config| !config.get_flags().no_tun);
                let interface_present =
                    if interface_expected == Some(true) && snapshot.state == "running" {
                        crate::process::interface_present(&snapshot.device_name)
                    } else {
                        None
                    };
                NetworkReport {
                    number: index + 1,
                    state: snapshot.state,
                    virtual_address_assigned: snapshot.virtual_ip.is_some(),
                    interface_expected,
                    interface_present,
                    peer_count: snapshot.peer_count,
                    direct_peer_count: snapshot.direct_peer_count,
                    error: snapshot.error.map(|error| error.code),
                    recovery: snapshot.recovery,
                }
            })
            .collect();
        recent_errors.extend(process_events.iter().filter_map(|event| {
            event.error.map(|code| RecentError {
                time: event.time,
                code,
            })
        }));
        recent_errors.sort_by_key(|error| error.time);
        recent_errors.dedup_by(|a, b| a.time == b.time && a.code == b.code);
        if recent_errors.len() > 50 {
            recent_errors.drain(..recent_errors.len() - 50);
        }
        Self {
            schema_version: 1,
            generated_at: timestamp(),
            app_version,
            core_version: crate::version(),
            platform: std::env::consts::OS,
            architecture: std::env::consts::ARCH,
            configuration_readable,
            preferences_readable,
            core_state: status.state,
            core_error: status.error.as_ref().map(|error| error.code),
            core_elevated: status.elevated,
            snapshot_error,
            networks,
            recent_errors,
            process_events,
            process_logs_readable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostic_export_ignores_unknown_text_and_never_copies_raw_logs_or_paths() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join("logs")).unwrap();
        let logs = concat!(
            "{\"time\":1,\"operation\":\"start\",\"error\":\"invalid_config\",\"secret\":\"PRIVATE_KEY\",\"path\":\"USER_DIRECTORY\"}\n",
            "{\"time\":2,\"operation\":\"PRIVATE_CONFIG\",\"error\":null}\n",
            "{\"time\":18446744073709551615,\"operation\":\"start\",\"error\":\"io\"}\n",
            "unstructured PRIVATE_TEXT\n"
        );
        std::fs::write(directory.path().join("logs/core-process.jsonl"), logs).unwrap();
        let status = HostStatus {
            state: crate::process::HostState::Stopped,
            pid: None,
            elevated: false,
            version: None,
            error: Some(crate::process::CoreError {
                code: ErrorCode::CoreExited,
                message: "PRIVATE_ERROR".into(),
            }),
            paths: crate::process::CorePaths::new("USER_DIRECTORY".into(), directory.path().into()),
        };
        let id = uuid::Uuid::new_v4();
        let config = crate::configuration::import(id, "hostname = 'PRIVATE_HOST'\n[network_identity]\nnetwork_name = 'PRIVATE_NETWORK'\nnetwork_secret = 'PRIVATE_SECRET'\n").unwrap().config;
        let snapshot = NetworkSnapshot {
            id,
            revision: 1,
            recovery_config: None,
            state: "running",
            running_config: Some(config),
            device_name: "PRIVATE_DEVICE".into(),
            virtual_ip: Some("198.18.0.123".into()),
            peer_count: 1,
            direct_peer_count: 1,
            telemetry: None,
            recovery: None,
            error: None,
        };
        let report = Report::collect(
            "0.1.0".into(),
            &status,
            Ok(vec![snapshot]),
            true,
            true,
            vec![],
        );
        let output = serde_json::to_string(&report).unwrap();
        assert!(!output.contains("PRIVATE"));
        assert!(!output.contains("USER_DIRECTORY"));
        assert!(!output.contains("198.18.0.123"));
        assert!(!output.contains(&id.to_string()));
        assert!(!output.contains("18446744073709551615"));
        assert!(!output.contains(&directory.path().display().to_string()));
        assert_eq!(report.recent_errors.len(), 1);
        assert!(output.contains("invalid_config"));
    }
}
