//! Application-wide speech and live voice transport states, statuses, and error taxonomy.
//!
//! Mirrors the contracts established in `src/utils/speech.ts`, `src/utils/live-voice.ts`,
//! and `src/types/application-errors.ts`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Status of the single-playback speech narration transport.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SpeechStatus {
    #[default]
    Idle,
    Loading,
    Playing,
    Paused,
    Error,
}

impl SpeechStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Loading => "loading",
            Self::Playing => "playing",
            Self::Paused => "paused",
            Self::Error => "error",
        }
    }
}

/// Serializable error recovery action for application and device errors.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioRecoveryAction {
    #[default]
    None,
    FixInput,
    DownloadRequired,
    Retry,
    RetryLater,
    CheckConnection,
    CheckConfiguration,
    ChooseProvider,
    SignIn,
    ContactSupport,
}

/// Recovery instruction attached to an `AudioAppError`.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAppRecovery {
    pub action: AudioRecoveryAction,
    pub can_retry: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

/// Structured application error matching `AppError` in `src/types/application-errors.ts`.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct AudioAppError(Box<AudioAppErrorDetails>);

/// Keep the uncommon error payload off every audio result's stack frame while
/// preserving its serialized shape and the existing field accessors.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAppErrorDetails {
    pub code: String,
    pub message: String,
    pub reference_id: String,
    pub source: String,
    pub recovery: AudioAppRecovery,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, String>,
}

impl std::ops::Deref for AudioAppError {
    type Target = AudioAppErrorDetails;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for AudioAppError {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl AudioAppError {
    /// Never copy arbitrary provider/device text into UI state or diagnostics.
    /// Mirrors Source normalizeApplicationError's reviewed-message boundary.
    pub fn new(
        code: impl Into<String>,
        _raw_message: impl Into<String>,
        source: impl Into<String>,
    ) -> Self {
        let code = code.into();
        let source = source.into();
        let (code, message) = match code.as_str() {
            "VALIDATION_FAILED" => (
                "VALIDATION_FAILED",
                "Check the highlighted information and try again.",
            ),
            "AUTHENTICATION_REQUIRED" => ("AUTHENTICATION_REQUIRED", "Sign in to continue."),
            "AUTHENTICATION_FAILED" => (
                "AUTHENTICATION_FAILED",
                "We could not verify your sign-in. Please try again.",
            ),
            "PERMISSION_DENIED" => (
                "PERMISSION_DENIED",
                "You do not have permission to do that.",
            ),
            "NOT_FOUND" => ("NOT_FOUND", "The requested item could not be found."),
            "CONFLICT" => ("CONFLICT", "This changed elsewhere. Refresh and try again."),
            "RATE_LIMITED" => (
                "RATE_LIMITED",
                "Too many requests. Please wait and try again.",
            ),
            "TIMEOUT" => ("TIMEOUT", "The request took too long. Please try again."),
            "NETWORK_UNAVAILABLE" => (
                "NETWORK_UNAVAILABLE",
                "We could not reach the service. Check your connection and try again.",
            ),
            "CONFIGURATION_ERROR" => (
                "CONFIGURATION_ERROR",
                "This feature is not configured correctly. Choose another option or contact support.",
            ),
            "PROVIDER_ERROR" => (
                "PROVIDER_ERROR",
                "The selected provider could not complete the request. Please try again.",
            ),
            "MALFORMED_RESPONSE" => (
                "MALFORMED_RESPONSE",
                "The service returned an invalid response. Please try again.",
            ),
            _ => (
                "INTERNAL_ERROR",
                "Something went wrong. Please try again or contact support with the reference ID.",
            ),
        };
        let source = match source.as_str() {
            "application" | "validation" | "convex" | "auth" | "fetch" | "provider" | "unknown" => {
                source
            }
            _ => "unknown".to_owned(),
        };
        Self(Box::new(AudioAppErrorDetails {
            code: code.to_owned(),
            message: message.to_owned(),
            source,
            reference_id: format!("audio-err-{}", uuid_stub()),
            recovery: AudioAppRecovery::default(),
            status: None,
            metadata: BTreeMap::new(),
        }))
    }
    fn recovery_error(
        code: &str,
        source: &str,
        operation: &str,
        action: AudioRecoveryAction,
        can_retry: bool,
    ) -> Self {
        let mut error = Self::new(code, "", source);
        error.recovery = AudioAppRecovery {
            action,
            can_retry,
            retry_after_ms: None,
        };
        error
            .metadata
            .insert("feature".to_owned(), "voice-narration".to_owned());
        if matches!(
            operation,
            "synthesize"
                | "playback"
                | "decode"
                | "initialize_sink"
                | "start_live_voice_capture"
                | "start_live_voice_playback"
                | "start_capture_stream"
                | "live_voice_play"
                | "pause"
                | "seek"
                | "stop"
        ) {
            error
                .metadata
                .insert("operation".to_owned(), operation.to_owned());
        }
        error
    }
    pub fn configuration_error(_raw: impl Into<String>) -> Self {
        Self::recovery_error(
            "CONFIGURATION_ERROR",
            "application",
            "synthesize",
            AudioRecoveryAction::ChooseProvider,
            false,
        )
    }
    pub fn permission_denied(_raw: impl Into<String>, operation: &str) -> Self {
        Self::recovery_error(
            "PERMISSION_DENIED",
            "application",
            operation,
            AudioRecoveryAction::Retry,
            true,
        )
    }
    pub fn provider_error(_raw: impl Into<String>, operation: &str) -> Self {
        Self::recovery_error(
            "PROVIDER_ERROR",
            "provider",
            operation,
            AudioRecoveryAction::Retry,
            true,
        )
    }
    pub fn device_error(_raw: impl Into<String>, operation: &str) -> Self {
        Self::recovery_error(
            "INTERNAL_ERROR",
            "application",
            operation,
            AudioRecoveryAction::Retry,
            true,
        )
    }
    pub fn playback_fell_behind() -> Self {
        let mut error = Self::device_error("", "playback");
        // Exact reviewed literal thrown by the original liveVoiceAudio.
        error.message = "Speech playback fell behind. Reconnect to continue.".to_owned();
        error
    }
    pub fn invalid_audio(_raw: impl Into<String>) -> Self {
        let mut error = Self::recovery_error(
            "VALIDATION_FAILED",
            "validation",
            "decode",
            AudioRecoveryAction::FixInput,
            false,
        );
        error.message = "Invalid Live audio.".to_owned();
        error
    }
    pub fn safe_for_state(&self) -> Self {
        let mut safe = Self::new(&self.code, "", &self.source);
        safe.recovery = self.recovery.clone();
        safe.status = self.status;
        // Reference IDs and message/metadata from arbitrary callers are not trusted.
        for (key, value) in &self.metadata {
            if key == "feature"
                && matches!(
                    value.as_str(),
                    "voice-narration" | "native-audio" | "voice-live"
                )
            {
                safe.metadata.insert(key.clone(), value.clone());
            }
        }
        safe
    }
}

/// Process-local diagnostic references; no provider credentials or request text.
fn uuid_stub() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1001);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// Timing alignment range for follow-along text highlighting.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAlignmentRange {
    pub source_start: usize,
    pub source_end: usize,
    pub audio_start: f64,
    pub audio_end: f64,
    pub precision: String, // "word" or "segment"
}

