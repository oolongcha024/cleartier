mod core_commands;
mod host_environment;

#[tauri::command]
fn core_version() -> &'static str {
    cleartier_core::version()
}

#[tauri::command]
fn host_environment() -> Result<(String, String), String> {
    host_environment::read()
}

pub fn run() {
    if let Some(code) = cleartier_core::dispatch_headless() {
        std::process::exit(code);
    }
    tauri::Builder::default()
        .setup(core_commands::setup)
        .invoke_handler(tauri::generate_handler![
            host_environment,
            core_version,
            core_commands::core_status,
            core_commands::core_start,
            core_commands::core_stop,
            core_commands::core_snapshot,
            core_commands::core_shutdown
        ])
        .build(tauri::generate_context!())
        .expect("failed to build ClearTier")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                use tauri::Manager;
                if let Some(core) = app.try_state::<cleartier_core::process::CoreController>() {
                    let _ = tauri::async_runtime::block_on(core.shutdown());
                }
            }
        });
}
