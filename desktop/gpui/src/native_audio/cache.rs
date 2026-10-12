//! Private in-memory clip cache and generation-keyed work bookkeeping.
//! Source identity inputs and LRU24; no provider request/promise sharing is
//! implemented here, so this does not establish billing deduplication.

use super::{alignment::SpeechAlignmentSnapshot, pcm::PcmFormat};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};

/// Cap on cached audio clips, matching `MAX_CACHED_CLIPS` in `src/utils/speech.ts`.
pub const MAX_CACHED_CLIPS: usize = 24;

/// A cached synthesized clip in memory.
#[derive(Clone)]
pub struct CachedClip {
    pub key: String,
    pub format: PcmFormat,
    pub samples: Vec<i16>,
    pub wav_bytes: Vec<u8>,
    pub alignment: Option<SpeechAlignmentSnapshot>,
}

impl CachedClip {
    pub fn byte_size(&self) -> usize {
        self.samples.len() * 2 + self.wav_bytes.len()
    }
}

/// Compute the canonical content-addressed cache key.
///
/// Same Source identity inputs, encoded without ambiguous separators or private
/// prose in keys/logs. This native digest is not Source's plaintext join key.
pub fn compute_cache_key(
    provider_id: &str,
    model: &str,
    voice: &str,
    response_format: &str,
    speed: Option<f64>,
    instructions: Option<&str>,
    text: &str,
) -> String {
    let mut hash = Sha256::new();
    let speed = speed.map(|s| s.to_string()).unwrap_or_default();
    for field in [
        provider_id,
        model,
        voice,
        response_format,
        &speed,
        instructions.unwrap_or_default(),
        super::segment::trim_ecmascript(text),
    ] {
        hash.update((field.len() as u64).to_le_bytes());
        hash.update(field.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

/// Content-addressed LRU cache for audio clips and alignment snapshots.
pub struct SpeechClipCache {
    max_entries: usize,
    entries: HashMap<String, CachedClip>,
    order: VecDeque<String>,
    in_flight: HashMap<String, u64>, // key -> generation token
}

impl Default for SpeechClipCache {
    fn default() -> Self {
        Self::new(MAX_CACHED_CLIPS)
    }
}

impl SpeechClipCache {
    pub fn new(max_entries: usize) -> Self {
        Self {
            max_entries: max_entries.max(1),
            entries: HashMap::new(),
            order: VecDeque::new(),
            in_flight: HashMap::new(),
        }
    }

    pub fn get(&mut self, key: &str) -> Option<CachedClip> {
        if let Some(clip) = self.entries.get(key).cloned() {
            // Re-insert at back of order so it counts as recently used
            self.order.retain(|k| k != key);
            self.order.push_back(key.to_string());
            Some(clip)
        } else {
            None
        }
    }

    pub fn insert(&mut self, clip: CachedClip) {
        let key = clip.key.clone();
        if self.entries.contains_key(&key) {
            self.order.retain(|k| k != &key);
        }
        self.entries.insert(key.clone(), clip);
        self.order.push_back(key);

        while self.entries.len() > self.max_entries
            || self
                .entries
                .values()
                .map(CachedClip::byte_size)
                .sum::<usize>()
                > 32 * 1024 * 1024
        {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            } else {
                break;
            }
        }
    }

    pub fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.in_flight.clear();
    }

    /// Mark a synthesis request as in-flight under a generation token.
    ///
    /// Returns false if already in flight (deduplication gate).
    pub fn begin_in_flight(&mut self, key: &str, generation: u64) -> bool {
        if self.in_flight.contains_key(key) {
            false
        } else {
            self.in_flight.insert(key.to_string(), generation);
            true
        }
    }

    pub fn finish_in_flight(&mut self, key: &str, generation: u64) -> bool {
        if self.in_flight.get(key) == Some(&generation) {
            self.in_flight.remove(key);
            true
        } else {
            false
        }
    }
    pub fn cancel_in_flight(&mut self, generation: u64) {
        self.in_flight.retain(|_, token| *token != generation);
    }

    pub fn is_in_flight(&self, key: &str) -> bool {
        self.in_flight.contains_key(key)
    }
}
impl std::fmt::Debug for CachedClip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CachedClip")
            .field("sample_count", &self.samples.len())
            .field("byte_count", &self.wav_bytes.len())
            .finish_non_exhaustive()
    }
}
impl std::fmt::Debug for SpeechClipCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SpeechClipCache")
            .field("entry_count", &self.entries.len())
            .field("pending_count", &self.in_flight.len())
            .finish_non_exhaustive()
    }
}
