//! EasyTier ownership and status queries, independent of Tauri and WebView.
mod check;
mod entry;
pub mod process;

use anyhow::{Context, Result};
use easytier::{
    common::config::{ConfigFileControl, TomlConfigLoader},
    common::global_ctx::GlobalCtxEvent,
    instance_manager::NetworkInstanceManager,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use check::{CheckReport, run_check};
pub use entry::dispatch_headless;

pub fn version() -> &'static str {
    easytier::VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSnapshot {
    pub id: Uuid,
    /// None means that the core has not supplied a status yet.
    pub running: Option<bool>,
    pub device_name: String,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct CoreRuntime {
    manager: NetworkInstanceManager,
    event_errors: std::sync::Arc<std::sync::Mutex<std::collections::BTreeMap<Uuid, String>>>,
    watchers: std::sync::Mutex<std::collections::BTreeMap<Uuid, tokio::task::JoinHandle<()>>>,
}

impl CoreRuntime {
    /// Acceptance is not readiness. Query snapshots for the actual instance state.
    pub fn start(&self, toml: &str) -> Result<Uuid> {
        let config = TomlConfigLoader::new_from_str(toml).context("invalid core configuration")?;
        let id =
            self.manager
                .run_network_instance(config, true, ConfigFileControl::STATIC_CONFIG)?;
        let receiver = self
            .manager
            .iter()
            .find(|instance| *instance.key() == id)
            .and_then(|instance| instance.subscribe_event());
        if let Some(mut receiver) = receiver {
            let errors = self.event_errors.clone();
            let task = tokio::spawn(async move {
                loop {
                    match receiver.recv().await {
                        Ok(GlobalCtxEvent::TunDeviceError(error)) => {
                            errors.lock().unwrap().insert(id, error);
                        }
                        Ok(GlobalCtxEvent::TunDeviceReady(_)) => {
                            errors.lock().unwrap().remove(&id);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        _ => {}
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
        self.event_errors.lock().unwrap().remove(&id);
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
            snapshots.push(match info {
                Some(info) => InstanceSnapshot {
                    id,
                    running: Some(info.running),
                    device_name: info.dev_name,
                    error: info
                        .error_msg
                        .or_else(|| self.event_errors.lock().unwrap().get(&id).cloned()),
                },
                None => InstanceSnapshot {
                    id,
                    running: None,
                    device_name: String::new(),
                    error: None,
                },
            });
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
