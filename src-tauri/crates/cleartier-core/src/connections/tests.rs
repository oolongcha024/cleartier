use super::*;
use easytier::common::config::{ConfigLoader, TomlConfigLoader};
use std::sync::{Arc, Mutex as StdMutex};

fn parameters(name: &str) -> ConnectionConfig {
    serde_json::from_value(serde_json::json!({"name":name,"secret":" secret \" with spaces ","servers":["tcp://127.0.0.1:11010"],
        "hostname":null,"ipv4Mode":"auto","ipv4Address":"","ipv4Prefix":24,"tunName":format!("ct-{name}"),"mtu":null,
        "ipv6":true,"p2pPolicy":"auto","latencyFirst":false,"tcpHolePunching":true,"udpHolePunching":true,
        "upnp":true,"magicDns":false,"dnsSuffix":"et.net.","udpBroadcastRelay":false})).unwrap()
}
#[derive(Default)]
struct Script {
    tomls: Vec<String>,
    background_starts: usize,
    fail_background: Option<ErrorCode>,
    snapshots: BTreeMap<Uuid, InstanceSnapshot>,
    calls: Vec<(String, Uuid)>,
    fail_start: Option<ErrorCode>,
    fail_stop: Option<ErrorCode>,
    fail_shutdown: bool,
    stop_gate: Option<Arc<tokio::sync::Notify>>,
    stop_entered: Option<Arc<tokio::sync::Notify>>,
    fatal_start: bool,
    fail_query: bool,
    not_ready: bool,
    start_gate: Option<Arc<tokio::sync::Notify>>,
    start_entered: Option<Arc<tokio::sync::Notify>>,
}
#[derive(Clone, Default)]
struct Fake(Arc<StdMutex<Script>>);
impl Backend for Fake {
    async fn start_in_background(&self, toml: String) -> Result<Uuid> {
        {
            let mut script = self.0.lock().unwrap();
            script.background_starts += 1;
            if let Some(code) = script.fail_background {
                return Err(CoreError::new(code, "background failure"));
            }
        }
        self.start(toml).await
    }
    async fn start(&self, toml: String) -> Result<Uuid> {
        let config = TomlConfigLoader::new_from_str(&toml).unwrap();
        let id = config.get_id();
        let (gate, entered) = {
            let script = self.0.lock().unwrap();
            (script.start_gate.clone(), script.start_entered.clone())
        };
        if let Some(entered) = entered {
            entered.notify_one();
        }
        if let Some(gate) = gate {
            gate.notified().await;
        }
        let mut script = self.0.lock().unwrap();
        script.tomls.push(toml);
        script.calls.push(("start".into(), id));
        if let Some(code) = script.fail_start.take() {
            return Err(CoreError::new(code, "scripted failure"));
        }
        let fatal = script.fatal_start;
        let ready = !fatal && !script.not_ready;
        script.snapshots.insert(
            id,
            InstanceSnapshot {
                telemetry: None,
                id,
                running: Some(!fatal),
                device_name: config.get_flags().dev_name,
                error: None,
                ready,
                virtual_ip: None,
                peer_count: 0,
                direct_peer_count: 0,
                issue: fatal.then_some(ErrorCode::TunFailed),
                fatal,
            },
        );
        Ok(id)
    }
    async fn stop(&self, id: Uuid) -> Result<()> {
        let (gate, entered) = {
            let script = self.0.lock().unwrap();
            (script.stop_gate.clone(), script.stop_entered.clone())
        };
        if let Some(entered) = entered {
            entered.notify_one();
        }
        if let Some(gate) = gate {
            gate.notified().await;
        }
        let mut script = self.0.lock().unwrap();
        script.calls.push(("stop".into(), id));
        if let Some(code) = script.fail_stop {
            return Err(CoreError::new(code, "Stop could not be confirmed"));
        }
        script.snapshots.remove(&id);
        Ok(())
    }
    async fn shutdown(&self) -> Result<()> {
        let mut script = self.0.lock().unwrap();
        if script.fail_shutdown {
            return Err(CoreError::new(ErrorCode::Io, "Cleanup not confirmed"));
        }
        script.snapshots.clear();
        Ok(())
    }
    async fn snapshot(&self) -> Result<Vec<InstanceSnapshot>> {
        let script = self.0.lock().unwrap();
        if script.fail_query {
            return Err(CoreError::new(ErrorCode::RequestTimeout, "query failed"));
        }
        Ok(script.snapshots.values().cloned().collect())
    }
}