/// The authoritative, observable state of the application-wide speech manager.
/// Mirrors `SpeechState` in `src/utils/speech.ts`.
#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechState {
    pub status: SpeechStatus,
    pub id: Option<String>,
    pub error: Option<AudioAppError>,
    pub current_time: f64,
    pub duration: f64,
    pub owner_id: Option<String>,
    pub queue_index: usize,
    pub queue_length: usize,
    pub label: Option<String>,
    pub voice: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub alignment: Vec<SpeechAlignmentRange>,
    pub alignment_provider: Option<String>,
}

impl SpeechState {
    pub fn reset_to_idle(&mut self) {
        self.status = SpeechStatus::Idle;
        self.id = None;
        self.error = None;
        self.current_time = 0.0;
        self.duration = 0.0;
        self.owner_id = None;
        self.queue_index = 0;
        self.queue_length = 0;
        self.label = None;
        self.voice = None;
        self.provider = None;
        self.model = None;
        self.alignment.clear();
        self.alignment_provider = None;
    }
}

/// Status of the full-duplex live voice conversational session.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LiveVoiceStatus {
    #[default]
    Idle,
    Connecting,
    Listening,
    Speaking,
    Closing,
    Error,
}

impl LiveVoiceStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Connecting => "connecting",
            Self::Listening => "listening",
            Self::Speaking => "speaking",
            Self::Closing => "closing",
            Self::Error => "error",
        }
    }
}

/// Observable state of the live voice session. Mirrors `LiveVoiceState` in `src/utils/live-voice.ts`.
#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveVoiceState {
    pub status: LiveVoiceStatus,
    pub author: String,
    pub muted: bool,
    pub level: f32,
    pub started_at: u64,
    pub user_transcript: String,
    pub assistant_transcript: String,
    pub notice: String,
    pub error: String,
    pub pending: Option<LiveAction>,
    pub working: bool,
    pub finalized: bool,
    pub sources: Vec<LiveVoiceSource>,
}

impl Default for LiveVoiceState {
    fn default() -> Self {
        Self {
            status: LiveVoiceStatus::Idle,
            author: "Le Lecteur".to_string(),
            muted: false,
            level: 0.0,
            started_at: 0,
            user_transcript: String::new(),
            assistant_transcript: String::new(),
            notice: String::new(),
            error: String::new(),
            pending: None,
            working: false,
            finalized: false,
            sources: Vec::new(),
        }
    }
}

/// Retained Source proposal shape. This DTO does not execute/apply any action.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct LiveAction {
    pub kind: LiveActionKind,
    pub text: String,
    pub original: String,
    pub target: String,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LiveActionKind {
    Answer,
    Find,
    Replace,
    Append,
    Research,
    Open,
    Apply,
    Discard,
}
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct LiveVoiceSource {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

impl std::fmt::Debug for AudioAppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AudioAppError { private data redacted }")
    }
}

impl std::fmt::Debug for SpeechState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SpeechState { private data redacted }")
    }
}

impl std::fmt::Debug for LiveVoiceState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LiveVoiceState { private data redacted }")
    }
}

impl std::fmt::Debug for LiveAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LiveAction { private data redacted }")
    }
}

impl std::fmt::Debug for LiveVoiceSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LiveVoiceSource { private data redacted }")
    }
}
