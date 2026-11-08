//! EasyTier ownership and status queries, independent of Tauri and WebView.
mod check;
pub mod configuration;
pub mod connections;
mod entry;
pub mod process;
mod status;
mod telemetry;
pub use status::InstanceSnapshot;
pub use telemetry::{PeerSnapshot, TelemetrySnapshot};

use anyhow::{Context, Result};
use easytier::{
    common::config::{ConfigFileControl, ConfigLoader, TomlConfigLoader},
    instance_manager::NetworkInstanceManager,
};
use uuid::Uuid;

pub use check::{CheckReport, run_check};
pub use entry::dispatch_headless;

pub fn version() -> &'static str {
    easytier::VERSION
}

#[derive(Default)]
pub struct CoreRuntime {
    manager: NetworkInstanceManager,
    event_signals:
        std::sync::Arc<std::sync::Mutex<std::collections::BTreeMap<Uuid, status::Signals>>>,
    no_tun: std::sync::Mutex<std::collections::BTreeMap<Uuid, bool>>,
    watchers: std::sync::Mutex<std::collections::BTreeMap<Uuid, tokio::task::JoinHandle<()>>>,
}

impl CoreRuntime {
    /// Acceptance is not readiness. Query snapshots for the actual instance state.
    pub fn start(&self, toml: &str) -> Result<Uuid> {
        let config = TomlConfigLoader::new_from_str(toml).context("invalid core configuration")?;
        let no_tun = config.get_flags().no_tun;
        let latency_first = config.get_flags().latency_first;
        let id =
            self.manager
                .run_network_instance(config, true, ConfigFileControl::STATIC_CONFIG)?;
        self.no_tun.lock().unwrap().insert(id, no_tun);
        self.event_signals.lock().unwrap().insert(
            id,
            status::Signals {
                latency_first,
                ..Default::default()
            },
        );
        let receiver = self
            .manager
            .iter()
            .find(|instance| *instance.key() == id)
            .and_then(|instance| instance.subscribe_event());
        if let Some(mut receiver) = receiver {
            let signals = self.event_signals.clone();
            let task = tokio::spawn(async move {
                loop {
                    match receiver.recv().await {
                        Ok(event) => {
                            signals
                                .lock()
                                .unwrap()
                                .entry(id)
                                .or_default()
                                .observe(event);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            signals
                                .lock()
                                .unwrap()
                                .entry(id)
                                .or_default()
                                .measurements
                                .incomplete = true;
                        }
                    }
                }
            });
            self.watchers.lock().unwrap().insert(id, task);
        }
        Ok(id)
    }

    pub fn stop(&self, id: Uuid) -> Result<()> {
        self.manager.delete_network_instance(vec![id])?;
        if let Some(task) = self.watchers.lock().unwrap().remove(&id) {
            task.abort();
        }
        self.event_signals.lock().unwrap().remove(&id);
        self.no_tun.lock().unwrap().remove(&id);
        Ok(())
    }

    pub async fn snapshot(&self) -> Result<Vec<InstanceSnapshot>> {
        let mut snapshots = Vec::new();
        for id in self.manager.list_network_instance_ids() {
            let info = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                self.manager.get_network_info(&id),
            )
            .await
            .context("core status query timed out")?;
            let no_tun = self
                .no_tun
                .lock()
                .unwrap()
                .get(&id)
                .copied()
                .unwrap_or(false);
            let mut signals = self.event_signals.lock().unwrap();
            let signals = signals.entry(id).or_default();
            snapshots.push(status::snapshot(id, info, no_tun, signals));
        }
        Ok(snapshots)
    }
}

impl Drop for CoreRuntime {
    fn drop(&mut self) {
        for (_, task) in std::mem::take(&mut *self.watchers.lock().unwrap()) {
            task.abort();
        }
        // NetworkInstance's drop joins the core thread and releases its resources.
        let _ = self.manager.retain_network_instance(Vec::new());
    }
}
