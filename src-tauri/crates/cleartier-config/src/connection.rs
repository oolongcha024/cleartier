use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The saved editor schema, shared by persistence and the native mapper.
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub name: String,
    pub secret: String,
    pub servers: Vec<String>,
    pub hostname: Option<String>,
    pub ipv4_mode: String,
    pub ipv4_address: String,
    pub ipv4_prefix: u8,
    pub tun_name: String,
    pub mtu: Option<u32>,
    pub ipv6: bool,
    pub p2p_policy: String,
    pub latency_first: bool,
    pub tcp_hole_punching: bool,
    pub udp_hole_punching: bool,
    pub upnp: bool,
    pub magic_dns: bool,
    pub dns_suffix: String,
    pub udp_broadcast_relay: bool,
    /// The imported document is a preservation base, never a second live config.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub official_toml: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl ConnectionConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        super::model::validate_config(&serde_json::to_value(self).map_err(|_| "invalid")?)
    }
    pub fn same_network(&self, other: &Self) -> bool {
        self.name == other.name && self.secret == other.secret
    }
}
