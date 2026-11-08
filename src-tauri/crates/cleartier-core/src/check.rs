use std::time::Duration;

use anyhow::{Context, Result, ensure};
use serde::Serialize;
use uuid::Uuid;

use crate::{CoreRuntime, version};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckReport {
    pub core_version: &'static str,
    pub passed: bool,
    pub checks: Vec<&'static str>,
    pub error: Option<String>,
}

/// Exercises real instances without a TUN, peers, listeners or saved configuration.
pub async fn run_check() -> CheckReport {
    let mut report = CheckReport {
        core_version: version(),
        passed: false,
        checks: vec!["linked_core_version"],
        error: None,
    };
    match check_instances(&mut report.checks).await {
        Ok(()) => report.passed = true,
        Err(error) => report.error = Some(format!("{error:#}")),
    }
    report
}

fn isolated_config() -> String {
    format!(
        r#"instance_id = "{}"
instance_name = "ClearTier core check"
hostname = "cleartier-check"
dhcp = false
listeners = []
peer = []
stun_servers = []
stun_servers_v6 = []

[network_identity]
network_name = "cleartier-check-{}"
network_secret = "{}"

[flags]
no_tun = true
enable_ipv6 = false
disable_p2p = true
disable_upnp = true
disable_udp_hole_punching = true
disable_tcp_hole_punching = true
"#,
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
    )
}

async fn wait_running(core: &CoreRuntime, ids: &[Uuid]) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let states = core.snapshot().await?;
            for state in &states {
                if let Some(error) = &state.error {
                    anyhow::bail!("instance {}: {}", state.id, error);
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
    .context("instances did not become ready within 15 seconds")?
}

async fn check_instances(checks: &mut Vec<&'static str>) -> Result<()> {
    let core = CoreRuntime::default();
    ensure!(core.start("[invalid").is_err(), "invalid TOML was accepted");
    checks.push("invalid_configuration_rejected");

    let first_config = isolated_config();
    let first = core.start(&first_config)?;
    let second = core.start(&isolated_config())?;
    wait_running(&core, &[first, second]).await?;
    checks.push("two_instances_running");

    ensure!(
        core.start(&first_config).is_err(),
        "duplicate instance was accepted"
    );
    checks.push("duplicate_instance_rejected");

    core.stop(first)?;
    wait_running(&core, &[second]).await?;
    ensure!(
        core.snapshot().await?.len() == 1,
        "stopped instance is still present"
    );
    checks.push("stop_one_keeps_other_running");

    core.stop(second)?;
    ensure!(
        core.snapshot().await?.is_empty(),
        "instances remain after stop"
    );
    checks.push("all_instances_stopped");

    let restarted = core.start(&first_config)?;
    wait_running(&core, &[restarted]).await?;
    core.stop(restarted)?;
    checks.push("instance_can_restart");
    Ok(())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn real_core_lifecycle_without_tun() {
        let report = super::run_check().await;
        assert!(report.passed, "{report:?}");
        assert_eq!(report.checks.len(), 7);
    }
}
