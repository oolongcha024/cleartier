//! Extract membership only. Imported credentials and secure-mode keys must not
//! disappear silently or be copied into an invitation for another machine.
use cleartier_config::ConnectionConfig;
use easytier::common::config::{ConfigLoader, TomlConfigLoader, gen_default_flags};
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
pub struct JoinParameters {
    pub name: String,
    pub secret: String,
    pub servers: Vec<String>,
}

pub fn parameters(id: Uuid, config: &ConnectionConfig) -> Result<JoinParameters, &'static str> {
    let text =
        crate::configuration::for_connection(id, config).map_err(|_| "unsupportedConfiguration")?;
    let core = TomlConfigLoader::new_from_str(&text).map_err(|_| "unsupportedConfiguration")?;
    if core.get_secure_mode().is_some_and(|mode| mode.enabled)
        || core.get_peers().iter().any(|peer| {
            peer.peer_public_key
                .as_ref()
                .is_some_and(|key| !key.is_empty())
        })
        || core.get_flags().encryption_algorithm != gen_default_flags().encryption_algorithm
    {
        return Err("unsupportedConfiguration");
    }
    let identity = core.get_network_identity();
    Ok(JoinParameters {
        name: identity.network_name,
        secret: identity.network_secret.unwrap_or_default(),
        servers: core
            .get_peers()
            .into_iter()
            .map(|peer| peer.uri.to_string())
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &str = "hostname = 'sender-node'\nipv4 = '10.42.0.8/24'\nlisteners = ['tcp://0.0.0.0:11010']\n[network_identity]\nnetwork_name = ' office '\nnetwork_secret = ' key '\n[[peer]]\nuri = 'tcp://example.com:11010'\n[flags]\ndev_name = 'ct-sender'\nmtu = 1200\ndisable_p2p = true\n";

    #[test]
    fn extracts_only_exact_identity_and_endpoints_from_effective_configuration() {
        let id = Uuid::new_v4();
        let mut config = crate::configuration::import(id, SOURCE).unwrap().config;
        config.name = " changed office ".into();
        config.secret = " next key ".into();
        config.servers = vec!["udp://example.com:11011".into()];
        let result = serde_json::to_value(parameters(id, &config).unwrap()).unwrap();
        assert_eq!(
            result,
            serde_json::json!({"name":" changed office ","secret":" next key ","servers":["udp://example.com:11011"]})
        );
    }

    #[test]
    fn unknown_configuration_cannot_be_silently_reduced_to_a_broken_invitation() {
        let id = Uuid::new_v4();
        let config = crate::configuration::import(id, &format!("{SOURCE}future_flag = true\n"))
            .unwrap()
            .config;
        assert_eq!(
            parameters(id, &config).err(),
            Some("unsupportedConfiguration")
        );
    }

    #[test]
    fn secure_mode_or_pinned_peer_keys_require_more_than_a_minimal_invitation() {
        let id = Uuid::new_v4();
        let mut table: toml::Table = toml::from_str(SOURCE).unwrap();
        table.insert(
            "secure_mode".into(),
            toml::Value::try_from(easytier::proto::common::SecureModeConfig {
                enabled: true,
                ..Default::default()
            })
            .unwrap(),
        );
        for source in [
            toml::to_string(&table).unwrap(),
            SOURCE.replace("uri =", "peer_public_key = 'not-shared'\nuri ="),
        ] {
            let preview = crate::configuration::import(id, &source).unwrap();
            assert!(preview.issues.is_empty(), "{:?}", preview.issues);
            assert_eq!(
                parameters(id, &preview.config).err(),
                Some("unsupportedConfiguration")
            );
        }
    }
}
