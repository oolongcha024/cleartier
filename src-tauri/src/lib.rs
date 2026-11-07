mod host_environment;

#[tauri::command]
fn host_environment() -> Result<(String, String), String> {
    host_environment::read()
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![host_environment])
        .run(tauri::generate_context!())
        .expect("failed to run ClearTier");
}
