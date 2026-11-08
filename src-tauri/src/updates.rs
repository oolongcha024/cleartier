//! Tauri/GitHub/NSIS Adapter. Policy and operation ordering live in the deep
//! cleartier-updates module, independently testable without a desktop runtime.
use cleartier_updates::{
    Backend, Cancellation, Candidate, Distribution, Error, Github, Preferences, Progress, Result,
    Snapshot, UpdateManager,
};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct Native {
    app: tauri::AppHandle,
}
pub struct Package {
    update: Arc<Update>,
    bytes: Arc<Vec<u8>>,
}
pub type Updates = UpdateManager<Native>;

fn distribution() -> Distribution {
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        let installed = windows_registry::CURRENT_USER
            .open("Software\\app.cleartier.desktop\\Installer")
            .and_then(|key| key.get_string("Path"))
            .ok()
            .and_then(|path| {
                std::fs::canonicalize(std::path::Path::new(&path).join("cleartier.exe")).ok()
            });
        let current = std::env::current_exe()
            .ok()
            .and_then(|path| std::fs::canonicalize(path).ok());
        if installed.is_some() && installed == current {
            return Distribution::Installed;
        }
        Distribution::Portable
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    {
        Distribution::Unsupported
    }
}
fn plugin_error(error: tauri_plugin_updater::Error) -> Error {
    use tauri_plugin_updater::Error as E;
    Error::new(match error {
        E::Reqwest(_) | E::Network(_) => "network",
        _ => "signature",
    })
}
impl Backend for Native {
    type Package = Package;
    fn distribution(&self) -> Distribution {
        distribution()
    }
    async fn find(&self, current: &str, prereleases: bool) -> Result<Option<Candidate>> {
        Github::new()?.find(current, prereleases).await
    }
    async fn download(
        &self,
        candidate: &Candidate,
        progress: Progress,
        cancel: Cancellation,
    ) -> Result<Package> {
        let download = async {
            let metadata = Github::new()?.manifest(candidate).await?;
            let updater = self
                .app
                .updater_builder()
                .timeout(Duration::from_secs(180))
                .endpoints(vec![
                    candidate
                        .manifest_url()
                        .parse()
                        .map_err(|_| Error::new("metadata"))?,
                ])
                .map_err(plugin_error)?
                .build()
                .map_err(plugin_error)?;
            // restore_update also requires the signature to bind the exact version.
            let update = updater
                .restore_update(metadata)
                .map_err(plugin_error)?
                .ok_or_else(|| Error::new("unavailable"))?;
            let mut downloaded = 0;
            let bytes = update
                .download(
                    |size, total| {
                        downloaded += size as u64;
                        progress(downloaded, total);
                    },
                    || {},
                )
                .await
                .map_err(plugin_error)?;
            update.verify(&bytes).map_err(plugin_error)?;
            Ok(Package {
                update: Arc::new(update),
                bytes: Arc::new(bytes),
            })
        };
        tokio::select! { result = download => result, _ = cancel.wait() => Err(Error::new("cancelled")) }
    }

    async fn install(&self, package: &Package, confirmed: bool) -> Result<()> {
        if distribution() != Distribution::Installed {
            return Err(Error::new("portable"));
        }
        package
            .update
            .verify(&package.bytes)
            .map_err(plugin_error)?;
        super::desktop::lifecycle::prepare_update(&self.app, confirmed).await?;
        // Windows success exits inside Tauri only after the installer launches.
        let update = package.update.clone();
        let bytes = package.bytes.clone();
        let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes.as_ref()))
            .await
            .unwrap_or_else(|_| {
                Err(tauri_plugin_updater::Error::Io(std::io::Error::other(
                    "installer task failed",
                )))
            });
        if result.is_err() {
            super::desktop::lifecycle::resume_after_update(&self.app).await;
        }
        result.map_err(|_| Error::new("install"))
    }
    fn open(&self, url: &str) -> Result<()> {
        use tauri_plugin_opener::OpenerExt;
        self.app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|_| Error::new("open"))
    }
    fn changed(&self, snapshot: &Snapshot) {
        let _ = self.app.emit("updates-changed", snapshot);
    }
}

pub fn setup(app: &mut tauri::App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let manager = Updates::new(
        app.path().app_config_dir()?.join("updates.json"),
        app.package_info().version.to_string(),
        Native {
            app: app.handle().clone(),
        },
    );
    app.manage(Arc::new(manager));
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if !handle
                .state::<super::desktop::Desktop>()
                .rejects_connections()
            {
                let _ = handle.state::<Arc<Updates>>().check(true).await;
            }
        }
    });
    Ok(())
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Command {
    Check,
    Configure { preferences: Preferences },
    Update { confirmed: bool },
    Cancel,
    OpenRelease,
    OpenZip,
}
#[tauri::command]
pub fn updates_status(manager: tauri::State<'_, Arc<Updates>>) -> Snapshot {
    manager.snapshot()
}
#[tauri::command]
pub async fn updates_command(
    manager: tauri::State<'_, Arc<Updates>>,
    command: Command,
) -> std::result::Result<Snapshot, &'static str> {
    let result = match command {
        Command::Check => manager.check(false).await,
        Command::Configure { preferences } => manager.configure(preferences).await,
        Command::Update { confirmed } => manager.update(confirmed).await,
        Command::Cancel => manager.cancel(),
        Command::OpenRelease => manager.open(false).map(|_| manager.snapshot()),
        Command::OpenZip => manager.open(true).map(|_| manager.snapshot()),
    };
    result.map_err(|error| error.code)
}
