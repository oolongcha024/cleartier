use super::*;
use easytier::common::config::{ConfigLoader, TomlConfigLoader};
use toml::Table;

const SOURCE: &str = r#"
instance_id = "11111111-1111-4111-8111-111111111111"
instance_name = "work node"
hostname = "work-pc"
ipv4 = "10.42.0.8/24"
dhcp = false
listeners = ["tcp://0.0.0.0:11010", "udp://0.0.0.0:11011"]
routes = ["192.168.8.0/24"]
stun_servers = []
[network_identity]
network_name = " exact office "
network_secret = " exact secret "
[[peer]]
uri = "tcp://127.0.0.1:11010"
peer_public_key = "preserved-key"
[[proxy_network]]
cidr = "192.168.8.0/24"
[flags]
dev_name = "ct-office"
mtu = 1200
enable_kcp_proxy = true
disable_upnp = true
"#;

#[test]
fn official_round_trip_preserves_unexposed_settings_and_overlays_only_changes() {
    let id = Uuid::new_v4();
    let preview = import(id, SOURCE).unwrap();
    assert!(preview.issues.is_empty(), "{:?}", preview.issues);
    assert_eq!(preview.config.hostname.as_deref(), Some("work-pc"));
    assert_eq!(preview.config.tun_name, "ct-office");
    let original: toml::Table = toml::from_str(SOURCE).unwrap();
    let mut changed = preview.config;
    changed.hostname = Some("new-pc".into());
    changed.upnp = true;
    changed.servers.push("udp://127.0.0.1:11012".into());
    let exported = export(id, &changed).unwrap();
    let result: toml::Table = toml::from_str(&exported).unwrap();
    assert_eq!(
        result["instance_id"].as_str(),
        Some(id.to_string().as_str())
    );
    for key in [
        "listeners",
        "routes",
        "proxy_network",
        "stun_servers",
        "instance_name",
        "ipv4",
        "dhcp",
        "network_identity",
    ] {
        assert_eq!(result[key], original[key], "{key}");
    }
    assert_eq!(
        result["flags"]["enable_kcp_proxy"],
        original["flags"]["enable_kcp_proxy"]
    );
    assert_eq!(
        result["peer"][0]["peer_public_key"],
        original["peer"][0]["peer_public_key"]
    );
    let loaded = TomlConfigLoader::new_from_str(&for_connection(id, &changed).unwrap()).unwrap();
    assert_eq!(loaded.get_hostname(), "new-pc");
    assert!(loaded.get_flags().enable_kcp_proxy);
    assert!(!loaded.get_flags().disable_upnp);
    assert_eq!(
        loaded.get_network_identity().network_secret.as_deref(),
        Some(" exact secret ")
    );
}

#[test]
fn unknown_nested_and_future_fields_are_retained_but_block_connection() {
    let id = Uuid::new_v4();
    let text = SOURCE
        .replace(
            "network_secret =",
            "future_identity = true\nnetwork_secret =",
        )
        .replace("mtu = 1200", "mtu = 1200\nfuture_flag = true");
    let preview = import(id, &text).unwrap();
    assert!(
        preview.issues.iter().any(
            |issue| issue.path == "network_identity.future_identity" && issue.code == "unknown"
        )
    );
    assert!(
        preview
            .issues
            .iter()
            .any(|issue| issue.path == "flags.future_flag")
    );
    let mut config = preview.config;
    config.hostname = Some("changed".into());
    let exported: toml::Table = toml::from_str(&export(id, &config).unwrap()).unwrap();
    assert_eq!(exported["flags"]["future_flag"].as_bool(), Some(true));
    assert_eq!(
        for_connection(id, &config).unwrap_err().code,
        ErrorCode::UnsupportedConfig
    );
}

#[test]
fn invalid_upstream_flag_types_cannot_panic_and_can_be_saved_and_exported() {
    for text in [
        "[flags]\nmtu = 'secret-value'",
        "flags = 'invalid-table'",
        "[network_identity]\nnetwork_name = 123",
    ] {
        let id = Uuid::new_v4();
        let preview = import(id, text).unwrap();
        assert!(!preview.issues.is_empty());
        preview.config.validate().unwrap();
        assert!(export(id, &preview.config).is_ok());
        let error = for_connection(id, &preview.config).unwrap_err();
        assert!(!error.message.contains("secret-value"));
    }
}

