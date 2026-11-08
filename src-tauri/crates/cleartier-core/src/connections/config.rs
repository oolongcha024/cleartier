use crate::process::{CoreError, ErrorCode, Result};
use cleartier_config::ConnectionConfig;
use easytier::common::config::{ConfigLoader, NetworkIdentity, PeerConfig, TomlConfigLoader};
use uuid::Uuid;

/// Use upstream's typed loader rather than interpolating credentials into TOML.
/// Listener ports are allocated by the OS so independent networks do not all
/// contend for the upstream CLI's fixed default port.
pub fn to_core(id: Uuid, config: &ConnectionConfig) -> Result<String> {
    crate::configuration::for_connection(id, config)
}

pub(crate) fn editor_toml(id: Uuid, config: &ConnectionConfig) -> Result<String> {
    config
        .validate()
        .map_err(|_| CoreError::new(ErrorCode::InvalidConfig, "Invalid network parameters"))?;
    if !config.extra.is_empty() {
        return Err(CoreError::new(
            ErrorCode::UnsupportedConfig,
            "Unrecognized connection parameters",
        ));
    }
    let core = TomlConfigLoader::default();
    core.set_id(id);
    core.set_inst_name(config.name.clone());
    core.set_hostname(config.hostname.clone());
    core.set_network_identity(NetworkIdentity::new(
        config.name.clone(),
        config.secret.clone(),
    ));
    core.set_dhcp(config.ipv4_mode == "auto");
    if config.ipv4_mode == "manual" {
        core.set_ipv4(Some(
            format!("{}/{}", config.ipv4_address, config.ipv4_prefix)
                .parse()
                .map_err(|_| CoreError::new(ErrorCode::InvalidConfig, "Invalid virtual address"))?,
        ));
    }
    let mut peers = Vec::new();
    for address in &config.servers {
        let peer = PeerConfig {
            uri: address
                .parse()
                .map_err(|_| CoreError::new(ErrorCode::InvalidConfig, "Invalid server address"))?,
            peer_public_key: None,
        };
        easytier::tunnel::TunnelScheme::try_from(&peer.uri)
            .map_err(|_| CoreError::new(ErrorCode::InvalidConfig, "Unsupported server protocol"))?;
        peers.push(peer);
    }
    core.set_peers(peers);
    core.set_listeners(
        ["tcp://0.0.0.0:0", "udp://0.0.0.0:0"]
            .iter()
            .map(|uri| uri.parse().unwrap())
            .collect(),
    );
    if config.ipv6 {
        let mut listeners = core.get_listeners().unwrap_or_default();
        listeners.extend(
            ["tcp://[::]:0", "udp://[::]:0"]
                .iter()
                .map(|uri| uri.parse().unwrap()),
        );
        core.set_listeners(listeners);
    }
    let mut flags = core.get_flags();
    #[cfg(not(target_os = "macos"))]
    {
        flags.dev_name = config.tun_name.clone();
    }
    flags.enable_ipv6 = config.ipv6;
    flags.mtu = config.mtu.unwrap_or(flags.mtu);
    flags.disable_p2p = config.p2p_policy == "disabled";
    flags.lazy_p2p = config.p2p_policy == "lazy";
    flags.p2p_only = config.p2p_policy == "only";
    flags.latency_first = config.latency_first && !flags.p2p_only;
    flags.disable_tcp_hole_punching = !config.tcp_hole_punching;
    flags.disable_udp_hole_punching = !config.udp_hole_punching;
    flags.disable_upnp = !config.upnp;
    flags.accept_dns = config.magic_dns;
    flags.tld_dns_zone = if config.dns_suffix.ends_with('.') {
        config.dns_suffix.clone()
    } else {
        format!("{}.", config.dns_suffix)
    };
    flags.enable_udp_broadcast_relay = config.udp_broadcast_relay;
    core.set_flags(flags);
    Ok(core.dump())
}
