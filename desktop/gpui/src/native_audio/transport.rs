//! Narration queue foundation with exact pending identity and callback guards.
//! No synthesis, credentials, encoded-audio decoder, or physical backend exists here.
use super::{
    backend::{AudioBackend, AudioSink},
    cache::{CachedClip, SpeechClipCache, compute_cache_key},
    request::{
        OPENAI_SPEECH_VOICES, PersonaVoice, SpeakQueueOptions, SpeakRequest, SpeechVoiceMenu,
        SpeechVoiceOption, default_personas, pick_voice_for_provider, resolve_supertonic_voice,
        with_persona_voice,
    },
    segment::{
        SpeechSegmentationOptions, SpeechTextSegment, segment_speech_text, trim_ecmascript,
        validate_source_segments,
    },
    state::{AudioAppError, SpeechState, SpeechStatus},
};
use std::collections::BTreeMap;

/// Identity is the configured Source provider ID, never its API key.
#[derive(Clone, PartialEq)]
pub struct SpeechProviderConfig {
    pub identity: String,
    pub kind: String,
    pub model: String,
    pub name: Option<String>,
    pub response_format: String,
    pub speed: Option<f64>,
    pub voice: Option<String>,
    pub instructions: Option<String>,
}
impl SpeechProviderConfig {
    pub fn new(
        identity: impl Into<String>,
        kind: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            identity: identity.into(),
            kind: kind.into(),
            model: model.into(),
            name: None,
            response_format: "mp3".to_owned(),
            speed: None,
            voice: None,
            instructions: None,
        }
    }
}
impl std::fmt::Debug for SpeechProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SpeechProviderConfig { private configuration redacted }")
    }
}
#[derive(Clone)]
pub struct SpeechLoadRequest {
    pub generation: u64,
    pub key: String,
    pub request: SpeakRequest,
    pub provider: SpeechProviderConfig,
    pub voice: String,
}
impl std::fmt::Debug for SpeechLoadRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SpeechLoadRequest")
            .field("generation", &self.generation)
            .finish_non_exhaustive()
    }
}

