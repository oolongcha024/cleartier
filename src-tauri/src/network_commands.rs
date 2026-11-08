use cleartier_core::{
    connections::{NetworkManager, NetworkSnapshot, Operation},
    process::CoreError,
};
use tauri::State;

#[tauri::command]
pub async fn network_operation(
    operation: Operation,
    manager: State<'_, NetworkManager>,
) -> Result<Vec<NetworkSnapshot>, CoreError> {
    manager.operate(operation).await
}

#[tauri::command]
pub async fn network_snapshot(
    manager: State<'_, NetworkManager>,
) -> Result<Vec<NetworkSnapshot>, CoreError> {
    manager.snapshot().await
}
