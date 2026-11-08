use super::*;
use cleartier_config::CloseBehavior;
use serde::Deserialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    preferences: DesktopPreferences,
    preference_error: Option<&'static str>,
    autostart_error: bool,
    tray_available: bool,
    pending: Option<Request>,
    quitting: bool,
    exit_error: Option<&'static str>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Update {
    close_behavior: CloseBehavior,
    launch_at_login: bool,
    auto_recover: bool,
}

fn status(app: &tauri::AppHandle, desktop: &Desktop) -> Status {
    let mut preferences = desktop.preferences.read().unwrap().clone();
    let autostart_error = match super::startup::enabled(&app) {
        Ok(enabled) => {
            preferences.launch_at_login = enabled;
            false
        }
        Err(_) => true,
    };
    Status {
        preferences,
        preference_error: *desktop.preference_error.read().unwrap(),
        autostart_error,
        tray_available: desktop.tray_available.load(Ordering::SeqCst),
        pending: desktop.pending.lock().unwrap().clone(),
        quitting: desktop.quitting.load(Ordering::SeqCst),
        exit_error: *desktop.exit_error.read().unwrap(),
    }
}
#[tauri::command]
pub async fn desktop_status(app: tauri::AppHandle) -> Status {
    let desktop = app.state::<Desktop>();
    let _mutation = desktop.mutation.lock().await;
    // A user can repair a damaged file and press Refresh without losing it or
    // having to restart the application. Failed reads keep the last good value.
    match desktop.repository.load() {
        Ok(next) => {
            let recover_changed = next.auto_recover
                != desktop.preferences.read().unwrap().auto_recover
                || desktop.preference_error.read().unwrap().is_some();
            *desktop.preferences.write().unwrap() = next.clone();
            *desktop.preference_error.write().unwrap() = None;
            if recover_changed {
                app.state::<cleartier_core::connections::NetworkManager>()
                    .set_recovery_enabled(next.auto_recover)
                    .await;
            }
        }
        Err(error) => *desktop.preference_error.write().unwrap() = Some(error.code),
    }
    status(&app, &desktop)
}

#[tauri::command]
pub async fn desktop_update(app: tauri::AppHandle, update: Update) -> Result<Status, &'static str> {
    let desktop = app.state::<Desktop>();
    let _mutation = desktop.mutation.lock().await;
    if desktop.quitting.load(Ordering::SeqCst) {
        return Err("quitting");
    }
    let mut next = desktop.repository.load().map_err(|_| "preferences")?;
    let old_autostart = super::startup::enabled(&app);
    let recover_changed = desktop.preferences.read().unwrap().auto_recover != update.auto_recover
        || desktop.preference_error.read().unwrap().is_some();
    // OS startup errors must not block unrelated close/recovery preferences.
    if old_autostart.is_err() && next.launch_at_login != update.launch_at_login {
        return Err("autostart");
    }
    let changed_autostart = old_autostart
        .as_ref()
        .is_ok_and(|old| *old != update.launch_at_login);
    next.close_behavior = update.close_behavior;
    next.launch_at_login = update.launch_at_login;
    next.auto_recover = update.auto_recover;
    if changed_autostart {
        super::startup::set(&app, next.launch_at_login).map_err(|_| "autostart")?;
    }
    if desktop.repository.save(&next).is_err() {
        if changed_autostart {
            let _ = super::startup::set(&app, old_autostart.unwrap_or(false));
        }
        return Err("preferences");
    }
    *desktop.preferences.write().unwrap() = next.clone();
    *desktop.preference_error.write().unwrap() = None;
    if recover_changed {
        app.state::<cleartier_core::connections::NetworkManager>()
            .set_recovery_enabled(next.auto_recover)
            .await;
    }
    desktop.notify(&app);
    Ok(status(&app, &desktop))
}
