use crate::process::Result;
use cleartier_config::ConnectionConfig;
use easytier::common::config::gen_default_flags;
use serde_json::Map;
use toml::{Table, Value};
use uuid::Uuid;

const EDITED_FLAGS: &[&str] = &[
    "dev_name",
    "mtu",
    "enable_ipv6",
    "disable_p2p",
    "lazy_p2p",
    "p2p_only",
    "latency_first",
    "disable_tcp_hole_punching",
    "disable_udp_hole_punching",
    "disable_upnp",
    "accept_dns",
    "tld_dns_zone",
    "enable_udp_broadcast_relay",
];

fn string(table: &Table, key: &str, default: &str) -> String {
    table
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(default)
        .to_owned()
}
fn boolean(table: &Table, key: &str, default: bool) -> bool {
    table.get(key).and_then(Value::as_bool).unwrap_or(default)
}

pub(super) fn project(_id: Uuid, table: &Table, original: String) -> ConnectionConfig {
    let empty = Table::new();
    let identity = table
        .get("network_identity")
        .and_then(Value::as_table)
        .unwrap_or(&empty);
    let flags = table
        .get("flags")
        .and_then(Value::as_table)
        .unwrap_or(&empty);
    let defaults = gen_default_flags();
    let address = string(table, "ipv4", "");
    let (address, prefix) = address
        .split_once('/')
        .map(|(ip, prefix)| (ip.to_owned(), prefix.parse().unwrap_or(24)))
        .unwrap_or((address, 24));
    let disabled = boolean(flags, "disable_p2p", false);
    let only = boolean(flags, "p2p_only", false);
    let lazy = boolean(flags, "lazy_p2p", false);
    ConnectionConfig {
        name: string(identity, "network_name", "default"),
        secret: string(identity, "network_secret", ""),
        servers: table
            .get("peer")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|peer| peer.get("uri").and_then(Value::as_str).map(str::to_owned))
            .collect(),
        hostname: table
            .get("hostname")
            .and_then(Value::as_str)
            .map(str::to_owned),
        ipv4_mode: if boolean(table, "dhcp", false) {
            "auto"
        } else if address.is_empty() {
            "none"
        } else {
            "manual"
        }
        .into(),
        ipv4_address: address,
        ipv4_prefix: prefix,
        tun_name: string(flags, "dev_name", ""),
        mtu: flags
            .get("mtu")
            .and_then(Value::as_integer)
            .and_then(|value| u32::try_from(value).ok()),
        ipv6: boolean(flags, "enable_ipv6", defaults.enable_ipv6),
        p2p_policy: if only {
            "only"
        } else if disabled {
            "disabled"
        } else if lazy {
            "lazy"
        } else {
            "auto"
        }
        .into(),
        latency_first: boolean(flags, "latency_first", defaults.latency_first),
        tcp_hole_punching: !boolean(
            flags,
            "disable_tcp_hole_punching",
            defaults.disable_tcp_hole_punching,
        ),
        udp_hole_punching: !boolean(
            flags,
            "disable_udp_hole_punching",
            defaults.disable_udp_hole_punching,
        ),
        upnp: !boolean(flags, "disable_upnp", defaults.disable_upnp),
        magic_dns: boolean(flags, "accept_dns", defaults.accept_dns),
        dns_suffix: string(flags, "tld_dns_zone", &defaults.tld_dns_zone),
        udp_broadcast_relay: boolean(
            flags,
            "enable_udp_broadcast_relay",
            defaults.enable_udp_broadcast_relay,
        ),
        official_toml: Some(original),
        extra: Map::new(),
    }
}

pub(super) fn preserved_fields(table: &Table) -> Vec<String> {
    let mut fields = table
        .keys()
        .filter(|key| {
            ![
                "instance_id",
                "hostname",
                "ipv4",
                "dhcp",
                "network_identity",
                "peer",
                "flags",
            ]
            .contains(&key.as_str())
        })
        .cloned()
        .collect::<Vec<_>>();
    if let Some(flags) = table.get("flags").and_then(Value::as_table) {
        fields.extend(
            flags
                .keys()
                .filter(|key| !EDITED_FLAGS.contains(&key.as_str()))
                .map(|key| format!("flags.{key}")),
        );
    }
    if table
        .get("peer")
        .and_then(Value::as_array)
        .is_some_and(|peers| {
            peers
                .iter()
                .any(|peer| peer.get("peer_public_key").is_some())
        })
    {
        fields.push("peer.peer_public_key".into());
    }
    fields
}

