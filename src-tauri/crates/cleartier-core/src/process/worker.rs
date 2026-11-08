use easytier::common::config::ConfigLoader;

use super::{
    CoreError, ErrorCode, Result, parse_config, platform,
    wire::{self, Command, Data, Hello, Request, Response},
};

struct Readers(Vec<tokio::task::JoinHandle<()>>);
impl Drop for Readers {
    fn drop(&mut self) {
        for task in &self.0 {
            task.abort();
        }
    }
}

pub async fn run_worker(endpoint: &str, owner: u32) -> Result<()> {
    if owner == 0 || owner == std::process::id() {
        return Err(CoreError::new(
            ErrorCode::IdentityRejected,
            "Invalid controller PID",
        ));
    }
    let _owner = platform::guard_owner(owner)?;
    let _resources = platform::lock_resources(&std::env::current_exe()?)?;
    let mut io = platform::connect(endpoint, owner).await?;
    let elevated = platform::elevated()?;
    wire::write(
        &mut io,
        &Hello {
            protocol: wire::PROTOCOL,
            pid: std::process::id(),
            version: crate::version().to_owned(),
            elevated,
        },
    )
    .await?;
    let (mut reader, mut writer) = tokio::io::split(io);
    let (send, mut receive) = tokio::sync::mpsc::channel(1);
    let (disconnected, lost) = tokio::sync::oneshot::channel();
    let read_task = tokio::spawn(async move {
        loop {
            let message = wire::read::<Request>(&mut reader).await;
            let failed = message.is_err();
            if send.send(message).await.is_err() || failed {
                break;
            }
        }
        let _ = disconnected.send(());
    });
    let watchdog = tokio::spawn(async move {
        let _ = lost.await;
        // Cleanup normally completes through CoreRuntime::drop. A separate task
        // can end even an elevated worker if a core thread hangs during cleanup.
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        std::process::exit(1);
    });
    let _readers = Readers(vec![read_task, watchdog]);
    let core = crate::CoreRuntime::default();
    let mut last_id = 0;
    loop {
        let request: Request = match receive.recv().await {
            Some(Ok(request)) => request,
            Some(Err(error)) if error.code == ErrorCode::Io => break,
            Some(Err(error)) => return Err(error),
            None => break,
        };
        if request.id <= last_id {
            return Err(CoreError::new(
                ErrorCode::ProtocolError,
                "Repeated local request",
            ));
        }
        last_id = request.id;
        if matches!(request.command, Command::Shutdown) {
            // Acknowledge only after instance Drop has released network resources.
            drop(core);
            wire::write(
                &mut writer,
                &Response {
                    id: request.id,
                    result: Ok(Data::Done),
                },
            )
            .await?;
            return Ok(());
        }
        let result =
            match request.command {
                Command::Start { toml } => match parse_config(&toml) {
                    Ok(config) if !config.get_flags().no_tun && !elevated => Err(CoreError::new(
                        ErrorCode::ElevationRequired,
                        "TUN requires administrator privileges",
                    )),
                    Ok(_) => core.start(&toml).map(Data::Started).map_err(|_| {
                        CoreError::new(
                            ErrorCode::CoreFailure,
                            "Core rejected the instance; check its configuration or duplicate ID",
                        )
                    }),
                    Err(error) => Err(error),
                },
                Command::Stop { id } => core.stop(id).map(|_| Data::Done).map_err(|_| {
                    CoreError::new(ErrorCode::CoreFailure, "Core could not stop the instance")
                }),
                Command::Snapshot => core.snapshot().await.map(Data::Snapshot).map_err(|_| {
                    CoreError::new(ErrorCode::CoreFailure, "Core status is unavailable")
                }),
                Command::Shutdown => unreachable!(),
            };
        wire::write(
            &mut writer,
            &Response {
                id: request.id,
                result,
            },
        )
        .await?;
    }
    Ok(())
}