#[test]
fn explicit_defaults_and_absent_peers_are_not_rewritten_by_unrelated_edits() {
    let id = Uuid::new_v4();
    let source = "dhcp = false\n[flags]\ndisable_p2p = false\nenable_ipv6 = true\n";
    let mut config = import(id, source).unwrap().config;
    config.hostname = Some("desktop".into());
    let result: toml::Table = toml::from_str(&export(id, &config).unwrap()).unwrap();
    assert_eq!(result["dhcp"].as_bool(), Some(false));
    assert!(!result.contains_key("peer"));
    assert!(!result.contains_key("ipv4"));
    assert_eq!(result["flags"]["disable_p2p"].as_bool(), Some(false));
    assert!(inspect(id, &config).unwrap().issues.is_empty());
}

#[test]
fn flags_combinations_are_preserved_reported_and_resolvable_through_the_form() {
    let id = Uuid::new_v4();
    let mut config = import(
        id,
        &SOURCE.replace(
            "mtu = 1200",
            "mtu = 1200\np2p_only = true\ndisable_p2p = true",
        ),
    )
    .unwrap()
    .config;
    assert!(
        inspect(id, &config)
            .unwrap()
            .issues
            .iter()
            .any(|issue| issue.code == "combination")
    );
    config.p2p_policy = "auto".into();
    assert!(inspect(id, &config).unwrap().issues.is_empty());
    let flags = TomlConfigLoader::new_from_str(&for_connection(id, &config).unwrap())
        .unwrap()
        .get_flags();
    assert!(!flags.disable_p2p && !flags.lazy_p2p && !flags.p2p_only);
}

#[test]
fn source_files_and_logging_never_run_inside_the_elevated_core() {
    let id = Uuid::new_v4();
    let source = "credential_file = 'not-read.json'\n[file_logger]\ndir = 'not-created'\n";
    let preview = import(id, source).unwrap();
    assert!(preview.issues.iter().all(|issue| issue.code == "managed"));
    assert_eq!(preview.issues.len(), 2);
    assert!(
        export(id, &preview.config)
            .unwrap()
            .contains("not-read.json")
    );
    assert!(for_connection(id, &preview.config).is_err());
}

#[test]
fn syntax_size_limits_and_error_redaction_apply_before_core_loading() {
    assert!(import(Uuid::new_v4(), "secret = [broken").is_err());
    assert!(import(Uuid::new_v4(), &"x".repeat(MAX_TOML_BYTES + 1)).is_err());
    let id = Uuid::new_v4();
    let preview = import(id, "\u{feff}[network_identity]\nnetwork_name = 'office'\n").unwrap();
    assert_eq!(preview.config.name, "office");
    if !cfg!(target_os = "macos") {
        assert!(preview.config.tun_name.starts_with("ct-"));
    }
}

#[test]
fn platform_specific_settings_remain_exportable_and_are_never_silently_disabled() {
    let id = Uuid::new_v4();
    let preview = import(
        id,
        &SOURCE.replace(
            "mtu = 1200",
            "mtu = 1200\nenable_udp_broadcast_relay = true",
        ),
    )
    .unwrap();
    assert_eq!(
        preview.issues.iter().any(|issue| issue.code == "platform"),
        !cfg!(windows)
    );
    assert!(
        export(id, &preview.config)
            .unwrap()
            .contains("enable_udp_broadcast_relay = true")
    );
}

#[test]
fn explicit_upstream_stun_defaults_are_known_even_when_the_loader_omits_them() {
    let mut source = Table::new();
    source.insert(
        "stun_servers".into(),
        toml::Value::try_from(easytier::common::stun::StunInfoCollector::get_default_servers())
            .unwrap(),
    );
    source.insert(
        "stun_servers_v6".into(),
        toml::Value::try_from(easytier::common::stun::StunInfoCollector::get_default_servers_v6())
            .unwrap(),
    );
    let id = Uuid::new_v4();
    let preview = import(id, &toml::to_string(&source).unwrap()).unwrap();
    assert!(preview.issues.is_empty(), "{:?}", preview.issues);
    let exported: Table = toml::from_str(&export(id, &preview.config).unwrap()).unwrap();
    assert_eq!(exported["stun_servers"], source["stun_servers"]);
    assert_eq!(exported["stun_servers_v6"], source["stun_servers_v6"]);
}
