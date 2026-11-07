fn main() {
    // Tauri tracks its config, but cached Windows resources also depend on icons.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
