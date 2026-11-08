//! Recovery intent is memory-only, owned by the GUI process, and independent of
//! saved configuration. A manual action always cancels the older intent first.
use super::*;
use std::time::Duration;
use tokio::time::Instant;

const DELAYS: [u64; 3] = [2, 5, 15];
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub phase: &'static str,
    pub attempt: usize,
    pub max_attempts: usize,
    pub retry_in_seconds: u64,
}
struct Intent {
    config: ConnectionConfig,
    attempts: usize,
    due: Option<Instant>,
    healthy_since: Option<Instant>,
    blocked: Option<&'static str>,
}
pub(super) struct Recovery {
    enabled: bool,
    intents: BTreeMap<Uuid, Intent>,
}
impl Default for Recovery {
    fn default() -> Self {
        Self {
            enabled: true,
            intents: BTreeMap::new(),
        }
    }
}
impl Recovery {
    pub fn cancel(&mut self, id: Uuid) {
        self.intents.remove(&id);
    }
    pub fn clear(&mut self) {
        self.intents.clear();
    }
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.clear();
        }
    }
    pub fn track(&mut self, id: Uuid, config: ConnectionConfig) {
        if self.enabled {
            self.intents.insert(
                id,
                Intent {
                    config,
                    attempts: 0,
                    due: None,
                    healthy_since: Some(Instant::now()),
                    blocked: None,
                },
            );
        }
    }
    pub fn observe(&mut self, snapshots: &[NetworkSnapshot]) {
        let now = Instant::now();
        for (id, intent) in &mut self.intents {
            let snapshot = snapshots.iter().find(|snapshot| snapshot.id == *id);
            if snapshot.is_some_and(|snapshot| snapshot.state == "running") {
                intent.due = None;
                intent.blocked = None;
                if now.duration_since(*intent.healthy_since.get_or_insert(now))
                    >= Duration::from_secs(60)
                {
                    intent.attempts = 0;
                }
            } else if snapshot.is_none_or(|snapshot| matches!(snapshot.state, "failed" | "stopped"))
            {
                intent.healthy_since = None;
                if intent.due.is_some() || intent.blocked.is_some() {
                    continue;
                }
                let code = snapshot
                    .and_then(|snapshot| snapshot.error.as_ref())
                    .map(|error| error.code)
                    .unwrap_or(ErrorCode::InstanceFailed);
                if !retryable(code) {
                    intent.blocked = Some(if code == ErrorCode::ElevationRequired {
                        "authorization"
                    } else {
                        "stopped"
                    });
                } else if let Some(delay) = DELAYS.get(intent.attempts) {
                    intent.due = Some(now + Duration::from_secs(*delay));
                } else {
                    intent.blocked = Some("exhausted");
                }
            }
            // Unknown snapshots and IPC timeouts are not evidence of an exit.
        }
    }
    pub fn due(&mut self) -> Vec<(Uuid, ConnectionConfig)> {
        let mut result = Vec::new();
        for (id, intent) in &mut self.intents {
            if intent.due.is_some_and(|due| due <= Instant::now()) {
                intent.due = None;
                intent.attempts += 1;
                result.push((*id, intent.config.clone()));
            }
        }
        result
    }
    pub fn failed(&mut self, id: Uuid, error: &CoreError) {
        if let Some(intent) = self.intents.get_mut(&id) {
            intent.healthy_since = None;
            intent.blocked = if error.code == ErrorCode::ElevationRequired {
                Some("authorization")
            } else if !retryable(error.code) {
                Some("stopped")
            } else if intent.attempts >= DELAYS.len() {
                Some("exhausted")
            } else {
                None
            };
        }
    }
    pub fn snapshot(&self, id: Uuid) -> Option<RecoverySnapshot> {
        let intent = self.intents.get(&id)?;
        let phase = intent.blocked.or(intent.due.map(|_| "waiting"))?;
        Some(RecoverySnapshot {
            phase,
            attempt: intent.attempts,
            max_attempts: DELAYS.len(),
            retry_in_seconds: intent
                .due
                .map(|due| {
                    let remaining = due.saturating_duration_since(Instant::now());
                    remaining.as_secs() + u64::from(remaining.subsec_nanos() > 0)
                })
                .unwrap_or(0),
        })
    }
    pub fn waiting_config(&self, id: Uuid) -> Option<ConnectionConfig> {
        let intent = self.intents.get(&id)?;
        intent.due.map(|_| intent.config.clone())
    }
    pub fn pending(&self) -> bool {
        self.intents.values().any(|intent| intent.due.is_some())
    }
}
fn retryable(code: ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::CoreExited
            | ErrorCode::InstanceFailed
            | ErrorCode::CoreFailure
            | ErrorCode::LaunchFailed
            | ErrorCode::StartupTimeout
            | ErrorCode::RequestTimeout
            | ErrorCode::Io
    )
}
