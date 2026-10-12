//! Generation stream accumulator, reasoning tags processing, and snapshot state.
//!
//! Authoritative source:
//! - `src/utils/generation-stream.ts`
//! - `src/utils/reasoning-tags.ts`
//! - `src/utils/interview-stream.ts`
//!
//! Handles independent lifecycles for text and reasoning parts, stripping model-authored
//! thinking tags, withholding trailing partial tags mid-stream to prevent UI flicker,
//! and suppressing structured contract markers (DOSSIER/PROBE/SYNTHESIZE).

use regex::Regex;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamPartStatus {
    Pending,
    Running,
    Complete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamRunStatus {
    Running,
    Complete,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivePart {
    Reasoning,
    Text,
    None,
}

impl Serialize for ActivePart {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Reasoning => Some("reasoning").serialize(serializer),
            Self::Text => Some("text").serialize(serializer),
            Self::None => Option::<&str>::None.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for ActivePart {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match Option::<String>::deserialize(deserializer)?.as_deref() {
            None => Ok(Self::None),
            Some("reasoning") => Ok(Self::Reasoning),
            Some("text") => Ok(Self::Text),
            _ => Err(serde::de::Error::custom("Invalid active stream part")),
        }
    }
}

/// Framework-neutral equivalent of assistant-ui's message content-part state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStreamSnapshot {
    pub text: String,
    pub reasoning: String,
    pub active_part: ActivePart,
    pub text_status: StreamPartStatus,
    pub reasoning_status: StreamPartStatus,
    pub status: StreamRunStatus,
}

impl GenerationStreamSnapshot {
    pub fn empty() -> Self {
        Self {
            text: String::new(),
            reasoning: String::new(),
            active_part: ActivePart::None,
            text_status: StreamPartStatus::Pending,
            reasoning_status: StreamPartStatus::Pending,
            status: StreamRunStatus::Running,
        }
    }

    pub fn completed(text: String, reasoning: String) -> Self {
        Self {
            text_status: if text.is_empty() {
                StreamPartStatus::Pending
            } else {
                StreamPartStatus::Complete
            },
            reasoning_status: if reasoning.is_empty() {
                StreamPartStatus::Pending
            } else {
                StreamPartStatus::Complete
            },
            text,
            reasoning,
            active_part: ActivePart::None,
            status: StreamRunStatus::Complete,
        }
    }
}

/// Inputs driven by provider SSE events or deltas.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GenerationStreamInput {
    TextDelta(String),
    ReasoningStart,
    ReasoningDelta(String),
    ReasoningEnd,
    Finish,
    Error(String),
}

// ── Reasoning Tag Parsers (Source-authoritative from reasoning-tags.ts) ──

struct TagMatch {
    start: usize,
    end: usize,
    is_closing: bool,
}

fn js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn trim_js(text: &str) -> &str {
    text.trim_matches(js_whitespace)
}

fn ascii_prefix(text: &str, prefix: &str) -> bool {
    text.get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
}

/// Exact Source regex shape: an optional slash immediately follows `<`, then
/// JS whitespace, think/thinking and an ASCII word boundary. The suffix may
/// contain any bytes up to the next `>`; this is a text filter, not an HTML parser.
fn find_reasoning_tags(text: &str) -> Vec<TagMatch> {
    let mut matches = Vec::new();
    let mut cursor = 0;
    while let Some(relative) = text[cursor..].find('<') {
        let start = cursor + relative;
        let mut name = start + 1;
        if text[name..].starts_with('/') {
            name += 1;
        }
        name += text[name..].len() - text[name..].trim_start_matches(js_whitespace).len();
        if !ascii_prefix(&text[name..], "think") {
            cursor = start + 1;
            continue;
        }
        let mut after = name + 5;
        if ascii_prefix(&text[after..], "ing") {
            after += 3;
        }
        if text
            .as_bytes()
            .get(after)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        {
            cursor = start + 1;
            continue;
        }
        let Some(close) = text[after..].find('>') else {
            break;
        };
        let end = after + close + 1;
        let normalized: String = text[start..end]
            .chars()
            .filter(|c| !js_whitespace(*c))
            .collect();
        matches.push(TagMatch {
            start,
            end,
            is_closing: normalized.starts_with("</") || normalized.ends_with("/>"),
        });
        cursor = end;
    }
    matches
}

