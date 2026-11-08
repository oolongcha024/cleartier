//! Owned network intentions and observations. State locks never cover process
//! I/O or readiness waits; the controller alone owns serialized worker frames.
mod operations;
mod recovery;

use crate::{
    InstanceSnapshot,
    process::{CoreController, CoreError, ErrorCode, Result},
};
use cleartier_config::ConnectionConfig;
pub use recovery::RecoverySnapshot;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs::{File, OpenOptions},
    future::Future,
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::Mutex;
use uuid::Uuid;

pub trait Backend: Send + Sync + 'static {
    fn start(&self, toml: String) -> impl Future<Output = Result<Uuid>> + Send;
    fn start_in_background(&self, toml: String) -> impl Future<Output = Result<Uuid>> + Send;
    fn stop(&self, id: Uuid) -> impl Future<Output = Result<()>> + Send;
    fn snapshot(&self) -> impl Future<Output = Result<Vec<InstanceSnapshot>>> + Send;
    fn shutdown(&self) -> impl Future<Output = Result<()>> + Send;
}
impl Backend for CoreController {
    async fn start(&self, toml: String) -> Result<Uuid> {
        self.start(toml).await
    }
    async fn start_in_background(&self, toml: String) -> Result<Uuid> {
        self.start_in_background(toml).await
    }
    async fn stop(&self, id: Uuid) -> Result<()> {
        self.stop(id).await
    }
    async fn snapshot(&self) -> Result<Vec<InstanceSnapshot>> {
        let result = self.snapshot().await;
        if result.is_err() && self.status().state == crate::process::HostState::Failed {
            Err(CoreError::new(
                ErrorCode::CoreExited,
                "The owned core is unavailable",
            ))
        } else {
            result
        }
    }
    async fn shutdown(&self) -> Result<()> {
        self.shutdown().await
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum Operation {
    Start { id: Uuid, config: ConnectionConfig },
    Restart { id: Uuid, config: ConnectionConfig },
    Stop { id: Uuid },
    Release { id: Uuid },
}
impl Operation {
    fn id(&self) -> Uuid {
        match self {
            Self::Start { id, .. }
            | Self::Restart { id, .. }
            | Self::Stop { id }
            | Self::Release { id } => *id,
        }
    }
    fn config(&self) -> Option<&ConnectionConfig> {
        match self {
            Self::Start { config, .. } | Self::Restart { config, .. } => Some(config),
            _ => None,
        }
    }
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSnapshot {
    pub id: Uuid,
    pub revision: u64,
    pub state: &'static str,
    pub running_config: Option<ConnectionConfig>,
    pub recovery_config: Option<ConnectionConfig>,
    pub recovery: Option<RecoverySnapshot>,
    pub telemetry: Option<crate::TelemetrySnapshot>,
    pub device_name: String,
    pub virtual_ip: Option<String>,
    pub peer_count: usize,
    pub direct_peer_count: usize,
    pub error: Option<CoreError>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFrame {
    pub epoch: Uuid,
    pub health: &'static str,
    pub error: Option<CoreError>,
    pub networks: Vec<NetworkSnapshot>,
}
struct Active {
    generation: u64,
    kind: &'static str,
    background: bool,
}
struct State {
    epoch: Uuid,
    sequence: u64,
    health: &'static str,
    observation_error: Option<CoreError>,
    last_observed: Option<tokio::time::Instant>,
    recovery: recovery::Recovery,
    closing: bool,
    generations: BTreeMap<Uuid, u64>,
    active: BTreeMap<Uuid, Active>,
    lanes: BTreeMap<Uuid, Arc<Mutex<()>>>,
    candidates: BTreeMap<Uuid, ConnectionConfig>,
    observations: BTreeMap<Uuid, InstanceSnapshot>,
    frames: BTreeMap<Uuid, NetworkSnapshot>,
    recent_errors: VecDeque<crate::support::RecentError>,
    observed_errors: BTreeMap<Uuid, ErrorCode>,
    configs: BTreeMap<Uuid, ConnectionConfig>,
    measurements: BTreeMap<Uuid, crate::TelemetrySnapshot>,
    errors: BTreeMap<Uuid, CoreError>,
    lease: Option<File>,
    order: Vec<Uuid>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            epoch: Uuid::new_v4(),
            sequence: 0,
            health: "initializing",
            observation_error: None,
            last_observed: None,
            recovery: Default::default(),
            closing: false,
            generations: BTreeMap::new(),
            active: BTreeMap::new(),
            lanes: BTreeMap::new(),
            candidates: BTreeMap::new(),
            observations: BTreeMap::new(),
            frames: BTreeMap::new(),
            recent_errors: VecDeque::new(),
            observed_errors: BTreeMap::new(),
            configs: BTreeMap::new(),
            measurements: BTreeMap::new(),
            errors: BTreeMap::new(),
            lease: None,
            order: vec![],
        }
    }
}
fn has_active(state: &State) -> bool {
    !state.configs.is_empty()
        || !state.active.is_empty()
        || state.recovery.pending()
        || state
            .observations
            .values()
            .any(|snapshot| snapshot.running != Some(false))
}

struct Inner<B> {
    backend: B,
    state: Mutex<State>,
    sampling: Mutex<()>,
    lease_path: PathBuf,
}
pub struct NetworkManager<B = CoreController> {
    inner: Arc<Inner<B>>,
}
impl<B> Clone for NetworkManager<B> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}
impl<B: Backend> NetworkManager<B> {
    pub fn new(backend: B, lease_path: PathBuf) -> Self {
        Self {
            inner: Arc::new(Inner {
                backend,
                state: Mutex::new(State::default()),
                sampling: Mutex::new(()),
                lease_path,
            }),
        }
    }

