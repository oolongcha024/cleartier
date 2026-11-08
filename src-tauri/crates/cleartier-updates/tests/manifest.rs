use std::{fs, process::Command};

fn generate(corrupt: bool, version: &str, wrong_key: bool) -> bool {
    let directory = tempfile::tempdir().unwrap();
    let installer = directory
        .path()
        .join(format!("ClearTier_{version}_x64-setup.exe"));
    fs::write(
        &installer,
        if corrupt {
            "corrupted package"
        } else {
            include_str!("fixtures/payload.txt")
        },
    )
    .unwrap();
    fs::write(
        format!("{}.sig", installer.display()),
        include_str!("fixtures/signature.txt"),
    )
    .unwrap();
    let config = directory.path().join("tauri.conf.json");
    let key = if wrong_key {
        "invalid public key"
    } else {
        include_str!("fixtures/public-key.txt").trim()
    };
    fs::write(
        &config,
        serde_json::to_vec(&serde_json::json!({"plugins":{"updater":{"pubkey":key}}})).unwrap(),
    )
    .unwrap();
    let output = directory.path().join("latest.json");
    let result = Command::new(env!("CARGO_BIN_EXE_update-manifest"))
        .args([
            config.as_os_str(),
            installer.as_os_str(),
            version.as_ref(),
            output.as_os_str(),
        ])
        .output()
        .unwrap();
    if result.status.success() {
        let json: serde_json::Value = serde_json::from_slice(&fs::read(output).unwrap()).unwrap();
        assert_eq!(json["version"], version);
        assert!(
            json["platforms"]["windows-x86_64"]["url"]
                .as_str()
                .unwrap()
                .starts_with("https://github.com/oolongcha024/cleartier/releases/download/")
        );
        assert_eq!(
            json["platforms"]["windows-x86_64"]["signature"],
            include_str!("fixtures/signature.txt").trim()
        );
        true
    } else {
        assert!(!output.exists());
        false
    }
}
#[test]
fn signed_installer_generates_the_public_manifest() {
    assert!(generate(false, "0.2.0", false));
}
#[test]
fn corrupted_installer_cannot_generate_a_manifest() {
    assert!(!generate(true, "0.2.0", false));
}
#[test]
fn replaying_an_old_signature_as_a_new_version_is_rejected() {
    assert!(!generate(false, "0.3.0", false));
}
#[test]
fn unknown_signing_key_is_rejected() {
    assert!(!generate(false, "0.2.0", true));
}
