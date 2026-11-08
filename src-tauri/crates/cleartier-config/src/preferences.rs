//! Desktop preferences are separate from credentials and network documents.
//! An unreadable or newer file is never replaced with defaults implicitly.
use super::{Result, StorageError, sync_directory};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseBehavior {
    #[default]
    Background,
    Exit,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferences {
    pub version: u32,
    pub close_behavior: CloseBehavior,
    pub close_explained: bool,
    pub launch_at_login: bool,
    pub auto_recover: bool,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}
impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            version: 1,
            close_behavior: CloseBehavior::Background,
            close_explained: false,
            launch_at_login: false,
            auto_recover: true,
            extra: BTreeMap::new(),
        }
    }
}
pub struct PreferencesRepository {
    directory: PathBuf,
}
impl PreferencesRepository {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }
    pub fn load(&self) -> Result<DesktopPreferences> {
        match fs::File::open(self.directory.join("desktop.json")) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(DesktopPreferences::default())
            }
            Err(_) => Err(StorageError::new("io")),
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(65537)
                    .read_to_end(&mut bytes)
                    .map_err(|_| StorageError::new("io"))?;
                if bytes.len() > 65536 {
                    return Err(StorageError::new("tooLarge"));
                }
                let value: DesktopPreferences =
                    serde_json::from_slice(&bytes).map_err(|_| StorageError::new("invalid"))?;
                if value.version != 1 {
                    return Err(StorageError::new("unsupportedVersion"));
                }
                Ok(value)
            }
        }
    }
    pub fn save(&self, preferences: &DesktopPreferences) -> Result<()> {
        fs::create_dir_all(&self.directory).map_err(|_| StorageError::new("io"))?;
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.directory.join("desktop.lock"))
            .map_err(|_| StorageError::new("io"))?;
        lock.try_lock().map_err(|_| StorageError::new("busy"))?;
        // Re-read before writing: unknown fields and unsupported versions survive.
        let mut current = self.load()?;
        current.close_behavior = preferences.close_behavior;
        current.close_explained = preferences.close_explained;
        current.launch_at_login = preferences.launch_at_login;
        current.auto_recover = preferences.auto_recover;
        let bytes =
            serde_json::to_vec_pretty(&current).map_err(|_| StorageError::new("invalid"))?;
        if bytes.len() > 65536 {
            return Err(StorageError::new("tooLarge"));
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)
            .map_err(|_| StorageError::new("io"))?;
        temporary
            .write_all(&bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| StorageError::new("io"))?;
        temporary
            .persist(self.directory.join("desktop.json"))
            .map_err(|_| StorageError::new("io"))?;
        sync_directory(&self.directory);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_round_trip_and_unknown_fields_survive() {
        let directory = tempfile::tempdir().unwrap();
        let repository = PreferencesRepository::new(directory.path().to_owned());
        let mut preferences = repository.load().unwrap();
        assert!(preferences.auto_recover);
        assert!(!preferences.launch_at_login);
        preferences.close_behavior = CloseBehavior::Exit;
        repository.save(&preferences).unwrap();
        let path = directory.path().join("desktop.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["futurePreference"] = serde_json::json!({"keep": true});
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        preferences.auto_recover = false;
        repository.save(&preferences).unwrap();
        let loaded = repository.load().unwrap();
        assert_eq!(loaded.close_behavior, CloseBehavior::Exit);
        assert!(!loaded.auto_recover);
        assert!(loaded.extra.contains_key("futurePreference"));
    }
    #[test]
    fn corrupt_and_newer_files_are_never_replaced() {
        let directory = tempfile::tempdir().unwrap();
        let repository = PreferencesRepository::new(directory.path().to_owned());
        let path = directory.path().join("desktop.json");
        for content in [
            "broken",
            r#"{"version":2,"closeBehavior":"background","closeExplained":false,"launchAtLogin":false,"autoRecover":true}"#,
        ] {
            fs::write(&path, content).unwrap();
            assert!(repository.load().is_err());
            assert!(repository.save(&DesktopPreferences::default()).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
        let mut value = serde_json::to_value(DesktopPreferences::default()).unwrap();
        value["futurePreference"] = serde_json::json!(vec![0; 10000]);
        let compact = serde_json::to_vec(&value).unwrap();
        assert!(compact.len() < 65536);
        fs::write(&path, &compact).unwrap();
        let preferences = repository.load().unwrap();
        assert_eq!(repository.save(&preferences).unwrap_err().code, "tooLarge");
        assert_eq!(fs::read(&path).unwrap(), compact);
    }
}
