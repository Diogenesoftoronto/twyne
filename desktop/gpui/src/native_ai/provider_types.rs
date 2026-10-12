//! Typed BYOK/settings projections and pure routing. These values do not verify
//! account grants, credentials or connected capabilities. Serialization is a
//! redacted view projection; it is not a lossless settings backup envelope.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;

macro_rules! string_enum {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash)]
        pub enum $name {
            $($variant,)+
            Other(String),
        }

        impl $name {
            pub fn as_str(&self) -> &str {
                match self {
                    $(Self::$variant => $wire,)+
                    Self::Other(val) => val.as_str(),
                }
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(self.as_str())
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let s = String::deserialize(deserializer)?;
                Ok(match s.as_str() {
                    $($wire => Self::$variant,)+
                    _ => Self::Other(s),
                })
            }
        }
    };
}

string_enum!(AiProviderType {
    OpenAi => "openai",
    Anthropic => "anthropic",
    Google => "google",
    OpenAiCompatible => "openai-compatible",
    AnthropicCompatible => "anthropic-compatible",
    DeepSeek => "deepseek",
    OpenRouter => "openrouter",
    Ollama => "ollama",
    Zai => "zai",
    MiniMax => "minimax",
    LiteRt => "litert",
    FishAudio => "fishaudio",
    Supertonic => "supertonic",
});

impl AiProviderType {
    pub fn is_voice_only(&self) -> bool {
        matches!(self, Self::FishAudio | Self::Supertonic)
    }

    pub fn is_openai_compatible(&self) -> bool {
        matches!(
            self,
            Self::OpenAiCompatible
                | Self::DeepSeek
                | Self::OpenRouter
                | Self::Ollama
                | Self::Zai
                | Self::MiniMax
        )
    }

    pub fn supports_voice_narration(&self) -> bool {
        matches!(self, Self::OpenAi | Self::FishAudio | Self::Supertonic)
            || self.is_openai_compatible()
    }

    pub fn supports_voice_transcription(&self) -> bool {
        matches!(
            self,
            Self::OpenAi | Self::Google | Self::LiteRt | Self::FishAudio
        ) || self.is_openai_compatible()
    }
}

string_enum!(AiFeature {
    PersonaAnalysis => "persona-analysis",
    PersonaFeedback => "persona-feedback",
    PersonaReply => "persona-reply",
    PersonaRewrite => "persona-rewrite",
    CommentReply => "comment-reply",
    RubricReview => "rubric-review",
    RubricJudge => "rubric-judge",
    RoomSynthesis => "room-synthesis",
    ResearchExtract => "research-extract",
    ResearchWebSearch => "research-web-search",
    CitationFormat => "citation-format",
    SourceSummarize => "source-summarize",
    SourceDetectMissing => "source-detect-missing",
    VoiceNarration => "voice-narration",
    VoiceTranscription => "voice-transcription",
    InterviewTurn => "interview-turn",
    DossierCheck => "dossier-check",
    InFlowTool => "in-flow-tool",
});

impl AiFeature {
    pub fn is_voice_feature(&self) -> bool {
        matches!(self, Self::VoiceNarration | Self::VoiceTranscription)
    }

    pub fn default_temperature(&self) -> f64 {
        match self {
            Self::RubricJudge => 0.2,
            Self::RubricReview => 0.3,
            Self::PersonaAnalysis => 0.5,
            Self::RoomSynthesis => 0.4,
            Self::VoiceNarration | Self::VoiceTranscription => 0.4,
            Self::CitationFormat => 0.1,
            Self::SourceSummarize => 0.3,
            Self::SourceDetectMissing => 0.2,
            Self::ResearchWebSearch | Self::ResearchExtract => 0.2,
            _ => 0.4,
        }
    }
}

/// Provider configuration record.
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: AiProviderType,
    // A configured URL can itself contain a credential/query; do not serialize it.
    #[serde(default, skip_serializing)]
    pub base_url: Option<String>,
    /// Caller-held BYOK value, not a server vault. Never serialize or Debug it.
    #[serde(default, skip_serializing)]
    pub api_key: Option<String>,
    pub default_model: String,
    #[serde(default)]
    pub available_models: Vec<String>,
    #[serde(default)]
    pub model_modalities: HashMap<String, ModelModalities>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models_dev_id: Option<String>,
}

impl AiProviderConfig {
    pub fn new_litert(base_url: &str) -> Self {
        Self {
            id: "desktop-litert-local".to_string(),
            name: "Local — MiniCPM5-2B".to_string(),
            provider_type: AiProviderType::LiteRt,
            base_url: Some(base_url.to_string()),
            api_key: Some("local".to_string()),
            default_model: "minicpm5-2b".to_string(),
            available_models: vec!["minicpm5-2b".to_string()],
            model_modalities: HashMap::new(),
            api_mode: None,
            models_dev_id: None,
        }
    }

    pub fn supports_feature(&self, feature: &AiFeature) -> bool {
        match feature {
            AiFeature::VoiceNarration => self.provider_type.supports_voice_narration(),
            AiFeature::VoiceTranscription => {
                self.provider_type.supports_voice_transcription() || self.is_tinker()
            }
            _ => !self.provider_type.is_voice_only(),
        }
    }
}

/// Per-feature overrides configured in Settings.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiFeatureOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

/// User's AI settings record.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_provider_id: Option<String>,
    #[serde(default)]
    pub providers: Vec<AiProviderConfig>,
    #[serde(default)]
    pub per_feature: HashMap<AiFeature, AiFeatureOverride>,
}