    /// Cached observations only. Cold/stale caches cannot authorize an action.
    pub async fn snapshot(&self) -> Result<RuntimeFrame> {
        let state = self.inner.state.lock().await;
        let _probe = if state.lease.is_none() {
            Some(self.lease()?)
        } else {
            None
        };
        Ok(frame(&state))
    }

    /// One native sampling owner, independent of the WebView/window lifetime.
    pub async fn maintain(&self) -> Result<()> {
        if self.inner.state.lock().await.closing {
            return Ok(());
        }
        self.synchronize().await?;
        let (recoveries, conflicts) = {
            let mut state = self.inner.state.lock().await;
            if state.closing {
                return Ok(());
            }
            let conflicts = collisions(&state);
            let due = state.recovery.due();
            let mut recoveries = vec![];
            for (id, config) in due {
                if state.active.contains_key(&id) {
                    continue;
                }
                match admit(
                    &mut state,
                    &Operation::Restart {
                        id,
                        config: config.clone(),
                    },
                    true,
                ) {
                    Ok(ticket) => recoveries.push((ticket, Operation::Restart { id, config })),
                    Err(error) => {
                        state.recovery.failed(id, &error);
                        state.errors.insert(id, error);
                    }
                }
            }
            publish(&mut state);
            (recoveries, conflicts)
        };
        for (ticket, operation) in recoveries {
            let manager = self.clone();
            tokio::spawn(async move {
                let _ = manager.execute(ticket, operation).await;
            });
        }
        for (id, generation) in conflicts {
            let manager = self.clone();
            tokio::spawn(async move {
                let _ = manager.stop_collision(id, generation).await;
            });
        }
        Ok(())
    }

    pub async fn set_recovery_enabled(&self, enabled: bool) {
        let mut state = self.inner.state.lock().await;
        state.recovery.set_enabled(enabled);
        if enabled && !state.closing {
            let healthy: Vec<_> = state
                .observations
                .values()
                .filter(|snapshot| {
                    snapshot.ready && snapshot.running == Some(true) && !snapshot.fatal
                })
                .filter_map(|snapshot| {
                    state
                        .configs
                        .get(&snapshot.id)
                        .cloned()
                        .map(|config| (snapshot.id, config))
                })
                .collect();
            for (id, config) in healthy {
                if !state.active.contains_key(&id) {
                    state.recovery.track(id, config);
                }
            }
        } else if !enabled {
            let ids: Vec<_> = state
                .active
                .iter()
                .filter(|(_, operation)| operation.background)
                .map(|(id, _)| *id)
                .collect();
            for id in ids {
                *state.generations.entry(id).or_default() += 1;
            }
        }
        publish(&mut state);
    }

    pub async fn has_active_networks(&self) -> bool {
        let state = self.inner.state.lock().await;
        has_active(&state)
    }
    pub async fn recent_errors(&self) -> Vec<crate::support::RecentError> {
        self.inner
            .state
            .lock()
            .await
            .recent_errors
            .iter()
            .cloned()
            .collect()
    }

    pub async fn shutdown(&self) -> Result<()> {
        self.shutdown_inner(true).await.map(|_| ())
    }

    /// Check for active work and close admission under the same lock, so a
    /// connection cannot slip between an update confirmation and shutdown.
    pub async fn shutdown_for_update(&self, confirmed: bool) -> Result<bool> {
        self.shutdown_inner(confirmed).await
    }