/// Patch only changed editor fields; preserving omission and explicit defaults
/// matters, as does retaining a peer's public key when its address is unchanged.
pub(super) fn overlay(
    table: &mut Table,
    current: &ConnectionConfig,
    previous: &ConnectionConfig,
) -> Result<()> {
    if current.name != previous.name || current.secret != previous.secret {
        let identity = table
            .entry("network_identity")
            .or_insert_with(|| Value::Table(Table::new()));
        let identity = identity.as_table_mut().ok_or_else(super::invalid)?;
        if current.name != previous.name {
            identity.insert("network_name".into(), Value::String(current.name.clone()));
        }
        if current.secret != previous.secret {
            identity.insert(
                "network_secret".into(),
                Value::String(current.secret.clone()),
            );
        }
    }
    if current.hostname != previous.hostname {
        table.remove("hostname");
        if let Some(hostname) = &current.hostname {
            table.insert("hostname".into(), Value::String(hostname.clone()));
        }
    }
    if current.ipv4_mode != previous.ipv4_mode
        || current.ipv4_address != previous.ipv4_address
        || current.ipv4_prefix != previous.ipv4_prefix
    {
        table.insert("dhcp".into(), Value::Boolean(current.ipv4_mode == "auto"));
        table.remove("ipv4");
        if current.ipv4_mode == "manual" {
            table.insert(
                "ipv4".into(),
                Value::String(format!("{}/{}", current.ipv4_address, current.ipv4_prefix)),
            );
        }
    }
    if current.servers != previous.servers {
        let old = table
            .get("peer")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        table.insert(
            "peer".into(),
            Value::Array(
                current
                    .servers
                    .iter()
                    .map(|uri| {
                        old.iter()
                            .find(|peer| {
                                peer.get("uri").and_then(Value::as_str) == Some(uri.as_str())
                            })
                            .cloned()
                            .unwrap_or_else(|| {
                                Value::Table(Table::from_iter([(
                                    "uri".into(),
                                    Value::String(uri.clone()),
                                )]))
                            })
                    })
                    .collect(),
            ),
        );
    }
    if current.tun_name == previous.tun_name
        && current.mtu == previous.mtu
        && current.ipv6 == previous.ipv6
        && current.p2p_policy == previous.p2p_policy
        && current.latency_first == previous.latency_first
        && current.tcp_hole_punching == previous.tcp_hole_punching
        && current.udp_hole_punching == previous.udp_hole_punching
        && current.upnp == previous.upnp
        && current.magic_dns == previous.magic_dns
        && current.dns_suffix == previous.dns_suffix
        && current.udp_broadcast_relay == previous.udp_broadcast_relay
    {
        return Ok(());
    }
    let flags = table
        .entry("flags")
        .or_insert_with(|| Value::Table(Table::new()))
        .as_table_mut()
        .ok_or_else(super::invalid)?;
    macro_rules! flag {
        ($field:ident, $key:literal, $value:expr) => {
            if current.$field != previous.$field {
                flags.insert(
                    $key.into(),
                    Value::try_from($value).map_err(|_| super::invalid())?,
                );
            }
        };
    }
    flag!(tun_name, "dev_name", &current.tun_name);
    if current.mtu != previous.mtu {
        flags.remove("mtu");
        if let Some(mtu) = current.mtu {
            flags.insert("mtu".into(), Value::Integer(mtu.into()));
        }
    }
    flag!(ipv6, "enable_ipv6", current.ipv6);
    if current.p2p_policy != previous.p2p_policy {
        flags.insert(
            "disable_p2p".into(),
            Value::Boolean(current.p2p_policy == "disabled"),
        );
        flags.insert(
            "lazy_p2p".into(),
            Value::Boolean(current.p2p_policy == "lazy"),
        );
        flags.insert(
            "p2p_only".into(),
            Value::Boolean(current.p2p_policy == "only"),
        );
    }
    flag!(latency_first, "latency_first", current.latency_first);
    flag!(
        tcp_hole_punching,
        "disable_tcp_hole_punching",
        !current.tcp_hole_punching
    );
    flag!(
        udp_hole_punching,
        "disable_udp_hole_punching",
        !current.udp_hole_punching
    );
    flag!(upnp, "disable_upnp", !current.upnp);
    flag!(magic_dns, "accept_dns", current.magic_dns);
    flag!(
        dns_suffix,
        "tld_dns_zone",
        if current.dns_suffix.ends_with('.') {
            current.dns_suffix.clone()
        } else {
            format!("{}.", current.dns_suffix)
        }
    );
    flag!(
        udp_broadcast_relay,
        "enable_udp_broadcast_relay",
        current.udp_broadcast_relay
    );
    Ok(())
}
