use super::*;
use serde_json::json;

fn document() -> Document {
    serde_json::from_value(json!({
        "version": 1, "revision": "", "selectedId": "00000000-0000-4000-8000-000000000001",
        "futureRoot": { "keep": true },
        "networks": [{
            "id": "00000000-0000-4000-8000-000000000001",
            "client": {"alias":"办公", "icon":"work", "autoConnect":false, "futureClient":42},
            "futureRecord": "keep",
            "config": {"name":" exact name ", "secret":" exact secret ", "servers":["tcp://example.com:11010"],
                "hostname":null, "ipv4Mode":"auto", "ipv4Address":"", "ipv4Prefix":24,
                "tunName":"ct-test", "mtu":null, "ipv6":true, "p2pPolicy":"auto", "latencyFirst":false,
                "tcpHolePunching":true, "udpHolePunching":true, "upnp":true, "magicDns":false,
                "dnsSuffix":"et.net.", "udpBroadcastRelay":false, "futureCore":{"x":1}}
        }]
    })).unwrap()
}

#[test]
fn round_trip_keeps_credentials_preferences_and_unknown_fields() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    assert!(repository.load().unwrap().networks.is_empty());
    assert!(!directory.path().join("networks.json").exists());
    let saved = repository.save(document(), "").unwrap();
    assert!(!saved.revision.is_empty());
    let loaded = repository.load().unwrap();
    assert_eq!(
        serde_json::to_value(&saved).unwrap(),
        serde_json::to_value(&loaded).unwrap()
    );
    assert_eq!(loaded.networks[0].config["secret"], " exact secret ");
    assert_eq!(loaded.networks[0].extra["futureRecord"], "keep");
    assert_eq!(loaded.networks[0].client.extra["futureClient"], 42);
    assert_eq!(loaded.networks[0].config["futureCore"], json!({"x":1}));
    let mut edited = loaded.clone();
    edited.extra.clear();
    edited.networks[0].extra.clear();
    edited.networks[0].client.extra.clear();
    edited.networks[0]
        .config
        .as_object_mut()
        .unwrap()
        .remove("futureCore");
    let saved_again = repository.save(edited, &loaded.revision).unwrap();
    assert_eq!(saved_again.extra["futureRoot"], json!({"keep":true}));
    assert_eq!(saved_again.networks[0].extra["futureRecord"], "keep");
    assert_eq!(saved_again.networks[0].client.extra["futureClient"], 42);
    assert_eq!(saved_again.networks[0].config["futureCore"], json!({"x":1}));
}

#[test]
fn stale_writer_and_invalid_documents_cannot_change_saved_data() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    let saved = repository.save(document(), "").unwrap();
    assert_eq!(
        repository.save(document(), "").unwrap_err().code,
        "conflict"
    );
    let mut invalid = saved.clone();
    invalid.networks.push(invalid.networks[0].clone());
    assert_eq!(
        repository.save(invalid, &saved.revision).unwrap_err().code,
        "invalid"
    );
    assert_eq!(repository.load().unwrap().revision, saved.revision);
    assert!(!directory.path().join("networks.backup.json").exists());
}

#[test]
fn corrupt_primary_is_preserved_and_recovery_is_explicit() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    let first = repository.save(document(), "").unwrap();
    let mut changed = first.clone();
    changed.networks[0].client.alias = "第二次保存".into();
    let second = repository.save(changed, &first.revision).unwrap();
    fs::write(directory.path().join("networks.json"), b"damaged").unwrap();
    let error = repository.load().unwrap_err();
    assert_eq!(error.code, "invalid");
    assert!(error.backup_available);
    assert!(repository.save(second, &first.revision).is_err());
    assert_eq!(
        fs::read(directory.path().join("networks.json")).unwrap(),
        b"damaged"
    );
    let restored = repository.restore().unwrap();
    assert_eq!(restored.networks[0].client.alias, "办公");
    assert!(fs::read_dir(directory.path()).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("networks.damaged-")
    }));
    assert_eq!(repository.restore().unwrap_err().code, "recoveryNotNeeded");
}

#[test]
fn missing_primary_with_backup_is_not_a_first_launch() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    let first = repository.save(document(), "").unwrap();
    repository.save(first.clone(), &first.revision).unwrap();
    fs::remove_file(directory.path().join("networks.json")).unwrap();
    let error = repository.load().unwrap_err();
    assert_eq!(error.code, "missing");
    assert!(error.backup_available);
    assert!(repository.save(document(), "").is_err());
    assert_eq!(repository.restore().unwrap().networks.len(), 1);
}