    async fn shutdown_inner(&self, confirmed: bool) -> Result<bool> {
        let lanes = {
            let mut state = self.inner.state.lock().await;
            if !confirmed && has_active(&state) {
                return Ok(false);
            }
            state.closing = true;
            state.recovery.clear();
            for generation in state.generations.values_mut() {
                *generation += 1;
            }
            publish(&mut state);
            state.lanes.values().cloned().collect::<Vec<_>>()
        };
        // In-flight requests finish their frame exchange and compensate a late
        // start before shutdown can report completion. No state lock is held.
        let mut guards = Vec::new();
        for lane in lanes {
            guards.push(lane.lock_owned().await);
        }
        let result = self.inner.backend.shutdown().await;
        let mut state = self.inner.state.lock().await;
        if result.is_ok() {
            state.configs.clear();
            state.candidates.clear();
            state.observations.clear();
            state.active.clear();
            state.errors.clear();
            state.health = "ready";
            state.observation_error = None;
            state.last_observed = Some(tokio::time::Instant::now());
        } else {
            state.health = "stale";
            state.observation_error = result.as_ref().err().cloned();
        }
        publish(&mut state);
        result.map(|_| true)
    }

    /// Reopen admission only after a confirmed cleanup and failed installer
    /// launch. Recovery intentions stay cleared; stopped networks stay stopped.
    pub async fn resume_after_update(&self, recovery_enabled: bool) {
        let mut state = self.inner.state.lock().await;
        if state.closing
            && state.configs.is_empty()
            && state.active.is_empty()
            && state.observations.is_empty()
            && state.observation_error.is_none()
        {
            state.closing = false;
            state.recovery.set_enabled(recovery_enabled);
            publish(&mut state);
        }
    }

    async fn synchronize(&self) -> Result<()> {
        let _sampling = self.inner.sampling.lock().await;
        let generations = self.inner.state.lock().await.generations.clone();
        let result = self.inner.backend.snapshot().await;
        let mut state = self.inner.state.lock().await;
        match result {
            Ok(snapshots) => {
                state.health = "ready";
                state.observation_error = None;
                state.last_observed = Some(tokio::time::Instant::now());
                let ids: BTreeSet<_> = state
                    .observations
                    .keys()
                    .chain(state.configs.keys())
                    .copied()
                    .chain(snapshots.iter().map(|snapshot| snapshot.id))
                    .collect();
                for id in ids {
                    if state.generations.get(&id) != generations.get(&id) {
                        continue;
                    }
                    if let Some(snapshot) = snapshots.iter().find(|snapshot| snapshot.id == id) {
                        if let Some(telemetry) = &snapshot.telemetry {
                            state.measurements.insert(id, telemetry.clone());
                        }
                        state.observations.insert(id, snapshot.clone());
                    } else {
                        state.observations.remove(&id);
                        if !state.active.contains_key(&id) && state.configs.remove(&id).is_some() {
                            state.errors.insert(
                                id,
                                CoreError::new(
                                    ErrorCode::InstanceFailed,
                                    "The running instance disappeared",
                                ),
                            );
                        }
                    }
                }
            }
            Err(error) if error.code == ErrorCode::CoreExited => {
                state.health = "ready";
                state.observation_error = None;
                state.last_observed = Some(tokio::time::Instant::now());
                let ids: Vec<_> = state
                    .configs
                    .keys()
                    .chain(state.observations.keys())
                    .copied()
                    .collect();
                for id in ids {
                    if state.generations.get(&id) == generations.get(&id) {
                        state.configs.remove(&id);
                        state.observations.remove(&id);
                        state.errors.insert(id, error.clone());
                    }
                }
            }
            Err(error) => {
                state.health = "stale";
                state.observation_error = Some(error.clone());
                publish(&mut state);
                return Err(error);
            }
        }
        publish(&mut state);
        Ok(())
    }
    fn lease(&self) -> Result<File> {
        if let Some(parent) = self.inner.lease_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&self.inner.lease_path)?;
        file.try_lock().map_err(|_| {
            CoreError::new(
                ErrorCode::OtherController,
                "Another ClearTier window controls the core",
            )
        })?;
        Ok(file)
    }
}
fn frame(state: &State) -> RuntimeFrame {
    let expired = state.health == "ready"
        && state
            .last_observed
            .is_some_and(|at| at.elapsed() >= std::time::Duration::from_secs(3));
    RuntimeFrame {
        epoch: state.epoch,
        health: if expired { "stale" } else { state.health },
        error: state.observation_error.clone().or_else(|| {
            expired.then(|| {
                CoreError::new(
                    ErrorCode::RequestTimeout,
                    "The last core observation has expired",
                )
            })
        }),
        networks: state.frames.values().cloned().collect(),
    }
}

