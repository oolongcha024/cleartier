use crate::{Candidate, Error, Preferences, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Record {
    version: u32,
    pub preferences: Preferences,
    pub last_automatic: Option<u64>,
    pub last_checked: Option<u64>,
    pub blocked_until: Option<u64>,
    pub candidate: Option<Candidate>,
    #[serde(default)]
    source: String,
    #[serde(flatten)]
    extra: BTreeMap<String, serde_json::Value>,
}
impl Record {
    pub fn new() -> Self {
        Self {
            version: 1,
            preferences: Preferences {
                automatic: true,
                prereleases: false,
            },
            last_automatic: None,
            last_checked: None,
            blocked_until: None,
            candidate: None,
            source: crate::UPDATE_INDEX_URL.into(),
            extra: BTreeMap::new(),
        }
    }
}
pub(crate) struct Repository {
    path: PathBuf,
}
impl Repository {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    pub fn load(&self) -> Result<Record> {
        let file = match fs::File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Record::new());
            }
            Err(_) => return Err(Error::new("storage")),
        };
        let mut bytes = vec![];
        file.take(262145)
            .read_to_end(&mut bytes)
            .map_err(|_| Error::new("storage"))?;
        if bytes.len() > 262144 {
            return Err(Error::new("storage"));
        }
        let mut record: Record =
            serde_json::from_slice(&bytes).map_err(|_| Error::new("storage"))?;
        if record.version != 1 {
            return Err(Error::new("storage"));
        }
        if record.source != crate::UPDATE_INDEX_URL {
            record.source = crate::UPDATE_INDEX_URL.into();
            record.blocked_until = None;
            record.last_automatic = None;
        }
        Ok(record)
    }
    pub fn save(&self, record: &Record) -> Result<()> {
        let directory = self.path.parent().ok_or_else(|| Error::new("storage"))?;
        fs::create_dir_all(directory).map_err(|_| Error::new("storage"))?;
        let bytes = serde_json::to_vec_pretty(record).map_err(|_| Error::new("storage"))?;
        let mut file =
            tempfile::NamedTempFile::new_in(directory).map_err(|_| Error::new("storage"))?;
        file.write_all(&bytes)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| Error::new("storage"))?;
        file.persist(&self.path)
            .map_err(|_| Error::new("storage"))?;
        Ok(())
    }
}
