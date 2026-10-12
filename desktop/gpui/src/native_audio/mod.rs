//! Native audio and speech transport foundation for Twyne desktop.
//!
//! Provides:
//!   - Source-backed speech narration transport state (`SpeechState`, `SpeechStatus`).
//!   - Single-voice playback queue and three-second grace rule.
//!   - Independent audio-only controllers; host owns consent/provider/UI arbitration.
//!   - Content-addressed clip cache (`MAX_CACHED_CLIPS = 24`) and generation-keyed work bookkeeping.
//!   - Generation tokens guarding against stale or late provider responses.
//!   - Native 16-bit linear PCM and 24,000 Hz Live Voice framing.
//!   - Live output queue guard (>5s ahead of actual output clock).
//!   - Hardware traits and deterministic mocks; no physical backend/provider exists.
//!   - UTF-16 Source fallback chunks and exact supplied Intl-chunk validation.

pub mod alignment;
pub mod backend;
pub mod cache;
pub mod live_voice;
pub mod pcm;
pub mod request;
pub mod segment;
pub mod state;
pub mod transport;

pub use alignment::{
    FishTimestampEvent, SpeechAlignmentSnapshot, alignment_range_at_source_offset,
    alignment_range_at_time, map_fish_timestamp_event,
};
pub use backend::{
    AudioBackend, AudioBackendError, AudioSink, AudioSource, MockAudioSink, MockAudioSource,
    MockLoopbackBackend,
};
pub use cache::{CachedClip, MAX_CACHED_CLIPS, SpeechClipCache, compute_cache_key};
pub use live_voice::{MAX_PLAYBACK_LAG_SECONDS, NativeLiveVoiceSession};
pub use pcm::{
    LIVE_CHUNK_BYTES, LIVE_CHUNK_SAMPLES, LIVE_SAMPLE_RATE, LivePcmFramer, PcmFormat,
    calculate_rms_level, chunk_pcm_samples, decode_wav_bytes, encode_wav_bytes, f32_to_i16,
    generate_synthetic_silence, generate_synthetic_tone, i16_to_f32, i16_to_pcm_bytes,
    pcm_bytes_to_i16, validate_pcm_bytes,
};
pub use request::{
    OPENAI_SPEECH_VOICES, PersonaVoice, SpeakQueueOptions, SpeakRequest, SpeechVoiceMenu,
    SpeechVoiceOption, default_personas, pick_voice_for_provider, resolve_supertonic_voice,
    with_persona_voice,
};
pub use segment::{
    DEFAULT_MAX_CHARS, DEFAULT_TARGET_WORDS, SpeechSegmentationOptions, SpeechTextSegment,
    segment_speech_text, slice_utf16, validate_source_segments,
};
pub use state::{
    AudioAppError, AudioAppRecovery, AudioRecoveryAction, LiveAction, LiveActionKind,
    LiveVoiceSource, LiveVoiceState, LiveVoiceStatus, SpeechAlignmentRange, SpeechState,
    SpeechStatus,
};
pub use transport::{NativeSpeechTransport, SpeechLoadRequest, SpeechProviderConfig};
