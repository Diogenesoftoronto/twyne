//! Speech requests, queue options, persona voice resolution, and voice menus.
//!
//! Preserves note authorship, cast identity, and voice direction across providers.
//! Mirrors `SpeakRequest` and persona contracts in `src/utils/speech.ts`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Standard voices accepted by OpenAI-compatible speech APIs.
pub const OPENAI_SPEECH_VOICES: &[&str] = &[
    "alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse",
    "marin", "cedar",
];

/// A single passage to read aloud.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakRequest {
    /// Stable id for the item being read (note ID, commentary ID, etc.).
    pub id: String,
    /// Prose to narrate. Empty or whitespace-only text is rejected.
    pub text: String,
    /// UTF-16 code-unit offset in the original document, when reading a marked selection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_offset: Option<usize>,
    /// Fallback voice name, e.g. "alloy", "onyx".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice: Option<String>,
    /// Per-provider voice overrides (e.g. fishaudio -> 32-char hex model id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voices: Option<BTreeMap<String, String>>,
    /// Voice direction or persona lore to guide narration delivery.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// Display title for the reading (e.g. "Marguerite", "The Room's Verdict").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Author who authored the note or feedback. Used to resolve cast voice when only author is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// When true, split long manuscripts into progressive semantic chunks.
    #[serde(default)]
    pub progressive: bool,
    /// Caller-held freshness/generation token.
    #[serde(skip)]
    pub generation: u64,
}

impl SpeakRequest {
    pub fn new(id: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            text: text.into(),
            source_offset: None,
            voice: None,
            voices: None,
            instructions: None,
            label: None,
            author: None,
            progressive: false,
            generation: 0,
        }
    }

    pub fn with_author(mut self, author: impl Into<String>) -> Self {
        self.author = Some(author.into());
        self
    }

    pub fn with_voice(mut self, voice: impl Into<String>) -> Self {
        self.voice = Some(voice.into());
        self
    }

    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn with_source_offset(mut self, offset: usize) -> Self {
        self.source_offset = Some(offset);
        self
    }

    pub fn with_progressive(mut self, progressive: bool) -> Self {
        self.progressive = progressive;
        self
    }

    pub fn is_blank(&self) -> bool {
        super::segment::trim_ecmascript(&self.text).is_empty()
    }
}

/// Options when launching a queue of multiple passages.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakQueueOptions {
    pub start_index: usize,
    pub owner_id: Option<String>,
}

/// Persona voice metadata representing the editorial cast.
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaVoice {
    pub id: String,
    pub name: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_voice: Option<String>,
    pub provider_voices: BTreeMap<String, String>,
    pub instructions: String,
}

/// Built-in personas matching `PERSONAS` in `src/utils/personas.ts`.
pub fn default_personas() -> Vec<PersonaVoice> {
    serde_json::from_str(include_str!("resident_personas.json"))
        .expect("TS-produced original resident persona metadata")
}

/// Pick the voice name for whichever provider will actually serve this request.
///
/// Falls back to the generic name when the provider has no specific entry, and
/// the generic fallback remains available when no provider is selected.
pub fn pick_voice_for_provider(
    voices: &BTreeMap<String, String>,
    fallback: Option<&str>,
    provider_type: Option<&str>,
) -> Option<String> {
    if let Some(p) = provider_type
        && let Some(v) = voices.get(p).filter(|value| !value.is_empty())
    {
        return Some(v.clone());
    }
    fallback.map(|s| s.to_string())
}

/// Map generic voice names to Supertonic embedding IDs when using browser/local TTS.
pub fn resolve_supertonic_voice(selected: Option<&str>, default_fallback: &str) -> String {
    match selected {
        Some("onyx") => "M1".to_string(),
        Some("shimmer") => "F1".to_string(),
        Some("echo") => "M2".to_string(),
        Some("ash") => "F2".to_string(),
        Some("alloy") => "M3".to_string(),
        Some(custom) => custom.to_string(),
        _ => default_fallback.to_string(),
    }
}

/// Fill in voice and instructions from the persona cast when only an author name is provided.
pub fn with_persona_voice(request: &SpeakRequest, cast: &[PersonaVoice]) -> SpeakRequest {
    if request.author.is_none() {
        return request.clone();
    }
    if request.voice.as_ref().is_some_and(|v| !v.is_empty())
        && request.voices.is_some()
        && request.instructions.as_ref().is_some_and(|v| !v.is_empty())
    {
        return request.clone();
    }
    let author_raw =
        super::segment::trim_ecmascript(request.author.as_ref().unwrap()).to_lowercase();
    if author_raw.is_empty() {
        return request.clone();
    }

    let found = cast.iter().find(|p| {
        let name = super::segment::trim_ecmascript(&p.name).to_lowercase();
        let id = p.id.to_lowercase();
        let role = p.role.to_lowercase();
        name == author_raw || id == author_raw || role == author_raw
    });

    if let Some(p) = found {
        let mut cloned = request.clone();
        if cloned.voice.is_none() {
            cloned.voice = p.default_voice.clone();
        }
        if cloned.voices.is_none() {
            cloned.voices = Some(p.provider_voices.clone());
        }
        if cloned.instructions.is_none() {
            cloned.instructions = Some(p.instructions.clone());
        }
        cloned
    } else {
        request.clone()
    }
}

/// Single voice option in the UI voice selection menu.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechVoiceOption {
    pub id: String,
    pub label: String,
}

/// Available voices for the active narration provider.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechVoiceMenu {
    pub provider: String,
    pub model: String,
    pub selected: String,
    pub options: Vec<SpeechVoiceOption>,
    pub allows_custom: bool,
}

impl std::fmt::Debug for SpeakRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SpeakRequest { private data redacted }")
    }
}

impl std::fmt::Debug for PersonaVoice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PersonaVoice { private data redacted }")
    }
}
