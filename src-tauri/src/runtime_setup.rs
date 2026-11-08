use cleartier_core::process::{CoreController, CorePaths};
use tauri::Manager;

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(cleartier_config::Repository::new(
        app.path().app_config_dir()?,
    ));
    let paths = CorePaths::new(
        app.path().app_config_dir()?,
        app.path().app_local_data_dir()?,
    );
    let executable = std::env::current_exe()?;
    let core = tauri::async_runtime::block_on(async { CoreController::new(executable, paths) })?;
    app.manage(cleartier_core::connections::NetworkManager::new(
        core.clone(),
        app.path()
            .app_local_data_dir()?
            .join("runtime-control.lock"),
    ));
    app.manage(core);
    Ok(())
}