/// Did the model emit any reasoning tags?
pub fn has_reasoning_tags(text: &str) -> bool {
    !find_reasoning_tags(text).is_empty()
}

/// Strip reasoning blocks from model text output.
pub fn strip_reasoning_tags(text: &str) -> String {
    let matches = find_reasoning_tags(text);
    let mut visible = String::new();
    let mut cursor = 0;
    let mut depth: usize = 0;

    for m in matches {
        if depth == 0 {
            visible.push_str(&text[cursor..m.start]);
        }
        if m.is_closing {
            depth = depth.saturating_sub(1);
        } else {
            depth += 1;
        }
        cursor = m.end;
    }

    if depth == 0 && cursor < text.len() {
        visible.push_str(&text[cursor..]);
    }

    clean_reasoning_whitespace(&visible)
}

/// Extract tagged reasoning from text.
pub fn extract_tagged_reasoning(text: &str) -> String {
    let matches = find_reasoning_tags(text);
    if matches.is_empty() {
        return String::new();
    }

    let mut reasoning = String::new();
    let mut cursor = 0;
    let mut depth: usize = 0;

    for m in matches {
        if depth > 0 {
            reasoning.push_str(&text[cursor..m.start]);
        }
        if m.is_closing {
            depth = depth.saturating_sub(1);
        } else {
            depth += 1;
        }
        cursor = m.end;
    }

    if depth > 0 && cursor < text.len() {
        reasoning.push_str(&text[cursor..]);
    }

    clean_reasoning_whitespace(&reasoning)
}

fn clean_reasoning_whitespace(text: &str) -> String {
    static PATTERNS: OnceLock<[Regex; 3]> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            Regex::new("[ \t]+\n").expect("Source whitespace regex"),
            Regex::new("\n[ \t]+").expect("Source whitespace regex"),
            Regex::new("\n{3,}").expect("Source whitespace regex"),
        ]
    });
    let text = patterns[0].replace_all(text, "\n");
    let text = patterns[1].replace_all(&text, "\n");
    let text = patterns[2].replace_all(&text, "\n\n");
    trim_js(&text).to_owned()
}

/// Check if there is an open reasoning block currently.
pub fn has_open_reasoning_block(text: &str) -> bool {
    let matches = find_reasoning_tags(text);
    let mut depth: usize = 0;
    for m in matches {
        if m.is_closing {
            depth = depth.saturating_sub(1);
        } else {
            depth += 1;
        }
    }
    depth > 0
}

/// Drop tag markers (<think> and </think>) while keeping the content as fallback.
pub fn remove_reasoning_tag_markers(text: &str) -> String {
    let matches = find_reasoning_tags(text);
    if matches.is_empty() {
        return trim_js(text).to_string();
    }
    let mut result = String::new();
    let mut cursor = 0;
    for m in matches {
        result.push_str(&text[cursor..m.start]);
        cursor = m.end;
    }
    if cursor < text.len() {
        result.push_str(&text[cursor..]);
    }
    trim_js(&result).to_string()
}

/// Withhold any trailing fragment that could still become a reasoning tag.
/// Matches `trimPartialReasoningTag` in `reasoning-tags.ts`.
pub fn trim_partial_reasoning_tag(visible: &str) -> String {
    if let Some(index) = visible.rfind('<') {
        let suffix = &visible[index + 1..];
        let candidate = suffix
            .strip_prefix('/')
            .map_or(suffix, |tail| tail.trim_start_matches(js_whitespace));
        // Source withholds `<` but does not withhold a bare `</`.
        let partial = suffix.is_empty()
            || (!candidate.is_empty()
                && "thinking"
                    .get(..candidate.len())
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case(candidate)));
        if partial {
            return trim_js(&visible[..index]).to_owned();
        }
    }
    visible.to_owned()
}

