//! Native PCM buffer boundaries, conversions, 2400-sample framing, RMS level calculation,
//! and self-contained RIFF WAVE encoding/decoding.
//!
//! Enforces memory-safe boundaries matching `src/utils/live-voice-audio.ts`.

use super::state::AudioAppError;
use serde::{Deserialize, Serialize};

/// Standard sample rate for Twyne Live Voice (24 kHz).
pub const LIVE_SAMPLE_RATE: u32 = 24_000;
/// Standard 100ms chunk for Live Voice (2400 samples at 24 kHz).
pub const LIVE_CHUNK_SAMPLES: usize = 2_400;
/// Expected byte length of one 100ms 16-bit mono chunk (4800 bytes).
pub const LIVE_CHUNK_BYTES: usize = LIVE_CHUNK_SAMPLES * 2;
pub const MAX_PCM_BYTES: usize = 16 * 1024 * 1024;

/// PCM format specification.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcmFormat {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
}

impl PcmFormat {
    pub fn validate(&self, sample_count: usize) -> Result<(), AudioAppError> {
        if !(1..=192_000).contains(&self.sample_rate)
            || !(1..=32).contains(&self.channels)
            || self.bits_per_sample != 16
            || !sample_count.is_multiple_of(self.channels as usize)
            || sample_count > MAX_PCM_BYTES / 2
        {
            return Err(AudioAppError::invalid_audio(
                "Unsupported or incomplete PCM frames",
            ));
        }
        Ok(())
    }
    pub const fn live_default() -> Self {
        Self {
            sample_rate: LIVE_SAMPLE_RATE,
            channels: 1,
            bits_per_sample: 16,
        }
    }

    pub const fn cd_quality() -> Self {
        Self {
            sample_rate: 44_100,
            channels: 2,
            bits_per_sample: 16,
        }
    }

    pub const fn tts_narration(sample_rate: u32) -> Self {
        Self {
            sample_rate,
            channels: 1,
            bits_per_sample: 16,
        }
    }

    pub fn bytes_per_sample(&self) -> usize {
        (self.bits_per_sample as usize / 8) * self.channels as usize
    }

    pub fn duration_seconds(&self, sample_count: usize) -> f64 {
        if self.sample_rate == 0 || self.channels == 0 {
            0.0
        } else {
            sample_count as f64 / (self.sample_rate as f64 * self.channels as f64)
        }
    }

    pub fn samples_for_duration(&self, seconds: f64) -> usize {
        if seconds <= 0.0 {
            0
        } else {
            (seconds * self.sample_rate as f64 * self.channels as f64).round() as usize
        }
    }
}

impl Default for PcmFormat {
    fn default() -> Self {
        Self::live_default()
    }
}

/// Validate raw PCM bytes against 16-bit little-endian boundaries.
///
/// Invariant: byte slice must be even in length. Odd lengths are an immediate
/// validation failure ("Invalid Live audio" from `live-voice-audio.ts`).
pub fn validate_pcm_bytes(bytes: &[u8]) -> Result<(), AudioAppError> {
    if bytes.is_empty() {
        return Err(AudioAppError::invalid_audio(
            "Invalid Live audio: empty buffer",
        ));
    }
    if !bytes.len().is_multiple_of(2) || bytes.len() > MAX_PCM_BYTES {
        return Err(AudioAppError::invalid_audio(
            "Invalid Live audio: odd byte length",
        ));
    }
    Ok(())
}

/// Convert raw little-endian bytes to signed 16-bit PCM samples.
pub fn pcm_bytes_to_i16(bytes: &[u8]) -> Result<Vec<i16>, AudioAppError> {
    validate_pcm_bytes(bytes)?;
    let mut samples = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.as_chunks::<2>().0 {
        samples.push(i16::from_le_bytes(*chunk));
    }
    Ok(samples)
}

/// Convert signed 16-bit PCM samples to little-endian bytes.
pub fn i16_to_pcm_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for &sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

/// Convert signed 16-bit PCM sample to normalized f32 in range [-1.0, 1.0].
pub fn i16_to_f32(sample: i16) -> f32 {
    sample as f32 / 32768.0
}

/// Convert normalized f32 sample [-1.0, 1.0] to clamped signed 16-bit PCM sample.
pub fn f32_to_i16(sample: f32) -> i16 {
    let clamped = sample.clamp(-1.0, 1.0);
    if clamped < 0.0 {
        (clamped as f64 * 32768.0) as i16
    } else {
        (clamped as f64 * 32767.0) as i16
    }
}

