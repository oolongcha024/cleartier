use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub version: u32,
    pub revision: String,
    pub selected_id: String,
    pub networks: Vec<NetworkRecord>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version: 1,
            revision: String::new(),
            selected_id: String::new(),
            networks: vec![],
            extra: Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRecord {
    pub id: Uuid,
    pub client: ClientConfig,
    pub config: Value,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    pub alias: String,
    pub icon: String,
    pub auto_connect: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Document {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != 1 {
            return Err("unsupportedVersion");
        }
        if !self.revision.is_empty() && Uuid::parse_str(&self.revision).is_err() {
            return Err("invalid");
        }
        let mut ids = HashSet::new();
        let mut tun_names = HashSet::new();
        for network in &self.networks {
            if !ids.insert(network.id) {
                return Err("invalid");
            }
            if !["work", "sports_esports", "home", "hub", "dns", "public"]
                .contains(&network.client.icon.as_str())
            {
                return Err("invalid");
            }
            // Validate the known schema while preserving every unrecognized field.
            validate_config(&network.config)?;
            let tun = network.config["tunName"]
                .as_str()
                .unwrap()
                .to_ascii_lowercase();
            if !tun_names.insert(tun) {
                return Err("invalid");
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_config(value: &Value) -> Result<(), &'static str> {
    let config = value.as_object().ok_or("invalid")?;
    for field in [
        "name",
        "secret",
        "ipv4Address",
        "dnsSuffix",
        "tunName",
        "ipv4Mode",
        "p2pPolicy",
    ] {
        if !config.get(field).is_some_and(Value::is_string) {
            return Err("invalid");
        }
    }
    if config["name"].as_str().unwrap().trim().is_empty() {
        return Err("invalid");
    }
    let servers = config
        .get("servers")
        .and_then(Value::as_array)
        .ok_or("invalid")?;
    if servers.is_empty()
        || !servers.iter().all(|server| {
            server.as_str().is_some_and(|server| {
                !server.chars().any(char::is_whitespace)
                    && server.contains("://")
                    && url::Url::parse(server).is_ok_and(|url| {
                        url.host_str().is_some_and(|host| !host.is_empty()) && url.port() != Some(0)
                    })
            })
        })
    {
        return Err("invalid");
    }
    let tun = config["tunName"].as_str().unwrap();
    if tun.is_empty()
        || tun.len() > 15
        || !tun
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("invalid");
    }
    if !["auto", "manual"].contains(&config["ipv4Mode"].as_str().unwrap())
        || !["auto", "lazy", "disabled", "only"].contains(&config["p2pPolicy"].as_str().unwrap())
    {
        return Err("invalid");
    }
    if !config
        .get("ipv4Prefix")
        .and_then(Value::as_u64)
        .is_some_and(|n| (1..=32).contains(&n))
    {
        return Err("invalid");
    }
    let mtu = config.get("mtu").ok_or("invalid")?;
    if !mtu.is_null() && !mtu.as_u64().is_some_and(|n| (400..=1380).contains(&n)) {
        return Err("invalid");
    }
    let hostname = config.get("hostname").ok_or("invalid")?;
    if !hostname.is_null()
        && !hostname
            .as_str()
            .is_some_and(|s| s.chars().count() <= 32 && !s.chars().any(char::is_control))
    {
        return Err("invalid");
    }
    for field in [
        "ipv6",
        "latencyFirst",
        "tcpHolePunching",
        "udpHolePunching",
        "upnp",
        "magicDns",
        "udpBroadcastRelay",
    ] {
        if !config.get(field).is_some_and(Value::is_boolean) {
            return Err("invalid");
        }
    }
    if config["ipv4Mode"] == "manual" {
        let address: std::net::Ipv4Addr = config["ipv4Address"]
            .as_str()
            .unwrap()
            .parse()
            .map_err(|_| "invalid")?;
        if address.octets()[0] == 0 || address.octets()[0] >= 224 || address.octets()[0] == 127 {
            return Err("invalid");
        }
    }
    if config["magicDns"] == true {
        let suffix = config["dnsSuffix"].as_str().unwrap().trim_end_matches('.');
        if suffix.len() > 253
            || !suffix.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            })
        {
            return Err("invalid");
        }
    }
    Ok(())
}