#[test]
fn future_schema_and_inaccessible_directory_are_not_reset() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    let mut value = serde_json::to_value(document()).unwrap();
    value["version"] = json!(99);
    fs::write(directory.path().join("networks.json"), value.to_string()).unwrap();
    assert_eq!(repository.load().unwrap_err().code, "unsupportedVersion");
    assert!(repository.save(document(), "").is_err());
    assert_eq!(
        Repository::new(directory.path().join("networks.json"))
            .load()
            .unwrap_err()
            .code,
        "io"
    );
}

#[test]
fn lock_contention_fails_without_touching_primary() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    let _lock = repository.lock().unwrap();
    assert_eq!(repository.save(document(), "").unwrap_err().code, "busy");
    assert!(!directory.path().join("networks.json").exists());
}

#[test]
fn invalid_server_and_address_fields_are_rejected_before_any_write() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    for server in [
        "host:11010",
        "tcp://",
        "tcp://host:0",
        "tcp://host:65536",
        "tcp://bad host:11010",
    ] {
        let mut invalid = document();
        invalid.networks[0].config["servers"] = json!([server]);
        assert_eq!(repository.save(invalid, "").unwrap_err().code, "invalid");
    }
    let mut invalid = document();
    invalid.networks[0].config["ipv4Mode"] = json!("manual");
    invalid.networks[0].config["ipv4Address"] = json!("127.0.0.1");
    assert_eq!(repository.save(invalid, "").unwrap_err().code, "invalid");
    assert!(!directory.path().join("networks.json").exists());
}

#[test]
fn oversized_primary_can_be_recovered_without_losing_the_original() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    let first = repository.save(document(), "").unwrap();
    repository.save(first.clone(), &first.revision).unwrap();
    fs::write(
        directory.path().join("networks.json"),
        vec![b'x'; LIMIT as usize + 1],
    )
    .unwrap();
    let error = repository.load().unwrap_err();
    assert_eq!(error.code, "tooLarge");
    assert!(error.backup_available);
    assert_eq!(repository.restore().unwrap().networks.len(), 1);
    let damaged = fs::read_dir(directory.path())
        .unwrap()
        .find_map(|entry| {
            let path = entry.unwrap().path();
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("networks.damaged-")
                .then_some(path)
        })
        .unwrap();
    assert_eq!(fs::metadata(damaged).unwrap().len(), LIMIT + 1);
}

#[test]
fn peer_icons_are_local_client_preferences_and_auto_can_remove_them() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    let peer = uuid::Uuid::new_v4();
    let mut input = document();
    input.networks[0]
        .client
        .peer_icons
        .insert(peer, "server".into());
    let first = repository.save(input, "").unwrap();
    let mut reopened = repository.load().unwrap();
    assert_eq!(
        reopened.networks[0]
            .client
            .peer_icons
            .get(&peer)
            .map(String::as_str),
        Some("server")
    );
    assert!(reopened.networks[0].config.get("peerIcons").is_none());
    reopened.networks[0].client.peer_icons.remove(&peer);
    repository.save(reopened, &first.revision).unwrap();
    assert!(
        repository.load().unwrap().networks[0]
            .client
            .peer_icons
            .is_empty()
    );
    let mut invalid = repository.load().unwrap();
    invalid.networks[0]
        .client
        .peer_icons
        .insert(peer, "inferred-windows".into());
    assert_eq!(
        repository
            .save(invalid.clone(), &invalid.revision)
            .unwrap_err()
            .code,
        "invalid"
    );
    invalid.networks[0].client.peer_icons.clear();
    invalid.networks[0]
        .client
        .peer_icons
        .insert(uuid::Uuid::nil(), "computer".into());
    assert_eq!(invalid.validate(), Err("invalid"));
}

#[test]
fn imported_toml_survives_disk_round_trip_even_with_unsupported_values() {
    let directory = tempfile::tempdir().unwrap();
    let repository = Repository::new(directory.path().into());
    let mut input = document();
    input.networks[0].config["officialToml"] = json!("[flags]\nfuture_flag = true\nmtu = 1500\n");
    input.networks[0].config["mtu"] = json!(1500);
    input.networks[0].config["servers"] = json!([]);
    input.networks[0].config["ipv4Mode"] = json!("none");
    let first = repository.save(input, "").unwrap();
    let mut loaded = repository.load().unwrap();
    assert_eq!(
        loaded.networks[0].config["officialToml"],
        first.networks[0].config["officialToml"]
    );
    loaded.networks[0].client.alias = "new alias".into();
    let next = repository.save(loaded, &first.revision).unwrap();
    assert_eq!(next.networks[0].config, first.networks[0].config);
    let mut invalid = next.clone();
    invalid.networks[0].config["officialToml"] = json!(42);
    assert_eq!(
        repository.save(invalid, &next.revision).unwrap_err().code,
        "invalid"
    );
}
