use std::{path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{CoreController, CoreError, CorePaths, ErrorCode, HostState, Result, platform};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessCheckMode {
    Process,
    Tun,
    Cancel,
    Recovery,
    MissingResource,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessCheckReport {
    core_version: &'static str,
    mode: ProcessCheckMode,
    gui_pid: u32,
    gui_elevated: bool,
    core_pid: Option<u32>,
    core_elevated: Option<bool>,
    pub passed: bool,
    checks: Vec<&'static str>,
    tun_names: Vec<String>,
    pub error: Option<CoreError>,
    cleanup_error: Option<CoreError>,
    paths: CorePaths,
}

pub async fn run_process_check(
    executable: PathBuf,
    paths: CorePaths,
    mode: ProcessCheckMode,
) -> ProcessCheckReport {
    let mut report = ProcessCheckReport {
        core_version: crate::version(),
        mode,
        gui_pid: std::process::id(),
        gui_elevated: platform::elevated().unwrap_or(false),
        core_pid: None,
        core_elevated: None,
        passed: false,
        checks: Vec::new(),
        tun_names: Vec::new(),
        error: None,
        cleanup_error: None,
        paths: paths.clone(),
    };
    let core = match CoreController::new(executable, paths) {
        Ok(core) => core,
        Err(error) => {
            report.error = Some(error);
            return report;
        }
    };
    let result = check(&core, &mut report).await;
    let cleanup = core.shutdown().await;
    if let Err(error) = cleanup {
        report.cleanup_error = Some(error);
    }
    if mode == ProcessCheckMode::Tun || mode == ProcessCheckMode::Cancel {
        for name in &report.tun_names {
            if let Err(error) = wait_adapter(name, false).await {
                report.cleanup_error = Some(error);
            }
        }
        if report.cleanup_error.is_none() {
            report.checks.push("temporary_adapters_removed");
        }
    }
    report.error = result.err();
    report.passed = report.error.is_none() && report.cleanup_error.is_none();
    report
}

fn require(condition: bool, message: &str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(CoreError::new(ErrorCode::CoreFailure, message))
    }
}

fn config(id: Uuid, tun: Option<(&str, &str)>) -> String {
    let mut text = format!(
        r#"instance_id = "{id}"
hostname = "cleartier-process-check"
dhcp = false
listeners = []
peer = []
stun_servers = []
stun_servers_v6 = []
"#
    );
    if let Some((_, ipv4)) = tun {
        text.push_str(&format!("ipv4 = \"{ipv4}\"\n"));
    }
    text.push_str(&format!(
        r#"
[network_identity]
network_name = "cleartier-check-{id}"
network_secret = "{}"
[flags]
no_tun = {}
enable_ipv6 = false
disable_p2p = true
disable_upnp = true
disable_udp_hole_punching = true
disable_tcp_hole_punching = true
"#,
        Uuid::new_v4(),
        tun.is_none()
    ));
    if let Some((name, _)) = tun {
        text.push_str(&format!("dev_name = \"{name}\"\n"));
    }
    text
}

async fn wait_running(core: &CoreController, ids: &[Uuid]) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let states = core.snapshot().await?;
            for state in &states {
                if let Some(error) = &state.error {
                    return Err(CoreError::new(ErrorCode::CoreFailure, error));
                }
            }
            if ids.iter().all(|id| {
                states
                    .iter()
                    .any(|state| state.id == *id && state.running == Some(true))
            }) {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .map_err(|_| {
        CoreError::new(
            ErrorCode::StartupTimeout,
            "Network instance did not become ready",
        )
    })?
}

async fn wait_adapter(name: &str, present: bool) -> Result<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        if platform::tun_exists(name)? == present {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(CoreError::new(
                ErrorCode::CoreFailure,
                format!(
                    "Adapter '{name}' did not become {}",
                    if present { "present" } else { "absent" }
                ),
            ));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn check(core: &CoreController, report: &mut ProcessCheckReport) -> Result<()> {
    require(
        core.status().state == HostState::Stopped,
        "Controller launched a core eagerly",
    )?;
    report.checks.push("core_starts_on_demand");
    let invalid = core.start("[invalid".into()).await.unwrap_err();
    require(
        invalid.code == ErrorCode::InvalidConfig && core.status().pid.is_none(),
        "Invalid config launched a core",
    )?;
    let external = core
        .start("credential_file = 'external-file'".into())
        .await
        .unwrap_err();
    require(
        external.code == ErrorCode::InvalidConfig,
        "File-based config was accepted",
    )?;
    report
        .checks
        .push("invalid_and_file_based_configs_rejected_before_launch");

    let tun = matches!(
        report.mode,
        ProcessCheckMode::Tun | ProcessCheckMode::Cancel
    );
    if tun {
        if !cfg!(windows) {
            return Err(CoreError::new(
                ErrorCode::UnsupportedPlatform,
                "TUN checks currently target Windows",
            ));
        }
        require(
            !report.gui_elevated,
            "Run this check from a normal, non-administrator PowerShell",
        )?;
        report.checks.push("gui_remains_ordinary_user");
        report.tun_names = (0..2)
            .map(|_| format!("ct-{}", &Uuid::new_v4().simple().to_string()[..8]))
            .collect();
        for name in &report.tun_names {
            require(
                !platform::tun_exists(name)?,
                "Temporary adapter name already exists",
            )?;
        }
    }
    let first_config = config(
        Uuid::new_v4(),
        tun.then(|| (report.tun_names[0].as_str(), "198.18.0.1/32")),
    );
    let first = core.start(first_config.clone()).await;
    if report.mode == ProcessCheckMode::MissingResource {
        let error = first.err().ok_or_else(|| {
            CoreError::new(ErrorCode::CoreFailure, "Expected a missing-resource error")
        })?;
        require(
            error.code == ErrorCode::MissingResource && core.status().pid.is_none(),
            "Missing resource was not rejected before launch",
        )?;
        report
            .checks
            .push("missing_resource_reported_before_elevation");
        return Ok(());
    }
    if report.mode == ProcessCheckMode::Cancel {
        let error = first.err().ok_or_else(|| {
            CoreError::new(
                ErrorCode::CoreFailure,
                "UAC was approved; repeat this mode and choose No",
            )
        })?;
        require(
            error.code == ErrorCode::ElevationCancelled
                && core.status().state == HostState::Stopped
                && core.status().pid.is_none(),
            "UAC cancellation was not reported as stopped",
        )?;
        report
            .checks
            .push("uac_cancellation_reported_without_running_core");
        return Ok(());
    }
    let first = first?;
    let host = core.status();
    report.core_pid = host.pid;
    report.core_elevated = Some(host.elevated);
    require(
        host.pid.is_some_and(|pid| pid != report.gui_pid),
        "Core is not a separate process",
    )?;
    require(
        host.version.as_deref() == Some(crate::version()),
        "Core handshake version does not match",
    )?;
    report
        .checks
        .push("separate_process_authenticated_and_version_matched");
    if tun {
        require(host.elevated, "TUN core is not elevated")?;
        report.checks.push("only_core_is_elevated");
    }
    let second = core
        .start(config(
            Uuid::new_v4(),
            tun.then(|| (report.tun_names[1].as_str(), "198.18.0.2/32")),
        ))
        .await?;
    require(
        core.status().pid == host.pid,
        "Second network created another core process",
    )?;
    wait_running(core, &[first, second]).await?;
    report.checks.push("two_instances_share_one_core_process");
    if tun {
        for name in &report.tun_names {
            wait_adapter(name, true).await?;
        }
        report.checks.push("two_tun_adapters_visible_to_windows");
    }
    require(
        core.start(first_config.clone()).await.is_err(),
        "Duplicate network was accepted",
    )?;
    report.checks.push("duplicate_instance_rejected_over_ipc");
    if report.mode == ProcessCheckMode::Recovery {
        core.interrupt_for_check().await?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while core.status().state != HostState::Failed && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        require(
            core.status()
                .error
                .is_some_and(|error| error.code == ErrorCode::CoreExited),
            "Unexpected exit was not reported",
        )?;
        require(
            core.snapshot().await.is_err(),
            "Lost core was reported as an empty healthy snapshot",
        )?;
        report.checks.push("unexpected_exit_reported");
        let id = core.start(first_config).await?;
        require(core.status().pid != host.pid, "Failed process was reused")?;
        wait_running(core, &[id]).await?;
        report.checks.push("new_core_can_start_after_failure");
        core.stop(id).await?;
    } else {
        core.stop(first).await?;
        wait_running(core, &[second]).await?;
        require(
            core.snapshot().await?.len() == 1,
            "Stopped network remains in snapshot",
        )?;
        if tun {
            wait_adapter(&report.tun_names[0], false).await?;
            require(
                platform::tun_exists(&report.tun_names[1])?,
                "Stopping one network removed the other adapter",
            )?;
        }
        report
            .checks
            .push("stopping_one_network_keeps_other_running");
        core.stop(second).await?;
        require(
            core.snapshot().await?.is_empty(),
            "Networks remain after stopping",
        )?;
        if !tun {
            let id = core.start(first_config).await?;
            wait_running(core, &[id]).await?;
            core.stop(id).await?;
            report.checks.push("network_can_restart_over_ipc");
        }
    }
    core.shutdown().await?;
    require(
        core.status().state == HostState::Stopped && core.status().pid.is_none(),
        "Core did not shut down",
    )?;
    report.checks.push("core_shutdown_completed");
    Ok(())
}
