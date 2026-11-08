use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicU64, AtomicUsize};

struct Script {
    now: AtomicU64,
    checks: AtomicUsize,
    downloads: AtomicUsize,
    installs: AtomicUsize,
    found: Mutex<Result<Option<Candidate>>>,
    signature_error: AtomicBool,
    cleanup_error: AtomicBool,
    active: AtomicBool,
    hold_check: AtomicBool,
    hold_download: AtomicBool,
    entered: Notify,
    release: Notify,
    distribution: Distribution,
}
#[derive(Clone)]
struct Fake(Arc<Script>);
impl Backend for Fake {
    type Package = Vec<u8>;
    fn distribution(&self) -> Distribution {
        self.0.distribution
    }
    fn now(&self) -> u64 {
        self.0.now.load(Ordering::SeqCst)
    }
    async fn find(&self, _: &str, _: bool) -> Result<Option<Candidate>> {
        self.0.checks.fetch_add(1, Ordering::SeqCst);
        if self.0.hold_check.load(Ordering::SeqCst) {
            self.0.entered.notify_one();
            self.0.release.notified().await;
        }
        self.0.found.lock().unwrap().clone()
    }
    async fn download(
        &self,
        _: &Candidate,
        progress: Progress,
        cancel: Cancellation,
    ) -> Result<Vec<u8>> {
        self.0.downloads.fetch_add(1, Ordering::SeqCst);
        progress(150_000, Some(300_000));
        if self.0.hold_download.load(Ordering::SeqCst) {
            self.0.entered.notify_one();
            tokio::select! { _ = self.0.release.notified() => {}, _ = cancel.wait() => return Err(Error::new("cancelled")) }
        }
        if self.0.signature_error.load(Ordering::SeqCst) {
            return Err(Error::new("signature"));
        }
        Ok(vec![1, 2, 3])
    }
    async fn install(&self, _: &Vec<u8>, confirmed: bool) -> Result<()> {
        if self.0.active.load(Ordering::SeqCst) && !confirmed {
            return Err(Error::new("confirmation"));
        }
        if self.0.cleanup_error.load(Ordering::SeqCst) {
            return Err(Error::new("cleanup"));
        }
        self.0.installs.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn open(&self, url: &str) -> Result<()> {
        assert!(url.starts_with("https://github.com/oolongcha024/cleartier/"));
        Ok(())
    }
}
fn candidate(version: &str) -> Candidate {
    Candidate {
        version: version.into(),
        notes: "Release notes".into(),
    }
}
fn fixture(distribution: Distribution) -> (tempfile::TempDir, Arc<UpdateManager<Fake>>, Fake) {
    let directory = tempfile::tempdir().unwrap();
    let backend = Fake(Arc::new(Script {
        now: AtomicU64::new(1_000_000),
        checks: AtomicUsize::new(0),
        downloads: AtomicUsize::new(0),
        installs: AtomicUsize::new(0),
        found: Mutex::new(Ok(Some(candidate("0.2.0-beta.10")))),
        signature_error: AtomicBool::new(false),
        cleanup_error: AtomicBool::new(false),
        active: AtomicBool::new(false),
        hold_check: AtomicBool::new(false),
        hold_download: AtomicBool::new(false),
        entered: Notify::new(),
        release: Notify::new(),
        distribution,
    }));
    let manager = Arc::new(UpdateManager::new(
        directory.path().join("updates.json"),
        "0.1.0-rc.1".into(),
        backend.clone(),
    ));
    (directory, manager, backend)
}

#[tokio::test]
async fn automatic_checks_share_a_persistent_24_hour_interval_including_failures() {
    let (directory, manager, backend) = fixture(Distribution::Installed);
    *backend.0.found.lock().unwrap() = Err(Error::new("network"));
    assert_eq!(manager.check(true).await.unwrap_err().code, "network");
    assert_eq!(manager.snapshot().phase, "idle");
    assert_eq!(manager.snapshot().error, Some("network"));
    manager.check(true).await.unwrap();
    let restarted = UpdateManager::new(
        directory.path().join("updates.json"),
        "0.1.0-rc.1".into(),
        backend.clone(),
    );
    restarted.check(true).await.unwrap();
    assert_eq!(backend.0.checks.load(Ordering::SeqCst), 1);
    backend
        .0
        .now
        .fetch_add(CHECK_INTERVAL - 1, Ordering::SeqCst);
    restarted.check(true).await.unwrap();
    assert_eq!(backend.0.checks.load(Ordering::SeqCst), 1);
    backend.0.now.fetch_add(1, Ordering::SeqCst);
    assert!(restarted.check(true).await.is_err());
    assert_eq!(backend.0.checks.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn manual_checks_bypass_cadence_and_disabled_automatic_checks() {
    let (_directory, manager, backend) = fixture(Distribution::Installed);
    manager
        .configure(Preferences {
            automatic: false,
            prereleases: true,
        })
        .await
        .unwrap();
    manager.check(true).await.unwrap();
    assert_eq!(backend.0.checks.load(Ordering::SeqCst), 0);
    manager.check(false).await.unwrap();
    manager.check(false).await.unwrap();
    assert_eq!(backend.0.checks.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn same_version_is_not_reinstalled_and_channel_changes_clear_ineligible_candidates() {
    let (_directory, manager, _) = fixture(Distribution::Installed);
    manager.check(false).await.unwrap();
    assert_eq!(
        manager.snapshot().candidate.unwrap().version,
        "0.2.0-beta.10"
    );
    manager
        .configure(Preferences {
            automatic: true,
            prereleases: false,
        })
        .await
        .unwrap();
    assert!(manager.snapshot().candidate.is_none());
    assert!(manager.update(false).await.is_err());
    for version in ["0.1.0-rc.1", "0.1.0-beta.999", "0.0.9", "1.0.0+build"] {
        assert!(!candidate(version).accepted("0.1.0-rc.1", true));
    }
    assert!(candidate("0.2.0-beta.10").accepted("0.2.0-beta.9", true));
    assert!(!candidate("0.2.0-beta.10").accepted("0.1.0", false));
}
#[tokio::test]
async fn concurrent_checks_coalesce_and_late_calls_cannot_change_preferences() {
    let (_directory, manager, backend) = fixture(Distribution::Installed);
    backend.0.hold_check.store(true, Ordering::SeqCst);
    let task = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.check(false).await })
    };
    backend.0.entered.notified().await;
    assert_eq!(manager.check(false).await.unwrap().phase, "checking");
    assert_eq!(
        manager
            .configure(Preferences {
                automatic: false,
                prereleases: false
            })
            .await
            .unwrap_err()
            .code,
        "busy"
    );
    backend.0.release.notify_one();
    task.await.unwrap().unwrap();
    assert_eq!(backend.0.checks.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn cancellation_discards_download_without_installing_or_reporting_a_failure() {
    let (_directory, manager, backend) = fixture(Distribution::Installed);
    manager.check(false).await.unwrap();
    backend.0.hold_download.store(true, Ordering::SeqCst);
    let task = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.update(false).await })
    };
    backend.0.entered.notified().await;
    assert_eq!(manager.snapshot().downloaded, 150_000);
    manager.cancel().unwrap();
    assert_eq!(task.await.unwrap().unwrap_err().code, "cancelled");
    assert_eq!(manager.snapshot().phase, "available");
    assert!(manager.snapshot().error.is_none());
    assert_eq!(backend.0.installs.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn signature_failure_never_calls_install() {
    let (_directory, manager, backend) = fixture(Distribution::Installed);
    manager.check(false).await.unwrap();
    backend.0.signature_error.store(true, Ordering::SeqCst);
    assert_eq!(manager.update(false).await.unwrap_err().code, "signature");
    assert_eq!(backend.0.installs.load(Ordering::SeqCst), 0);
    assert_eq!(manager.snapshot().phase, "available");
}
#[tokio::test]
async fn ready_package_waits_for_network_confirmation_and_cleanup_failure_is_retryable() {
    let (_directory, manager, backend) = fixture(Distribution::Installed);
    manager.check(false).await.unwrap();
    backend.0.active.store(true, Ordering::SeqCst);
    assert_eq!(manager.update(false).await.unwrap().phase, "ready");
    assert_eq!(backend.0.installs.load(Ordering::SeqCst), 0);
    backend.0.cleanup_error.store(true, Ordering::SeqCst);
    assert_eq!(manager.update(true).await.unwrap_err().code, "cleanup");
    backend.0.cleanup_error.store(false, Ordering::SeqCst);
    manager.update(true).await.unwrap();
    assert_eq!(backend.0.downloads.load(Ordering::SeqCst), 1);
    assert_eq!(backend.0.installs.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn portable_can_open_zip_but_cannot_download_or_install_and_unsupported_never_checks() {
    let (_directory, manager, backend) = fixture(Distribution::Portable);
    manager.check(false).await.unwrap();
    manager.open(true).unwrap();
    assert_eq!(manager.update(false).await.unwrap_err().code, "portable");
    assert_eq!(backend.0.downloads.load(Ordering::SeqCst), 0);
    let (_directory, manager, backend) = fixture(Distribution::Unsupported);
    manager.check(false).await.unwrap();
    assert_eq!(backend.0.checks.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn rate_limits_are_persistent_and_apply_to_manual_checks() {
    let (directory, manager, backend) = fixture(Distribution::Installed);
    *backend.0.found.lock().unwrap() = Err(Error {
        code: "rateLimited",
        retry_at: Some(1_000_120),
    });
    assert!(manager.check(false).await.is_err());
    let restarted = UpdateManager::new(
        directory.path().join("updates.json"),
        "0.1.0-rc.1".into(),
        backend.clone(),
    );
    assert_eq!(
        restarted.check(false).await.unwrap_err().code,
        "rateLimited"
    );
    assert_eq!(backend.0.checks.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn unsupported_or_damaged_storage_is_never_overwritten_and_unknown_fields_survive() {
    let (directory, manager, backend) = fixture(Distribution::Installed);
    manager.check(false).await.unwrap();
    let path = directory.path().join("updates.json");
    let mut json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    json["future"] = json!({"keep":true});
    std::fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
    let manager = UpdateManager::new(path.clone(), "0.1.0-rc.1".into(), backend.clone());
    manager
        .configure(Preferences {
            automatic: false,
            prereleases: true,
        })
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&std::fs::read(&path).unwrap()).unwrap()["future"]
            ["keep"],
        true
    );
    for invalid in [
        b"{damaged".to_vec(),
        serde_json::to_vec(&json!({"version":2})).unwrap(),
    ] {
        std::fs::write(&path, &invalid).unwrap();
        let manager = UpdateManager::new(path.clone(), "0.1.0-rc.1".into(), backend.clone());
        assert_eq!(manager.check(true).await.unwrap_err().code, "storage");
        assert_eq!(std::fs::read(&path).unwrap(), invalid);
    }
}

fn release(version: &str, prerelease: bool) -> serde_json::Value {
    let c = candidate(version);
    json!({"tag_name":format!("v{version}"),"draft":false,"prerelease":prerelease,"body":"notes","assets":[
        {"name":MANIFEST_NAME,"state":"uploaded","browser_download_url":c.manifest_url()},
        {"name":c.installer_name(),"state":"uploaded","browser_download_url":c.installer_url()},
        {"name":"cleartier-windows-x64.zip","state":"uploaded","browser_download_url":c.zip_url()}]})
}
#[test]
fn release_selection_uses_semver_not_dates_filters_channels_drafts_and_missing_assets() {
    let mut draft = release("9.0.0", false);
    draft["draft"] = json!(true);
    let mut incomplete = release("8.0.0", false);
    incomplete["assets"] = json!([]);
    let list = json!([
        release("0.2.0-beta.9", true),
        release("0.2.0-beta.10", true),
        release("0.1.1", false),
        draft,
        incomplete
    ]);
    assert_eq!(
        select_release(&list, "0.1.0", true)
            .unwrap()
            .unwrap()
            .version,
        "0.2.0-beta.10"
    );
    assert_eq!(
        select_release(&list, "0.1.0", false)
            .unwrap()
            .unwrap()
            .version,
        "0.1.1"
    );
    assert!(select_release(&list, "9.0.0", true).unwrap().is_none());
    let mut other_host = release("0.3.0", false);
    other_host["assets"][0]["browser_download_url"] = json!("https://example.invalid/latest.json");
    assert!(
        select_release(&json!([other_host]), "0.1.0", true)
            .unwrap()
            .is_none()
    );
}
