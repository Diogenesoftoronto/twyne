//! Timing alignment ranges and word/sentence offset lookups for speech follow-along.
//!
//! Mirrors `src/utils/speech-alignment.ts`.

use super::segment::{is_ecmascript_whitespace, slice_utf16, trim_ecmascript};
use super::state::SpeechAlignmentRange;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Snapshot of alignment ranges returned by a speech provider for a clip.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAlignmentSnapshot {
    pub provider: String,
    pub ranges: Vec<SpeechAlignmentRange>,
}

impl SpeechAlignmentSnapshot {
    pub fn new(provider: impl Into<String>, ranges: Vec<SpeechAlignmentRange>) -> Self {
        Self {
            provider: provider.into(),
            ranges,
        }
    }
}

/// Look up the alignment range active at a given playback timestamp.
///
/// Returns the range currently sounding (`audio_start <= seconds < audio_end`),
/// or the most recent range passed.
pub fn alignment_range_at_time(
    ranges: &[SpeechAlignmentRange],
    seconds: f64,
) -> Option<&SpeechAlignmentRange> {
    if !seconds.is_finite() {
        return None;
    }
    // Direct match: currently inside the range interval
    if let Some(range) = ranges
        .iter()
        .find(|r| seconds >= r.audio_start && seconds < r.audio_end)
    {
        return Some(range);
    }
    // Fallback: the latest range that started before or at this time
    ranges.iter().rev().find(|r| seconds >= r.audio_start)
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct FishTimestampEvent {
    pub content: Option<String>,
    pub chunk_seq: Option<i64>,
    pub chunk_audio_offset_sec: Option<Value>,
    pub alignment: Option<FishAlignment>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct FishAlignment {
    pub segments: Option<Vec<FishTimestampSegment>>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct FishTimestampSegment {
    pub text: Option<String>,
    pub start: Option<Value>,
    pub end: Option<Value>,
}
fn number(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Null) => 0.0,
        Some(Value::Bool(value)) => {
            if *value {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::Number(value)) => value.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(value)) => {
            let value = trim_ecmascript(value);
            if value.is_empty() {
                0.0
            } else {
                value.parse().unwrap_or(f64::NAN)
            }
        }
        _ => f64::NAN,
    }
}
/// Match the exact Source quote at UTF-16 offsets. Provider normalization is
/// refused rather than moving the highlight to a similar/repeated passage.
pub fn map_fish_timestamp_event(
    source: &str,
    event: &FishTimestampEvent,
    source_start: usize,
) -> Vec<SpeechAlignmentRange> {
    let content = event.content.as_deref().unwrap_or_default();
    let offset = number(event.chunk_audio_offset_sec.as_ref());
    let offset = if offset.is_nan() { 0.0 } else { offset };
    let mut cursor = 0;
    let mut ranges = Vec::new();
    for segment in event
        .alignment
        .as_ref()
        .and_then(|value| value.segments.as_deref())
        .unwrap_or_default()
    {
        let text = segment.text.as_deref().unwrap_or_default();
        let start = number(segment.start.as_ref());
        let end = number(segment.end.as_ref());
        if text.is_empty()
            || !offset.is_finite()
            || !start.is_finite()
            || !end.is_finite()
            || end <= start
        {
            continue;
        }
        let Some(remaining) = content.get(cursor..) else {
            continue;
        };
        let Some(relative) = remaining.find(text) else {
            continue;
        };
        let local = cursor + relative;
        let Some(absolute) = source_start.checked_add(content[..local].encode_utf16().count())
        else {
            continue;
        };
        let Some(source_end) = absolute.checked_add(text.encode_utf16().count()) else {
            continue;
        };
        if slice_utf16(source, absolute, source_end) != Some(text) {
            continue;
        }
        ranges.push(SpeechAlignmentRange {
            source_start: absolute,
            source_end,
            audio_start: offset + start,
            audio_end: offset + end,
            precision: if trim_ecmascript(text).chars().any(is_ecmascript_whitespace) {
                "segment"
            } else {
                "word"
            }
            .to_owned(),
        });
        cursor = local + text.len();
    }
    ranges
}

/// Look up the alignment range corresponding to a character offset in the source document.
pub fn alignment_range_at_source_offset(
    ranges: &[SpeechAlignmentRange],
    offset: usize,
) -> Option<&SpeechAlignmentRange> {
    ranges
        .iter()
        .find(|r| offset >= r.source_start && offset <= r.source_end)
}
