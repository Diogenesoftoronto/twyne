//! Unconnected coordinator with bounded, generation-qualified request tickets.
//! Host result adoption still requires its own current entity/scope/revision CAS.
use super::{
    litert_lifecycle::{LiteRtConfig, LiteRtError, LiteRtProcessManager, LiteRtState},
    loopback_transport::{AiError, CompletionResult, LoopbackClient, validate_request},
    provider_types::{
        AiFeature, AiProviderType, AiSettingsRecord, ResolvedFeatureConfig, resolve_feature_config,
        resolve_feature_config_for_persona,
    },
    request::{AiRequestId, CancellationToken, CompletionRequest, RevisionIdentity},
    stream_accumulator::GenerationStreamSnapshot,
};
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
};
use uuid::Uuid;

pub const MAX_IN_FLIGHT: usize = 4;
pub const MAX_TERMINAL_TICKETS: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RequestTicket {
    pub request_id: AiRequestId,
    nonce: Uuid,
    epoch: Uuid,
    revision: Option<RevisionIdentity>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestTerminal {
    SucceededSynthetic,
    Failed,
    Cancelled,
    Stale,
}
struct InFlightEntry {
    ticket: RequestTicket,
    cancel: CancellationToken,
}
struct Registry {
    epoch: Uuid,
    active: Option<RevisionIdentity>,
    in_flight: HashMap<AiRequestId, InFlightEntry>,
    terminal: VecDeque<(RequestTicket, RequestTerminal)>,
}
impl Registry {
    fn current(&self, ticket: &RequestTicket) -> bool {
        self.epoch == ticket.epoch && self.active == ticket.revision
    }
    fn invalidate(&mut self) {
        self.epoch = Uuid::new_v4();
        let entries = self
            .in_flight
            .drain()
            .map(|(_, entry)| entry)
            .collect::<Vec<_>>();
        for entry in entries {
            entry.cancel.cancel();
            self.remember(entry.ticket, RequestTerminal::Stale);
        }
    }
    fn remember(&mut self, ticket: RequestTicket, state: RequestTerminal) {
        self.terminal.push_back((ticket, state));
        while self.terminal.len() > MAX_TERMINAL_TICKETS {
            self.terminal.pop_front();
        }
    }
}

pub struct NativeAiCoordinator {
    litert_manager: LiteRtProcessManager,
    settings: AiSettingsRecord,
    registry: Mutex<Registry>,
}
/// A synthetic result carrying the exact ticket needed for a later adoption guard.
#[derive(Clone, Debug)]
pub struct GuardedCompletion {
    pub ticket: RequestTicket,
    pub result: CompletionResult,
}

impl NativeAiCoordinator {
    pub fn new(config: LiteRtConfig, settings: AiSettingsRecord) -> Self {
        Self {
            litert_manager: LiteRtProcessManager::new(config),
            settings,
            registry: Mutex::new(Registry {
                epoch: Uuid::new_v4(),
                active: None,
                in_flight: HashMap::new(),
                terminal: VecDeque::new(),
            }),
        }
    }
    pub fn litert_manager(&self) -> &LiteRtProcessManager {
        &self.litert_manager
    }
    pub fn litert_manager_mut(&mut self) -> &mut LiteRtProcessManager {
        &mut self.litert_manager
    }
    pub fn litert_state(&self) -> &LiteRtState {
        self.litert_manager.state()
    }
    pub fn is_local_ai_ready(&self) -> bool {
        self.litert_manager.is_ready()
    }
    pub fn start_local_ai(&mut self) -> Result<Option<String>, LiteRtError> {
        self.litert_manager.start()
    }
    pub fn stop_local_ai(&mut self) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.invalidate();
        }
        self.litert_manager.stop();
    }
    pub fn update_settings(&mut self, settings: AiSettingsRecord) {
        if self.settings != settings {
            if let Ok(mut registry) = self.registry.lock() {
                registry.invalidate();
            }
            self.settings = settings;
        }
    }
    pub fn settings(&self) -> &AiSettingsRecord {
        &self.settings
    }
    pub fn resolve_feature(&self, feature: &AiFeature) -> Option<ResolvedFeatureConfig> {
        resolve_feature_config(&self.settings, feature)
    }
    pub fn resolve_feature_for_persona(
        &self,
        feature: &AiFeature,
        id: Option<&str>,
        model: Option<&str>,
        temperature: Option<f64>,
    ) -> Option<ResolvedFeatureConfig> {
        resolve_feature_config_for_persona(&self.settings, feature, id, model, temperature)
    }
    /// Constant-size host context boundary, never manuscript serialization.
    /// Revisit/settings changes invalidate old tickets even if the folio/gen returns.
    pub fn set_active_revision(&self, revision: Option<RevisionIdentity>) -> Result<(), AiError> {
        let mut registry = self.registry.lock().map_err(|_| AiError::StaleRequest)?;
        if registry.active != revision {
            registry.invalidate();
            registry.active = revision;
        }
        Ok(())
    }
    pub fn begin_request(&self, req: &CompletionRequest) -> Result<RequestTicket, AiError> {
        validate_request(req)?;
        let mut registry = self.registry.lock().map_err(|_| AiError::StaleRequest)?;
        if req.revision.is_none() || registry.active != req.revision {
            return Err(AiError::StaleRequest);
        }
        if registry.in_flight.contains_key(&req.request_id)
            || registry
                .terminal
                .iter()
                .any(|(t, _)| t.request_id == req.request_id)
        {
            return Err(AiError::DuplicateRequest);
        }
        if registry.in_flight.len() >= MAX_IN_FLIGHT {
            return Err(AiError::QueueFull);
        }
        let ticket = RequestTicket {
            request_id: req.request_id.clone(),
            nonce: Uuid::new_v4(),
            epoch: registry.epoch,
            revision: req.revision.clone(),
        };
        registry.in_flight.insert(
            req.request_id.clone(),
            InFlightEntry {
                ticket: ticket.clone(),
                cancel: req.cancel_token.clone(),
            },
        );
        Ok(ticket)
    }
    pub fn accepts_snapshot(&self, ticket: &RequestTicket) -> bool {
        self.registry.lock().ok().is_some_and(|registry| {
            registry.current(ticket)
                && registry
                    .in_flight
                    .get(&ticket.request_id)
                    .is_some_and(|entry| entry.ticket == *ticket && !entry.cancel.is_cancelled())
        })
    }
    /// Exact ticket match prevents an old completion/unwind from unregistering
    /// a replacement request. Terminal transition is accepted once only.
    pub fn finish_request(
        &self,
        ticket: &RequestTicket,
        outcome: RequestTerminal,
    ) -> Result<(), AiError> {
        let mut registry = self.registry.lock().map_err(|_| AiError::StaleRequest)?;
        let entry = registry
            .in_flight
            .get(&ticket.request_id)
            .ok_or(AiError::StaleRequest)?;
        if entry.ticket != *ticket {
            return Err(AiError::StaleRequest);
        }
        let state = if !registry.current(ticket) {
            RequestTerminal::Stale
        } else if entry.cancel.is_cancelled() {
            RequestTerminal::Cancelled
        } else {
            outcome
        };
        registry.in_flight.remove(&ticket.request_id);
        registry.remember(ticket.clone(), state);
        match state {
            RequestTerminal::Stale => Err(AiError::StaleRequest),
            RequestTerminal::Cancelled => Err(AiError::Cancelled),
            _ => Ok(()),
        }
    }
    pub fn can_apply_result(&self, ticket: &RequestTicket) -> bool {
        self.registry.lock().ok().is_some_and(|registry| {
            ticket.revision.is_some()
                && registry.current(ticket)
                && registry
                    .terminal
                    .iter()
                    .any(|(t, state)| t == ticket && *state == RequestTerminal::SucceededSynthetic)
        })
    }
    pub fn terminal_state(&self, ticket: &RequestTicket) -> Option<RequestTerminal> {
        self.registry
            .lock()
            .ok()?
            .terminal
            .iter()
            .find(|(t, _)| t == ticket)
            .map(|(_, state)| *state)
    }
    pub fn in_flight_count(&self) -> usize {
        self.registry.lock().map_or(0, |r| r.in_flight.len())
    }
    pub fn cancel_request(&self, id: &AiRequestId) -> bool {
        self.registry.lock().ok().is_some_and(|r| {
            r.in_flight.get(id).is_some_and(|e| {
                e.cancel.cancel();
                true
            })
        })
    }
    pub fn cancel_all_for_folio(&self, id: &str) -> usize {
        self.registry.lock().map_or(0, |r| {
            r.in_flight
                .values()
                .filter(|e| e.ticket.revision.as_ref().is_some_and(|v| v.folio_id == id))
                .map(|e| {
                    e.cancel.cancel();
                    1
                })
                .sum()
        })
    }
    pub fn is_revision_current(
        &self,
        expected: Option<&RevisionIdentity>,
        folio: &str,
        generation: u64,
    ) -> bool {
        expected.is_some_and(|revision| revision.is_current(folio, generation))
    }
    pub fn execute_request(&self, req: CompletionRequest) -> Result<CompletionResult, AiError> {
        let client = self.resolve_client(&req)?;
        let guard = FlightGuard::new(self, &req)?;
        let result = client.send_completion(&req);
        guard.finish(&result)?;
        result
    }
    pub fn execute_streaming_request<F>(
        &self,
        req: CompletionRequest,
        on_snapshot: F,
    ) -> Result<CompletionResult, AiError>
    where
        F: FnMut(&GenerationStreamSnapshot) -> bool,
    {
        let client = self.resolve_client(&req)?;
        let guard = FlightGuard::new(self, &req)?;
        let result = client.stream_completion(&req, on_snapshot);
        guard.finish(&result)?;
        result
    }
    /// Fixture-only captured bytes, not provider dispatch. The host must also
    /// guard its own UI entity and canonical candidate before adopting a result.
    pub fn execute_captured_request<F>(
        &self,
        req: CompletionRequest,
        chunks: &[&[u8]],
        mut callback: F,
    ) -> Result<GuardedCompletion, AiError>
    where
        F: FnMut(&GenerationStreamSnapshot) -> bool,
    {
        let client = self.resolve_client(&req)?;
        let guard = FlightGuard::new(self, &req)?;
        let result = client.decode_captured_response(&req, chunks, |snapshot| {
            self.accepts_snapshot(&guard.ticket)
                && callback(snapshot)
                && self.accepts_snapshot(&guard.ticket)
        });
        let ticket = guard.ticket.clone();
        guard.finish(&result)?;
        result.map(|result| GuardedCompletion { ticket, result })
    }
    fn resolve_client(&self, req: &CompletionRequest) -> Result<LoopbackClient, AiError> {
        validate_request(req)?;
        let providers: Vec<_> = self
            .settings
            .providers
            .iter()
            .filter(|p| p.id == req.provider_id)
            .collect();
        if providers.len() != 1 {
            return Err(AiError::InvalidRequest);
        }
        let provider = providers[0];
        if req.feature.is_voice_feature()
            || !provider.supports_feature(&req.feature)
            || provider.api_mode.as_deref().is_some_and(|m| m != "chat")
            || !matches!(
                provider.provider_type,
                AiProviderType::LiteRt | AiProviderType::Ollama | AiProviderType::OpenAiCompatible
            )
        {
            return Err(AiError::CapabilityUnavailable);
        }
        LoopbackClient::from_base_url(provider.base_url.as_deref().unwrap_or(""))
            .ok_or(AiError::CapabilityUnavailable)
    }
}
impl Drop for NativeAiCoordinator {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.invalidate();
        }
    }
}
struct FlightGuard<'a> {
    coordinator: &'a NativeAiCoordinator,
    ticket: RequestTicket,
    finished: bool,
}
impl<'a> FlightGuard<'a> {
    fn new(coordinator: &'a NativeAiCoordinator, req: &CompletionRequest) -> Result<Self, AiError> {
        Ok(Self {
            coordinator,
            ticket: coordinator.begin_request(req)?,
            finished: false,
        })
    }
    fn finish(mut self, result: &Result<CompletionResult, AiError>) -> Result<(), AiError> {
        let outcome = match result {
            Ok(_) => RequestTerminal::SucceededSynthetic,
            Err(AiError::Cancelled) => RequestTerminal::Cancelled,
            Err(AiError::StaleRequest) => RequestTerminal::Stale,
            Err(_) => RequestTerminal::Failed,
        };
        let outcome = self.coordinator.finish_request(&self.ticket, outcome);
        self.finished = true;
        outcome
    }
}
impl Drop for FlightGuard<'_> {
    fn drop(&mut self) {
        if !self.finished {
            let _ = self
                .coordinator
                .finish_request(&self.ticket, RequestTerminal::Failed);
        }
    }
}
