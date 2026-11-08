//! File access is restricted to paths chosen through the native dialog in this
//! ordinary-user process. The WebView never supplies an arbitrary write path.
use cleartier_config::ConnectionConfig;
use cleartier_core::configuration::{self, Preview};
use std::io::{Read, Write};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

#[tauri::command]
pub async fn toml_import(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<Preview>, &'static str> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("EasyTier TOML", &["toml"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|_| "io")?;
        let file = std::fs::File::open(path).map_err(|_| "io")?;
        let mut bytes = Vec::new();
        file.take(configuration::MAX_TOML_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "io")?;
        if bytes.len() > configuration::MAX_TOML_BYTES {
            return Err("tooLarge");
        }
        let text = String::from_utf8(bytes).map_err(|_| "invalid")?;
        configuration::import(Uuid::new_v4(), &text)
            .map(Some)
            .map_err(|_| "invalid")
    })
    .await
    .map_err(|_| "io")?
}

#[tauri::command]
pub async fn toml_inspect(id: Uuid, config: ConnectionConfig) -> Result<Preview, &'static str> {
    tauri::async_runtime::spawn_blocking(move || {
        configuration::inspect(id, &config).map_err(|_| "invalid")
    })
    .await
    .map_err(|_| "io")?
}

#[tauri::command]
pub async fn toml_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: Uuid,
    config: ConnectionConfig,
) -> Result<bool, &'static str> {
    tauri::async_runtime::spawn_blocking(move || {
        let text = configuration::export(id, &config).map_err(|_| "invalid")?;
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("EasyTier TOML", &["toml"])
            .set_file_name("easytier.toml")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|_| "io")?;
        let parent = path.parent().ok_or("io")?;
        // NamedTempFile restricts Unix permissions and atomically replaces the
        // chosen destination on Windows as well as Unix, just like the repository.
        let mut output = tempfile::NamedTempFile::new_in(parent).map_err(|_| "io")?;
        output
            .write_all(text.as_bytes())
            .and_then(|_| output.as_file().sync_all())
            .map_err(|_| "io")?;
        output.persist(path).map_err(|_| "io")?;
        Ok(true)
    })
    .await
    .map_err(|_| "io")?
}
