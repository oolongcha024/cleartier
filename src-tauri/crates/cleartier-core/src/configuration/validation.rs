use super::Issue;
use easytier::common::config::{ConfigLoader, Flags, TomlConfigLoader, gen_default_flags};
use toml::{Table, Value};

fn issue(issues: &mut Vec<Issue>, path: &str, code: &'static str) {
    issues.push(Issue {
        path: path.to_owned(),
        code,
    });
}

pub(crate) fn issues(table: &Table) -> Vec<Issue> {
    let mut issues = Vec::new();
    // The upstream flags loader unwraps invalid types. Validate the fully merged
    // typed flags first, and never expose its errors (which can contain values).
    let mut defaults = serde_json::to_value(gen_default_flags()).unwrap();
    if let Some(value) = table.get("flags") {
        let Some(flags) = value.as_table() else {
            issue(&mut issues, "flags", "invalid");
            return issues;
        };
        for (key, value) in flags {
            if defaults.get(key).is_none() {
                issue(&mut issues, &format!("flags.{key}"), "unknown");
            } else {
                let converted = serde_json::to_value(value).unwrap_or_default();
                let mut probe = defaults.clone();
                probe[key] = converted.clone();
                if serde_json::from_value::<Flags>(probe).is_err() {
                    issue(&mut issues, &format!("flags.{key}"), "invalid");
                } else {
                    defaults[key] = converted;
                }
            }
        }
    }
    if issues.iter().any(|issue| issue.code == "invalid") {
        return issues;
    }
    let text = match toml::to_string(table) {
        Ok(text) => text,
        Err(_) => {
            issue(&mut issues, "", "invalid");
            return issues;
        }
    };
    let core = match TomlConfigLoader::new_from_str(&text) {
        Ok(core) => core,
        Err(_) => {
            issue(&mut issues, "", "invalid");
            return issues;
        }
    };
    // Typed round-trip exposes ignored keys, including nested keys in tables and
    // array entries. Flags have their own complete schema above (dump omits defaults).
    let canonical: Table = toml::from_str(&core.dump()).unwrap();
    for (key, value) in table {
        // dump also omits explicitly configured default STUN lists. Their typed
        // string arrays cannot contain nested unrecognized fields.
        if ["flags", "stun_servers", "stun_servers_v6"].contains(&key.as_str()) {
            continue;
        }
        if ["credential_file", "source", "file_logger", "console_logger"].contains(&key.as_str()) {
            issue(&mut issues, key, "managed");
            continue;
        }
        unknown(value, canonical.get(key), key, &mut issues);
    }
    let flags = core.get_flags();
    if !cfg!(windows) && flags.enable_udp_broadcast_relay {
        issue(&mut issues, "flags.enable_udp_broadcast_relay", "platform");
    }
    if !cfg!(target_os = "linux") && table.contains_key("netns") {
        issue(&mut issues, "netns", "platform");
    }
    if cfg!(target_os = "macos") && !flags.dev_name.is_empty() {
        issue(&mut issues, "flags.dev_name", "platform");
    }
    if flags.p2p_only && (flags.disable_p2p || flags.lazy_p2p || flags.latency_first) {
        issue(&mut issues, "flags.p2p_only", "combination");
    }
    if flags.disable_p2p && flags.lazy_p2p {
        issue(&mut issues, "flags.lazy_p2p", "combination");
    }
    if !(400..=1380).contains(&flags.mtu) {
        issue(&mut issues, "flags.mtu", "range");
    }
    if !cfg!(target_os = "macos")
        && (!flags.dev_name.is_empty()
            && (flags.dev_name.len() > 15
                || !flags
                    .dev_name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')))
    {
        issue(&mut issues, "flags.dev_name", "interfaceName");
    }
    if let Some(value) = table.get("hostname").and_then(Value::as_str) {
        if value.chars().count() > 32 || value.chars().any(char::is_control) {
            issue(&mut issues, "hostname", "normalized");
        }
    }
    for key in ["ipv4", "ipv6", "ipv6_public_addr_prefix"] {
        if let Some(value) = table.get(key).and_then(Value::as_str) {
            let valid = match key {
                "ipv4" => core.get_ipv4().is_some_and(|parsed| {
                    // The upstream treats /32 as /24; do not silently promise /32.
                    value
                        .split_once('/')
                        .is_none_or(|(_, prefix)| prefix != "32")
                        && parsed.address().octets()[0] > 0
                        && parsed.address().octets()[0] < 224
                        && parsed.address().octets()[0] != 127
                }),
                "ipv6" => core.get_ipv6().is_some(),
                _ => core.get_ipv6_public_addr_prefix().is_some(),
            };
            if !valid {
                issue(&mut issues, key, "invalid");
            }
        }
    }
    for (index, peer) in core.get_peers().iter().enumerate() {
        if easytier::tunnel::TunnelScheme::try_from(&peer.uri).is_err() {
            issue(&mut issues, &format!("peer[{index}].uri"), "protocol");
        }
    }
    for (index, listener) in core.get_listener_uris().iter().enumerate() {
        if easytier::tunnel::TunnelScheme::try_from(listener).is_err() {
            issue(&mut issues, &format!("listeners[{index}]"), "protocol");
        }
    }
    for (index, listener) in core.get_mapped_listeners().iter().enumerate() {
        if easytier::common::config::validate_mapped_listener_url(listener).is_err() {
            issue(
                &mut issues,
                &format!("mapped_listeners[{index}]"),
                "invalid",
            );
        }
    }
    if core.get_proxy_cidrs().iter().any(|proxy| {
        proxy
            .mapped_cidr
            .is_some_and(|mapped| mapped.network_length() != proxy.cidr.network_length())
    }) {
        issue(&mut issues, "proxy_network.mapped_cidr", "combination");
    }
    if flags
        .encryption_algorithm
        .parse::<easytier::common::config::EncryptionAlgorithm>()
        .is_err()
    {
        issue(&mut issues, "flags.encryption_algorithm", "invalid");
    }
    if flags.accept_dns {
        let suffix = flags.tld_dns_zone.trim_end_matches('.');
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
            issue(&mut issues, "flags.tld_dns_zone", "invalid");
        }
    }
    issues
}

fn unknown(value: &Value, known: Option<&Value>, path: &str, issues: &mut Vec<Issue>) {
    let Some(known) = known else {
        issue(issues, path, "unknown");
        return;
    };
    match (value, known) {
        (Value::Table(table), Value::Table(schema)) => {
            for (key, value) in table {
                unknown(value, schema.get(key), &format!("{path}.{key}"), issues);
            }
        }
        (Value::Array(values), Value::Array(schema)) => {
            for (index, value) in values.iter().enumerate() {
                unknown(
                    value,
                    schema.get(index),
                    &format!("{path}[{index}]"),
                    issues,
                );
            }
        }
        _ => {}
    }
}