pub struct NativeSpeechTransport {
    state: SpeechState,
    queue: Vec<SpeakRequest>,
    queue_index: usize,
    queue_owner: Option<String>,
    generation: u64,
    sink: Box<dyn AudioSink>,
    cache: SpeechClipCache,
    cast: Vec<PersonaVoice>,
    provider: Option<SpeechProviderConfig>,
    pending: Option<SpeechLoadRequest>,
}
impl NativeSpeechTransport {
    pub fn new(backend: &dyn AudioBackend) -> Result<Self, AudioAppError> {
        Ok(Self {
            state: SpeechState::default(),
            queue: Vec::new(),
            queue_index: 0,
            queue_owner: None,
            generation: 1,
            sink: backend
                .create_sink()
                .map_err(|e| e.to_app_error("initialize_sink"))?,
            cache: SpeechClipCache::default(),
            cast: default_personas(),
            provider: None,
            pending: None,
        })
    }
    pub fn set_cast(&mut self, cast: Vec<PersonaVoice>) {
        self.cast = if cast.is_empty() {
            default_personas()
        } else {
            cast
        };
    }
    /// Host supplies an actually available narration configuration. No fallback
    /// to hosted/account synthesis is inferred when configuration is absent.
    pub fn set_provider_configuration(
        &mut self,
        provider: Option<SpeechProviderConfig>,
    ) -> Result<(), AudioAppError> {
        self.stop_speech()?;
        self.cache.clear();
        self.provider = provider;
        self.state.reset_to_idle();
        Ok(())
    }
    pub fn set_provider_config(
        &mut self,
        kind: impl Into<String>,
        model: impl Into<String>,
    ) -> Result<(), AudioAppError> {
        let kind = kind.into();
        self.set_provider_configuration(Some(SpeechProviderConfig::new(&kind, &kind, model)))
    }
    pub fn speech_state(&self) -> &SpeechState {
        &self.state
    }
    pub fn current_speech_text(&self) -> Option<&str> {
        self.queue
            .get(self.queue_index)
            .map(|r| trim_ecmascript(&r.text))
    }
    pub fn current_speech_source_offset(&self) -> Option<usize> {
        self.queue
            .get(self.queue_index)
            .and_then(|r| r.source_offset)
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn queue_length(&self) -> usize {
        self.queue.len()
    }
    pub fn queue_index(&self) -> usize {
        self.queue_index
    }
    pub fn pending_load(&self) -> Option<&SpeechLoadRequest> {
        self.pending.as_ref()
    }
    fn fail(&mut self, error: AudioAppError) {
        self.state.status = SpeechStatus::Error;
        self.state.error = Some(error);
        self.state.alignment.clear();
        self.state.alignment_provider = None;
        self.pending = None;
    }
    pub fn halt_playback(&mut self) -> Result<(), AudioAppError> {
        let prior = self.generation;
        self.generation = self.generation.wrapping_add(1);
        self.pending = None;
        self.cache.cancel_in_flight(prior);
        if let Err(error) = self.sink.stop() {
            let error = error.to_app_error("stop");
            self.fail(error.clone());
            return Err(error);
        }
        Ok(())
    }
    pub fn stop_speech(&mut self) -> Result<(), AudioAppError> {
        let result = self.halt_playback();
        self.queue.clear();
        self.queue_index = 0;
        self.queue_owner = None;
        if result.is_ok() {
            self.state.reset_to_idle();
        }
        result
    }
    pub fn pause_speech(&mut self) {
        if self.state.status == SpeechStatus::Playing {
            match self.sink.pause() {
                Ok(()) => self.state.status = SpeechStatus::Paused,
                Err(e) => {
                    self.on_playback_error(self.generation, e.to_app_error("pause"));
                }
            }
        }
    }
    pub fn resume_speech(&mut self) {
        if self.state.status == SpeechStatus::Paused {
            match self.sink.resume() {
                Ok(()) => self.state.status = SpeechStatus::Playing,
                Err(e) => {
                    self.on_playback_error(self.generation, e.to_app_error("playback"));
                }
            }
        }
    }
    pub fn toggle_pause_speech(&mut self) {
        match self.state.status {
            SpeechStatus::Playing => self.pause_speech(),
            SpeechStatus::Paused => self.resume_speech(),
            _ => {}
        }
    }
    pub fn seek_speech(&mut self, seconds: f64) {
        if self.state.duration <= 0.0 || !seconds.is_finite() {
            return;
        }
        match self.sink.seek(seconds.clamp(0.0, self.state.duration)) {
            Ok(()) => self.state.current_time = self.sink.current_time(),
            Err(e) => {
                self.on_playback_error(self.generation, e.to_app_error("seek"));
            }
        }
    }
    pub fn has_next_speech(&self) -> bool {
        self.queue_index + 1 < self.queue.len()
    }
    pub fn next_speech(&mut self) -> Result<(), AudioAppError> {
        if self.has_next_speech() {
            self.queue_index += 1;
            self.play_current()?;
        }
        Ok(())
    }
    pub fn previous_speech(&mut self) -> Result<(), AudioAppError> {
        if self.queue.is_empty() {
            return Ok(());
        }
        if self.state.current_time > 3.0 || self.queue_index == 0 {
            self.seek_speech(0.0);
            Ok(())
        } else {
            self.queue_index -= 1;
            self.play_current()
        }
    }
    pub fn restart_speech_with_voice(&mut self, voice: &str) -> Result<(), AudioAppError> {
        let voice = trim_ecmascript(voice);
        if voice.is_empty() || self.queue.get(self.queue_index).is_none() {
            return Ok(());
        }
        let id = self.queue[self.queue_index].id.clone();
        for item in &mut self.queue[self.queue_index..] {
            if item.id == id {
                item.voice = Some(voice.to_owned());
                if let Some(provider) = &self.provider {
                    item.voices
                        .get_or_insert_with(BTreeMap::new)
                        .insert(provider.kind.clone(), voice.to_owned());
                }
            }
        }
        self.play_current()
    }
    pub fn speak(&mut self, request: SpeakRequest) -> Result<(), AudioAppError> {
        if request.is_blank() {
            return Ok(());
        }
        if self.state.id.as_deref() == Some(&request.id) {
            match self.state.status {
                SpeechStatus::Playing => {
                    self.pause_speech();
                    return Ok(());
                }
                SpeechStatus::Paused => {
                    self.resume_speech();
                    return Ok(());
                }
                SpeechStatus::Loading => return self.stop_speech(),
                _ => {}
            }
        }
        if request.progressive {
            let segments = segment_speech_text(&request.text, SpeechSegmentationOptions::default());
            self.speak_with_segments(request, segments)
        } else {
            self.speak_queue(vec![request], SpeakQueueOptions::default())
        }
    }
    /// Supply actual Source Intl output for exact sentence segmentation. The
    /// built-in progressive path is explicitly only Source's conservative fallback.
    pub fn speak_with_segments(
        &mut self,
        request: SpeakRequest,
        segments: Vec<SpeechTextSegment>,
    ) -> Result<(), AudioAppError> {
        if !validate_source_segments(&request.text, &segments) {
            return Err(AudioAppError::invalid_audio("Invalid Source offsets"));
        }
        let base = request.source_offset.unwrap_or(0);
        let owner = request.id.clone();
        let mut requests = Vec::new();
        for segment in segments {
            let mut item = request.clone();
            item.text = segment.text;
            item.source_offset = Some(
                base.checked_add(segment.start)
                    .ok_or_else(|| AudioAppError::invalid_audio("Invalid offset"))?,
            );
            item.progressive = false;
            requests.push(item);
        }
        self.speak_queue(
            requests,
            SpeakQueueOptions {
                start_index: 0,
                owner_id: Some(owner),
            },
        )
    }
    pub fn speak_queue(
        &mut self,
        requests: Vec<SpeakRequest>,
        options: SpeakQueueOptions,
    ) -> Result<(), AudioAppError> {
        let requests: Vec<_> = requests.into_iter().filter(|r| !r.is_blank()).collect();
        if requests.is_empty() {
            return Ok(());
        }
        self.halt_playback()?;
        self.queue = requests;
        self.queue_index = options.start_index.min(self.queue.len() - 1);
        self.queue_owner = options.owner_id;
        self.play_current()
    }
    fn resolve_voice(&self, request: &SpeakRequest, provider: &SpeechProviderConfig) -> String {
        let empty = BTreeMap::new();
        let voice = pick_voice_for_provider(
            request.voices.as_ref().unwrap_or(&empty),
            request.voice.as_deref(),
            Some(&provider.kind),
        );
        if provider.kind == "supertonic" {
            resolve_supertonic_voice(voice.as_deref(), provider.voice.as_deref().unwrap_or("F1"))
        } else {
            voice
                .or_else(|| provider.voice.clone())
                .unwrap_or_else(|| "alloy".to_owned())
        }
    }
    pub fn play_current(&mut self) -> Result<(), AudioAppError> {
        let Some(request) = self.queue.get(self.queue_index).cloned() else {
            return self.stop_speech();
        };
        self.halt_playback()?;
        self.state = SpeechState {
            status: SpeechStatus::Loading,
            id: Some(request.id.clone()),
            owner_id: self.queue_owner.clone(),
            queue_index: self.queue_index,
            queue_length: self.queue.len(),
            label: request.label.clone().or_else(|| request.author.clone()),
            ..SpeechState::default()
        };
        let Some(provider) = self.provider.clone() else {
            let error = AudioAppError::configuration_error("");
            self.fail(error.clone());
            return Err(error);
        };
        let mut enriched = with_persona_voice(&request, &self.cast);
        enriched.text = trim_ecmascript(&enriched.text).to_owned();
        let voice = self.resolve_voice(&enriched, &provider);
        let key = compute_cache_key(
            &provider.identity,
            &provider.model,
            &voice,
            &provider.response_format,
            provider.speed,
            enriched
                .instructions
                .as_deref()
                .or(provider.instructions.as_deref()),
            &enriched.text,
        );
        self.state.voice = Some(voice.clone());
        self.pending = Some(SpeechLoadRequest {
            generation: self.generation,
            key: key.clone(),
            request: enriched,
            provider,
            voice,
        });
        if let Some(clip) = self.cache.get(&key) {
            self.load_clip_and_play(self.generation, clip)?;
        } else {
            self.cache.begin_in_flight(&key, self.generation);
        }
        Ok(())
    }
    /// Wrong-key, duplicate and stale completions cannot sound or mutate cache.
    pub fn load_clip_and_play(
        &mut self,
        token: u64,
        clip: CachedClip,
    ) -> Result<bool, AudioAppError> {
        if token != self.generation
            || self.state.status != SpeechStatus::Loading
            || self
                .pending
                .as_ref()
                .is_none_or(|p| p.generation != token || p.key != clip.key)
        {
            return Ok(false);
        }
        if let Err(error) = clip.format.validate(clip.samples.len()) {
            self.on_playback_error(token, error.clone());
            return Err(error);
        }
        if clip.samples.is_empty() {
            let error = AudioAppError::invalid_audio("");
            self.on_playback_error(token, error.clone());
            return Err(error);
        }
        let source = &self.pending.as_ref().unwrap().request.text;
        if clip.alignment.as_ref().is_some_and(|snapshot| {
            snapshot.ranges.iter().any(|r| {
                !r.audio_start.is_finite()
                    || !r.audio_end.is_finite()
                    || r.audio_end <= r.audio_start
                    || r.source_end <= r.source_start
                    || super::segment::slice_utf16(source, r.source_start, r.source_end).is_none()
                    || !matches!(r.precision.as_str(), "word" | "segment")
            })
        }) {
            let error = AudioAppError::invalid_audio("");
            self.on_playback_error(token, error.clone());
            return Err(error);
        }
        let duration = clip.format.duration_seconds(clip.samples.len());
        if let Err(error) = self.sink.play(clip.format, &clip.samples) {
            let error = error.to_app_error("playback");
            self.on_playback_error(token, error.clone());
            return Err(error);
        }
        self.cache.finish_in_flight(&clip.key, token);
        self.cache.insert(clip.clone());
        self.pending = None;
        self.state.status = SpeechStatus::Playing;
        self.state.duration = duration;
        self.state.current_time = 0.0;
        let menu = self.current_speech_voice_menu();
        self.state.provider = menu.as_ref().map(|m| m.provider.clone());
        self.state.model = menu.map(|m| m.model);
        if let Some(alignment) = clip.alignment {
            self.state.alignment = alignment.ranges;
            self.state.alignment_provider = Some(alignment.provider);
        }
        Ok(true)
    }
    pub fn on_playback_ended(&mut self, token: u64) -> Result<bool, AudioAppError> {
        if token != self.generation || self.state.status != SpeechStatus::Playing {
            return Ok(false);
        }
        if self.has_next_speech() {
            self.queue_index += 1;
            self.play_current()?;
        } else {
            self.stop_speech()?;
        }
        Ok(true)
    }
    pub fn on_playback_error(&mut self, token: u64, error: AudioAppError) -> bool {
        if token != self.generation {
            return false;
        }
        let _ = self.halt_playback();
        self.fail(error.safe_for_state());
        true
    }
    pub fn update_playback_clock(&mut self, token: u64, time: f64) -> bool {
        if token != self.generation
            || self.state.status != SpeechStatus::Playing
            || !time.is_finite()
        {
            return false;
        }
        self.state.current_time = time.clamp(0.0, self.state.duration);
        true
    }
    pub fn retry_speech(&mut self) -> Result<(), AudioAppError> {
        if self.queue.get(self.queue_index).is_some() {
            self.play_current()?;
        }
        Ok(())
    }
    pub fn current_speech_voice_menu(&self) -> Option<SpeechVoiceMenu> {
        let request = self.queue.get(self.queue_index)?;
        let provider = self.provider.as_ref()?;
        let request = with_persona_voice(request, &self.cast);
        let selected = self.resolve_voice(&request, provider);
        let mut options = Vec::new();
        let mut add = |id: String, label: String| {
            if !id.is_empty() && !options.iter().any(|o: &SpeechVoiceOption| o.id == id) {
                options.push(SpeechVoiceOption { id, label });
            }
        };
        for persona in &self.cast {
            let mut req = SpeakRequest::new(&persona.id, "");
            req.voice = persona.default_voice.clone();
            req.voices = Some(persona.provider_voices.clone());
            let id = self.resolve_voice(&req, provider);
            if provider.kind == "fishaudio" {
                if let Some(id) = persona.provider_voices.get("fishaudio") {
                    add(id.clone(), persona.name.clone());
                }
            } else {
                add(id, persona.name.clone());
            }
        }
        let (label, custom) = match provider.kind.as_str() {
            "supertonic" => {
                for id in ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4"] {
                    add(id.to_owned(), format!("Voice {id}"));
                }
                ("Browser voice".to_owned(), false)
            }
            "fishaudio" => {
                add(selected.clone(), "Current voice".to_owned());
                ("Fish Audio".to_owned(), true)
            }
            _ => {
                for voice in OPENAI_SPEECH_VOICES {
                    add(
                        (*voice).to_owned(),
                        format!("{}{}", voice[..1].to_uppercase(), &voice[1..]),
                    );
                }
                add(selected.clone(), "Current voice".to_owned());
                (
                    provider.name.clone().unwrap_or_else(|| {
                        if provider.kind == "hosted" {
                            "Twyne voice"
                        } else {
                            "Voice API"
                        }
                        .to_owned()
                    }),
                    provider.kind != "openai" && provider.kind != "hosted",
                )
            }
        };
        Some(SpeechVoiceMenu {
            provider: label,
            model: provider.model.clone(),
            selected,
            options,
            allows_custom: custom,
        })
    }
    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }
}
impl Drop for NativeSpeechTransport {
    fn drop(&mut self) {
        let _ = self.stop_speech();
    }
}