#[tokio::test]
async fn update_cleanup_requires_confirmation_and_reopens_only_after_confirmed_cleanup() {
    let root = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), root.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    assert!(!manager.shutdown_for_update(false).await.unwrap());
    assert!(fake.0.lock().unwrap().snapshots.contains_key(&id));

    fake.0.lock().unwrap().fail_shutdown = true;
    assert!(manager.shutdown_for_update(true).await.is_err());
    manager.resume_after_update(true).await;
    assert!(
        manager
            .operate(Operation::Start {
                id: Uuid::new_v4(),
                config: parameters("other")
            })
            .await
            .is_err()
    );
    assert!(fake.0.lock().unwrap().snapshots.contains_key(&id));

    fake.0.lock().unwrap().fail_shutdown = false;
    assert!(manager.shutdown_for_update(true).await.unwrap());
    assert!(fake.0.lock().unwrap().snapshots.is_empty());
    assert!(
        manager
            .operate(Operation::Start {
                id,
                config: parameters("office")
            })
            .await
            .is_err()
    );
    manager.resume_after_update(true).await;
    manager.maintain().await.unwrap();
    assert!(fake.0.lock().unwrap().snapshots.is_empty());
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn update_cleanup_waits_for_and_compensates_an_in_flight_start() {
    let root = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let gate = Arc::new(tokio::sync::Notify::new());
    let entered = Arc::new(tokio::sync::Notify::new());
    {
        let mut script = fake.0.lock().unwrap();
        script.start_gate = Some(gate.clone());
        script.start_entered = Some(entered.clone());
    }
    let manager = NetworkManager::new(fake.clone(), root.path().join("lease"));
    let worker = manager.clone();
    let start = tokio::spawn(async move {
        worker
            .operate(Operation::Start {
                id: Uuid::new_v4(),
                config: parameters("office"),
            })
            .await
    });
    entered.notified().await;
    assert!(!manager.shutdown_for_update(false).await.unwrap());
    let worker = manager.clone();
    let cleanup = tokio::spawn(async move { worker.shutdown_for_update(true).await });
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    assert!(!cleanup.is_finished());
    gate.notify_one();
    let _ = start.await.unwrap();
    assert!(cleanup.await.unwrap().unwrap());
    assert!(fake.0.lock().unwrap().snapshots.is_empty());
    assert!(!manager.has_active_networks().await);
}

#[test]
fn mapper_keeps_identity_exact_and_maps_editor_fields_without_fixed_port_conflicts() {
    let mut config = parameters(" exact name ");
    config.tun_name = "ct-test".into();
    config.ipv4_mode = "manual".into();
    config.ipv4_address = "198.18.0.1".into();
    config.mtu = Some(1200);
    config.hostname = Some("my-host".into());
    config.p2p_policy = "disabled".into();
    config.ipv6 = false;
    config.upnp = false;
    config.tcp_hole_punching = false;
    config.udp_hole_punching = false;
    config.magic_dns = true;
    config.dns_suffix = "office.test".into();
    let id = Uuid::new_v4();
    let mapped =
        TomlConfigLoader::new_from_str(&crate::configuration::for_connection(id, &config).unwrap())
            .unwrap();
    assert_eq!(mapped.get_id(), id);
    assert_eq!(mapped.get_network_identity().network_name, config.name);
    assert_eq!(
        mapped.get_network_identity().network_secret.as_deref(),
        Some(config.secret.as_str())
    );
    assert_eq!(mapped.get_hostname(), "my-host");
    assert!(!mapped.get_dhcp());
    assert_eq!(mapped.get_ipv4().unwrap().to_string(), "198.18.0.1/24");
    assert!(
        mapped
            .get_listeners()
            .unwrap()
            .iter()
            .all(|url| url.port() == Some(0))
    );
    let flags = mapped.get_flags();
    assert_eq!(flags.mtu, 1200);
    assert!(!flags.enable_ipv6);
    assert!(flags.disable_p2p);
    assert!(
        flags.disable_upnp && flags.disable_tcp_hole_punching && flags.disable_udp_hole_punching
    );
    assert!(flags.accept_dns);
    assert_eq!(flags.tld_dns_zone, "office.test.");
    for (policy, disabled, lazy, only) in [
        ("auto", false, false, false),
        ("lazy", false, true, false),
        ("disabled", true, false, false),
        ("only", false, false, true),
    ] {
        config.p2p_policy = policy.into();
        config.latency_first = true;
        let flags = TomlConfigLoader::new_from_str(
            &crate::configuration::for_connection(id, &config).unwrap(),
        )
        .unwrap()
        .get_flags();
        assert_eq!(
            (flags.disable_p2p, flags.lazy_p2p, flags.p2p_only),
            (disabled, lazy, only)
        );
        assert_eq!(flags.latency_first, !only);
    }
}

