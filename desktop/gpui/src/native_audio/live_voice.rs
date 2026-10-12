//! Audio-only live foundation. Credentials, consent, websocket/delegation and
//! receipt settlement belong to the host and are deliberately not simulated.
use super::{
    backend::{AudioBackend, AudioSink, AudioSource},
    pcm::{LivePcmFramer, PcmFormat, pcm_bytes_to_i16},
    state::{AudioAppError, LiveVoiceState, LiveVoiceStatus},
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
pub const MAX_PLAYBACK_LAG_SECONDS: f64 = 5.0;
/// Host must check this generation again at its send boundary.
pub type LiveAudioChunkCallback = Box<dyn FnMut(u64, &[i16], f32) + Send + 'static>;
pub struct NativeLiveVoiceSession {
    state: LiveVoiceState,
    format: PcmFormat,
    source: Option<Box<dyn AudioSource>>,
    sink: Option<Box<dyn AudioSink>>,
    scheduled_playback_time: f64,
    current_clock_time: f64,
    generation: u64,
    epoch: Arc<AtomicU64>,
    framing_epoch: Arc<AtomicU64>,
    armed: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
}
impl Default for NativeLiveVoiceSession {
    fn default() -> Self {
        Self::new()
    }
}
impl NativeLiveVoiceSession {
    pub fn new() -> Self {
        Self {
            state: LiveVoiceState::default(),
            format: PcmFormat::live_default(),
            source: None,
            sink: None,
            scheduled_playback_time: 0.0,
            current_clock_time: 0.0,
            generation: 1,
            epoch: Arc::new(AtomicU64::new(1)),
            framing_epoch: Arc::new(AtomicU64::new(1)),
            armed: Arc::new(AtomicBool::new(false)),
            muted: Arc::new(AtomicBool::new(false)),
        }
    }
    pub fn state(&self) -> &LiveVoiceState {
        &self.state
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn is_active(&self) -> bool {
        matches!(
            self.state.status,
            LiveVoiceStatus::Connecting | LiveVoiceStatus::Listening | LiveVoiceStatus::Speaking
        )
    }
    pub fn is_muted(&self) -> bool {
        self.state.muted
    }
    pub fn format(&self) -> PcmFormat {
        self.format
    }
    fn invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.epoch.store(self.generation, Ordering::SeqCst);
        self.armed.store(false, Ordering::SeqCst);
    }
    fn release_devices(&mut self) {
        if let Some(mut source) = self.source.take() {
            let _ = source.stop_capture();
        }
        if let Some(mut sink) = self.sink.take() {
            let _ = sink.stop();
        }
        self.scheduled_playback_time = 0.0;
        self.current_clock_time = 0.0;
    }
    pub fn stop_session(&mut self) {
        self.invalidate();
        self.release_devices();
        self.state.status = LiveVoiceStatus::Idle;
        self.state.level = 0.0;
        self.state.error.clear();
        self.state.pending = None;
        self.state.working = false;
        self.state.finalized = false;
    }
    fn fail(&mut self, error: AudioAppError) -> AudioAppError {
        self.invalidate();
        self.release_devices();
        self.state.status = LiveVoiceStatus::Error;
        self.state.level = 0.0;
        self.state.pending = None;
        self.state.working = false;
        self.state.finalized = false;
        self.state.error = error.message.clone();
        error
    }
    /// Initialize supplied audio objects only. Remains Connecting until an
    /// actual provider session.started acknowledgement; it is not a live session.
    pub fn start_session(
        &mut self,
        backend: &dyn AudioBackend,
        author: impl Into<String>,
        mut on_capture: LiveAudioChunkCallback,
    ) -> Result<u64, AudioAppError> {
        self.stop_session();
        let author = author.into();
        self.state = LiveVoiceState {
            status: LiveVoiceStatus::Connecting,
            author: if author.is_empty() {
                "Le Lecteur".to_owned()
            } else {
                author
            },
            ..LiveVoiceState::default()
        };
        self.muted.store(false, Ordering::SeqCst);
        let token = self.generation;
        let mut source = match backend.create_source() {
            Ok(source) => source,
            Err(error) => return Err(self.fail(error.to_app_error("start_live_voice_capture"))),
        };
        let mut sink = match backend.create_sink() {
            Ok(sink) => sink,
            Err(error) => {
                let _ = source.stop_capture();
                return Err(self.fail(error.to_app_error("start_live_voice_playback")));
            }
        };
        if sink.audio_clock().is_none() {
            let _ = source.stop_capture();
            let _ = sink.stop();
            return Err(self.fail(AudioAppError::device_error("", "start_live_voice_playback")));
        }
        let epoch = self.epoch.clone();
        let armed = self.armed.clone();
        let muted = self.muted.clone();
        let framing_epoch = self.framing_epoch.clone();
        let mut seen_framing = framing_epoch.load(Ordering::SeqCst);
        let mut framer = LivePcmFramer::default();
        let callback = Box::new(move |samples: &[i16], _level: f32| {
            let current_framing = framing_epoch.load(Ordering::SeqCst);
            if current_framing != seen_framing {
                framer.reset();
                seen_framing = current_framing;
            }
            if epoch.load(Ordering::SeqCst) != token
                || !armed.load(Ordering::SeqCst)
                || muted.load(Ordering::SeqCst)
            {
                framer.reset();
                return;
            }
            framer.push(samples, |frame, level| {
                if epoch.load(Ordering::SeqCst) == token
                    && armed.load(Ordering::SeqCst)
                    && !muted.load(Ordering::SeqCst)
                {
                    on_capture(token, frame, level);
                }
            });
        });
        if let Err(error) = source.start_capture(self.format, callback) {
            let _ = source.stop_capture();
            let _ = sink.stop();
            return Err(self.fail(error.to_app_error("start_capture_stream")));
        }
        self.source = Some(source);
        self.sink = Some(sink);
        Ok(token)
    }
    pub fn mark_session_started(&mut self, token: u64, started_at: u64) -> bool {
        if token != self.generation
            || self.state.status != LiveVoiceStatus::Connecting
            || started_at == 0
        {
            return false;
        }
        self.state.started_at = started_at;
        self.state.status = LiveVoiceStatus::Listening;
        self.armed.store(true, Ordering::SeqCst);
        true
    }
    /// Close audio immediately; only actual host receipt can mark finalized.
    pub fn begin_close(&mut self) -> Option<u64> {
        if !self.is_active() {
            return None;
        }
        self.armed.store(false, Ordering::SeqCst);
        self.release_devices();
        self.state.status = LiveVoiceStatus::Closing;
        self.state.pending = None;
        self.state.level = 0.0;
        Some(self.generation)
    }
    pub fn acknowledge_session_closed(&mut self, token: u64) -> bool {
        if token != self.generation
            || self.state.status == LiveVoiceStatus::Idle
            || self.state.status == LiveVoiceStatus::Error
        {
            return false;
        }
        self.stop_session();
        self.state.finalized = true;
        true
    }
    pub fn set_muted(&mut self, muted: bool) {
        if !matches!(
            self.state.status,
            LiveVoiceStatus::Listening | LiveVoiceStatus::Speaking
        ) {
            return;
        }
        if self.state.muted != muted {
            self.framing_epoch.fetch_add(1, Ordering::SeqCst);
        }
        self.state.muted = muted;
        self.muted.store(muted, Ordering::SeqCst);
        if let Some(source) = self.source.as_mut() {
            source.set_muted(muted);
        }
        if muted {
            self.state.level = 0.0;
        }
    }
    pub fn toggle_mute(&mut self) {
        self.set_muted(!self.state.muted);
    }
    pub fn enqueue_assistant_audio_bytes(
        &mut self,
        token: u64,
        bytes: &[u8],
    ) -> Result<bool, AudioAppError> {
        if !self.accepts(token) {
            return Ok(false);
        }
        let samples = match pcm_bytes_to_i16(bytes) {
            Ok(samples) => samples,
            Err(error) => return Err(self.fail(error)),
        };
        self.enqueue_assistant_audio_samples(token, &samples)
    }
    fn accepts(&self, token: u64) -> bool {
        token == self.generation
            && matches!(
                self.state.status,
                LiveVoiceStatus::Listening | LiveVoiceStatus::Speaking
            )
    }
    pub fn enqueue_assistant_audio_samples(
        &mut self,
        token: u64,
        samples: &[i16],
    ) -> Result<bool, AudioAppError> {
        if !self.accepts(token) {
            return Ok(false);
        }
        if samples.is_empty() {
            return Err(self.fail(AudioAppError::invalid_audio("")));
        }
        if let Err(error) = self.format.validate(samples.len()) {
            return Err(self.fail(error));
        }
        let current = self.sink.as_ref().and_then(|sink| sink.audio_clock());
        let Some(current) =
            current.filter(|time| time.is_finite() && *time >= self.current_clock_time)
        else {
            return Err(self.fail(AudioAppError::device_error("", "playback")));
        };
        self.current_clock_time = current;
        if self.scheduled_playback_time - current > MAX_PLAYBACK_LAG_SECONDS {
            return Err(self.fail(AudioAppError::playback_fell_behind()));
        }
        let start = current.max(self.scheduled_playback_time);
        if let Err(error) = self
            .sink
            .as_mut()
            .unwrap()
            .schedule_pcm(self.format, samples, start)
        {
            return Err(self.fail(error.to_app_error("live_voice_play")));
        }
        self.scheduled_playback_time = start + self.format.duration_seconds(samples.len());
        self.state.status = LiveVoiceStatus::Speaking;
        Ok(true)
    }
    pub fn scheduled_playback_time(&self) -> f64 {
        self.scheduled_playback_time
    }
    pub fn on_assistant_speech_ended(&mut self, token: u64) -> bool {
        let Some(clock) = self.sink.as_ref().and_then(|sink| sink.audio_clock()) else {
            return false;
        };
        self.update_clock(token, clock)
    }
    pub fn update_input_level(&mut self, token: u64, level: f32) -> bool {
        if !self.accepts(token) || self.state.muted || !level.is_finite() {
            return false;
        }
        self.state.level = level.clamp(0.0, 1.0);
        true
    }
    pub fn update_clock(&mut self, token: u64, clock: f64) -> bool {
        if !self.accepts(token) || !clock.is_finite() || clock < self.current_clock_time {
            return false;
        }
        self.current_clock_time = clock;
        if self.state.status == LiveVoiceStatus::Speaking && clock >= self.scheduled_playback_time {
            self.state.status = LiveVoiceStatus::Listening;
        }
        true
    }
    pub fn update_transcripts(&mut self, token: u64, user: &str, assistant: &str) -> bool {
        if !self.accepts(token) {
            return false;
        }
        self.state.user_transcript = caption_tail(user);
        self.state.assistant_transcript = caption_tail(assistant);
        true
    }
}
// Source caps at12000 UTF-16 units. Preserve Unicode scalars at the boundary
// rather than inventing a lone-surrogate String Rust cannot represent.
fn caption_tail(text: &str) -> String {
    let mut count = 0;
    let mut start = text.len();
    for (index, c) in text.char_indices().rev() {
        if count + c.len_utf16() > 12000 {
            break;
        }
        count += c.len_utf16();
        start = index;
    }
    text[start..].to_owned()
}
impl Drop for NativeLiveVoiceSession {
    fn drop(&mut self) {
        self.stop_session();
    }
}
