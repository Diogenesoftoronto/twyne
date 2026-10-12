//! Abstract audio backend interfaces, device boundaries, and synthetic mock loopback.
//!
//! Provides concrete abstraction over hardware audio devices (sinks and sources),
//! allowing deterministic mock checks without claiming physical device proof.

use super::{
    pcm::{PcmFormat, calculate_rms_level},
    state::AudioAppError,
};
use std::sync::{Arc, Mutex};

/// Errors originating at the hardware or platform audio boundary.
#[derive(Clone, Eq, PartialEq)]
pub enum AudioBackendError {
    DeviceUnavailable(String),
    PermissionDenied(String),
    FormatUnsupported(String),
    BufferUnderrun(String),
    PlaybackFellBehind(String),
    Internal(String),
}

impl std::fmt::Debug for AudioBackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let kind = match self {
            Self::DeviceUnavailable(_) => "DeviceUnavailable",
            Self::PermissionDenied(_) => "PermissionDenied",
            Self::FormatUnsupported(_) => "FormatUnsupported",
            Self::BufferUnderrun(_) => "BufferUnderrun",
            Self::PlaybackFellBehind(_) => "PlaybackFellBehind",
            Self::Internal(_) => "Internal",
        };
        write!(f, "{kind} {{ private platform detail redacted }}")
    }
}

impl AudioBackendError {
    pub fn to_app_error(&self, operation: &str) -> AudioAppError {
        match self {
            Self::PermissionDenied(msg) => AudioAppError::permission_denied(msg, operation),
            Self::PlaybackFellBehind(_) => AudioAppError::playback_fell_behind(),
            Self::DeviceUnavailable(msg)
            | Self::FormatUnsupported(msg)
            | Self::BufferUnderrun(msg)
            | Self::Internal(msg) => AudioAppError::device_error(msg, operation),
        }
    }
}

/// Abstract audio playback sink.
pub trait AudioSink: Send {
    /// Load and start playback of a PCM sample buffer.
    fn play(&mut self, format: PcmFormat, samples: &[i16]) -> Result<(), AudioBackendError>;
    /// Append a live chunk on one monotonic output clock, never replace audio.
    /// Backends without scheduling must fail explicitly instead of calling play.
    fn schedule_pcm(
        &mut self,
        _format: PcmFormat,
        _samples: &[i16],
        _start: f64,
    ) -> Result<(), AudioBackendError> {
        Err(AudioBackendError::FormatUnsupported(
            "Live scheduling unavailable".to_owned(),
        ))
    }
    fn audio_clock(&self) -> Option<f64> {
        None
    }
    /// Pause playback at current timestamp.
    fn pause(&mut self) -> Result<(), AudioBackendError>;
    /// Resume playback from paused timestamp.
    fn resume(&mut self) -> Result<(), AudioBackendError>;
    /// Stop playback and reset cursor.
    fn stop(&mut self) -> Result<(), AudioBackendError>;
    /// Seek to a timestamp in seconds.
    fn seek(&mut self, seconds: f64) -> Result<(), AudioBackendError>;
    /// Current playback position in seconds.
    fn current_time(&self) -> f64;
    /// Total duration of active clip in seconds.
    fn duration(&self) -> f64;
    /// Whether audio is actively playing.
    fn is_playing(&self) -> bool;
    /// Whether audio is currently paused.
    fn is_paused(&self) -> bool;
    /// Whether audio is stopped / idle.
    fn is_stopped(&self) -> bool;
}

/// Callback for captured audio frames: (pcm_samples, rms_level).
pub type OnCaptureChunk = Box<dyn FnMut(&[i16], f32) + Send + 'static>;

/// Abstract microphone/audio capture source.
pub trait AudioSource: Send {
    /// Start capturing audio stream in the requested format.
    fn start_capture(
        &mut self,
        format: PcmFormat,
        on_chunk: OnCaptureChunk,
    ) -> Result<(), AudioBackendError>;
    /// Stop audio capture and release device.
    fn stop_capture(&mut self) -> Result<(), AudioBackendError>;
    /// Mute or unmute the input stream without closing the audio track.
    fn set_muted(&mut self, muted: bool);
    /// Whether capture is active.
    fn is_capturing(&self) -> bool;
    /// Whether input is currently muted.
    fn is_muted(&self) -> bool;
}

/// Top-level factory for audio sinks and sources.
pub trait AudioBackend: Send + Sync {
    fn create_sink(&self) -> Result<Box<dyn AudioSink>, AudioBackendError>;
    fn create_source(&self) -> Result<Box<dyn AudioSource>, AudioBackendError>;
}

/// Synthetic mock audio sink for deterministic test execution.
#[derive(Clone, Default)]
pub struct MockAudioSink {
    inner: Arc<Mutex<MockAudioSinkInner>>,
}

