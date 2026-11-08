use cleartier_config::{Document, Repository, StorageError};
use tauri::State;

#[tauri::command]
pub fn config_load(repository: State<'_, Repository>) -> Result<Document, StorageError> {
    repository.load()
}

#[tauri::command]
pub fn config_save(
    document: Document,
    expected_revision: String,
    repository: State<'_, Repository>,
) -> Result<Document, StorageError> {
    repository.save(document, &expected_revision)
}

#[tauri::command]
pub fn config_restore(repository: State<'_, Repository>) -> Result<Document, StorageError> {
    repository.restore()
}
