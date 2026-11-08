use crate::process::ErrorCode;
use easytier::{
    common::global_ctx::GlobalCtxEvent, proto::api::manage::NetworkInstanceRunningInfo,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSnapshot {
    #[serde(default)]
    pub telemetry: Option<crate::telemetry::TelemetrySnapshot>,
    pub id: Uuid,
    pub running: Option<bool>,
    pub device_name: String,
    pub error: Option<String>,
    #[serde(default)]
    pub ready: bool,
    #[serde(default)]
    pub virtual_ip: Option<String>,
    #[serde(default)]
    pub peer_count: usize,
    #[serde(default)]
    pub direct_peer_count: usize,
    #[serde(default)]
    pub issue: Option<ErrorCode>,
    #[serde(default)]
    pub fatal: bool,
}

#[derive(Clone, Default)]
pub(crate) struct Signals {
    pub measurements: crate::telemetry::Measurements,
    pub latency_first: bool,
    pub ready: bool,
    pub device_name: Option<String>,
    pub fatal: Option<ErrorCode>,
    pub warning: Option<ErrorCode>,
}
impl Signals {
    pub fn observe(&mut self, event: GlobalCtxEvent) {
        match event {
            GlobalCtxEvent::PeerConnRemoved(ref connection) => {
                self.measurements.observe(connection)
            }
            GlobalCtxEvent::TunDeviceReady(name) => {
                self.ready = true;
                self.device_name = Some(name);
                self.fatal = None;
            }
            GlobalCtxEvent::TunDeviceError(_) => {
                self.ready = false;
                self.fatal = Some(ErrorCode::TunFailed);
            }
            GlobalCtxEvent::DhcpIpv4Conflicted(_) => {
                self.fatal = Some(ErrorCode::AddressConflict);
            }
            GlobalCtxEvent::DhcpIpv4Changed(_, Some(_)) => {
                if self.fatal == Some(ErrorCode::AddressConflict) {
                    self.fatal = None;
                }
            }
            GlobalCtxEvent::ListenerAddFailed(_, _) => {
                self.warning = Some(ErrorCode::ListenerFailed);
            }
            GlobalCtxEvent::ConnectError(_, _, _) | GlobalCtxEvent::ConnectionError(_, _, _) => {
                if self.warning != Some(ErrorCode::ListenerFailed) {
                    self.warning = Some(ErrorCode::PeerUnreachable);
                }
            }
            GlobalCtxEvent::PeerAdded(_) | GlobalCtxEvent::PeerConnAdded(_) => {
                if self.warning == Some(ErrorCode::PeerUnreachable) {
                    self.warning = None;
                }
            }
            GlobalCtxEvent::UdpBroadcastRelayStartResult { error: Some(_), .. } => {
                self.warning = Some(ErrorCode::BroadcastFailed)
            }
            _ => {}
        }
    }
}

pub(crate) fn snapshot(
    id: Uuid,
    info: Option<NetworkInstanceRunningInfo>,
    no_tun: bool,
    live: &mut Signals,
) -> InstanceSnapshot {
    let Some(info) = info else {
        return InstanceSnapshot {
            id,
            telemetry: None,
            running: None,
            device_name: String::new(),
            error: None,
            ready: false,
            virtual_ip: None,
            peer_count: 0,
            direct_peer_count: 0,
            issue: None,
            fatal: false,
        };
    };
    let mut history = Signals::default();
    for event in &info.events {
        if let Ok(event) = serde_json::from_str(event) {
            if let GlobalCtxEvent::PeerConnRemoved(ref connection) = event {
                live.measurements.observe(connection);
            }
            history.observe(event);
        }
    }
    let fatal = if info.error_msg.is_some() {
        Some(ErrorCode::InstanceFailed)
    } else if live.ready {
        live.fatal
    } else {
        live.fatal.or(history.fatal)
    };
    let telemetry = Some(live.measurements.snapshot(&info, live.latency_first));
    let ready =
        info.my_node_info.is_some() && (no_tun || live.ready || history.ready) && fatal.is_none();
    let local_id = info.my_node_info.as_ref().map(|node| node.peer_id);
    let routes: Vec<_> = info
        .routes
        .iter()
        .filter(|route| Some(route.peer_id) != local_id)
        .collect();
    let virtual_ip = info
        .my_node_info
        .as_ref()
        .and_then(|node| node.virtual_ipv4.as_ref())
        .and_then(|ip| ip.address.as_ref())
        .map(ToString::to_string);
    InstanceSnapshot {
        id,
        telemetry,
        running: Some(info.running),
        device_name: live
            .device_name
            .clone()
            .or(history.device_name)
            .unwrap_or(info.dev_name),
        error: fatal.map(|_| "The network instance failed".into()),
        ready,
        virtual_ip,
        peer_count: routes.len(),
        direct_peer_count: routes
            .iter()
            .filter(|route| crate::telemetry::route_cost(route, live.latency_first) == 1)
            .count(),
        issue: fatal.or(live.warning).or(history.warning),
        fatal: fatal.is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use easytier::proto::api::manage::MyNodeInfo;
    #[test]
    fn readiness_and_peer_presence_are_separate_and_event_errors_are_redacted() {
        let id = Uuid::new_v4();
        let mut info = NetworkInstanceRunningInfo {
            running: true,
            my_node_info: Some(MyNodeInfo::default()),
            ..Default::default()
        };
        assert!(!snapshot(id, Some(info.clone()), false, &mut Signals::default()).ready);
        info.events.push(
            serde_json::to_string(&GlobalCtxEvent::TunDeviceReady("actual-tun".into())).unwrap(),
        );
        let ready = snapshot(id, Some(info.clone()), false, &mut Signals::default());
        assert!(ready.ready);
        assert_eq!(ready.peer_count, 0);
        assert_eq!(ready.device_name, "actual-tun");
        info.events.push(
            serde_json::to_string(&GlobalCtxEvent::TunDeviceError("sensitive detail".into()))
                .unwrap(),
        );
        let failed = snapshot(id, Some(info), false, &mut Signals::default());
        assert!(failed.fatal);
        assert_eq!(failed.issue, Some(ErrorCode::TunFailed));
        assert!(
            !serde_json::to_string(&failed)
                .unwrap()
                .contains("sensitive detail")
        );
    }
    #[test]
    fn an_individual_connect_error_is_not_a_fatal_instance_error() {
        let mut signals = Signals::default();
        signals.observe(GlobalCtxEvent::TunDeviceReady("tun".into()));
        signals.observe(GlobalCtxEvent::ConnectError(
            "private endpoint".into(),
            "ipv4".into(),
            "timeout".into(),
        ));
        let info = NetworkInstanceRunningInfo {
            running: true,
            my_node_info: Some(MyNodeInfo::default()),
            ..Default::default()
        };
        let current = snapshot(Uuid::new_v4(), Some(info), false, &mut signals);
        assert!(current.ready && !current.fatal);
        assert_eq!(current.issue, Some(ErrorCode::PeerUnreachable));
        assert!(
            !serde_json::to_string(&current)
                .unwrap()
                .contains("private endpoint")
        );
    }
}

#[cfg(test)]
mod peer_test {
    use crate::CoreRuntime;
    use easytier::common::config::{ConfigLoader, NetworkIdentity, PeerConfig, TomlConfigLoader};
    use std::time::Duration;
    use uuid::Uuid;
    fn isolated(name: &str) -> TomlConfigLoader {
        let config = TomlConfigLoader::default();
        config.set_id(Uuid::new_v4());
        config.set_network_identity(NetworkIdentity::new(name.into(), "local test key".into()));
        config.set_dhcp(false);
        config.set_listeners(vec![]);
        config.set_peers(vec![]);
        config.set_stun_servers(Some(vec![]));
        config.set_stun_servers_v6(Some(vec![]));
        let mut flags = config.get_flags();
        flags.no_tun = true;
        flags.enable_ipv6 = false;
        flags.disable_upnp = true;
        flags.disable_p2p = true;
        flags.disable_udp_hole_punching = true;
        flags.disable_tcp_hole_punching = true;
        config.set_flags(flags);
        config
    }
    #[tokio::test]
    async fn real_local_peers_are_distinguished_from_an_empty_running_instance() {
        let name = format!("local-{}", Uuid::new_v4());
        let server = isolated(&name);
        server.set_listeners(vec!["tcp://127.0.0.1:0".parse().unwrap()]);
        let a = CoreRuntime::default();
        let b = CoreRuntime::default();
        let id = a.start(&server.dump()).unwrap();
        let listener = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(node) = a
                    .manager
                    .get_network_info(&id)
                    .await
                    .and_then(|info| info.my_node_info)
                {
                    if let Some(listener) = node.listeners.first() {
                        break listener.to_string();
                    }
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(a.snapshot().await.unwrap()[0].peer_count, 0);
        let client = isolated(&name);
        client.set_peers(vec![PeerConfig {
            uri: listener.parse().unwrap(),
            peer_public_key: None,
        }]);
        b.start(&client.dump()).unwrap();
        tokio::time::timeout(Duration::from_secs(8), async {
            loop {
                let a_state = a.snapshot().await.unwrap();
                let b_state = b.snapshot().await.unwrap();
                if a_state[0].peer_count > 0 && b_state[0].peer_count > 0 {
                    assert!(a_state[0].ready && b_state[0].ready);
                    let measurements = a_state[0].telemetry.as_ref().unwrap();
                    assert!(!measurements.peers.is_empty());
                    assert_eq!(measurements.peers[0].connection, "direct");
                    if !measurements.peers[0].protocols.is_empty()
                        && measurements.download_bytes.parse::<u64>().unwrap() > 0
                        && measurements.upload_bytes.parse::<u64>().unwrap() > 0
                    {
                        break;
                    }
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .unwrap();
    }
}