#[derive(Default)]
struct MockAudioSinkInner {
    format: PcmFormat,
    samples: Vec<i16>,
    current_time: f64,
    clock: f64,
    scheduled_end: Option<f64>,
    duration: f64,
    is_playing: bool,
    is_paused: bool,
    play_count: usize,
    pause_count: usize,
    stop_count: usize,
    seek_count: usize,
    inject_permission_denied: bool,
    inject_fell_behind: bool,
}

impl MockAudioSink {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn inject_permission_denied(&self, inject: bool) {
        self.inner.lock().unwrap().inject_permission_denied = inject;
    }

    pub fn inject_fell_behind(&self, inject: bool) {
        self.inner.lock().unwrap().inject_fell_behind = inject;
    }

    pub fn play_count(&self) -> usize {
        self.inner.lock().unwrap().play_count
    }

    /// Synthetic stored PCM count; never reports device playback proof.
    pub fn sample_count(&self) -> usize {
        self.inner.lock().unwrap().samples.len()
    }

    pub fn step_time(&self, delta_seconds: f64) -> bool {
        let mut inner = self.inner.lock().unwrap();
        if !delta_seconds.is_finite() || delta_seconds < 0.0 {
            return false;
        }
        inner.clock += delta_seconds;
        if let Some(end) = inner.scheduled_end {
            inner.current_time = inner.clock;
            if inner.clock >= end {
                inner.scheduled_end = None;
                inner.is_playing = false;
                return true;
            }
            return false;
        }
        if !inner.is_playing {
            return false;
        }
        inner.current_time += delta_seconds;
        if inner.current_time >= inner.duration {
            inner.current_time = inner.duration;
            inner.is_playing = false;
            inner.is_paused = false;
            true // clip completed
        } else {
            false
        }
    }
}

impl AudioSink for MockAudioSink {
    fn play(&mut self, format: PcmFormat, samples: &[i16]) -> Result<(), AudioBackendError> {
        format
            .validate(samples.len())
            .map_err(|_| AudioBackendError::FormatUnsupported("Invalid PCM format".to_owned()))?;
        let mut inner = self.inner.lock().unwrap();
        if inner.inject_permission_denied {
            return Err(AudioBackendError::PermissionDenied(
                "Simulated permission denied on audio output device".to_string(),
            ));
        }
        if inner.inject_fell_behind {
            return Err(AudioBackendError::PlaybackFellBehind(
                "Speech playback fell behind (>5s). Reconnect to continue.".to_string(),
            ));
        }
        inner.format = format;
        inner.scheduled_end = None;
        inner.samples = samples.to_vec();
        inner.duration = format.duration_seconds(samples.len());
        inner.current_time = 0.0;
        inner.is_playing = true;
        inner.is_paused = false;
        inner.play_count += 1;
        Ok(())
    }
    fn audio_clock(&self) -> Option<f64> {
        Some(self.inner.lock().unwrap().clock)
    }
    fn schedule_pcm(
        &mut self,
        format: PcmFormat,
        samples: &[i16],
        start: f64,
    ) -> Result<(), AudioBackendError> {
        format
            .validate(samples.len())
            .map_err(|_| AudioBackendError::FormatUnsupported("Invalid PCM format".to_owned()))?;
        let mut inner = self.inner.lock().unwrap();
        if !start.is_finite()
            || start < inner.clock
            || inner.inject_permission_denied
            || inner.inject_fell_behind
        {
            return Err(AudioBackendError::Internal(
                "Live scheduling refused".to_owned(),
            ));
        }
        inner.format = format;
        inner.samples.extend_from_slice(samples);
        inner.scheduled_end = Some(start + format.duration_seconds(samples.len()));
        inner.duration = inner.scheduled_end.unwrap() - inner.clock;
        inner.is_playing = true;
        inner.is_paused = false;
        inner.play_count += 1;
        Ok(())
    }

    fn pause(&mut self) -> Result<(), AudioBackendError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.is_playing {
            inner.is_playing = false;
            inner.is_paused = true;
            inner.pause_count += 1;
        }
        Ok(())
    }

    fn resume(&mut self) -> Result<(), AudioBackendError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.inject_permission_denied {
            return Err(AudioBackendError::PermissionDenied(
                "Simulated permission denied on audio output resume".to_string(),
            ));
        }
        if inner.is_paused {
            inner.is_paused = false;
            inner.is_playing = true;
            inner.play_count += 1;
        }
        Ok(())
    }

    fn stop(&mut self) -> Result<(), AudioBackendError> {
        let mut inner = self.inner.lock().unwrap();
        inner.is_playing = false;
        inner.is_paused = false;
        inner.current_time = 0.0;
        inner.duration = 0.0;
        inner.scheduled_end = None;
        inner.samples.clear();
        inner.stop_count += 1;
        Ok(())
    }

    fn seek(&mut self, seconds: f64) -> Result<(), AudioBackendError> {
        let mut inner = self.inner.lock().unwrap();
        if inner.duration > 0.0 {
            inner.current_time = seconds.clamp(0.0, inner.duration);
            inner.seek_count += 1;
        }
        Ok(())
    }

    fn current_time(&self) -> f64 {
        self.inner.lock().unwrap().current_time
    }

    fn duration(&self) -> f64 {
        self.inner.lock().unwrap().duration
    }

    fn is_playing(&self) -> bool {
        self.inner.lock().unwrap().is_playing
    }

    fn is_paused(&self) -> bool {
        self.inner.lock().unwrap().is_paused
    }

    fn is_stopped(&self) -> bool {
        let inner = self.inner.lock().unwrap();
        !inner.is_playing && !inner.is_paused
    }
}

