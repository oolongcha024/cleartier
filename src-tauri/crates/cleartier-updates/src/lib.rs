//! One owner for update policy, cadence, persistent preferences and operations.
//! Platform/network/installer details enter through Backend; callers use snapshots
//! and commands, including in tests. No WebView timer or installer URL is trusted.
mod releases;
mod storage;
pub use releases::{Candidate, Github, MANIFEST_NAME, REPOSITORY, select_release};
use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::{Mutex as AsyncMutex, Notify};

pub const CHECK_INTERVAL: u64 = 24 * 60 * 60;
#[cfg(test)]
mod tests;
pub type Result<T> = std::result::Result<T, Error>;
#[derive(Clone, Debug)]
pub struct Error {
    pub code: &'static str,
    pub retry_at: Option<u64>,
}
impl Error {
    pub fn new(code: &'static str) -> Self {
        Self {
            code,
            retry_at: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Distribution {
    Installed,
    Portable,
    Unsupported,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub automatic: bool,
    pub prereleases: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub distribution: Distribution,
    pub preferences: Preferences,
    pub phase: &'static str,
    pub candidate: Option<Candidate>,
    pub error: Option<&'static str>,
    pub last_checked: Option<u64>,
    pub downloaded: u64,
    pub total: Option<u64>,
}
#[derive(Clone, Default)]
pub struct Cancellation {
    flag: Arc<AtomicBool>,
    signal: Arc<Notify>,
}
impl Cancellation {
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.signal.notify_one();
    }
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
    pub async fn wait(&self) {
        if !self.is_cancelled() {
            self.signal.notified().await;
        }
    }
}
pub type Progress = Arc<dyn Fn(u64, Option<u64>) + Send + Sync>;
pub trait Backend: Send + Sync + 'static {
    type Package: Send + Sync;
    fn distribution(&self) -> Distribution;
    fn now(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }
    fn find(
        &self,
        current: &str,
        prereleases: bool,
    ) -> impl Future<Output = Result<Option<Candidate>>> + Send;
    fn download(
        &self,
        candidate: &Candidate,
        progress: Progress,
        cancel: Cancellation,
    ) -> impl Future<Output = Result<Self::Package>> + Send;
    fn install(
        &self,
        package: &Self::Package,
        confirmed: bool,
    ) -> impl Future<Output = Result<()>> + Send;
    fn open(&self, url: &str) -> Result<()>;
    fn changed(&self, _snapshot: &Snapshot) {}
}
struct State<P> {
    snapshot: Snapshot,
    record: storage::Record,
    loaded: bool,
    cancel: Cancellation,
    package: Option<P>,
}
pub struct UpdateManager<B: Backend> {
    backend: Arc<B>,
    current: String,
    storage: storage::Repository,
    state: Arc<Mutex<State<B::Package>>>,
    operation: AsyncMutex<()>,
}
impl<B: Backend> UpdateManager<B> {
    pub fn new(path: PathBuf, current: String, backend: B) -> Self {
        let storage = storage::Repository::new(path);
        let (record, error) = match storage.load(&current) {
            Ok(record) => (record, None),
            Err(error) => (storage::Record::new(&current), Some(error.code)),
        };
        let candidate = record
            .candidate
            .clone()
            .filter(|candidate| candidate.accepted(&current, record.preferences.prereleases));
        let snapshot = Snapshot {
            revision: 0,
            distribution: backend.distribution(),
            preferences: record.preferences.clone(),
            phase: if candidate.is_some() {
                "available"
            } else {
                "idle"
            },
            candidate,
            error,
            last_checked: record.last_checked,
            downloaded: 0,
            total: None,
        };
        Self {
            backend: Arc::new(backend),
            current,
            storage,
            state: Arc::new(Mutex::new(State {
                snapshot,
                record,
                loaded: error.is_none(),
                cancel: Cancellation::default(),
                package: None,
            })),
            operation: AsyncMutex::new(()),
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        self.state.lock().unwrap().snapshot.clone()
    }
    fn change<T>(&self, update: impl FnOnce(&mut State<B::Package>) -> T) -> T {
        let (snapshot, result) = {
            let mut state = self.state.lock().unwrap();
            let result = update(&mut state);
            state.snapshot.revision += 1;
            (state.snapshot.clone(), result)
        };
        self.backend.changed(&snapshot);
        result
    }
    fn load(&self) -> Result<()> {
        if !self.state.lock().unwrap().loaded {
            let record = self.storage.load(&self.current)?;
            self.change(|state| {
                state.snapshot.preferences = record.preferences.clone();
                state.record = record;
                state.loaded = true;
                state.snapshot.error = None;
            });
        }
        Ok(())
    }
    fn save(&self) -> Result<()> {
        self.storage.save(&self.state.lock().unwrap().record)
    }
    fn fail(&self, error: Error) -> Error {
        self.change(|state| {
            state.snapshot.phase = if state.package.is_some() {
                "ready"
            } else if state.snapshot.candidate.is_some() {
                "available"
            } else {
                "idle"
            };
            state.snapshot.error = if error.code == "cancelled" {
                None
            } else {
                Some(error.code)
            };
        });
        error
    }
    pub async fn configure(&self, preferences: Preferences) -> Result<Snapshot> {
        let _operation = self.operation.try_lock().map_err(|_| Error::new("busy"))?;
        self.load().map_err(|error| self.fail(error))?;
        let mut record = self.state.lock().unwrap().record.clone();
        record.preferences = preferences.clone();
        if record
            .candidate
            .as_ref()
            .is_some_and(|candidate| !candidate.accepted(&self.current, preferences.prereleases))
        {
            record.candidate = None;
        }
        self.storage
            .save(&record)
            .map_err(|error| self.fail(error))?;
        self.change(|state| {
            state.record = record;
            state.snapshot.preferences = preferences;
            state.snapshot.candidate = state.record.candidate.clone();
            state.package = None;
            state.snapshot.error = None;
            state.snapshot.phase = if state.snapshot.candidate.is_some() {
                "available"
            } else {
                "idle"
            };
        });
        Ok(self.snapshot())
    }
    pub async fn check(&self, automatic: bool) -> Result<Snapshot> {
        let Ok(_operation) = self.operation.try_lock() else {
            return Ok(self.snapshot());
        };
        if self.backend.distribution() == Distribution::Unsupported {
            return Ok(self.snapshot());
        }
        self.load().map_err(|error| self.fail(error))?;
        let now = self.backend.now();
        {
            let state = self.state.lock().unwrap();
            if state.package.is_some()
                || (automatic
                    && (!state.record.preferences.automatic
                        || state
                            .record
                            .last_automatic
                            .is_some_and(|last| last <= now && now - last < CHECK_INTERVAL)))
            {
                return Ok(state.snapshot.clone());
            }
            if state.record.blocked_until.is_some_and(|until| until > now) {
                return Err(Error::new("rateLimited"));
            }
        }
        self.change(|state| {
            if automatic {
                state.record.last_automatic = Some(now);
            }
            state.record.last_checked = Some(now);
            state.snapshot.last_checked = Some(now);
            state.snapshot.phase = "checking";
            state.snapshot.error = None;
        });
        if let Err(error) = self.save() {
            return Err(self.fail(error));
        }
        let prereleases = self.snapshot().preferences.prereleases;
        match self.backend.find(&self.current, prereleases).await {
            Ok(candidate) => {
                let candidate =
                    candidate.filter(|candidate| candidate.accepted(&self.current, prereleases));
                self.change(|state| {
                    state.record.candidate = candidate.clone();
                    state.record.blocked_until = None;
                    state.snapshot.candidate = candidate;
                    state.snapshot.phase = if state.snapshot.candidate.is_some() {
                        "available"
                    } else {
                        "current"
                    };
                });
                self.save().map_err(|error| self.fail(error))?;
                Ok(self.snapshot())
            }
            Err(error) => {
                self.change(|state| state.record.blocked_until = error.retry_at);
                let _ = self.save();
                Err(self.fail(error))
            }
        }
    }
    pub async fn update(&self, confirmed: bool) -> Result<Snapshot> {
        let _operation = self.operation.try_lock().map_err(|_| Error::new("busy"))?;
        if self.backend.distribution() != Distribution::Installed {
            return Err(Error::new("portable"));
        }
        let candidate = self
            .snapshot()
            .candidate
            .ok_or_else(|| Error::new("unavailable"))?;
        if !candidate.accepted(&self.current, self.snapshot().preferences.prereleases) {
            return Err(Error::new("unavailable"));
        }
        if self.state.lock().unwrap().package.is_none() {
            self.change(|state| {
                state.cancel = Cancellation::default();
                state.snapshot.phase = "downloading";
                state.snapshot.error = None;
                state.snapshot.downloaded = 0;
                state.snapshot.total = None;
            });
            let state = self.state.clone();
            let backend = self.backend.clone();
            let last_progress = Mutex::new(None::<std::time::Instant>);
            let progress: Progress = Arc::new(move |downloaded, total| {
                let now = std::time::Instant::now();
                {
                    let mut last = last_progress.lock().unwrap();
                    if last.is_some_and(|last| now.duration_since(last).as_millis() < 150)
                        && Some(downloaded) != total
                    {
                        return;
                    }
                    *last = Some(now);
                }
                let snapshot = {
                    let mut state = state.lock().unwrap();
                    if state.snapshot.phase != "downloading" {
                        return;
                    }
                    let delta = downloaded.saturating_sub(state.snapshot.downloaded);
                    if delta < 128 * 1024 && Some(downloaded) != total {
                        return;
                    }
                    state.snapshot.downloaded = downloaded;
                    state.snapshot.total = total;
                    state.snapshot.revision += 1;
                    state.snapshot.clone()
                };
                backend.changed(&snapshot);
            });
            let cancel = self.state.lock().unwrap().cancel.clone();
            let package = self
                .backend
                .download(&candidate, progress, cancel.clone())
                .await
                .map_err(|error| self.fail(error))?;
            let cancelled = self.change(|state| {
                if cancel.is_cancelled() {
                    return true;
                }
                state.package = Some(package);
                // Cancellation and admission to installation share this lock.
                state.snapshot.phase = "installing";
                false
            });
            if cancelled {
                return Err(self.fail(Error::new("cancelled")));
            }
        }
        let package = self
            .change(|state| {
                let package = state.package.take();
                if package.is_some() {
                    state.snapshot.phase = "installing";
                    state.snapshot.error = None;
                }
                package
            })
            .ok_or_else(|| self.fail(Error::new("cancelled")))?;
        let result = self.backend.install(&package, confirmed).await;
        // Native success exits the app. Tests and installer failure return here.
        self.change(|state| state.package = Some(package));
        match result {
            Ok(()) => Ok(self.snapshot()),
            Err(error) if error.code == "confirmation" => {
                self.change(|state| state.snapshot.phase = "ready");
                Ok(self.snapshot())
            }
            Err(error) => Err(self.fail(error)),
        }
    }
    pub fn cancel(&self) -> Result<Snapshot> {
        self.change(|state| {
            if matches!(state.snapshot.phase, "installing" | "checking") {
                return Err(Error::new("busy"));
            }
            state.cancel.cancel();
            state.package = None;
            state.snapshot.phase = if state.snapshot.candidate.is_some() {
                "available"
            } else {
                "idle"
            };
            state.snapshot.error = None;
            Ok(())
        })?;
        Ok(self.snapshot())
    }
    pub fn open(&self, zip: bool) -> Result<()> {
        let candidate = self
            .snapshot()
            .candidate
            .ok_or_else(|| Error::new("unavailable"))?;
        if !candidate.accepted(&self.current, self.snapshot().preferences.prereleases) {
            return Err(Error::new("unavailable"));
        }
        self.backend.open(&if zip {
            candidate.zip_url()
        } else {
            candidate.release_url()
        })
    }
}
