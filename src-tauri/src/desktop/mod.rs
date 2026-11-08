//! Desktop lifecycle stays in Rust: hidden windows do not own timers or recovery.
pub(crate) mod diagnostics;
pub(crate) mod lifecycle;
pub(crate) mod preferences;
mod startup;
pub use lifecycle::{event, second_instance};

use cleartier_config::{DesktopPreferences, PreferencesRepository};
use serde::Serialize;
use std::sync::{
    Mutex, RwLock,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    id: u64,
    kind: &'static str,
}

pub struct Desktop {
    repository: PreferencesRepository,
    preferences: RwLock<DesktopPreferences>,
    preference_error: RwLock<Option<&'static str>>,
    mutation: tokio::sync::Mutex<()>,
    pending: Mutex<Option<Request>>,
    sequence: AtomicU64,
    tray_available: AtomicBool,
    quitting: AtomicBool,
    exit_ready: AtomicBool,
    exit_error: RwLock<Option<&'static str>>,
}
impl Desktop {
    pub(crate) fn rejects_connections(&self) -> bool {
        self.quitting.load(Ordering::SeqCst) || self.exit_error.read().unwrap().is_some()
    }
    fn notify(&self, app: &tauri::AppHandle) {
        let _ = app.emit("desktop-changed", ());
    }
    fn request(&self, app: &tauri::AppHandle, kind: &'static str) {
        if self.quitting.load(Ordering::SeqCst) {
            return;
        }
        let mut pending = self.pending.lock().unwrap();
        if pending.as_ref().is_some_and(|request| request.kind == kind) {
            return;
        }
        *pending = Some(Request {
            id: self.sequence.fetch_add(1, Ordering::SeqCst) + 1,
            kind,
        });
        drop(pending);
        show(app);
        self.notify(app);
    }
}
pub(super) fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let repository = PreferencesRepository::new(app.path().app_config_dir()?);
    let (preferences, error) = match repository.load() {
        Ok(value) => (value, None),
        Err(error) => {
            let mut preferences = DesktopPreferences::default();
            preferences.auto_recover = false;
            (preferences, Some(error.code))
        }
    };
    let recover = preferences.auto_recover && error.is_none();
    app.manage(Desktop {
        repository,
        preferences: RwLock::new(preferences),
        preference_error: RwLock::new(error),
        mutation: tokio::sync::Mutex::new(()),
        pending: Mutex::new(None),
        sequence: AtomicU64::new(0),
        tray_available: AtomicBool::new(false),
        quitting: AtomicBool::new(false),
        exit_ready: AtomicBool::new(false),
        exit_error: RwLock::new(None),
    });
    let handle = app.handle().clone();
    if std::env::args_os().any(|arg| arg == "--installer-shutdown") {
        lifecycle::shutdown(&handle);
        return Ok(());
    }
    // Tray failure must not make the only window disappear without a way back.
    let tray_available = lifecycle::create_tray(app).is_ok();
    app.state::<Desktop>()
        .tray_available
        .store(tray_available, Ordering::SeqCst);
    if !tray_available || !std::env::args_os().any(|arg| arg == "--background") {
        show(&handle);
    }
    tauri::async_runtime::spawn(async move {
        let manager = handle.state::<cleartier_core::connections::NetworkManager>();
        manager.set_recovery_enabled(recover).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if handle.state::<Desktop>().quitting.load(Ordering::SeqCst) {
                break;
            }
            let _ = manager.maintain().await;
        }
    });
    Ok(())
}