#[test]
fn unsupported_fields_are_preserved_on_disk_but_not_silently_ignored_at_launch() {
    let mut config = parameters("office");
    config
        .extra
        .insert("futureOption".into(), serde_json::json!(true));
    assert_eq!(
        crate::configuration::for_connection(Uuid::new_v4(), &config)
            .unwrap_err()
            .code,
        ErrorCode::UnsupportedConfig
    );
}

#[tokio::test]
async fn same_network_profiles_are_exclusive_and_repeated_start_does_not_restart() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id: a,
            config: parameters("office"),
        })
        .await
        .unwrap();
    assert_eq!(
        manager
            .operate(Operation::Start {
                id: b,
                config: parameters("office")
            })
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::NetworkAlreadyRunning
    );
    assert_eq!(
        manager
            .operate(Operation::Start {
                id: a,
                config: parameters("office")
            })
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::InstanceRunning
    );
    assert_eq!(fake.0.lock().unwrap().calls, vec![("start".into(), a)]);
    manager.operate(Operation::Stop { id: a }).await.unwrap();
    manager
        .operate(Operation::Start {
            id: b,
            config: parameters("office"),
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn failed_new_configuration_does_not_restore_old_connection_or_stop_other_networks() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id: a,
            config: parameters("office"),
        })
        .await
        .unwrap();
    manager
        .operate(Operation::Start {
            id: b,
            config: parameters("game"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().fail_start = Some(ErrorCode::TunNameInUse);
    let mut changed = parameters("office");
    changed.secret = "new secret".into();
    assert!(
        manager
            .operate(Operation::Restart {
                id: a,
                config: changed
            })
            .await
            .is_err()
    );
    let snapshots = observed(&manager).await;
    let a_state = snapshots.iter().find(|state| state.id == a).unwrap();
    assert_eq!(a_state.state, "failed");
    assert!(a_state.running_config.is_none());
    assert_eq!(
        snapshots.iter().find(|state| state.id == b).unwrap().state,
        "running"
    );
    assert_eq!(
        fake.0.lock().unwrap().calls,
        vec![
            ("start".into(), a),
            ("start".into(), b),
            ("stop".into(), a),
            ("start".into(), a)
        ]
    );
}

#[tokio::test]
async fn tun_failure_is_reported_and_only_the_failed_instance_is_cleaned_up() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let a = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id: a,
            config: parameters("office"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().fatal_start = true;
    let b = Uuid::new_v4();
    assert_eq!(
        manager
            .operate(Operation::Start {
                id: b,
                config: parameters("game")
            })
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::TunFailed
    );
    let snapshots = observed(&manager).await;
    assert_eq!(
        snapshots.iter().find(|state| state.id == a).unwrap().state,
        "running"
    );
    assert_eq!(
        snapshots.iter().find(|state| state.id == b).unwrap().state,
        "failed"
    );
}

#[tokio::test]
async fn another_gui_cannot_control_or_claim_the_owned_networks_are_stopped() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    manager
        .operate(Operation::Start {
            id: Uuid::new_v4(),
            config: parameters("office"),
        })
        .await
        .unwrap();
    let other = NetworkManager::new(Fake::default(), directory.path().join("lease"));
    assert_eq!(
        other.snapshot().await.err().unwrap().code,
        ErrorCode::OtherController
    );
}

#[tokio::test]
async fn failed_queries_are_errors_and_do_not_discard_the_running_configuration() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().fail_query = true;
    assert_eq!(
        manager.maintain().await.err().unwrap().code,
        ErrorCode::RequestTimeout
    );
    fake.0.lock().unwrap().fail_query = false;
    assert!(observed(&manager).await[0].running_config.is_some());
}