fn publish(state: &mut State) {
    state.sequence += 1;
    let ids: BTreeSet<_> = state
        .frames
        .keys()
        .chain(state.configs.keys())
        .chain(state.observations.keys())
        .chain(state.errors.keys())
        .chain(state.measurements.keys())
        .chain(state.active.keys())
        .copied()
        .collect();
    let mut frames = vec![];
    for id in ids {
        let observed = state.observations.get(&id);
        let operation = state.active.get(&id);
        let fatal =
            observed.is_some_and(|snapshot| snapshot.fatal || snapshot.running == Some(false));
        let error = if fatal {
            Some(CoreError::new(
                observed
                    .and_then(|snapshot| snapshot.issue)
                    .unwrap_or(ErrorCode::InstanceFailed),
                "The running instance failed",
            ))
        } else {
            state.errors.get(&id).cloned().or_else(|| {
                observed
                    .and_then(|snapshot| snapshot.issue)
                    .map(|code| CoreError::new(code, "A network condition requires attention"))
            })
        };
        let status = if let Some(operation) = operation {
            operation.kind
        } else if fatal || (observed.is_none() && error.is_some()) {
            "failed"
        } else if let Some(snapshot) = observed {
            if snapshot.running.is_none() {
                "unknown"
            } else if snapshot.ready {
                "running"
            } else {
                "starting"
            }
        } else {
            "stopped"
        };
        frames.push(NetworkSnapshot {
            id,
            revision: state.sequence,
            state: status,
            running_config: state.configs.get(&id).cloned(),
            recovery_config: None,
            recovery: None,
            telemetry: observed
                .and_then(|snapshot| snapshot.telemetry.clone())
                .or_else(|| state.measurements.get(&id).cloned()),
            device_name: observed
                .map(|snapshot| snapshot.device_name.clone())
                .unwrap_or_default(),
            virtual_ip: observed.and_then(|snapshot| snapshot.virtual_ip.clone()),
            peer_count: observed.map(|snapshot| snapshot.peer_count).unwrap_or(0),
            direct_peer_count: observed
                .map(|snapshot| snapshot.direct_peer_count)
                .unwrap_or(0),
            error,
        });
    }
    if state.health == "ready" {
        state.recovery.observe(&frames);
    }
    for snapshot in &mut frames {
        let starting = state
            .active
            .get(&snapshot.id)
            .is_some_and(|operation| operation.background);
        snapshot.recovery = state.recovery.snapshot(snapshot.id, starting);
        if snapshot.recovery.is_some() {
            snapshot.recovery_config = state.recovery.config(snapshot.id);
        }
        if let Some(error) = &snapshot.error {
            record_error(state, snapshot.id, error.code);
        } else {
            state.observed_errors.remove(&snapshot.id);
        }
    }
    state.frames = frames
        .into_iter()
        .map(|snapshot| (snapshot.id, snapshot))
        .collect();
}
fn collisions(state: &State) -> Vec<(Uuid, u64)> {
    let mut snapshots: Vec<_> = state
        .observations
        .values()
        .filter(|snapshot| snapshot.ready)
        .collect();
    snapshots.sort_by_key(|snapshot| {
        state
            .order
            .iter()
            .position(|id| *id == snapshot.id)
            .map(|index| index + 1)
            .unwrap_or(0)
    });
    let mut addresses = BTreeSet::new();
    snapshots
        .into_iter()
        .filter_map(|snapshot| {
            let duplicate = snapshot
                .virtual_ip
                .as_ref()
                .is_some_and(|address| !addresses.insert(address));
            (duplicate
                && state.configs.contains_key(&snapshot.id)
                && !state.active.contains_key(&snapshot.id))
            .then(|| {
                (
                    snapshot.id,
                    *state.generations.get(&snapshot.id).unwrap_or(&0),
                )
            })
        })
        .collect()
}
fn record_error(state: &mut State, id: Uuid, code: ErrorCode) {
    if state.observed_errors.insert(id, code) != Some(code) {
        state
            .recent_errors
            .push_back(crate::support::RecentError::new(code));
        while state.recent_errors.len() > 50 {
            state.recent_errors.pop_front();
        }
    }
}
use operations::admit;
#[cfg(test)]
mod tests;