/// Effective resolved configuration for a specific feature invocation.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedFeatureConfig {
    pub provider: AiProviderConfig,
    pub model: String,
    pub temperature: f64,
    pub max_tokens: Option<u32>,
}

/// Resolve the effective provider, model, temperature and token cap for a feature.
/// Source routing over an already normalized settings projection. Managed
/// provider injection/stripping and lossless settings persistence are outside
/// this subset; they are not approximated here.
pub fn resolve_feature_config(
    settings: &AiSettingsRecord,
    feature: &AiFeature,
) -> Option<ResolvedFeatureConfig> {
    let eligible: Vec<&AiProviderConfig> = settings
        .providers
        .iter()
        .filter(|p| p.supports_feature(feature))
        .collect();

    if eligible.is_empty() {
        return None;
    }

    let override_cfg = settings.per_feature.get(feature);

    let overridden = override_cfg
        .and_then(|ov| ov.provider_id.as_deref())
        .and_then(|id| eligible.iter().find(|p| p.id == id).copied());

    let preferred = overridden
        .or_else(|| {
            settings
                .default_provider_id
                .as_deref()
                .and_then(|id| eligible.iter().find(|p| p.id == id).copied())
        })
        .or_else(|| eligible.first().copied())?;

    let model = override_cfg
        .and_then(|ov| ov.model.clone())
        .unwrap_or_else(|| preferred.default_model_for_feature(feature));

    let temperature = override_cfg
        .and_then(|ov| ov.temperature)
        .unwrap_or_else(|| feature.default_temperature());

    let max_tokens = override_cfg.and_then(|ov| ov.max_tokens);

    Some(ResolvedFeatureConfig {
        provider: preferred.clone(),
        model,
        temperature,
        max_tokens,
    })
}

/// Resolve feature configuration with persona-level overrides.
/// Source persona routing over the same normalized-input subset.
pub fn resolve_feature_config_for_persona(
    settings: &AiSettingsRecord,
    feature: &AiFeature,
    persona_provider_id: Option<&str>,
    persona_model: Option<&str>,
    persona_temperature: Option<f64>,
) -> Option<ResolvedFeatureConfig> {
    let base = resolve_feature_config(settings, feature)?;

    let persona_provider =
        persona_provider_id.and_then(|id| settings.providers.iter().find(|p| p.id == id));

    let provider = persona_provider.cloned().unwrap_or(base.provider);

    let model = persona_model.map(String::from).unwrap_or_else(|| {
        if persona_provider.is_some() {
            provider.default_model.clone()
        } else {
            base.model
        }
    });

    let temperature = persona_temperature.unwrap_or(base.temperature);

    Some(ResolvedFeatureConfig {
        provider,
        model,
        temperature,
        max_tokens: base.max_tokens,
    })
}

/// True if any provider capable of language/text generation is configured.
pub fn has_configured_ai_provider(settings: &AiSettingsRecord) -> bool {
    settings
        .providers
        .iter()
        .any(|p| !p.provider_type.is_voice_only())
}

/// True if any provider capable of voice narration or transcription is configured.
pub fn has_configured_voice_provider(settings: &AiSettingsRecord) -> bool {
    settings.providers.iter().any(|p| {
        p.provider_type.supports_voice_narration()
            || p.provider_type.supports_voice_transcription()
            || p.is_tinker()
    })
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ModelModalities {
    pub input: Vec<String>,
    pub output: Vec<String>,
}

impl std::fmt::Debug for AiProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AiProviderConfig")
            .field("configured", &true)
            .field(
                "has_credential",
                &self.api_key.as_ref().is_some_and(|k| !k.is_empty()),
            )
            .field("has_endpoint", &self.base_url.is_some())
            .field("model_count", &self.available_models.len())
            .finish_non_exhaustive()
    }
}

impl AiProviderConfig {
    fn is_tinker(&self) -> bool {
        self.base_url
            .as_deref()
            .and_then(|s| url::Url::parse(s).ok())
            .and_then(|u| u.host_str().map(str::to_owned))
            .is_some_and(|h| h == "tinker.thinkingmachines.dev")
    }
    fn accepts_direct_audio(&self) -> bool {
        if let Some(m) = self.model_modalities.get(&self.default_model) {
            return m.input.iter().any(|v| v == "audio") && m.output.iter().any(|v| v == "text");
        }
        if matches!(
            self.provider_type,
            AiProviderType::Google | AiProviderType::LiteRt
        ) {
            return true;
        }
        let model = self.default_model.to_lowercase();
        ["inkling", "gemma", "gemini", "audio", "omni"]
            .iter()
            .any(|name| model.contains(name))
    }
    fn default_model_for_feature(&self, feature: &AiFeature) -> String {
        if *feature == AiFeature::VoiceTranscription && self.accepts_direct_audio() {
            return self.default_model.clone();
        }
        if self.provider_type == AiProviderType::OpenAi || self.provider_type.is_openai_compatible()
        {
            if *feature == AiFeature::VoiceNarration {
                return "gpt-4o-mini-tts".into();
            }
            if *feature == AiFeature::VoiceTranscription {
                return "gpt-4o-mini-transcribe".into();
            }
        }
        if self.provider_type == AiProviderType::FishAudio {
            return if *feature == AiFeature::VoiceTranscription {
                "asr-1"
            } else {
                "s2-pro"
            }
            .into();
        }
        self.default_model.clone()
    }
}
