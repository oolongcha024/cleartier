//! Redacted per-session measurements. Counters survive a connection leaving the
//! peer list, including its final removal event, but never survive an instance.
use easytier::proto::api::{
    instance::{PeerConnInfo, Route},
    manage::NetworkInstanceRunningInfo,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, time::Instant};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerSnapshot {
    pub id: String,
    #[serde(default)]
    pub instance_id: Option<Uuid>,
    #[serde(default)]
    pub public_server: bool,
    pub name: String,
    pub ip: Option<String>,
    pub connection: String,
    pub latency: Option<f64>,
    pub loss_rate: Option<f64>,
    pub protocols: Vec<String>,
    pub next_hop: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySnapshot {
    pub session: Uuid,
    pub elapsed_ms: u64,
    pub hostname: String,
    pub peers: Vec<PeerSnapshot>,
    // Strings preserve u64 precision across JSON and JavaScript.
    pub download_bytes: String,
    pub upload_bytes: String,
    pub incomplete: bool,
}

#[derive(Clone)]
pub(crate) struct Measurements {
    session: Uuid,
    started: Instant,
    counters: BTreeMap<String, (u64, u64)>,
    download: u64,
    upload: u64,
    pub incomplete: bool,
}
impl Default for Measurements {
    fn default() -> Self {
        Self {
            session: Uuid::new_v4(),
            started: Instant::now(),
            counters: BTreeMap::new(),
            download: 0,
            upload: 0,
            incomplete: false,
        }
    }
}
pub(crate) fn route_cost(route: &Route, latency_first: bool) -> i32 {
    if latency_first {
        route.cost_latency_first.unwrap_or(route.cost)
    } else {
        route.cost
    }
}
impl Measurements {
    pub fn observe(&mut self, connection: &PeerConnInfo) {
        let Some(stats) = &connection.stats else {
            return;
        };
        if connection.conn_id.is_empty() {
            return;
        }
        let previous = self.counters.entry(connection.conn_id.clone()).or_default();
        // A connection UUID owns monotonic counters. Older event/query snapshots
        // cannot add bytes twice or reduce a total. A new UUID starts at zero.
        self.download = self
            .download
            .saturating_add(stats.rx_bytes.saturating_sub(previous.0));
        self.upload = self
            .upload
            .saturating_add(stats.tx_bytes.saturating_sub(previous.1));
        previous.0 = previous.0.max(stats.rx_bytes);
        previous.1 = previous.1.max(stats.tx_bytes);
    }

    pub fn snapshot(
        &mut self,
        info: &NetworkInstanceRunningInfo,
        latency_first: bool,
    ) -> TelemetrySnapshot {
        for peer in &info.peers {
            for connection in &peer.conns {
                self.observe(connection);
            }
        }
        let local = info.my_node_info.as_ref().map(|node| node.peer_id);
        let mut identities = BTreeMap::<Uuid, usize>::new();
        for route in &info.routes {
            if Some(route.peer_id) != local {
                if let Ok(id) = Uuid::parse_str(&route.inst_id) {
                    *identities.entry(id).or_default() += 1;
                }
            }
        }
        let mut peers: Vec<PeerSnapshot> = info
            .routes
            .iter()
            .filter(|route| Some(route.peer_id) != local)
            .map(|route| {
                let peer = info.peers.iter().find(|peer| peer.peer_id == route.peer_id);
                let default = peer
                    .and_then(|peer| peer.default_conn_id.as_ref())
                    .map(|id| Uuid::from(id.clone()).to_string());
                let connection = peer.and_then(|peer| {
                    peer.conns
                        .iter()
                        .filter(|conn| !conn.is_closed)
                        .min_by_key(|conn| (Some(&conn.conn_id) != default.as_ref(), &conn.conn_id))
                });
                let direct = route_cost(route, latency_first) == 1;
                let next_id = if latency_first {
                    route
                        .next_hop_peer_id_latency_first
                        .unwrap_or(route.next_hop_peer_id)
                } else {
                    route.next_hop_peer_id
                };
                // RTT/loss are measurements of a direct tunnel, not an end-to-end
                // probe to a remote node reached through a relay.
                let measured = connection.filter(|_| direct).filter(|conn| {
                    conn.stats
                        .as_ref()
                        .is_some_and(|stats| stats.latency_us > 0)
                });
                let mut protocols: Vec<_> = peer
                    .into_iter()
                    .flat_map(|peer| &peer.conns)
                    .filter(|conn| !conn.is_closed)
                    .filter_map(|conn| conn.tunnel.as_ref())
                    .map(|tunnel| tunnel.tunnel_type.clone())
                    .collect();
                protocols.sort();
                protocols.dedup();
                let next_hop = (!direct).then(|| {
                    info.routes
                        .iter()
                        .find(|next| next.peer_id == next_id)
                        .map(|next| next.hostname.clone())
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| next_id.to_string())
                });
                PeerSnapshot {
                    id: route.peer_id.to_string(),
                    instance_id: Uuid::parse_str(&route.inst_id)
                        .ok()
                        .filter(|id| !id.is_nil() && identities.get(id) == Some(&1)),
                    public_server: route
                        .feature_flag
                        .as_ref()
                        .is_some_and(|flag| flag.is_public_server),
                    name: if route.hostname.is_empty() {
                        route.peer_id.to_string()
                    } else {
                        route.hostname.clone()
                    },
                    ip: route
                        .ipv4_addr
                        .as_ref()
                        .and_then(|ip| ip.address.as_ref())
                        .map(ToString::to_string),
                    connection: if direct { "direct" } else { "relay" }.into(),
                    latency: measured
                        .and_then(|conn| conn.stats.as_ref())
                        .map(|stats| stats.latency_us as f64 / 1000.0),
                    loss_rate: measured.and_then(|conn| {
                        conn.loss_rate
                            .is_finite()
                            .then_some((conn.loss_rate as f64).clamp(0.0, 1.0))
                    }),
                    protocols,
                    next_hop,
                    version: (!route.version.is_empty()).then(|| route.version.clone()),
                }
            })
            .collect();
        peers.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
        TelemetrySnapshot {
            session: self.session,
            elapsed_ms: self.started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            hostname: info
                .my_node_info
                .as_ref()
                .map(|node| node.hostname.clone())
                .unwrap_or_default(),
            peers,
            download_bytes: self.download.to_string(),
            upload_bytes: self.upload.to_string(),
            incomplete: self.incomplete,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use easytier::{
        common::global_ctx::GlobalCtxEvent,
        proto::api::{
            instance::{PeerConnStats, PeerInfo},
            manage::MyNodeInfo,
        },
    };

    fn connection(id: &str, rx: u64, tx: u64) -> PeerConnInfo {
        PeerConnInfo {
            conn_id: id.into(),
            peer_id: 2,
            stats: Some(PeerConnStats {
                rx_bytes: rx,
                tx_bytes: tx,
                latency_us: 12_500,
                ..Default::default()
            }),
            loss_rate: 0.025,
            ..Default::default()
        }
    }
    fn info(connection: PeerConnInfo) -> NetworkInstanceRunningInfo {
        NetworkInstanceRunningInfo {
            running: true,
            my_node_info: Some(MyNodeInfo {
                peer_id: 1,
                hostname: "local-node".into(),
                ..Default::default()
            }),
            peers: vec![PeerInfo {
                peer_id: 2,
                conns: vec![connection],
                ..Default::default()
            }],
            routes: vec![
                Route {
                    peer_id: 1,
                    hostname: "local-node".into(),
                    ..Default::default()
                },
                Route {
                    peer_id: 2,
                    hostname: "friend".into(),
                    cost: 1,
                    version: "test-version".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }
    #[test]
    fn cumulative_counts_survive_removal_and_ignore_repeated_or_older_snapshots() {
        let mut live = crate::status::Signals::default();
        let first = info(connection("a", 100, 200));
        let before = crate::status::snapshot(Uuid::nil(), Some(first.clone()), true, &mut live)
            .telemetry
            .unwrap();
        assert_eq!(before.download_bytes, "100");
        // Final event recovers bytes transferred since the most recent poll.
        live.observe(GlobalCtxEvent::PeerConnRemoved(connection("a", 175, 250)));
        let old = crate::status::snapshot(Uuid::nil(), Some(first), true, &mut live)
            .telemetry
            .unwrap();
        assert_eq!(old.download_bytes, "175");
        let mut empty = NetworkInstanceRunningInfo::default();
        empty.events.push(
            serde_json::to_string(&GlobalCtxEvent::PeerConnRemoved(connection("a", 175, 250)))
                .unwrap(),
        );
        let after = crate::status::snapshot(Uuid::nil(), Some(empty.clone()), true, &mut live)
            .telemetry
            .unwrap();
        assert_eq!(after.download_bytes, "175");
        assert_eq!(after.upload_bytes, "250");
        assert_eq!(after.session, before.session);
        let mut next = info(connection("b", 25, 35));
        next.events = empty.events;
        let newer = crate::status::snapshot(Uuid::nil(), Some(next.clone()), true, &mut live)
            .telemetry
            .unwrap();
        assert_eq!(newer.download_bytes, "200");
        let restart = crate::status::snapshot(
            Uuid::nil(),
            Some(next),
            true,
            &mut crate::status::Signals::default(),
        )
        .telemetry
        .unwrap();
        assert_ne!(newer.session, restart.session);
    }
    #[test]
    fn metrics_use_default_tunnel_and_never_relabel_relay_hop_as_target_quality() {
        let id = Uuid::new_v4();
        let mut data = info(connection("another-link", 1, 2));
        data.peers[0].default_conn_id = Some(id.into());
        let mut selected = connection(&id.to_string(), 3, 4);
        selected.stats.as_mut().unwrap().latency_us = 42_000;
        data.peers[0].conns.push(selected);
        let mut measurements = Measurements::default();
        let direct = measurements.snapshot(&data, false);
        assert_eq!(direct.peers.len(), 1);
        assert_eq!(direct.peers[0].latency, Some(42.0));
        assert!((direct.peers[0].loss_rate.unwrap() - 0.025).abs() < 0.0001);
        data.routes[1].cost_latency_first = Some(2);
        data.routes[1].next_hop_peer_id_latency_first = Some(3);
        data.routes.push(Route {
            peer_id: 3,
            hostname: "relay".into(),
            cost: 1,
            ..Default::default()
        });
        let routed = measurements.snapshot(&data, true);
        assert_eq!(routed.peers[0].connection, "relay");
        assert_eq!(routed.peers[0].next_hop.as_deref(), Some("relay"));
        assert_eq!(routed.peers[0].latency, None);
        assert_eq!(routed.peers[0].loss_rate, None);
        assert_eq!(direct.hostname, "local-node");
    }
    #[test]
    fn counters_remain_exact_over_javascript_integer_limit_and_unknown_is_not_zero() {
        let mut data = info(connection("big", 9_007_199_254_740_993, 0));
        data.peers[0].conns[0].stats.as_mut().unwrap().latency_us = 0;
        let snapshot = Measurements::default().snapshot(&data, false);
        assert_eq!(snapshot.download_bytes, "9007199254740993");
        assert_eq!(snapshot.upload_bytes, "0");
        assert_eq!(snapshot.peers[0].latency, None);
        assert_eq!(snapshot.peers[0].loss_rate, None);
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(!json.contains("network_name"));
        assert!(!json.contains("pubkey"));
        assert!(!json.contains("remote_addr"));
    }
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    use easytier::proto::{
        api::{instance::Route, manage::MyNodeInfo},
        common::PeerFeatureFlag,
    };
    #[test]
    fn public_role_and_unique_instance_identity_are_reported_without_os_guesses() {
        let id = Uuid::new_v4();
        let mut data = NetworkInstanceRunningInfo {
            my_node_info: Some(MyNodeInfo {
                peer_id: 1,
                ..Default::default()
            }),
            routes: vec![Route {
                peer_id: 2,
                hostname: "my-windows-nas".into(),
                inst_id: id.to_string(),
                feature_flag: Some(PeerFeatureFlag {
                    is_public_server: true,
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        };
        let first = Measurements::default().snapshot(&data, false);
        assert_eq!(first.peers[0].instance_id, Some(id));
        assert!(first.peers[0].public_server);
        data.routes[0].peer_id = 3;
        data.routes[0].hostname = "changed name".into();
        assert_eq!(
            Measurements::default().snapshot(&data, false).peers[0].instance_id,
            Some(id)
        );
        // Copied remote configurations cannot safely share a manual preference.
        let mut duplicate = data.routes[0].clone();
        duplicate.peer_id = 4;
        data.routes.push(duplicate);
        assert!(
            Measurements::default()
                .snapshot(&data, false)
                .peers
                .iter()
                .all(|peer| peer.instance_id.is_none())
        );
        data.routes.pop();
        data.routes[0].inst_id.clear();
        data.routes[0].feature_flag = None;
        let unknown = Measurements::default().snapshot(&data, false);
        assert!(unknown.peers[0].instance_id.is_none());
        assert!(!unknown.peers[0].public_server);
    }
}
