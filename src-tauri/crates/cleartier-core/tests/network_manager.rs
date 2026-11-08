// A custom harness keeps controller and worker executable identities equal.
#[cfg(unix)]
fn main() {
    check::main();
}
#[cfg(not(unix))]
fn main() {}

#[cfg(unix)]
mod check {
    use cleartier_core::{
        InstanceSnapshot,
        connections::{Backend, NetworkManager, Operation},
        process::{CoreController, CorePaths, Result},
    };
    use easytier::common::config::{ConfigLoader, TomlConfigLoader};
    use uuid::Uuid;

    // Production mapping and authenticated worker communication are exercised, with
    // only OS network side effects disabled by this test Adapter.
    struct Isolated(CoreController);
    impl Backend for Isolated {
        async fn start(&self, toml: String) -> Result<Uuid> {
            let config = TomlConfigLoader::new_from_str(&toml).unwrap();
            if config.get_inst_name() == "imported-instance" {
                assert!(config.get_flags().private_mode);
            }
            let mut flags = config.get_flags();
            flags.no_tun = true;
            flags.enable_ipv6 = false;
            flags.disable_upnp = true;
            flags.disable_p2p = true;
            flags.disable_tcp_hole_punching = true;
            flags.disable_udp_hole_punching = true;
            config.set_flags(flags);
            config.set_peers(vec![]);
            config.set_listeners(vec![]);
            config.set_stun_servers(Some(vec![]));
            config.set_stun_servers_v6(Some(vec![]));
            config.set_dhcp(false);
            self.0.start(config.dump()).await
        }
        async fn stop(&self, id: Uuid) -> Result<()> {
            self.0.stop(id).await
        }
        async fn snapshot(&self) -> Result<Vec<InstanceSnapshot>> {
            self.0.snapshot().await
        }
    }
    fn config(name: &str) -> cleartier_config::ConnectionConfig {
        serde_json::from_value(serde_json::json!({"name":name,"secret":"test key","servers":["tcp://127.0.0.1:11010"],
        "hostname":null,"ipv4Mode":"auto","ipv4Address":"","ipv4Prefix":24,"tunName":format!("ct-{name}"),"mtu":null,
        "ipv6":false,"p2pPolicy":"auto","latencyFirst":false,"tcpHolePunching":true,"udpHolePunching":true,
        "upnp":true,"magicDns":false,"dnsSuffix":"et.net.","udpBroadcastRelay":false})).unwrap()
    }
    async fn real_worker_runs_two_mapped_networks_and_restarts_only_its_target() {
        let root = tempfile::tempdir().unwrap();
        let core = CoreController::new(
            std::env::current_exe().unwrap(),
            CorePaths::new(root.path().join("config"), root.path().join("data")),
        )
        .unwrap();
        let manager = NetworkManager::new(Isolated(core.clone()), root.path().join("lease"));
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let imported = cleartier_core::configuration::import(a, "instance_name = 'imported-instance'\n[network_identity]\nnetwork_name = 'office'\nnetwork_secret = 'test key'\n[flags]\nprivate_mode = true\n").unwrap().config;
        manager
            .operate(Operation::Start {
                id: a,
                config: imported.clone(),
            })
            .await
            .unwrap();
        manager
            .operate(Operation::Start {
                id: b,
                config: config("game"),
            })
            .await
            .unwrap();
        let pid = core.status().pid;
        assert_eq!(
            manager
                .snapshot()
                .await
                .unwrap()
                .iter()
                .filter(|state| state.state == "running")
                .count(),
            2
        );
        let before = manager.snapshot().await.unwrap();
        let session_a = before
            .iter()
            .find(|state| state.id == a)
            .unwrap()
            .telemetry
            .as_ref()
            .unwrap()
            .session;
        let session_b = before
            .iter()
            .find(|state| state.id == b)
            .unwrap()
            .telemetry
            .as_ref()
            .unwrap()
            .session;
        let mut changed = imported;
        changed.secret = "new key".into();
        manager
            .operate(Operation::Restart {
                id: a,
                config: changed,
            })
            .await
            .unwrap();
        assert_eq!(core.status().pid, pid);
        assert_eq!(
            manager
                .snapshot()
                .await
                .unwrap()
                .iter()
                .find(|state| state.id == b)
                .unwrap()
                .state,
            "running"
        );
        let restarted = manager.snapshot().await.unwrap();
        assert_ne!(
            restarted
                .iter()
                .find(|state| state.id == a)
                .unwrap()
                .telemetry
                .as_ref()
                .unwrap()
                .session,
            session_a
        );
        assert_eq!(
            restarted
                .iter()
                .find(|state| state.id == b)
                .unwrap()
                .telemetry
                .as_ref()
                .unwrap()
                .session,
            session_b
        );
        manager.operate(Operation::Stop { id: a }).await.unwrap();
        let stopped = manager.snapshot().await.unwrap();
        assert_eq!(
            stopped
                .iter()
                .filter(|state| state.state == "running")
                .count(),
            1
        );
        let retained = stopped.iter().find(|state| state.id == a).unwrap();
        assert_eq!(retained.state, "stopped");
        assert!(retained.running_config.is_none());
        assert!(retained.telemetry.is_some());
        core.shutdown().await.unwrap();
    }

    pub fn main() {
        if let Some(code) = cleartier_core::dispatch_headless() {
            std::process::exit(code);
        }
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap()
            .block_on(real_worker_runs_two_mapped_networks_and_restarts_only_its_target());
        println!("Mapped networks: shared real core, independent restart and stop passed");
    }
}
