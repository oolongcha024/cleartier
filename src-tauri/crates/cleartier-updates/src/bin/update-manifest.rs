//! Build-time gate: verify the same Minisign format used by Tauri before
//! exporting a public update manifest. Secret keys are never read here.
use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use std::{fs, path::Path};

fn main() {
    if let Err(error) = generate() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
fn generate() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 4 {
        return Err("Usage: update-manifest <tauri-config> <installer> <version> <output>".into());
    }
    let config: serde_json::Value = serde_json::from_slice(&fs::read(&args[0])?)?;
    let key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("Missing updater public key")?;
    let key = String::from_utf8(STANDARD.decode(key.trim())?)?;
    let key = PublicKey::decode(&key)?;
    let signature = fs::read_to_string(format!("{}.sig", args[1]))?;
    let decoded = String::from_utf8(STANDARD.decode(signature.trim())?)?;
    let decoded = Signature::decode(&decoded)?;
    key.verify(&fs::read(&args[1])?, &decoded, true)?;
    let signed = decoded
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"))
        .ok_or("Signature must bind the application version")?;
    if signed != args[2] {
        return Err("Signature version differs from application version".into());
    }
    let candidate = cleartier_updates::Candidate {
        version: args[2].clone(),
        notes: String::new(),
    };
    if Path::new(&args[1])
        .file_name()
        .and_then(|name| name.to_str())
        != Some(candidate.installer_name().as_str())
    {
        return Err("Unexpected installer filename".into());
    }
    let manifest = serde_json::json!({"version":args[2], "platforms":{"windows-x86_64":{
        "url":candidate.installer_url(), "signature":signature.trim()
    }}});
    fs::write(&args[3], serde_json::to_string_pretty(&manifest)? + "\n")?;
    Ok(())
}