/// Synthetic mock audio capture source for deterministic test execution.
#[derive(Clone)]
pub struct MockAudioSource {
    inner: Arc<Mutex<MockAudioSourceInner>>,
}

struct MockAudioSourceInner {
    is_capturing: bool,
    is_muted: bool,
    format: PcmFormat,
    on_chunk: Option<OnCaptureChunk>,
    inject_permission_denied: bool,
    epoch: u64,
}

impl Default for MockAudioSource {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(MockAudioSourceInner {
                is_capturing: false,
                is_muted: false,
                format: PcmFormat::live_default(),
                on_chunk: None,
                inject_permission_denied: false,
                epoch: 0,
            })),
        }
    }
}

impl MockAudioSource {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn inject_permission_denied(&self, inject: bool) {
        self.inner.lock().unwrap().inject_permission_denied = inject;
    }

    /// Feed a synthetic chunk into the capture pipeline.
    pub fn emit_chunk(&self, samples: &[i16]) {
        let (callback, is_muted, epoch) = {
            let mut inner = self.inner.lock().unwrap();
            if !inner.is_capturing {
                return;
            }
            (inner.on_chunk.take(), inner.is_muted, inner.epoch)
        };
        if let Some(mut callback) = callback {
            if is_muted {
                // When muted, emit silence with 0 level without stopping stream
                let silence = vec![0i16; samples.len()];
                callback(&silence, 0.0);
            } else {
                let level = calculate_rms_level(samples);
                callback(samples, level);
            }
            // Do not invoke user callbacks under the device mutex, or restore
            // an obsolete callback after a reentrant stop/restart.
            let mut inner = self.inner.lock().unwrap();
            if inner.is_capturing && inner.epoch == epoch && inner.on_chunk.is_none() {
                inner.on_chunk = Some(callback);
            }
        }
    }
}

impl AudioSource for MockAudioSource {
    fn start_capture(
        &mut self,
        format: PcmFormat,
        on_chunk: OnCaptureChunk,
    ) -> Result<(), AudioBackendError> {
        format
            .validate(0)
            .map_err(|_| AudioBackendError::FormatUnsupported("Invalid PCM format".to_owned()))?;
        let mut inner = self.inner.lock().unwrap();
        if inner.inject_permission_denied {
            return Err(AudioBackendError::PermissionDenied(
                "Microphone permission denied by system".to_string(),
            ));
        }
        inner.format = format;
        inner.epoch = inner.epoch.wrapping_add(1);
        inner.is_muted = false;
        inner.on_chunk = Some(on_chunk);
        inner.is_capturing = true;
        Ok(())
    }

    fn stop_capture(&mut self) -> Result<(), AudioBackendError> {
        let mut inner = self.inner.lock().unwrap();
        inner.is_capturing = false;
        inner.epoch = inner.epoch.wrapping_add(1);
        inner.on_chunk = None;
        Ok(())
    }

    fn set_muted(&mut self, muted: bool) {
        self.inner.lock().unwrap().is_muted = muted;
    }

    fn is_capturing(&self) -> bool {
        self.inner.lock().unwrap().is_capturing
    }

    fn is_muted(&self) -> bool {
        self.inner.lock().unwrap().is_muted
    }
}

/// Test loopback backend creating mocks.
#[derive(Clone, Default)]
pub struct MockLoopbackBackend {
    pub last_sink: Arc<Mutex<Option<MockAudioSink>>>,
    pub last_source: Arc<Mutex<Option<MockAudioSource>>>,
}

impl MockLoopbackBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

impl AudioBackend for MockLoopbackBackend {
    fn create_sink(&self) -> Result<Box<dyn AudioSink>, AudioBackendError> {
        let sink = MockAudioSink::new();
        *self.last_sink.lock().unwrap() = Some(sink.clone());
        Ok(Box::new(sink))
    }

    fn create_source(&self) -> Result<Box<dyn AudioSource>, AudioBackendError> {
        let source = MockAudioSource::new();
        *self.last_source.lock().unwrap() = Some(source.clone());
        Ok(Box::new(source))
    }
}
