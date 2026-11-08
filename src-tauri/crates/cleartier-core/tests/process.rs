use std::process::Command;

fn check(mode: &str) -> serde_json::Value {
    let directory = tempfile::tempdir().unwrap();
    let report = directory.path().join("report.json");
    let status = Command::new(env!("CARGO_BIN_EXE_core-test-host"))
        .args(["--process-check", mode])
        .arg(&report)
        .status()
        .unwrap();
    let report: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&report).unwrap()).unwrap();
    assert!(status.success(), "{report:#}");
    assert_eq!(report["passed"], true, "{report:#}");
    let logs = directory
        .path()
        .join("report.files/data/logs/core-process.jsonl");
    let logs = std::fs::read_to_string(logs).unwrap();
    assert!(!logs.contains("network_secret"));
    assert!(!logs.contains("cleartier-check-"));
    report
}

#[test]
fn separate_process_runs_and_stops_real_networks() {
    let report = check("process");
    assert_ne!(report["guiPid"], report["corePid"]);
    assert!(
        report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| check == "stopping_one_network_keeps_other_running")
    );
}

#[test]
fn detects_real_process_crash_and_starts_a_new_core() {
    let report = check("recovery");
    assert!(
        report["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| check == "new_core_can_start_after_failure")
    );
}

#[test]
fn invalid_worker_arguments_never_fall_through_to_gui() {
    let status = Command::new(env!("CARGO_BIN_EXE_core-test-host"))
        .args(["--core-host", "invalid", "not-a-pid"])
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(2));
}
