// Test-only executable uses the exact headless dispatcher shipped by ClearTier.
// It is not included in the Tauri application or Windows distribution.
fn main() {
    std::process::exit(cleartier_core::dispatch_headless().unwrap_or(2));
}