/// Calculate the root-mean-square (RMS) level of a PCM sample buffer.
///
/// Parity: `Math.min(1, Math.sqrt(sum / pcm.length) * 5)` in `src/utils/live-voice-audio.ts`.
pub fn calculate_rms_level(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sum = 0.0f64;
    for &sample in samples {
        let normalized = sample as f64 / 32768.0;
        sum += normalized * normalized;
    }
    ((sum / samples.len() as f64).sqrt() * 5.0).min(1.0) as f32
}

/// Split continuous PCM samples into fixed-size chunks (e.g. 2400 samples).
pub fn chunk_pcm_samples(samples: &[i16], chunk_size: usize) -> Vec<Vec<i16>> {
    if chunk_size == 0 {
        return vec![samples.to_vec()];
    }
    samples.chunks(chunk_size).map(|c| c.to_vec()).collect()
}

/// Encode PCM samples to a standard 44-byte header canonical RIFF WAVE file.
pub fn encode_wav_bytes(format: PcmFormat, samples: &[i16]) -> Result<Vec<u8>, AudioAppError> {
    format.validate(samples.len())?;
    let data_len = (samples.len() * 2) as u32;
    let file_len = 36 + data_len;
    let byte_rate =
        format.sample_rate * format.channels as u32 * (format.bits_per_sample as u32 / 8);
    let block_align = format.channels * (format.bits_per_sample / 8);

    let mut wav = Vec::with_capacity((44 + data_len) as usize);

    // RIFF chunk descriptor
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&file_len.to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    // "fmt " sub-chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size (16 for PCM)
    wav.extend_from_slice(&1u16.to_le_bytes()); // AudioFormat (1 for PCM)
    wav.extend_from_slice(&format.channels.to_le_bytes());
    wav.extend_from_slice(&format.sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&format.bits_per_sample.to_le_bytes());

    // "data" sub-chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for &sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }

    Ok(wav)
}

/// Decode a RIFF WAVE byte buffer into `(PcmFormat, Vec<i16>)`.
///
/// Rejects non-PCM, non-RIFF, or malformed data chunks.
pub fn decode_wav_bytes(wav_bytes: &[u8]) -> Result<(PcmFormat, Vec<i16>), AudioAppError> {
    if wav_bytes.len() < 44 || wav_bytes.len() > MAX_PCM_BYTES + 1024 * 1024 {
        return Err(AudioAppError::invalid_audio(
            "Malformed WAV: file too small for RIFF header",
        ));
    }
    if &wav_bytes[0..4] != b"RIFF" || &wav_bytes[8..12] != b"WAVE" {
        return Err(AudioAppError::invalid_audio(
            "Malformed WAV: missing RIFF/WAVE header",
        ));
    }
    let riff_size = u32::from_le_bytes(wav_bytes[4..8].try_into().unwrap()) as usize;
    if riff_size.checked_add(8) != Some(wav_bytes.len()) {
        return Err(AudioAppError::invalid_audio("Malformed RIFF length"));
    }

    let mut cursor = 12;
    let mut format: Option<PcmFormat> = None;
    let mut pcm_data: Option<Vec<i16>> = None;

    while cursor + 8 <= wav_bytes.len() {
        let chunk_id = &wav_bytes[cursor..cursor + 4];
        let chunk_size = u32::from_le_bytes([
            wav_bytes[cursor + 4],
            wav_bytes[cursor + 5],
            wav_bytes[cursor + 6],
            wav_bytes[cursor + 7],
        ]) as usize;
        cursor += 8;

        if cursor
            .checked_add(chunk_size)
            .is_none_or(|end| end > wav_bytes.len())
        {
            return Err(AudioAppError::invalid_audio(
                "Malformed WAV: chunk truncated",
            ));
        }

        if chunk_id == b"fmt " {
            if format.is_some() {
                return Err(AudioAppError::invalid_audio("Duplicate fmt chunk"));
            }
            if chunk_size < 16 {
                return Err(AudioAppError::invalid_audio(
                    "Malformed WAV: fmt chunk too small",
                ));
            }
            let audio_format = u16::from_le_bytes([wav_bytes[cursor], wav_bytes[cursor + 1]]);
            if audio_format != 1 {
                return Err(AudioAppError::invalid_audio(format!(
                    "Unsupported WAV: audio format {} is not PCM (1)",
                    audio_format
                )));
            }
            let channels = u16::from_le_bytes([wav_bytes[cursor + 2], wav_bytes[cursor + 3]]);
            let sample_rate = u32::from_le_bytes([
                wav_bytes[cursor + 4],
                wav_bytes[cursor + 5],
                wav_bytes[cursor + 6],
                wav_bytes[cursor + 7],
            ]);
            let bits_per_sample =
                u16::from_le_bytes([wav_bytes[cursor + 14], wav_bytes[cursor + 15]]);
            if bits_per_sample != 16 {
                return Err(AudioAppError::invalid_audio(format!(
                    "Unsupported WAV: bits per sample {} is not 16-bit",
                    bits_per_sample
                )));
            }
            format = Some(PcmFormat {
                sample_rate,
                channels,
                bits_per_sample,
            });
            let format = format.as_ref().unwrap();
            format.validate(0)?;
            let block = u16::from_le_bytes(wav_bytes[cursor + 12..cursor + 14].try_into().unwrap());
            let rate = u32::from_le_bytes(wav_bytes[cursor + 8..cursor + 12].try_into().unwrap());
            if block as usize != format.bytes_per_sample()
                || rate != format.sample_rate * block as u32
            {
                return Err(AudioAppError::invalid_audio("Malformed WAV frame rate"));
            }
        } else if chunk_id == b"data" {
            if pcm_data.is_some() || !chunk_size.is_multiple_of(2) || chunk_size > MAX_PCM_BYTES {
                return Err(AudioAppError::invalid_audio("Malformed data chunk"));
            }
            let samples = wav_bytes[cursor..cursor + chunk_size]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|bytes| i16::from_le_bytes(*bytes))
                .collect();
            pcm_data = Some(samples);
        }

        cursor += chunk_size;
        // Word alignment padding
        if !chunk_size.is_multiple_of(2) {
            cursor += 1;
        }
    }
    if cursor != wav_bytes.len() {
        return Err(AudioAppError::invalid_audio("Malformed WAV padding"));
    }

    match (format, pcm_data) {
        (Some(fmt), Some(samples)) => {
            fmt.validate(samples.len())?;
            Ok((fmt, samples))
        }
        (None, _) => Err(AudioAppError::invalid_audio(
            "Malformed WAV: missing fmt chunk",
        )),
        (_, None) => Err(AudioAppError::invalid_audio(
            "Malformed WAV: missing data chunk",
        )),
    }
}

