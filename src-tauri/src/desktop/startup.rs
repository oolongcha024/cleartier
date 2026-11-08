//! Login startup is per user. Windows explicitly selects CurrentUser and quotes
//! the executable path; the plugin's default Dynamic mode can write HKLM.
#[cfg(windows)]
fn launcher(app: &tauri::AppHandle) -> Result<auto_launch::AutoLaunch, ()> {
    let executable = std::env::current_exe().map_err(|_| ())?;
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name(
            app.config()
                .product_name
                .as_deref()
                .unwrap_or(&app.package_info().name),
        )
        .set_app_path(&format!("\"{}\"", executable.display()))
        .set_args(&["--background"])
        .set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser)
        .build()
        .map_err(|_| ())
}
pub(super) fn enabled(_app: &tauri::AppHandle) -> Result<bool, ()> {
    #[cfg(windows)]
    {
        launcher(_app)?.is_enabled().map_err(|_| ())
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_autostart::ManagerExt;
        _app.autolaunch().is_enabled().map_err(|_| ())
    }
}
pub(super) fn set(_app: &tauri::AppHandle, enabled: bool) -> Result<(), ()> {
    #[cfg(windows)]
    {
        let launcher = launcher(_app)?;
        (if enabled {
            launcher.enable()
        } else {
            launcher.disable()
        })
        .map_err(|_| ())
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_autostart::ManagerExt;
        (if enabled {
            _app.autolaunch().enable()
        } else {
            _app.autolaunch().disable()
        })
        .map_err(|_| ())
    }
}
