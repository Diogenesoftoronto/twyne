//! Unconnected native AI foundation. Safe DTO projections, scoped
//! request tickets, explicit LiteRT plans and bounded synthetic HTTP/SSE decoding
//! do not establish real provider, model, device, authenticated session or UI proof.

pub mod contract_extractors;
pub mod coordinator;
pub mod litert_lifecycle;
pub mod loopback_transport;
pub mod provider_types;
pub mod request;
pub mod stream_accumulator;

// Public re-exports
pub use contract_extractors::{
    JudgeOutput, ResearchTarget, ResearchTargetKind, clamp_score, extract_first_json_object,
    extract_tagged_json, parse_judge_output, parse_research_targets, strip_json_fences,
};
pub use coordinator::{
    GuardedCompletion, MAX_IN_FLIGHT, NativeAiCoordinator, RequestTerminal, RequestTicket,
};
pub use litert_lifecycle::{
    DEFAULT_BIN_PATH, DEFAULT_MODEL_PATH, LOCAL_MODEL_ID, LOCAL_PROVIDER_ID, LiteRtConfig,
    LiteRtError, LiteRtLaunchPlan, LiteRtProcessManager, LiteRtServerHandle, LiteRtState,
    allocate_free_port, is_port_accepting_connections,
};
pub use loopback_transport::{AiError, CompletionEvidence, CompletionResult, LoopbackClient};
pub use provider_types::{
    AiFeature, AiFeatureOverride, AiProviderConfig, AiProviderType, AiSettingsRecord,
    ModelModalities, ResolvedFeatureConfig, has_configured_ai_provider,
    has_configured_voice_provider, resolve_feature_config, resolve_feature_config_for_persona,
};
pub use request::{
    AiRequestId, CancellationToken, ChatMessage, CompletionRequest, RevisionIdentity, TraceId,
};
pub use stream_accumulator::{
    ActivePart, GenerationStreamAccumulator, GenerationStreamInput, GenerationStreamSnapshot,
    InterviewStreamPhase, InterviewStreamSnapshot, StreamPartStatus, StreamRunStatus,
    create_interview_stream_snapshot, extract_tagged_reasoning, filter_interview_stream_markers,
    has_open_reasoning_block, has_reasoning_tags, remove_reasoning_tag_markers,
    snapshot_from_record, strip_reasoning_tags, text_snapshot, trim_partial_reasoning_tag,
};

#[cfg(test)]
#[path = "../../fixtures/native-ai/runtime-review/runtime-tests.rs"]
mod runtime_tests;
