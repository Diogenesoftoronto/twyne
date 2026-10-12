use super::seed::{ToolKind, split_sentences, word_count};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::sync::OnceLock;

pub const MAX_VERSIONS: usize = 4;
pub const STRUGGLE_THRESHOLD: f64 = 0.5;

const MAX_ATTEMPTS: usize = 5;
const GROWTH_CHARS: usize = 12;
const STALL_MS: f64 = 40_000.0;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockActivity {
    pub text: String,
    pub committed: String,
    pub versions: Vec<String>,
    pub inserted: usize,
    pub deleted: usize,
    pub undos: usize,
    pub rewrites: BTreeMap<usize, usize>,
    pub attempts: BTreeMap<usize, Vec<String>>,
    pub sentence_count_changes: usize,
    pub hedge_flips: usize,
    pub start_length: usize,
    pub first_at: f64,
    pub last_edit_at: f64,
    pub last_growth_at: f64,
    pub cooldown_until: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StruggleHint {
    pub kind: String,
    pub strength: f64,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StruggleReading {
    pub score: f64,
    pub hints: Vec<StruggleHint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentence_index: Option<usize>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadContext {
    #[serde(default)]
    pub cursor_at_end: bool,
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

fn shared_tail_trim(character: char) -> bool {
    js_whitespace(character)
        || matches!(
            character,
            '.' | '!' | '?' | '…' | '"' | '\'' | '”' | '’' | ')' | ']'
        )
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn hedge_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i-u:\b(?:perhaps|maybe|arguably|possibly|probably|somewhat|seems?|appears?|might|may|could|likely|suggests?|in some ways|to some extent|i think|i believe)\b)")
            .expect("valid hedge regex")
    })
}

pub fn hedge_count(text: &str) -> usize {
    hedge_regex().find_iter(text).count()
}

pub fn empty_activity(text: &str, now: f64) -> BlockActivity {
    let versions = if text.chars().any(|character| !js_whitespace(character)) {
        vec![text.to_owned()]
    } else {
        Vec::new()
    };
    BlockActivity {
        text: text.to_owned(),
        committed: text.to_owned(),
        versions,
        inserted: 0,
        deleted: 0,
        undos: 0,
        rewrites: BTreeMap::new(),
        attempts: BTreeMap::new(),
        sentence_count_changes: 0,
        hedge_flips: 0,
        start_length: utf16_len(text),
        first_at: now,
        last_edit_at: now,
        last_growth_at: now,
        cooldown_until: 0.0,
    }
}

pub fn record_edit(activity: &mut BlockActivity, after: &str, now: f64) {
    record_edit_with_undo(activity, after, now, false);
}

pub fn record_edit_with_undo(activity: &mut BlockActivity, after: &str, now: f64, undo: bool) {
    let before = activity.text.as_str();
    if before == after {
        return;
    }

    let before_units: Vec<u16> = before.encode_utf16().collect();
    let after_units: Vec<u16> = after.encode_utf16().collect();
    let min_length = before_units.len().min(after_units.len());
    let mut start = 0;
    while start < min_length && before_units[start] == after_units[start] {
        start += 1;
    }
    let mut end = 0;
    while end < min_length - start
        && before_units[before_units.len() - 1 - end] == after_units[after_units.len() - 1 - end]
    {
        end += 1;
    }

    let removed = before_units.len() - start - end;
    let added = after_units.len() - start - end;
    let grew = after_units
        .len()
        .saturating_sub(utf16_len(&activity.committed))
        >= GROWTH_CHARS;

    activity.text = after.to_owned();
    activity.inserted += added;
    activity.deleted += removed;
    if undo {
        activity.undos += 1;
    }
    activity.last_edit_at = now;
    if grew {
        activity.last_growth_at = now;
    }
}

fn shared_tail(left: &str, right: &str) -> usize {
    let left_end = left
        .char_indices()
        .rev()
        .find(|(_, character)| !shared_tail_trim(*character))
        .map(|(index, character)| index + character.len_utf8())
        .unwrap_or(0);
    let right_end = right
        .char_indices()
        .rev()
        .find(|(_, character)| !shared_tail_trim(*character))
        .map(|(index, character)| index + character.len_utf8())
        .unwrap_or(0);
    let left_units: Vec<u16> = left[..left_end].encode_utf16().collect();
    let right_units: Vec<u16> = right[..right_end].encode_utf16().collect();
    let mut count = 0;
    while count < left_units.len()
        && count < right_units.len()
        && left_units[left_units.len() - 1 - count] == right_units[right_units.len() - 1 - count]
    {
        count += 1;
    }
    count
}

fn strip_sentence_terminal_punctuation(text: &str) -> &str {
    text.trim_end_matches(['.', '!', '?', '…'])
}

pub fn commit_version(activity: &mut BlockActivity) {
    if activity.committed == activity.text {
        return;
    }

    let previous = activity.committed.clone();
    let current = activity.text.clone();
    let before = split_sentences(&previous);
    let after = split_sentences(&current);

    if before.len() != after.len() {
        if shared_tail(&previous, &current) >= 3 {
            activity.sentence_count_changes += 1;
        }
        activity.rewrites.clear();
        activity.attempts.clear();
    } else {
        let mut changed_index = None;
        let mut changed_count = 0;
        for (index, (was, now)) in before.iter().zip(after.iter()).enumerate() {
            if was.text != now.text {
                changed_index = Some(index);
                changed_count += 1;
            }
        }

        if changed_count == 1 {
            let index = changed_index.expect("one changed sentence has an index");
            let was = &before[index].text;
            let now = &after[index].text;
            let extended = now.starts_with(strip_sentence_terminal_punctuation(was));
            if !extended && utf16_len(was) >= 12 {
                *activity.rewrites.entry(index).or_default() += 1;
                let mut attempts = activity.attempts.remove(&index).unwrap_or_default();
                attempts.retain(|attempt| attempt != was);
                attempts.push(was.clone());
                if attempts.len() > MAX_ATTEMPTS {
                    let excess = attempts.len() - MAX_ATTEMPTS;
                    attempts.drain(..excess);
                }
                activity.attempts.insert(index, attempts);
            }
        }
    }

    if hedge_count(&previous) != hedge_count(&current) {
        activity.hedge_flips += 1;
    }

    activity.committed = current.clone();
    activity.versions.push(current);
    if activity.versions.len() > MAX_VERSIONS {
        let excess = activity.versions.len() - MAX_VERSIONS;
        activity.versions.drain(..excess);
    }
}

pub fn read_struggle(activity: &BlockActivity, now: f64, context: ReadContext) -> StruggleReading {
    if now < activity.cooldown_until {
        return StruggleReading {
            score: 0.0,
            hints: Vec::new(),
            sentence_index: None,
        };
    }

    let text = activity.text.as_str();
    let sentences = split_sentences(text);
    let words = word_count(text);
    let mut hints = Vec::new();

    let mut sentence_index = None;
    let mut most = 0;
    for (&index, &count) in &activity.rewrites {
        if count > most && index < sentences.len() {
            most = count;
            sentence_index = Some(index);
        }
    }
    if most >= 3 {
        hints.push(StruggleHint {
            kind: ToolKind::SentenceLab.id().to_owned(),
            strength: (0.6 + (most - 3) as f64 * 0.1).min(1.0),
            reason: format!("You've reworded one sentence {most} times."),
        });
    }

    let text_length = utf16_len(text);
    let length_delta = text_length.abs_diff(activity.start_length);
    let churn = (activity.inserted as f64 + activity.deleted as f64)
        / (40.0_f64.max(length_delta as f64 + 40.0));
    if sentences.len() >= 3
        && (activity.sentence_count_changes >= 2 || (churn >= 4.0 && words >= 80))
    {
        hints.push(StruggleHint {
            kind: ToolKind::RhythmStrip.id().to_owned(),
            strength: (0.5
                + activity.sentence_count_changes as f64 * 0.1
                + (churn - 4.0).max(0.0) * 0.02)
                .min(0.9),
            reason: if activity.sentence_count_changes >= 2 {
                "You've been splitting and joining sentences here.".to_owned()
            } else {
                "This paragraph keeps being reworked.".to_owned()
            },
        });
    }

    if activity.hedge_flips >= 2 && words >= 10 {
        hints.push(StruggleHint {
            kind: ToolKind::ClaimCheck.id().to_owned(),
            strength: (0.5 + (activity.hedge_flips - 2) as f64 * 0.15).min(0.9),
            reason: "You've been adding and removing qualifiers.".to_owned(),
        });
    }

    if context.cursor_at_end
        && words >= 25
        && activity.deleted >= 40
        && now - activity.last_growth_at >= STALL_MS
        && now - activity.last_edit_at >= 8_000.0
    {
        hints.push(StruggleHint {
            kind: ToolKind::ReaderQuestions.id().to_owned(),
            strength: 0.5,
            reason: "You've paused here after cutting.".to_owned(),
        });
    }

    hints.sort_by(|left, right| {
        right
            .strength
            .partial_cmp(&left.strength)
            .unwrap_or(Ordering::Equal)
    });
    let score = hints.first().map(|hint| hint.strength).unwrap_or(0.0);
    StruggleReading {
        score,
        hints,
        sentence_index,
    }
}

pub fn cool_down(activity: &mut BlockActivity, now: f64) {
    cool_down_for(activity, now, 5.0 * 60_000.0);
}

pub fn cool_down_for(activity: &mut BlockActivity, now: f64, ms: f64) {
    activity.cooldown_until = now + ms;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pass(activity: &mut BlockActivity, text: &str, now: f64) {
        record_edit(activity, text, now);
        commit_version(activity);
    }

    #[test]
    fn repeated_rewording_tracks_attempts_and_sentence_index() {
        let base = "The committee met on Tuesday. It decided nothing of consequence. Everyone went home. Nobody minded.";
        let mut activity = empty_activity(base, 0.0);
        pass(
            &mut activity,
            &base.replace("decided nothing of consequence", "settled nothing at all"),
            1.0,
        );
        pass(
            &mut activity,
            &base.replace("decided nothing of consequence", "reached no decision"),
            2.0,
        );
        pass(
            &mut activity,
            &base.replace("decided nothing of consequence", "adjourned undecided"),
            3.0,
        );

        let reading = read_struggle(&activity, 4.0, ReadContext::default());
        assert_eq!(reading.hints[0].kind, "sentence-lab");
        assert_eq!(reading.sentence_index, Some(1));
        assert!(activity.attempts[&1].contains(&"It decided nothing of consequence.".to_owned()));
    }

    #[test]
    fn hedge_flips_trigger_claim_check_with_ascii_word_boundaries() {
        let plain = "Remote work is better for deep focus than any open-plan office ever built.";
        let hedged =
            "Remote work is perhaps better for deep focus than any open-plan office ever built.";
        let mut activity = empty_activity(plain, 0.0);
        pass(&mut activity, hedged, 1.0);
        pass(&mut activity, plain, 2.0);
        pass(&mut activity, hedged, 3.0);

        assert_eq!(hedge_count(hedged), 1);
        assert_eq!(hedge_count("_perhaps_"), 0);
        assert!(
            read_struggle(&activity, 4.0, ReadContext::default())
                .hints
                .iter()
                .any(|hint| hint.kind == "claim-check")
        );
    }

    #[test]
    fn sentence_splits_with_shared_trailing_text_trigger_rhythm_strip() {
        let base = "The committee met on Tuesday. It decided nothing of consequence. Everyone went home. Nobody minded.";
        let mut activity = empty_activity(base, 0.0);
        pass(
            &mut activity,
            &base.replace("Tuesday. It", "Tuesday and it"),
            1.0,
        );
        pass(&mut activity, base, 2.0);
        pass(
            &mut activity,
            &base.replace("consequence. Everyone", "consequence, so everyone"),
            3.0,
        );

        assert!(
            read_struggle(&activity, 4.0, ReadContext::default())
                .hints
                .iter()
                .any(|hint| hint.kind == "rhythm-strip")
        );
    }

    #[test]
    fn cooldown_is_quiet_before_its_deadline_but_not_at_equality() {
        let base = "The committee met on Tuesday. It decided nothing of consequence. Everyone went home. Nobody minded.";
        let mut activity = empty_activity(base, 0.0);
        for index in 1..=4 {
            pass(
                &mut activity,
                &base.replace(
                    "nothing of consequence",
                    &format!("nothing, attempt {index}"),
                ),
                index as f64,
            );
        }
        cool_down_for(&mut activity, 5.0, 1_000.0);
        assert_eq!(
            read_struggle(&activity, 1_004.0, ReadContext::default()).score,
            0.0
        );
        assert!(read_struggle(&activity, 1_005.0, ReadContext::default()).score > 0.0);
    }

    #[test]
    fn edit_counts_and_growth_use_utf16_code_units() {
        let mut activity = empty_activity("a😀b", 0.0);
        record_edit_with_undo(&mut activity, "a😃b", 1.0, true);
        assert_eq!(activity.deleted, 1);
        assert_eq!(activity.inserted, 1);
        assert_eq!(activity.undos, 1);
        assert_eq!(activity.start_length, 4);
    }
}
