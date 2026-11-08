use cleartier_core::{
    connections::{NetworkManager, NetworkSnapshot, Operation},
    process::CoreError,
};
use tauri::{Manager, State};

#[tauri::command]
pub async fn network_operation(
    app: tauri::AppHandle,
    operation: Operation,
    manager: State<'_, NetworkManager>,
) -> Result<Vec<NetworkSnapshot>, CoreError> {
    if app.state::<crate::desktop::Desktop>().rejects_connections() {
        return Err(CoreError {
            code: cleartier_core::process::ErrorCode::CoreFailure,
            message: "The client is shutting down".into(),
        });
    }
    manager.operate(operation).await
}

#[tauri::command]
pub async fn network_snapshot(
    manager: State<'_, NetworkManager>,
) -> Result<Vec<NetworkSnapshot>, CoreError> {
    manager.snapshot().await
}
