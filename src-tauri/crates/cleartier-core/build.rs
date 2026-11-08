fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    // EasyTier emits a workspace-relative Packet.lib search path. Own the
    // absolute path here so core tests and every application caller can link.
    let resources = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../resources/windows");
    let packet = resources.join("Packet.lib");
    println!("cargo:rerun-if-changed={}", packet.display());
    assert!(
        packet.is_file(),
        "Missing Packet.lib; run node scripts/prepare-core-resources.mjs before building the Windows core"
    );
    println!("cargo:rustc-link-search=native={}", resources.display());
}