#[tokio::test]
async fn late_address_collision_stops_only_the_newer_network() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id: a,
            config: parameters("office"),
        })
        .await
        .unwrap();
    manager
        .operate(Operation::Start {
            id: b,
            config: parameters("game"),
        })
        .await
        .unwrap();
    {
        let mut script = fake.0.lock().unwrap();
        script.snapshots.get_mut(&a).unwrap().virtual_ip = Some("10.42.0.2".into());
        script.snapshots.get_mut(&b).unwrap().virtual_ip = Some("10.42.0.2".into());
    }
    let states = observed(&manager).await;
    assert_eq!(
        states.iter().find(|state| state.id == a).unwrap().state,
        "running"
    );
    let newer = states.iter().find(|state| state.id == b).unwrap();
    assert_eq!(newer.state, "failed");
    assert_eq!(newer.error.as_ref().unwrap().code, ErrorCode::AddressInUse);
    assert_eq!(
        fake.0.lock().unwrap().calls.last().unwrap(),
        &("stop".into(), b)
    );
}

#[tokio::test(start_paused = true)]
async fn unsupported_import_is_rejected_before_stopping_the_current_connection() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    let imported = crate::configuration::import(
        id,
        "[network_identity]\nnetwork_name = 'office'\n[flags]\nfuture_flag = true\n",
    )
    .unwrap();
    let error = manager
        .operate(Operation::Restart {
            id,
            config: imported.config,
        })
        .await
        .err()
        .unwrap();
    assert_eq!(error.code, ErrorCode::UnsupportedConfig);
    assert_eq!(fake.0.lock().unwrap().calls, vec![("start".into(), id)]);
    let snapshot = observed(&manager).await;
    assert_eq!(snapshot[0].state, "running");
    assert_eq!(
        snapshot[0].running_config.as_ref().unwrap().secret,
        parameters("office").secret
    );
    fake.0.lock().unwrap().snapshots.remove(&id);
    observed(&manager).await;
    tokio::time::advance(std::time::Duration::from_secs(2)).await;
    tick(&manager).await;
    assert_eq!(fake.0.lock().unwrap().background_starts, 1);
    assert_eq!(observed(&manager).await[0].state, "running");
}

#[tokio::test(start_paused = true)]
async fn recovery_reuses_running_parameters_and_does_not_restart_for_missing_peers() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let id = Uuid::new_v4();
    let config = parameters("office");
    manager
        .operate(Operation::Start {
            id,
            config: config.clone(),
        })
        .await
        .unwrap();
    tick(&manager).await;
    assert_eq!(fake.0.lock().unwrap().calls.len(), 1); // zero peers is still healthy
    fake.0.lock().unwrap().snapshots.remove(&id);
    let state = observed(&manager).await;
    assert_eq!(state[0].recovery.as_ref().unwrap().phase, "waiting");
    assert_eq!(
        state[0].recovery_config.as_ref().unwrap().secret,
        config.secret
    );
    tokio::time::advance(std::time::Duration::from_secs(2)).await;
    tick(&manager).await;
    assert_eq!(observed(&manager).await[0].state, "running");
    assert_eq!(fake.0.lock().unwrap().background_starts, 1);
    let last = fake.0.lock().unwrap().tomls.last().unwrap().clone();
    assert_eq!(
        TomlConfigLoader::new_from_str(&last)
            .unwrap()
            .get_network_identity()
            .network_secret
            .as_deref(),
        Some(config.secret.as_str())
    );
}

#[tokio::test(start_paused = true)]
async fn manual_stop_and_shutdown_cancel_queued_recovery() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().snapshots.remove(&id);
    observed(&manager).await;
    manager.operate(Operation::Stop { id }).await.unwrap();
    tokio::time::advance(std::time::Duration::from_secs(60)).await;
    tick(&manager).await;
    assert_eq!(fake.0.lock().unwrap().background_starts, 0);
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().snapshots.remove(&id);
    observed(&manager).await;
    manager.shutdown().await.unwrap();
    tokio::time::advance(std::time::Duration::from_secs(60)).await;
    tick(&manager).await;
    assert_eq!(fake.0.lock().unwrap().background_starts, 0);
    assert!(
        manager
            .operate(Operation::Start {
                id,
                config: parameters("office")
            })
            .await
            .is_err()
    );
}

