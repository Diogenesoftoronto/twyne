//! Source UTF-16 offsets and the conservative Source sentence fallback.
//! Full Source uses Intl.Segmenter when available; this fallback does not claim
//! ICU/locale sentence parity. Hosts can supply validated Source-produced chunks.
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

pub const DEFAULT_TARGET_WORDS: usize = 65;
pub const DEFAULT_MAX_CHARS: usize = 900;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTextSegment {
    pub text: String,
    /// Inclusive UTF-16 code-unit offset, as in JavaScript String.slice.
    pub start: usize,
    /// Exclusive UTF-16 code-unit offset.
    pub end: usize,
}
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SpeechSegmentationOptions {
    pub target_words: usize,
    pub max_chars: usize,
}
impl Default for SpeechSegmentationOptions {
    fn default() -> Self {
        Self {
            target_words: DEFAULT_TARGET_WORDS,
            max_chars: DEFAULT_MAX_CHARS,
        }
    }
}

pub fn is_ecmascript_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
pub fn trim_ecmascript(text: &str) -> &str {
    text.trim_matches(is_ecmascript_whitespace)
}
pub fn utf16_to_byte_offset(text: &str, offset: usize) -> Option<usize> {
    let mut units = 0;
    for (byte, c) in text.char_indices() {
        if units == offset {
            return Some(byte);
        }
        units += c.len_utf16();
        if units > offset {
            return None;
        }
    }
    (units == offset).then_some(text.len())
}
pub fn slice_utf16(text: &str, start: usize, end: usize) -> Option<&str> {
    if end < start {
        return None;
    }
    text.get(utf16_to_byte_offset(text, start)?..utf16_to_byte_offset(text, end)?)
}
/// Accept exact Source-produced Intl chunks without guessing Unicode boundaries.
pub fn validate_source_segments(source: &str, segments: &[SpeechTextSegment]) -> bool {
    let mut previous = 0;
    for segment in segments {
        if segment.start < previous
            || segment.end <= segment.start
            || slice_utf16(source, segment.start, segment.end) != Some(segment.text.as_str())
        {
            return false;
        }
        previous = segment.end;
    }
    true
}

fn space(unit: u16) -> bool {
    char::from_u32(unit as u32).is_some_and(is_ecmascript_whitespace)
}
fn trim(units: &[u16], mut start: usize, mut end: usize) -> Option<(usize, usize)> {
    while start < end && space(units[start]) {
        start += 1;
    }
    while end > start && space(units[end - 1]) {
        end -= 1;
    }
    (end > start).then_some((start, end))
}
fn word_count(text: &str) -> usize {
    static WORDS: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*").expect("Source word regex")
    });
    WORDS.find_iter(text).count()
}
fn sentences(units: &[u16]) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while index < units.len() {
        let paragraph =
            units[index] == 10 && units[index + 1..(index + 3).min(units.len())].contains(&10);
        let sentence = matches!(units[index], 46 | 33 | 63 | 0x2026);
        if paragraph || sentence {
            let mut end = index + 1;
            while end < units.len() && matches!(units[end], 34 | 39 | 0x2019 | 0x201d | 41 | 93) {
                end += 1;
            }
            if paragraph || end == units.len() || space(units[end]) {
                if let Some(span) = trim(units, start, end) {
                    spans.push(span);
                }
                start = end;
                index = end;
                continue;
            }
        }
        index += 1;
    }
    if let Some(tail) = trim(units, start, units.len()) {
        spans.push(tail);
    }
    spans
}
fn split_long(units: &[u16], span: (usize, usize), max: usize) -> Vec<(usize, usize)> {
    let (mut start, end) = span;
    let mut result = Vec::new();
    while end - start > max {
        let limit = start + max;
        let floor = start + max * 55 / 100;
        let clause = (floor..=limit).rev().find(|&i| {
            matches!(units[i - 1], 59 | 58 | 0x2014 | 10) && units.get(i).is_some_and(|&v| space(v))
        });
        let split = clause.or_else(|| (floor..=limit).rev().find(|&i| space(units[i])));
        let Some(split) = split else {
            break;
        };
        if let Some(piece) = trim(units, start, split) {
            result.push(piece);
        }
        start = split;
        while start < end && space(units[start]) {
            start += 1;
        }
    }
    if let Some(tail) = trim(units, start, end) {
        result.push(tail);
    }
    result
}
/// Execute the Source fallback; returned offsets are UTF-16, never UTF-8 bytes.
pub fn segment_speech_text(
    source: &str,
    options: SpeechSegmentationOptions,
) -> Vec<SpeechTextSegment> {
    let units: Vec<u16> = source.encode_utf16().collect();
    let target = options.target_words.max(1);
    let max = options.max_chars.max(80);
    let spans: Vec<_> = sentences(&units)
        .into_iter()
        .flat_map(|span| split_long(&units, span, max))
        .collect();
    let Some(&(mut start, mut end)) = spans.first() else {
        return Vec::new();
    };
    let mut words = word_count(slice_utf16(source, start, end).expect("fallback boundary"));
    let mut result = Vec::new();
    let flush = |start, end, result: &mut Vec<SpeechTextSegment>| {
        if let Some((start, end)) = trim(&units, start, end)
            && let Some(text) = slice_utf16(source, start, end)
        {
            result.push(SpeechTextSegment {
                text: text.to_owned(),
                start,
                end,
            });
        }
    };
    for &(next_start, next_end) in &spans[1..] {
        let next_words =
            word_count(slice_utf16(source, next_start, next_end).expect("fallback boundary"));
        if next_end - start > max || words >= target {
            flush(start, end, &mut result);
            start = next_start;
            end = next_end;
            words = next_words;
        } else {
            end = next_end;
            words += next_words;
        }
    }
    flush(start, end, &mut result);
    result
}
