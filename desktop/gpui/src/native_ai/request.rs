//! Native request metadata and cancellation; no provider/session authority.
//! Timeout/byte limits below are explicit native policies, not Source token budgets.

use super::provider_types::AiFeature;
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const MAX_REQUEST_BODY_BYTES: usize = 4 * 1024 * 1024; // 4 MiB
pub const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024; // 8 MiB
pub const DEFAULT_TIMEOUT_MS: u64 = 60_000;
pub const RESEARCH_TIMEOUT_MS: u64 = 30_000;

/// Unique request identifier for logging, cancellation, and in-flight tracking.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AiRequestId(pub String);

impl AiRequestId {
    pub fn new() -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        Self(format!("req-{now}-{}", Uuid::new_v4()))
    }
}

impl Default for AiRequestId {
    fn default() -> Self {
        Self::new()
    }
}

/// Native trace label, not an exact port of the Source random trace-ID format.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TraceId(pub String);

impl TraceId {
    pub fn new(prefix: &str) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        Self(format!("{prefix}-{now}-{}", Uuid::new_v4()))
    }
}

/// Manuscript identity at request dispatch time.
/// Used to detect if the user continued typing or saved a new revision while the
/// request was in flight, avoiding applying stale results to new text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevisionIdentity {
    pub folio_id: String,
    pub generation: u64,
}

impl RevisionIdentity {
    pub fn new(folio_id: impl Into<String>, generation: u64) -> Self {
        Self {
            folio_id: folio_id.into(),
            generation,
        }
    }

    /// Check if this request's revision matches the current active document revision.
    pub fn is_current(&self, active_folio_id: &str, active_generation: u64) -> bool {
        self.folio_id == active_folio_id && self.generation == active_generation
    }
}

/// Thread-safe cancellation token for halting inflight HTTP streams and child jobs.
#[derive(Clone, Debug)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// Chat message in OpenAI-compatible format.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".into(),
            content: content.into(),
        }
    }
}

/// Concrete completion request to be executed by a provider adapter.
#[derive(Clone)]
pub struct CompletionRequest {
    pub request_id: AiRequestId,
    pub trace_id: Option<TraceId>,
    pub revision: Option<RevisionIdentity>,
    pub feature: AiFeature,
    pub provider_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: f64,
    pub max_tokens: Option<u32>,
    pub stream: bool,
    pub timeout: Duration,
    pub cancel_token: CancellationToken,
}

impl CompletionRequest {
    pub fn new(
        feature: AiFeature,
        provider_id: impl Into<String>,
        model: impl Into<String>,
        messages: Vec<ChatMessage>,
    ) -> Self {
        let temp = feature.default_temperature();
        let timeout = if matches!(
            feature,
            AiFeature::ResearchExtract | AiFeature::ResearchWebSearch
        ) {
            Duration::from_millis(RESEARCH_TIMEOUT_MS)
        } else {
            Duration::from_millis(DEFAULT_TIMEOUT_MS)
        };

        Self {
            request_id: AiRequestId::new(),
            trace_id: None,
            revision: None,
            feature,
            provider_id: provider_id.into(),
            model: model.into(),
            messages,
            temperature: temp,
            max_tokens: None,
            stream: false,
            timeout,
            cancel_token: CancellationToken::new(),
        }
    }

    pub fn with_revision(mut self, folio_id: impl Into<String>, generation: u64) -> Self {
        self.revision = Some(RevisionIdentity::new(folio_id, generation));
        self
    }

    pub fn with_trace(mut self, trace_prefix: &str) -> Self {
        self.trace_id = Some(TraceId::new(trace_prefix));
        self
    }

    pub fn with_temperature(mut self, temperature: f64) -> Self {
        self.temperature = temperature;
        self
    }

    pub fn with_max_tokens(mut self, max_tokens: Option<u32>) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    pub fn with_streaming(mut self, stream: bool) -> Self {
        self.stream = stream;
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_cancel_token(mut self, cancel_token: CancellationToken) -> Self {
        self.cancel_token = cancel_token;
        self
    }

    /// Calculate approximate payload size to enforce byte bounds.
    pub fn estimated_bytes(&self) -> usize {
        self.messages
            .iter()
            .fold(self.model.len().saturating_add(128), |size, m| {
                size.saturating_add(m.role.len())
                    .saturating_add(m.content.len())
                    .saturating_add(32)
            })
    }
}

impl std::fmt::Debug for ChatMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatMessage")
            .field(
                "role",
                &match self.role.as_str() {
                    "system" | "user" | "assistant" | "tool" => self.role.as_str(),
                    _ => "[unrecognized]",
                },
            )
            .field("content_bytes", &self.content.len())
            .finish()
    }
}

impl std::fmt::Debug for CompletionRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CompletionRequest")
            .field("has_revision", &self.revision.is_some())
            .field("message_count", &self.messages.len())
            .field("estimated_bytes", &self.estimated_bytes())
            .field("stream", &self.stream)
            .field("cancelled", &self.cancel_token.is_cancelled())
            .finish_non_exhaustive()
    }
}

pub(crate) fn js_space(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
pub(crate) fn js_trim(value: &str) -> &str {
    value.trim_matches(js_space)
}
