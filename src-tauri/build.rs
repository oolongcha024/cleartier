fn main() {
    println!("cargo:rerun-if-changed=../package.json");
    let package_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../package.json");
    let package: serde_json::Value = serde_json::from_slice(
        &std::fs::read(package_path).expect("failed to read package.json version source"),
    )
    .expect("invalid package.json");
    assert_eq!(
        package["version"].as_str(),
        Some(env!("CARGO_PKG_VERSION")),
        "Cargo version differs from package.json; use pnpm version:start/next/promote/set"
    );
    // Tauri tracks its config, but cached Windows resources also depend on icons.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=resources/windows");
    println!("cargo:rerun-if-changed=windows-app.manifest");
    println!("cargo:rerun-if-changed=windows/installer-hooks.nsh");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Upstream's Packet.lib search is guarded by the build host OS.
        let root = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        println!("cargo:rustc-link-search=native={root}/resources/windows");
    }
    let windows =
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to build desktop resources");
}
