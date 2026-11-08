use super::*;
use cleartier_core::{connections::NetworkManager, process::CoreController, support::Report};
use std::io::Write;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

async fn report(app: &tauri::AppHandle) -> Report {
    let manager = app.state::<NetworkManager>();
    let snapshots = manager.snapshot().await.map_err(|error| error.code);
    Report::collect(
        app.package_info().version.to_string(),
        &app.state::<CoreController>().status(),
        snapshots,
        app.state::<cleartier_config::Repository>().load().is_ok(),
        app.state::<Desktop>().repository.load().is_ok(),
        manager.recent_errors().await,
    )
}
#[tauri::command]
pub async fn diagnostics_read(app: tauri::AppHandle) -> Result<Report, &'static str> {
    Ok(report(&app).await)
}

#[tauri::command]
pub async fn diagnostics_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<bool, &'static str> {
    let report = report(&app).await;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("ClearTier diagnostics", &["json"])
            .set_file_name("cleartier-diagnostics.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|_| "io")?;
        let mut output =
            tempfile::NamedTempFile::new_in(path.parent().ok_or("io")?).map_err(|_| "io")?;
        let bytes = serde_json::to_vec_pretty(&report).map_err(|_| "io")?;
        output
            .write_all(&bytes)
            .and_then(|_| output.as_file().sync_all())
            .map_err(|_| "io")?;
        output.persist(path).map_err(|_| "io")?;
        Ok(true)
    })
    .await
    .map_err(|_| "io")?
}
#[tauri::command]
pub async fn logs_open(app: tauri::AppHandle) -> Result<(), &'static str> {
    tauri::async_runtime::spawn_blocking(move || {
        // The caller cannot supply an arbitrary path or external URL.
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|_| "io")?
            .join("logs");
        std::fs::create_dir_all(&directory).map_err(|_| "io")?;
        app.opener()
            .open_path(directory.to_string_lossy(), None::<&str>)
            .map_err(|_| "io")
    })
    .await
    .map_err(|_| "io")?
}