#[tokio::test(start_paused = true)]
async fn recovery_stops_after_three_attempts_and_authorization_never_repeats() {
    for code in [
        ErrorCode::LaunchFailed,
        ErrorCode::ElevationRequired,
        ErrorCode::InvalidConfig,
    ] {
        let directory = tempfile::tempdir().unwrap();
        let fake = Fake::default();
        let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
        let id = Uuid::new_v4();
        manager
            .operate(Operation::Start {
                id,
                config: parameters("office"),
            })
            .await
            .unwrap();
        {
            let mut script = fake.0.lock().unwrap();
            script.snapshots.remove(&id);
            script.fail_background = Some(code);
        }
        observed(&manager).await;
        for _ in 0..6 {
            tokio::time::advance(std::time::Duration::from_secs(60)).await;
            tick(&manager).await;
        }
        let states = observed(&manager).await;
        let recovery = states[0].recovery.as_ref().unwrap();
        assert_eq!(
            fake.0.lock().unwrap().background_starts,
            if code == ErrorCode::LaunchFailed {
                3
            } else {
                1
            }
        );
        assert_eq!(
            recovery.phase,
            match code {
                ErrorCode::LaunchFailed => "exhausted",
                ErrorCode::ElevationRequired => "authorization",
                _ => "stopped",
            }
        );
    }
}

#[tokio::test(start_paused = true)]
async fn failed_explicit_restart_is_not_automatically_rolled_back() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().fail_start = Some(ErrorCode::LaunchFailed);
    let mut config = parameters("office");
    config.secret = "changed".into();
    assert!(
        manager
            .operate(Operation::Restart { id, config })
            .await
            .is_err()
    );
    tokio::time::advance(std::time::Duration::from_secs(60)).await;
    tick(&manager).await;
    assert_eq!(fake.0.lock().unwrap().background_starts, 0);
    assert!(observed(&manager).await[0].recovery.is_none());
}

#[tokio::test(start_paused = true)]
async fn brief_recoveries_do_not_reset_crash_budget_but_a_healthy_minute_does() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    for delay in [2, 5, 15] {
        fake.0.lock().unwrap().snapshots.remove(&id);
        observed(&manager).await;
        tokio::time::advance(std::time::Duration::from_secs(delay)).await;
        tick(&manager).await;
    }
    fake.0.lock().unwrap().snapshots.remove(&id);
    assert_eq!(
        observed(&manager).await[0].recovery.as_ref().unwrap().phase,
        "exhausted"
    );
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().snapshots.remove(&id);
    observed(&manager).await;
    tokio::time::advance(std::time::Duration::from_secs(2)).await;
    tick(&manager).await;
    tokio::time::advance(std::time::Duration::from_secs(60)).await;
    tick(&manager).await;
    fake.0.lock().unwrap().snapshots.remove(&id);
    let states = observed(&manager).await;
    assert_eq!(states[0].recovery.as_ref().unwrap().attempt, 0);
}

#[tokio::test(start_paused = true)]
async fn failed_query_or_disabled_recovery_never_restarts_an_instance() {
    let directory = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), directory.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().fail_query = true;
    assert!(manager.maintain().await.is_err());
    assert_eq!(fake.0.lock().unwrap().background_starts, 0);
    fake.0.lock().unwrap().fail_query = false;
    manager.set_recovery_enabled(false).await;
    fake.0.lock().unwrap().snapshots.remove(&id);
    observed(&manager).await;
    tokio::time::advance(std::time::Duration::from_secs(60)).await;
    tick(&manager).await;
    manager.set_recovery_enabled(true).await;
    tick(&manager).await;
    assert_eq!(fake.0.lock().unwrap().background_starts, 0);
}

// Exercise sampling through the native timer Interface; cached reads deliberately
// do not query the worker or perform address-conflict correction.
async fn tick(manager: &NetworkManager<Fake>) {
    manager.maintain().await.unwrap();
    for _ in 0..50 {
        tokio::task::yield_now().await;
    }
}
async fn observed(manager: &NetworkManager<Fake>) -> Vec<NetworkSnapshot> {
    tick(manager).await;
    manager.snapshot().await.unwrap().networks
}

