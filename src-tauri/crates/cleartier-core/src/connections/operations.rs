use super::*;
use std::time::Duration;

pub(super) struct Ticket {
    id: Uuid,
    generation: u64,
    background: bool,
    lane: Arc<Mutex<()>>,
}
pub(super) fn admit(state: &mut State, operation: &Operation, background: bool) -> Result<Ticket> {
    let id = operation.id();
    if state.closing {
        return Err(CoreError::new(
            ErrorCode::CoreFailure,
            "The client is shutting down",
        ));
    }
    if state.active.contains_key(&id) && !matches!(operation, Operation::Stop { .. }) {
        return Err(CoreError::new(
            ErrorCode::OperationBusy,
            "The network has an operation in progress",
        ));
    }
    if let Some(config) = operation.config() {
        for (other_id, other) in state.configs.iter().chain(state.candidates.iter()) {
            if *other_id == id {
                continue;
            }
            if config.same_network(other) {
                return Err(CoreError::new(
                    ErrorCode::NetworkAlreadyRunning,
                    "Another profile for this network is active",
                ));
            }
            if !config.tun_name.is_empty() && config.tun_name.eq_ignore_ascii_case(&other.tun_name)
            {
                return Err(CoreError::new(
                    ErrorCode::TunNameInUse,
                    "The interface name is reserved",
                ));
            }
            if config.ipv4_mode == "manual"
                && other.ipv4_mode == "manual"
                && config.ipv4_address == other.ipv4_address
            {
                return Err(CoreError::new(
                    ErrorCode::AddressInUse,
                    "The virtual address is reserved",
                ));
            }
        }
        state.candidates.insert(id, config.clone());
    }
    if !background {
        state.recovery.cancel(id);
    }
    let generation = state.generations.entry(id).or_default();
    *generation += 1;
    let ticket = Ticket {
        id,
        generation: *generation,
        background,
        lane: state.lanes.entry(id).or_default().clone(),
    };
    state.active.insert(
        id,
        Active {
            generation: ticket.generation,
            kind: match operation {
                Operation::Stop { .. } => "stopping",
                Operation::Release { .. } => state
                    .frames
                    .get(&id)
                    .map(|snapshot| snapshot.state)
                    .unwrap_or("unknown"),
                _ => "starting",
            },
            background,
        },
    );
    Ok(ticket)
}
impl<B: Backend> NetworkManager<B> {
    pub async fn operate(&self, operation: Operation) -> Result<RuntimeFrame> {
        // Preflight never disturbs a healthy instance or its recovery intent.
        if let Some(config) = operation.config() {
            if let Err(error) = crate::configuration::for_connection(operation.id(), config) {
                let mut state = self.inner.state.lock().await;
                state.errors.insert(operation.id(), error.clone());
                publish(&mut state);
                return Err(error);
            }
        }
        let ticket = {
            let mut state = self.inner.state.lock().await;
            if state.lease.is_none() {
                state.lease = Some(self.lease()?);
            }
            if matches!(operation, Operation::Release { .. })
                && (state.active.contains_key(&operation.id())
                    || state.recovery.pending_for(operation.id()))
            {
                return Err(CoreError::new(
                    ErrorCode::OperationBusy,
                    "The network is active or recovering",
                ));
            }
            let ticket = admit(&mut state, &operation, false)?;
            publish(&mut state);
            ticket
        };
        self.execute(ticket, operation).await
    }

