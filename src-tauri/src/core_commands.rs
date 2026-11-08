use cleartier_core::{
    InstanceSnapshot,
    process::{CoreController, CoreError, CorePaths, ErrorCode, HostStatus},
};
use tauri::{Manager, State};

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

#[tauri::command]
pub fn core_status(core: State<'_, CoreController>) -> HostStatus {
    core.status()
}

#[tauri::command]
pub async fn core_start(
    app: tauri::AppHandle,
    toml: String,
    core: State<'_, CoreController>,
) -> Result<String, CoreError> {
    if app.state::<crate::desktop::Desktop>().rejects_connections() {
        return Err(CoreError {
            code: ErrorCode::CoreFailure,
            message: "The client is shutting down".into(),
        });
    }
    core.start(toml).await.map(|id| id.to_string())
}

#[tauri::command]
pub async fn core_stop(
    instance_id: String,
    core: State<'_, CoreController>,
) -> Result<(), CoreError> {
    let id = instance_id.parse().map_err(|_| CoreError {
        code: ErrorCode::InvalidConfig,
        message: "Invalid instance ID".into(),
    })?;
    core.stop(id).await
}

#[tauri::command]
pub async fn core_snapshot(
    core: State<'_, CoreController>,
) -> Result<Vec<InstanceSnapshot>, CoreError> {
    core.snapshot().await
}

#[tauri::command]
pub async fn core_shutdown(core: State<'_, CoreController>) -> Result<(), CoreError> {
    core.shutdown().await
}
