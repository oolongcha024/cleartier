use std::{ffi::OsString, path::PathBuf};

use crate::process::{CorePaths, ProcessCheckMode};

enum Job {
    Direct(PathBuf),
    Process(ProcessCheckMode, PathBuf),
    Worker(String, u32),
}

/// Dispatch before constructing Tauri, including when arguments are invalid.
pub fn dispatch_headless() -> Option<i32> {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let flag = args.first()?.to_str()?;
    if !["--core-check", "--process-check", "--core-host"].contains(&flag) {
        return None;
    }
    let job = match flag {
        "--core-check" if args.len() == 2 => Job::Direct(PathBuf::from(&args[1])),
        "--core-host" if args.len() == 3 => {
            let Some(owner) = args[2].to_str().and_then(|value| value.parse::<u32>().ok()) else {
                return Some(2);
            };
            Job::Worker(args[1].to_string_lossy().into_owned(), owner)
        }
        "--process-check" if args.len() == 3 => {
            let mode = match args[1].to_str() {
                Some("process") => ProcessCheckMode::Process,
                Some("tun") => ProcessCheckMode::Tun,
                Some("cancel") => ProcessCheckMode::Cancel,
                Some("recovery") => ProcessCheckMode::Recovery,
                Some("missing-resource") => ProcessCheckMode::MissingResource,
                _ => return Some(2),
            };
            Job::Process(mode, PathBuf::from(&args[2]))
        }
        _ => return Some(2),
    };
    Some(match execute(job) {
        Ok(true) => 0,
        Ok(false) => 1,
        Err(error) => {
            eprintln!("Core operation failed: {error}");
            1
        }
    })
}

fn execute(job: Job) -> Result<bool, Box<dyn std::error::Error>> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    match job {
        Job::Worker(endpoint, owner) => {
            runtime.block_on(crate::process::run_worker(&endpoint, owner))?;
            Ok(true)
        }
        Job::Direct(path) => {
            let report = runtime.block_on(crate::run_check());
            std::fs::write(path, serde_json::to_vec_pretty(&report)?)?;
            Ok(report.passed)
        }
        Job::Process(mode, path) => {
            let directory = path.with_extension("files");
            let paths = CorePaths::new(directory.join("config"), directory.join("data"));
            let report = runtime.block_on(crate::process::run_process_check(
                std::env::current_exe()?,
                paths,
                mode,
            ));
            std::fs::write(path, serde_json::to_vec_pretty(&report)?)?;
            Ok(report.passed)
        }
    }
}