    async fn current(&self, ticket: &Ticket) -> bool {
        let state = self.inner.state.lock().await;
        !state.closing && state.generations.get(&ticket.id) == Some(&ticket.generation)
    }
    async fn check(&self, ticket: &Ticket) -> Result<()> {
        if self.current(ticket).await {
            Ok(())
        } else {
            Err(CoreError::new(
                ErrorCode::OperationCancelled,
                "The operation was superseded",
            ))
        }
    }
    pub(super) async fn execute(
        &self,
        ticket: Ticket,
        operation: Operation,
    ) -> Result<RuntimeFrame> {
        let _lane = ticket.lane.lock().await;
        let starting = operation.config().is_some();
        let result = async {
            self.check(&ticket).await?;
            self.synchronize().await?;
            self.check(&ticket).await?;
            match operation {
                Operation::Stop { id } => {
                    self.stop_instance(id).await?;
                    self.synchronize().await
                }
                Operation::Release { id } => {
                    let mut state = self.inner.state.lock().await;
                    if state.health != "ready"
                        || state.observations.contains_key(&id)
                        || state.configs.contains_key(&id)
                    {
                        return Err(CoreError::new(
                            ErrorCode::InstanceRunning,
                            "Disconnect this network before deleting it",
                        ));
                    }
                    state.recovery.cancel(id);
                    state.errors.remove(&id);
                    state.candidates.remove(&id);
                    Ok(())
                }
                Operation::Start { id, config } => {
                    self.start_instance(&ticket, id, config, false).await
                }
                Operation::Restart { id, config } => {
                    self.start_instance(&ticket, id, config, true).await
                }
            }
        }
        .await;
        let mut state = self.inner.state.lock().await;
        // A newer stop owns the same lane until this operation has compensated
        // any late start. Its state/reservations must survive this completion.
        let owns = state
            .active
            .get(&ticket.id)
            .is_some_and(|active| active.generation == ticket.generation);
        if owns {
            state.active.remove(&ticket.id);
            state.candidates.remove(&ticket.id);
            match &result {
                Ok(()) => {
                    state.errors.remove(&ticket.id);
                    if !ticket.background {
                        if let Some(config) = state.configs.get(&ticket.id).cloned() {
                            state.recovery.track(ticket.id, config);
                        }
                    }
                }
                Err(error) if error.code == ErrorCode::OperationCancelled => {
                    state.errors.remove(&ticket.id);
                }
                Err(error) => {
                    state.errors.insert(ticket.id, error.clone());
                    if ticket.background {
                        state.recovery.failed(ticket.id, error);
                    }
                    // Preflight/repeated-start rejection can leave a verified
                    // healthy instance intact. Explicit failed replacement cannot.
                    else if starting
                        && state.observations.get(&ticket.id).is_some_and(|snapshot| {
                            snapshot.ready && snapshot.running == Some(true) && !snapshot.fatal
                        })
                    {
                        if let Some(config) = state.configs.get(&ticket.id).cloned() {
                            state.recovery.track(ticket.id, config);
                        }
                    }
                }
            }
        }
        publish(&mut state);
        result.map(|_| frame(&state))
    }
    async fn stop_instance(&self, id: Uuid) -> Result<()> {
        self.inner.backend.stop(id).await?;
        let mut state = self.inner.state.lock().await;
        state.configs.remove(&id);
        state.observations.remove(&id);
        state.errors.remove(&id);
        Ok(())
    }
    async fn start_instance(
        &self,
        ticket: &Ticket,
        id: Uuid,
        config: ConnectionConfig,
        restart: bool,
    ) -> Result<()> {
        let existing = self.inner.state.lock().await.observations.get(&id).cloned();
        if let Some(existing) = existing {
            if !restart && existing.running != Some(false) {
                return Err(CoreError::new(
                    ErrorCode::InstanceRunning,
                    "The instance is already active",
                ));
            }
            self.stop_instance(id).await?;
        }
        self.check(ticket).await?;
        let toml = crate::configuration::for_connection(id, &config)?;
        let started = if ticket.background {
            self.inner.backend.start_in_background(toml).await?
        } else {
            self.inner.backend.start(toml).await?
        };
        if started != id {
            self.inner.backend.stop(started).await?;
            return Err(CoreError::new(
                ErrorCode::ProtocolError,
                "Unexpected instance ID",
            ));
        }
        {
            // Keep ownership even if cancellation raced with the start reply.
            // If cleanup fails, this configuration still reserves its resources.
            let mut state = self.inner.state.lock().await;
            state.configs.insert(id, config);
            state.errors.remove(&id);
            state.order.retain(|item| *item != id);
            state.order.push(id);
            publish(&mut state);
        }
        if !self.current(ticket).await {
            self.stop_instance(id).await?;
            return Err(CoreError::new(
                ErrorCode::OperationCancelled,
                "A cancelled start was cleaned up",
            ));
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(12);
        loop {
            if !self.current(ticket).await {
                self.stop_instance(id).await?;
                return Err(CoreError::new(
                    ErrorCode::OperationCancelled,
                    "A cancelled start was cleaned up",
                ));
            }
            self.synchronize().await?;
            let observed = self.inner.state.lock().await.observations.get(&id).cloned();
            if let Some(snapshot) = observed {
                if snapshot.fatal || snapshot.running == Some(false) {
                    self.stop_instance(id).await?;
                    return Err(CoreError::new(
                        snapshot.issue.unwrap_or(ErrorCode::InstanceFailed),
                        "The instance failed to start",
                    ));
                }
                if snapshot.ready && snapshot.running == Some(true) {
                    let duplicate =
                        self.inner
                            .state
                            .lock()
                            .await
                            .observations
                            .values()
                            .any(|other| {
                                other.id != id
                                    && other.ready
                                    && snapshot.virtual_ip.is_some()
                                    && other.virtual_ip == snapshot.virtual_ip
                            });
                    if duplicate {
                        self.stop_instance(id).await?;
                        return Err(CoreError::new(
                            ErrorCode::AddressInUse,
                            "Another network uses this virtual address",
                        ));
                    }
                    if let Err(error) = self.check(ticket).await {
                        self.stop_instance(id).await?;
                        return Err(error);
                    }
                    return Ok(());
                }
            }
            if tokio::time::Instant::now() >= deadline {
                self.stop_instance(id).await?;
                return Err(CoreError::new(
                    ErrorCode::InstanceStartTimeout,
                    "The instance did not become ready",
                ));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    pub(super) async fn stop_collision(&self, id: Uuid, generation: u64) -> Result<()> {
        let ticket = {
            let mut state = self.inner.state.lock().await;
            if state.closing
                || state.active.contains_key(&id)
                || state.generations.get(&id).copied().unwrap_or(0) != generation
            {
                return Ok(());
            }
            admit(&mut state, &Operation::Stop { id }, false)?
        };
        let claimed_generation = ticket.generation;
        self.execute(ticket, Operation::Stop { id }).await?;
        let mut state = self.inner.state.lock().await;
        if state.generations.get(&id) != Some(&claimed_generation) {
            return Ok(());
        }
        state.errors.insert(
            id,
            CoreError::new(
                ErrorCode::AddressInUse,
                "Another network uses this virtual address",
            ),
        );
        publish(&mut state);
        Ok(())
    }
}
