use super::*;
use cleartier_config::CloseBehavior;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub(super) fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开 ClearTier", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出 ClearTier", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("ClearTier")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "exit" => request_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn second_instance(app: &tauri::AppHandle, args: Vec<String>, _cwd: String) {
    if app.try_state::<Desktop>().is_none() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            for _ in 0..100 {
                if app.try_state::<Desktop>().is_some() {
                    second_instance(&app, args, String::new());
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        });
        return;
    }
    if args.iter().any(|arg| arg == "--installer-shutdown") {
        shutdown(app);
    } else {
        show(app);
    }
}

fn request_close(app: &tauri::AppHandle) {
    let desktop = app.state::<Desktop>();
    if desktop.quitting.load(Ordering::SeqCst) {
        return;
    }
    let preferences = desktop.preferences.read().unwrap().clone();
    if preferences.close_behavior == CloseBehavior::Exit
        || !desktop.tray_available.load(Ordering::SeqCst)
    {
        request_exit(app);
    } else if preferences.close_explained {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    } else {
        desktop.request(app, "close");
    }
}
fn request_exit(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if app
            .state::<cleartier_core::connections::NetworkManager>()
            .has_active_networks()
            .await
        {
            app.state::<Desktop>().request(&app, "exit");
        } else {
            shutdown(&app);
        }
    });
}

pub(super) fn shutdown(app: &tauri::AppHandle) {
    let desktop = app.state::<Desktop>();
    if desktop.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    *desktop.pending.lock().unwrap() = None;
    *desktop.exit_error.write().unwrap() = None;
    desktop.notify(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        app.state::<cleartier_core::connections::NetworkManager>()
            .prepare_shutdown()
            .await;
        let result = app
            .state::<cleartier_core::process::CoreController>()
            .shutdown()
            .await;
        let desktop = app.state::<Desktop>();
        if result.is_ok() {
            desktop.exit_ready.store(true, Ordering::SeqCst);
            app.exit(0);
        } else {
            // Keep the UI available if cleanup could not be confirmed. Retrying
            // exit is allowed, while recovery remains suspended.
            desktop.quitting.store(false, Ordering::SeqCst);
            *desktop.exit_error.write().unwrap() = Some("shutdown");
            show(&app);
            desktop.notify(&app);
        }
    });
}

#[tauri::command]
pub fn desktop_exit(app: tauri::AppHandle) {
    request_exit(&app);
}

#[tauri::command]
pub async fn desktop_respond(
    app: tauri::AppHandle,
    request_id: u64,
    choice: String,
) -> Result<(), &'static str> {
    let desktop = app.state::<Desktop>();
    let _mutation = desktop.mutation.lock().await;
    let pending = desktop.pending.lock().unwrap().clone().ok_or("stale")?;
    if pending.id != request_id {
        return Err("stale");
    }
    match (pending.kind, choice.as_str()) {
        (_, "cancel") => {
            *desktop.pending.lock().unwrap() = None;
            desktop.notify(&app);
        }
        ("close", "background") => {
            if !desktop.tray_available.load(Ordering::SeqCst) {
                return Err("tray");
            }
            let mut preferences = desktop.repository.load().map_err(|_| "preferences")?;
            preferences.close_explained = true;
            desktop
                .repository
                .save(&preferences)
                .map_err(|_| "preferences")?;
            *desktop.preferences.write().unwrap() = preferences;
            *desktop.pending.lock().unwrap() = None;
            if let Some(window) = app.get_webview_window("main") {
                window.hide().map_err(|_| "window")?;
            }
            desktop.notify(&app);
        }
        ("close", "exit") => {
            *desktop.pending.lock().unwrap() = None;
            request_exit(&app);
        }
        ("exit", "exit") => shutdown(&app),
        _ => return Err("invalid"),
    }
    Ok(())
}

pub fn event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            request_close(app);
        }
        tauri::RunEvent::ExitRequested { api, .. } => {
            if !app.state::<Desktop>().exit_ready.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_exit(app);
            }
        }
        tauri::RunEvent::Exit => {
            // OS teardown can bypass the normal request; the core also watches
            // its controller and cleans up on pipe EOF or controller death.
            let _ = tauri::async_runtime::block_on(async {
                app.state::<cleartier_core::connections::NetworkManager>()
                    .prepare_shutdown()
                    .await;
                app.state::<cleartier_core::process::CoreController>()
                    .shutdown()
                    .await
            });
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => show(app),
        _ => {}
    }
}
