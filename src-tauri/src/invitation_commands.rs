use cleartier_config::ConnectionConfig;
use cleartier_core::invitations::{self, JoinParameters};
use uuid::Uuid;

#[tauri::command]
pub async fn invitation_parameters(
    id: Uuid,
    config: ConnectionConfig,
) -> Result<JoinParameters, &'static str> {
    tauri::async_runtime::spawn_blocking(move || invitations::parameters(id, &config))
        .await
        .map_err(|_| "unsupportedConfiguration")?
}