/// Source Worklet framing: carry partial input between device callbacks and
/// emit only complete 2400-sample blocks. Reset on mute/stop/session changes.
pub struct LivePcmFramer {
    samples: [i16; LIVE_CHUNK_SAMPLES],
    index: usize,
}
impl Default for LivePcmFramer {
    fn default() -> Self {
        Self {
            samples: [0; LIVE_CHUNK_SAMPLES],
            index: 0,
        }
    }
}
impl LivePcmFramer {
    pub fn reset(&mut self) {
        self.index = 0;
        self.samples.fill(0);
    }
    pub fn push(&mut self, input: &[i16], mut on_frame: impl FnMut(&[i16], f32)) {
        for &sample in input {
            self.samples[self.index] = sample;
            self.index += 1;
            if self.index == LIVE_CHUNK_SAMPLES {
                on_frame(&self.samples, calculate_rms_level(&self.samples));
                self.index = 0;
            }
        }
    }
    pub fn pending_samples(&self) -> usize {
        self.index
    }
}

/// Generate a synthetic sine wave for loopback testing.
pub fn generate_synthetic_tone(
    format: PcmFormat,
    freq_hz: f32,
    duration_secs: f32,
    amplitude: f32,
) -> Vec<i16> {
    let num_samples = (duration_secs * format.sample_rate as f32) as usize;
    let mut samples = Vec::with_capacity(num_samples * format.channels as usize);
    let step = 2.0 * std::f32::consts::PI * freq_hz / format.sample_rate as f32;

    for i in 0..num_samples {
        let val = (i as f32 * step).sin() * amplitude;
        let s = f32_to_i16(val);
        for _ in 0..format.channels {
            samples.push(s);
        }
    }
    samples
}

/// Generate synthetic silence.
pub fn generate_synthetic_silence(format: PcmFormat, duration_secs: f32) -> Vec<i16> {
    let num_samples = (duration_secs * format.sample_rate as f32) as usize;
    vec![0i16; num_samples * format.channels as usize]
}
