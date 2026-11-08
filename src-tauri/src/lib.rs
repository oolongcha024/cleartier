mod config_commands;
mod desktop;
mod host_environment;
mod invitation_commands;
mod network_commands;
mod runtime_setup;
mod toml_commands;
mod updates;

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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(desktop::second_instance));
    #[cfg(not(windows))]
    let builder = builder.plugin(
        tauri_plugin_autostart::Builder::new()
            .app_name("ClearTier")
            .arg("--background")
            .build(),
    );
    builder
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            runtime_setup::setup(app)?;
            desktop::setup(app)?;
            updates::setup(app)
        })
        .invoke_handler(tauri::generate_handler![
            updates::updates_status,
            updates::updates_command,
            desktop::preferences::desktop_status,
            desktop::preferences::desktop_update,
            desktop::lifecycle::desktop_exit,
            desktop::lifecycle::desktop_respond,
            desktop::diagnostics::diagnostics_read,
            desktop::diagnostics::diagnostics_export,
            desktop::diagnostics::logs_open,
            host_environment,
            core_version,
            invitation_commands::invitation_parameters,
            network_commands::network_operation,
            network_commands::network_snapshot,
            config_commands::config_load,
            config_commands::config_save,
            config_commands::config_restore,
            toml_commands::toml_import,
            toml_commands::toml_inspect,
            toml_commands::toml_export
        ])
        .build(tauri::generate_context!())
        .expect("failed to build ClearTier")
        .run(desktop::event);
}
