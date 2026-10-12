use regex::Regex;
use serde_json::{json, Number, Value};
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolKind {
    SentenceLab,
    RhythmStrip,
    ClaimCheck,
    ReaderQuestions,
}

impl ToolKind {
    pub const fn id(self) -> &'static str {
        match self {
            Self::SentenceLab => "sentence-lab",
            Self::RhythmStrip => "rhythm-strip",
            Self::ClaimCheck => "claim-check",
            Self::ReaderQuestions => "reader-questions",
        }
    }

    pub const fn component(self) -> &'static str {
        match self {
            Self::SentenceLab => "SentenceLab",
            Self::RhythmStrip => "RhythmStrip",
            Self::ClaimCheck => "ClaimCheck",
            Self::ReaderQuestions => "ReaderQuestions",
        }
    }

    pub const fn title(self) -> &'static str {
        match self {
            Self::SentenceLab => "Sentence Lab",
            Self::RhythmStrip => "Rhythm Strip",
            Self::ClaimCheck => "Claim Check",
            Self::ReaderQuestions => "Reader Questions",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SentenceSpan {
    pub text: String,
    pub from: usize,
    pub to: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SavedToolConfig {
    pub target_min: Option<f64>,
    pub target_max: Option<f64>,
    pub slots: Option<Vec<String>>,
    pub angle: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SeedOptions {
    pub sentence_index: Option<i64>,
    pub claim_index: Option<i64>,
    pub attempts: BTreeMap<usize, Vec<String>>,
    pub filled: BTreeMap<String, bool>,
    pub config: SavedToolConfig,
}

fn js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

fn js_trim_bounds(text: &str) -> (usize, usize) {
    let start = text
        .char_indices()
        .find(|(_, character)| !js_whitespace(*character))
        .map(|(index, _)| index)
        .unwrap_or(text.len());
    let end = text
        .char_indices()
        .rev()
        .find(|(_, character)| !js_whitespace(*character))
        .map(|(index, character)| index + character.len_utf8())
        .unwrap_or(start);
    (start, end)
}

fn js_trim(text: &str) -> &str {
    let (start, end) = js_trim_bounds(text);
    &text[start..end]
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn sentence_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r#"[^.!?…]+(?:[.!?…]+["'”’ )\]]*|$)"#).expect("valid sentence regex"))
}

pub fn split_sentences(text: &str) -> Vec<SentenceSpan> {
    sentence_regex()
        .find_iter(text)
        .filter_map(|matched| {
            let raw = &text[matched.start()..matched.end()];
            let (start, end) = js_trim_bounds(raw);
            if start == end {
                return None;
            }
            let trimmed = &raw[start..end];
            let from = utf16_len(&text[..matched.start()]) + utf16_len(&raw[..start]);
            Some(SentenceSpan {
                text: trimmed.to_owned(),
                from,
                to: from + utf16_len(trimmed),
            })
        })
        .collect()
}

pub fn word_count(text: &str) -> usize {
    let mut count = 0;
    let mut in_word = false;
    for character in text.chars() {
        if js_whitespace(character) {
            in_word = false;
        } else if !in_word {
            count += 1;
            in_word = true;
        }
    }
    count
}

fn longest_sentence(sentences: &[SentenceSpan]) -> usize {
    let mut best = 0;
    let mut best_words = -1isize;
    for (index, sentence) in sentences.iter().enumerate() {
        let words = word_count(&sentence.text) as isize;
        if words > best_words {
            best = index;
            best_words = words;
        }
    }
    best
}

fn ascii_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn has_strong_claim_word(text: &str) -> bool {
    const TERMS: &[&str] = &[
        "is", "are", "was", "were", "must", "will", "always", "never", "every", "all",
        "no one", "prove", "proves", "show", "shows",
    ];
    let bytes = text.as_bytes();
    TERMS.iter().any(|term| {
        let needle = term.as_bytes();
        bytes.windows(needle.len()).enumerate().any(|(start, window)| {
            if !window.eq_ignore_ascii_case(needle) {
                return false;
            }
            let end = start + needle.len();
            (start == 0 || !ascii_word_byte(bytes[start - 1]))
                && (end == bytes.len() || !ascii_word_byte(bytes[end]))
        })
    })
}

fn strongest_claim(sentences: &[SentenceSpan]) -> usize {
    sentences
        .iter()
        .position(|sentence| {
            has_strong_claim_word(&sentence.text) && !js_trim(&sentence.text).ends_with('?')
        })
        .unwrap_or(0)
}

fn json_number(number: f64) -> Value {
    Number::from_f64(number)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn js_max(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() {
        return f64::NAN;
    }
    if left == right && left == 0.0 {
        return 0.0;
    }
    if left > right { left } else { right }
}

fn make_spec(kind: ToolKind, props: Value) -> Value {
    json!({
        "root": "tool",
        "elements": {
            "tool": {
                "type": kind.component(),
                "props": props,
                "children": []
            }
        }
    })
}

pub fn seed_spec(kind: ToolKind, passage: &str, options: &SeedOptions) -> Value {
    let sentences = split_sentences(passage);
    match kind {
        ToolKind::SentenceLab => {
            let requested = options
                .sentence_index
                .map(|index| index.max(0) as usize)
                .unwrap_or_else(|| longest_sentence(&sentences));
            let index = requested.min(sentences.len().saturating_sub(1));
            let sentence = sentences
                .get(index)
                .map(|span| span.text.as_str())
                .unwrap_or_else(|| js_trim(passage));
            let attempts = options
                .attempts
                .get(&index)
                .into_iter()
                .flatten()
                .filter(|attempt| attempt.as_str() != sentence)
                .rev()
                .take(5)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .cloned()
                .collect::<Vec<_>>();
            make_spec(
                kind,
                json!({
                    "sentence": sentence,
                    "attempts": attempts,
                    "variants": []
                }),
            )
        }
        ToolKind::RhythmStrip => {
            let target_min = options.config.target_min.unwrap_or(8.0);
            let target_max = js_max(
                target_min + 1.0,
                options.config.target_max.unwrap_or(28.0),
            );
            let rhythm_sentences = sentences
                .iter()
                .take(40)
                .map(|sentence| {
                    json!({
                        "text": sentence.text,
                        "words": word_count(&sentence.text)
                    })
                })
                .collect::<Vec<_>>();
            make_spec(
                kind,
                json!({
                    "sentences": rhythm_sentences,
                    "targetMin": json_number(target_min),
                    "targetMax": json_number(target_max)
                }),
            )
        }
        ToolKind::ClaimCheck => {
            let index = options
                .claim_index
                .map(|index| usize::try_from(index).ok())
                .unwrap_or_else(|| Some(strongest_claim(&sentences)));
            let claim = index
                .and_then(|index| sentences.get(index))
                .map(|sentence| sentence.text.as_str())
                .unwrap_or_else(|| js_trim(passage));
            let default_slots = ["A source", "An example", "A number"];
            let slots = options
                .config
                .slots
                .as_ref()
                .filter(|slots| !slots.is_empty())
                .unwrap_or(&default_slots);
            let slot_values = slots
                .iter()
                .map(|label| {
                    json!({
                        "label": label,
                        "filled": options.filled.get(label).copied().unwrap_or(false)
                    })
                })
                .collect::<Vec<_>>();
            make_spec(
                kind,
                json!({
                    "claim": claim,
                    "slots": slot_values
                }),
            )
        }
        ToolKind::ReaderQuestions => make_spec(
            kind,
            json!({
                "angle": options.config.angle.as_deref().unwrap_or(""),
                "questions": []
            }),
        ),
    }
}

const READER_QUESTION_BANK: [&str; 4] = [
    "What does this let me understand that I couldn't before?",
    "Who says so, and why should I trust them?",
    "What does that look like in practice?",
    "Why does this matter to me right now?",
];

pub fn offline_fill(seed: &Value) -> (Value, Option<&'static str>) {
    let component = seed.pointer("/elements/tool/type").and_then(Value::as_str);
    let mut filled = seed.clone();
    match component {
        Some("ReaderQuestions") => {
            if let Some(props) = filled
                .pointer_mut("/elements/tool/props")
                .and_then(Value::as_object_mut)
            {
                props.insert(
                    "questions".to_owned(),
                    json!(READER_QUESTION_BANK[..3].to_vec()),
                );
            }
            (
                filled,
                Some(concat!(
                    "General questions ",
                    "\u{2014}",
                    " connect a model in Settings for ones about this passage."
                )),
            )
        }
        Some("SentenceLab") => (
            filled,
            Some(concat!(
                "Your own attempts only ",
                "\u{2014}",
                " connect a model in Settings for fresh variants."
            )),
        ),
        _ => (filled, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_js_trim_whitespace_and_utf16_offsets() {
        let spans = split_sentences("\u{FEFF}😀\u{00A0}Hi. \u{0085}Next.");
        assert_eq!(spans[0].text, "😀\u{00A0}Hi.");
        assert_eq!((spans[0].from, spans[0].to), (1, 7));
        assert_eq!(spans[1].text, "\u{0085}Next.");
        assert_eq!((spans[1].from, spans[1].to), (8, 14));
        assert_eq!(word_count("one\u{FEFF}two\u{0085}three"), 2);
    }

    #[test]
    fn keeps_closing_quote_with_preceding_punctuation() {
        let spans = split_sentences("A.”Next?");
        assert_eq!(spans.iter().map(|span| span.text.as_str()).collect::<Vec<_>>(), ["A.”", "Next?"]);
    }

    #[test]
    fn longest_sentence_ties_keep_the_first() {
        let spec = seed_spec(ToolKind::SentenceLab, "First is long. A is B.", &SeedOptions::default());
        assert_eq!(spec["elements"]["tool"]["props"]["sentence"], "First is long.");
    }

    #[test]
    fn claim_indices_outside_the_sentence_range_use_trimmed_passage() {
        let passage = "  Maybe? Still perhaps.  ";
        let negative = SeedOptions {
            claim_index: Some(-1),
            ..SeedOptions::default()
        };
        let out_of_bounds = SeedOptions {
            claim_index: Some(20),
            ..SeedOptions::default()
        };
        assert_eq!(
            seed_spec(ToolKind::ClaimCheck, passage, &negative)["elements"]["tool"]["props"]["claim"],
            "Maybe? Still perhaps."
        );
        assert_eq!(
            seed_spec(ToolKind::ClaimCheck, passage, &out_of_bounds)["elements"]["tool"]["props"]["claim"],
            "Maybe? Still perhaps."
        );
    }

    #[test]
    fn earlier_attempts_exclude_current_and_keep_the_last_five_in_order() {
        let mut options = SeedOptions {
            sentence_index: Some(0),
            ..SeedOptions::default()
        };
        options.attempts.insert(
            0,
            vec![
                "old1".to_owned(),
                "old2".to_owned(),
                "Current sentence.".to_owned(),
                "old3".to_owned(),
                "old4".to_owned(),
                "old5".to_owned(),
                "old6".to_owned(),
            ],
        );
        let spec = seed_spec(ToolKind::SentenceLab, "Current sentence.", &options);
        assert_eq!(
            spec["elements"]["tool"]["props"]["attempts"],
            json!(["old2", "old3", "old4", "old5", "old6"])
        );
    }

    #[test]
    fn offline_reader_questions_match_the_no_provider_branch() {
        let seed = seed_spec(ToolKind::ReaderQuestions, "A passage.", &SeedOptions::default());
        let (filled, notice) = offline_fill(&seed);
        assert_eq!(
            filled["elements"]["tool"]["props"]["questions"],
            json!([
                "What does this let me understand that I couldn't before?",
                "Who says so, and why should I trust them?",
                "What does that look like in practice?"
            ])
        );
        assert_eq!(
            notice,
            Some("General questions \u{2014} connect a model in Settings for ones about this passage.")
        );
    }

    #[test]
    fn offline_sentence_lab_notice_and_other_tools_are_unchanged() {
        let sentence_seed = seed_spec(ToolKind::SentenceLab, "A sentence.", &SeedOptions::default());
        let (sentence_filled, notice) = offline_fill(&sentence_seed);
        assert_eq!(sentence_filled, sentence_seed);
        assert_eq!(
            notice,
            Some("Your own attempts only \u{2014} connect a model in Settings for fresh variants.")
        );
        let rhythm_seed = seed_spec(ToolKind::RhythmStrip, "A sentence.", &SeedOptions::default());
        assert_eq!(offline_fill(&rhythm_seed), (rhythm_seed, None));
    }
}