#[tokio::test(start_paused = true)]
async fn cold_and_stale_caches_are_explicit_and_reads_do_not_query_the_worker() {
    let root = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), root.path().join("lease"));
    assert_eq!(manager.snapshot().await.unwrap().health, "initializing");
    tick(&manager).await;
    assert_eq!(manager.snapshot().await.unwrap().health, "ready");
    fake.0.lock().unwrap().fail_query = true;
    assert!(manager.maintain().await.is_err());
    let frame = manager.snapshot().await.unwrap();
    assert_eq!(frame.health, "stale");
    assert_eq!(frame.error.unwrap().code, ErrorCode::RequestTimeout);
}
#[tokio::test(start_paused = true)]
async fn slow_readiness_does_not_block_other_networks_and_reserves_shared_resources() {
    let root = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), root.path().join("lease"));
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id: b,
            config: parameters("game"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().not_ready = true;
    let worker = manager.clone();
    let start = tokio::spawn(async move {
        worker
            .operate(Operation::Start {
                id: a,
                config: parameters("office"),
            })
            .await
    });
    for _ in 0..30 {
        tokio::task::yield_now().await;
    }
    let frame = manager.snapshot().await.unwrap();
    assert_eq!(
        frame
            .networks
            .iter()
            .find(|snapshot| snapshot.id == a)
            .unwrap()
            .state,
        "starting"
    );
    assert_eq!(
        manager
            .operate(Operation::Start {
                id: Uuid::new_v4(),
                config: parameters("office")
            })
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::NetworkAlreadyRunning
    );
    manager.operate(Operation::Stop { id: b }).await.unwrap();
    assert!(!start.is_finished());
    fake.0.lock().unwrap().snapshots.get_mut(&a).unwrap().ready = true;
    tokio::time::advance(std::time::Duration::from_millis(100)).await;
    start.await.unwrap().unwrap();
}
#[tokio::test(start_paused = true)]
async fn stop_cancels_an_in_flight_recovery_and_cleans_up_its_late_start() {
    let root = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), root.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    let gate = Arc::new(tokio::sync::Notify::new());
    let entered = Arc::new(tokio::sync::Notify::new());
    {
        let mut script = fake.0.lock().unwrap();
        script.snapshots.remove(&id);
        script.start_gate = Some(gate.clone());
        script.start_entered = Some(entered.clone());
    }
    tick(&manager).await;
    tokio::time::advance(std::time::Duration::from_secs(2)).await;
    tick(&manager).await;
    entered.notified().await;
    assert_eq!(
        manager
            .operate(Operation::Release { id })
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::OperationBusy
    );
    let worker = manager.clone();
    let stop = tokio::spawn(async move { worker.operate(Operation::Stop { id }).await });
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    gate.notify_one();
    stop.await.unwrap().unwrap();
    assert!(fake.0.lock().unwrap().snapshots.is_empty());
    let frame = manager.snapshot().await.unwrap();
    let network = frame
        .networks
        .iter()
        .find(|snapshot| snapshot.id == id)
        .unwrap();
    assert_eq!(network.state, "stopped");
    assert!(network.recovery.is_none());
    assert!(network.running_config.is_none());
    tokio::time::advance(std::time::Duration::from_secs(60)).await;
    tick(&manager).await;
    assert_eq!(fake.0.lock().unwrap().background_starts, 1);
}
#[tokio::test(start_paused = true)]
async fn quiescence_confirmation_rejects_active_networks_and_fences_old_recovery() {
    let root = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), root.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    assert_eq!(
        manager
            .operate(Operation::Release { id })
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::InstanceRunning
    );
    assert!(fake.0.lock().unwrap().snapshots.contains_key(&id));
    manager.operate(Operation::Stop { id }).await.unwrap();
    manager.operate(Operation::Release { id }).await.unwrap();
    tokio::time::advance(std::time::Duration::from_secs(60)).await;
    tick(&manager).await;
    assert_eq!(fake.0.lock().unwrap().background_starts, 0);
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn native_runtime_serialization_matches_the_shared_frontend_contract() {
    let contract: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../tests/fixtures/network-contract.json"
    )))
    .unwrap();
    let mut expected = contract["runtimeFrame"].clone();
    let config: ConnectionConfig =
        serde_json::from_value(contract["document"]["networks"][0]["config"].clone()).unwrap();
    let id = expected["networks"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let root = tempfile::tempdir().unwrap();
    let manager = NetworkManager::new(Fake::default(), root.path().join("lease"));
    let frame = manager
        .operate(Operation::Start { id, config })
        .await
        .unwrap();
    expected["epoch"] = serde_json::json!(frame.epoch);
    expected["networks"][0]["revision"] = serde_json::json!(frame.networks[0].revision);
    assert_eq!(serde_json::to_value(frame).unwrap(), expected);
}
#[tokio::test(start_paused = true)]
async fn cached_reads_expire_without_new_worker_observations() {
    let root = tempfile::tempdir().unwrap();
    let manager = NetworkManager::new(Fake::default(), root.path().join("lease"));
    manager.maintain().await.unwrap();
    tokio::time::advance(std::time::Duration::from_secs(4)).await;
    assert_eq!(manager.snapshot().await.unwrap().health, "stale");
    manager.maintain().await.unwrap();
    assert_eq!(manager.snapshot().await.unwrap().health, "ready");
}

