//! User-owned configuration storage, independent of the WebView and core process.
//! A failed load never authorizes a write. All writers lock the same stable file;
//! a revision check prevents another window from silently overwriting newer data.
mod model;
pub use model::{Document, NetworkRecord};

use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

const LIMIT: u64 = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageError {
    pub code: &'static str,
    pub backup_available: bool,
}
type Result<T> = std::result::Result<T, StorageError>;

impl StorageError {
    fn new(code: &'static str) -> Self {
        Self {
            code,
            backup_available: false,
        }
    }
}

pub struct Repository {
    directory: PathBuf,
}

impl Repository {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    pub fn load(&self) -> Result<Document> {
        let result = (|| {
            let _lock = self.lock()?;
            self.read_current()
        })();
        result.map_err(|mut error: StorageError| {
            error.backup_available = self.read("networks.backup.json").is_ok();
            error
        })
    }

    pub fn save(&self, mut document: Document, expected_revision: &str) -> Result<Document> {
        document.validate().map_err(StorageError::new)?;
        let _lock = self.lock()?;
        let current = self.read_current()?;
        if current.revision != expected_revision {
            return Err(StorageError::new("conflict"));
        }
        // Preserve unrecognized document fields even if a client omits them.
        preserve_fields(&mut document.extra, &current.extra);
        for network in &mut document.networks {
            if let Some(previous) = current
                .networks
                .iter()
                .find(|record| record.id == network.id)
            {
                preserve_fields(&mut network.extra, &previous.extra);
                preserve_fields(&mut network.client.extra, &previous.client.extra);
                preserve_fields(
                    network.config.as_object_mut().unwrap(),
                    previous.config.as_object().unwrap(),
                );
            }
        }
        document.revision = Uuid::new_v4().to_string();
        let encoded = encode(&document)?;
        if self.path("networks.json").exists() {
            let bytes = self.bytes("networks.json")?;
            self.atomic_write("networks.backup.json", &bytes)?;
        }
        self.atomic_write("networks.json", &encoded)?;
        Ok(document)
    }

    /// Recovery is explicit, preserves the unreadable original, and never rotates
    /// a damaged primary into the last known good backup.
    pub fn restore(&self) -> Result<Document> {
        let _lock = self.lock()?;
        if self.read_current().is_ok() && self.path("networks.json").exists() {
            return Err(StorageError::new("recoveryNotNeeded"));
        }
        let mut backup = self.read("networks.backup.json")?;
        match fs::copy(
            self.path("networks.json"),
            self.path(&format!("networks.damaged-{}.json", Uuid::new_v4())),
        ) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(StorageError::new("io")),
        }
        backup.revision = Uuid::new_v4().to_string();
        self.atomic_write("networks.json", &encode(&backup)?)?;
        Ok(backup)
    }

    fn path(&self, name: &str) -> PathBuf {
        self.directory.join(name)
    }

    fn lock(&self) -> Result<File> {
        fs::create_dir_all(&self.directory).map_err(|_| StorageError::new("io"))?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options
            .open(self.path("networks.lock"))
            .map_err(|_| StorageError::new("io"))?;
        lock.try_lock().map_err(|_| StorageError::new("busy"))?;
        Ok(lock)
    }

    fn bytes(&self, name: &str) -> Result<Vec<u8>> {
        let file = File::open(self.path(name)).map_err(|error| {
            StorageError::new(if error.kind() == std::io::ErrorKind::NotFound {
                "missing"
            } else {
                "io"
            })
        })?;
        let mut bytes = Vec::new();
        file.take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| StorageError::new("io"))?;
        if bytes.len() as u64 > LIMIT {
            return Err(StorageError::new("tooLarge"));
        }
        Ok(bytes)
    }

    fn read(&self, name: &str) -> Result<Document> {
        let document: Document =
            serde_json::from_slice(&self.bytes(name)?).map_err(|_| StorageError::new("invalid"))?;
        document.validate().map_err(StorageError::new)?;
        Ok(document)
    }

    fn read_current(&self) -> Result<Document> {
        match self.read("networks.json") {
            Err(error) if error.code == "missing" => {
                // A surviving backup means this is not a first launch.
                if self.path("networks.backup.json").exists() {
                    return Err(error);
                }
                Ok(Document::default())
            }
            result => result,
        }
    }

    fn atomic_write(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let mut temporary =
            NamedTempFile::new_in(&self.directory).map_err(|_| StorageError::new("io"))?;
        temporary
            .write_all(bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| StorageError::new("io"))?;
        temporary
            .persist(self.path(name))
            .map_err(|_| StorageError::new("io"))?;
        sync_directory(&self.directory);
        Ok(())
    }
}

fn encode(document: &Document) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec_pretty(document).map_err(|_| StorageError::new("invalid"))?;
    if bytes.len() as u64 > LIMIT {
        return Err(StorageError::new("tooLarge"));
    }
    Ok(bytes)
}

fn preserve_fields(
    target: &mut serde_json::Map<String, serde_json::Value>,
    previous: &serde_json::Map<String, serde_json::Value>,
) {
    for (key, value) in previous {
        target.entry(key.clone()).or_insert_with(|| value.clone());
    }
}

fn sync_directory(path: &Path) {
    #[cfg(unix)]
    if let Ok(directory) = File::open(path) {
        let _ = directory.sync_all();
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests;