const CONTRACT_TAGS: [&str; 3] = ["DOSSIER", "PROBE", "SYNTHESIZE"];

pub fn filter_interview_stream_markers(visible: &str) -> String {
    // Regex alternation chooses the earliest line start, regardless of tag name.
    let starts = std::iter::once((0, 0)).chain(
        visible
            .match_indices('\n')
            .map(|(index, _)| (index, index + 1)),
    );
    for (index, offset) in starts {
        let tail = visible[offset..].trim_start_matches(js_whitespace);
        if CONTRACT_TAGS
            .iter()
            .any(|tag| ascii_prefix(tail, tag) && tail.as_bytes().get(tag.len()) == Some(&b':'))
        {
            return trim_js(&visible[..index]).to_owned();
        }
    }
    // The Source partial regex runs against `\n${visible}`, so an entire
    // beginning tag prefix is withheld too. No trailing whitespace is allowed.
    let starts = std::iter::once(0).chain(visible.match_indices('\n').map(|(index, _)| index + 1));
    for offset in starts {
        let tail = visible[offset..].trim_start_matches(js_whitespace);
        if !tail.is_empty()
            && CONTRACT_TAGS.iter().any(|tag| {
                tag.get(..tail.len())
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case(tail))
            })
        {
            let prefix_end = offset.saturating_sub(1);
            return trim_js(&visible[..prefix_end]).to_owned();
        }
    }
    trim_js(visible).to_owned()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterviewStreamPhase {
    Reasoning,
    Answer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterviewStreamSnapshot {
    pub text: String,
    pub reasoning: String,
    pub phase: InterviewStreamPhase,
}

fn combined_reasoning(native: &str, tagged: String) -> String {
    let native = trim_js(native);
    if native.is_empty() {
        return tagged;
    }
    if tagged.is_empty() || tagged == native {
        return native.to_owned();
    }
    format!("{native}\n\n{tagged}")
}

/// Source `createInterviewStreamSnapshot`; ordinary generation snapshots do
/// not filter structured interview contracts. Partial think-tag behavior also
/// remains specific to the original consumer rather than invented here.
pub fn create_interview_stream_snapshot(
    raw_text: &str,
    native_reasoning: &str,
) -> InterviewStreamSnapshot {
    let text = filter_interview_stream_markers(&strip_reasoning_tags(raw_text));
    let phase = if text.is_empty() {
        InterviewStreamPhase::Reasoning
    } else {
        InterviewStreamPhase::Answer
    };
    InterviewStreamSnapshot {
        text,
        reasoning: combined_reasoning(native_reasoning, extract_tagged_reasoning(raw_text)),
        phase,
    }
}

pub fn text_snapshot(text: String, status: StreamRunStatus) -> GenerationStreamSnapshot {
    let text_status = if text.is_empty() {
        StreamPartStatus::Pending
    } else if status == StreamRunStatus::Running {
        StreamPartStatus::Running
    } else {
        StreamPartStatus::Complete
    };
    GenerationStreamSnapshot {
        text,
        reasoning: String::new(),
        active_part: ActivePart::None,
        text_status,
        reasoning_status: StreamPartStatus::Pending,
        status,
    }
}

pub fn snapshot_from_record(
    text: String,
    reasoning: String,
    phase: InterviewStreamPhase,
    status: StreamRunStatus,
) -> GenerationStreamSnapshot {
    let running = status == StreamRunStatus::Running;
    let reasoning_active = running && phase == InterviewStreamPhase::Reasoning;
    GenerationStreamSnapshot {
        text_status: if text.is_empty() {
            StreamPartStatus::Pending
        } else if running {
            StreamPartStatus::Running
        } else {
            StreamPartStatus::Complete
        },
        reasoning_status: if reasoning_active {
            StreamPartStatus::Running
        } else if reasoning.is_empty() {
            StreamPartStatus::Pending
        } else {
            StreamPartStatus::Complete
        },
        active_part: if !running {
            ActivePart::None
        } else if reasoning_active {
            ActivePart::Reasoning
        } else {
            ActivePart::Text
        },
        text,
        reasoning,
        status,
    }
}

// ── Stream Accumulator ──

/// Accumulator port of `createGenerationStreamAccumulator` from `generation-stream.ts`.
pub struct GenerationStreamAccumulator {
    raw_text: String,
    native_reasoning: String,
    text_started: bool,
    reasoning_started: bool,
    reasoning_ended: bool,
    status: StreamRunStatus,
    suppress_interview_markers: bool,
}

impl Default for GenerationStreamAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

impl GenerationStreamAccumulator {
    pub fn new() -> Self {
        Self {
            raw_text: String::new(),
            native_reasoning: String::new(),
            text_started: false,
            reasoning_started: false,
            reasoning_ended: false,
            status: StreamRunStatus::Running,
            suppress_interview_markers: false,
        }
    }

    pub fn with_interview_marker_suppression(mut self, suppress: bool) -> Self {
        self.suppress_interview_markers = suppress;
        self
    }

    pub fn push(&mut self, input: GenerationStreamInput) -> GenerationStreamSnapshot {
        match input {
            GenerationStreamInput::TextDelta(delta) => {
                self.raw_text.push_str(&delta);
                self.text_started = true;
            }
            GenerationStreamInput::ReasoningStart => {
                self.reasoning_started = true;
                self.reasoning_ended = false;
            }
            GenerationStreamInput::ReasoningDelta(delta) => {
                self.reasoning_started = true;
                self.native_reasoning.push_str(&delta);
            }
            GenerationStreamInput::ReasoningEnd => {
                self.reasoning_ended = true;
            }
            GenerationStreamInput::Finish => {
                self.reasoning_ended = true;
                self.status = StreamRunStatus::Complete;
            }
            GenerationStreamInput::Error(_) => {
                self.reasoning_ended = true;
                self.status = StreamRunStatus::Error;
            }
        }
        self.snapshot()
    }

    pub fn snapshot(&self) -> GenerationStreamSnapshot {
        let tagged_reasoning = extract_tagged_reasoning(&self.raw_text);
        let reasoning = combined_reasoning(&self.native_reasoning, tagged_reasoning);

        let tagged_reasoning_running = has_open_reasoning_block(&self.raw_text);
        let reasoning_running = self.status == StreamRunStatus::Running
            && (tagged_reasoning_running
                || (self.reasoning_started && !self.reasoning_ended && !self.text_started));

        let stripped = strip_reasoning_tags(&self.raw_text);
        let mut text = if self.status == StreamRunStatus::Running {
            trim_partial_reasoning_tag(&stripped)
        } else {
            stripped
        };

        if self.suppress_interview_markers {
            text = filter_interview_stream_markers(&text);
        }

        let active_part = if self.status != StreamRunStatus::Running {
            ActivePart::None
        } else if reasoning_running {
            ActivePart::Reasoning
        } else if self.text_started {
            ActivePart::Text
        } else {
            ActivePart::None
        };

        let text_status = if self.text_started && self.status == StreamRunStatus::Running {
            StreamPartStatus::Running
        } else if self.text_started {
            StreamPartStatus::Complete
        } else {
            StreamPartStatus::Pending
        };

        let reasoning_status = if reasoning_running {
            StreamPartStatus::Running
        } else if !reasoning.is_empty() {
            StreamPartStatus::Complete
        } else {
            StreamPartStatus::Pending
        };

        GenerationStreamSnapshot {
            text,
            reasoning,
            active_part,
            text_status,
            reasoning_status,
            status: self.status,
        }
    }
}

#[cfg(test)]
#[path = "stream_tests.rs"]
mod tests;