#[tokio::test(start_paused = true)]
async fn shutdown_and_disabling_recovery_also_clean_late_in_flight_starts() {
    for shutdown in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let fake = Fake::default();
        let manager = NetworkManager::new(fake.clone(), root.path().join("lease"));
        let id = Uuid::new_v4();
        manager
            .operate(Operation::Start {
                id,
                config: parameters("office"),
            })
            .await
            .unwrap();
        let gate = Arc::new(tokio::sync::Notify::new());
        let entered = Arc::new(tokio::sync::Notify::new());
        {
            let mut script = fake.0.lock().unwrap();
            script.snapshots.remove(&id);
            script.start_gate = Some(gate.clone());
            script.start_entered = Some(entered.clone());
        }
        tick(&manager).await;
        tokio::time::advance(std::time::Duration::from_secs(2)).await;
        tick(&manager).await;
        entered.notified().await;
        let task = if shutdown {
            let worker = manager.clone();
            Some(tokio::spawn(async move { worker.shutdown().await }))
        } else {
            manager.set_recovery_enabled(false).await;
            None
        };
        for _ in 0..20 {
            tokio::task::yield_now().await;
        }
        gate.notify_one();
        if let Some(task) = task {
            task.await.unwrap().unwrap();
        }
        for _ in 0..50 {
            tokio::task::yield_now().await;
        }
        assert!(fake.0.lock().unwrap().snapshots.is_empty());
        assert!(!manager.has_active_networks().await);
        assert!(
            manager
                .snapshot()
                .await
                .unwrap()
                .networks
                .iter()
                .all(|snapshot| snapshot.running_config.is_none() && snapshot.recovery.is_none())
        );
    }
}
#[tokio::test(start_paused = true)]
async fn failed_stop_retains_resource_ownership_but_cannot_reenable_automatic_recovery() {
    let root = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), root.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    fake.0.lock().unwrap().fail_stop = Some(ErrorCode::Io);
    assert!(manager.operate(Operation::Stop { id }).await.is_err());
    assert!(manager.has_active_networks().await);
    assert_eq!(
        manager
            .operate(Operation::Start {
                id: Uuid::new_v4(),
                config: parameters("office")
            })
            .await
            .err()
            .unwrap()
            .code,
        ErrorCode::NetworkAlreadyRunning
    );
    fake.0.lock().unwrap().snapshots.remove(&id);
    tick(&manager).await;
    tokio::time::advance(std::time::Duration::from_secs(60)).await;
    tick(&manager).await;
    assert_eq!(fake.0.lock().unwrap().background_starts, 0);
}

#[tokio::test(start_paused = true)]
async fn slow_stop_publishes_a_fresh_confirmation_instead_of_an_expired_pre_stop_observation() {
    let root = tempfile::tempdir().unwrap();
    let fake = Fake::default();
    let manager = NetworkManager::new(fake.clone(), root.path().join("lease"));
    let id = Uuid::new_v4();
    manager
        .operate(Operation::Start {
            id,
            config: parameters("office"),
        })
        .await
        .unwrap();
    let gate = Arc::new(tokio::sync::Notify::new());
    let entered = Arc::new(tokio::sync::Notify::new());
    {
        let mut script = fake.0.lock().unwrap();
        script.stop_gate = Some(gate.clone());
        script.stop_entered = Some(entered.clone());
    }
    let worker = manager.clone();
    let stopping = tokio::spawn(async move { worker.operate(Operation::Stop { id }).await });
    entered.notified().await;
    tokio::time::advance(std::time::Duration::from_secs(4)).await;
    assert_eq!(manager.snapshot().await.unwrap().health, "stale");
    gate.notify_one();
    let frame = stopping.await.unwrap().unwrap();
    assert_eq!(frame.health, "ready");
    assert_eq!(frame.networks[0].state, "stopped");
}
