//! Source-shaped structured reply projections, bounded at explicit parse boundaries.
//! No scores/targets are generated. Unsupported malformed/UTF16 slices are refused.
use super::{request::js_trim, stream_accumulator::strip_reasoning_tags};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, sync::OnceLock};
const MAX_CONTRACT_BYTES: usize = 1024 * 1024;
const MAX_TARGET_RECORDS: usize = 4096;
const JS_SPACE: &str = r"\u{0009}-\u{000d}\u{0020}\u{00a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JudgeOutput {
    pub score: u8,
    pub rationale: String,
}
pub fn clamp_score(score: f64) -> u8 {
    if !score.is_finite() {
        5
    } else {
        score.round().clamp(1.0, 10.0) as u8
    }
}
pub fn strip_json_fences(text: &str) -> String {
    static FENCE: OnceLock<Regex> = OnceLock::new();
    let stripped = FENCE
        .get_or_init(|| Regex::new(r"(?i-u:```(?:json)?)").unwrap())
        .replace_all(text, "");
    js_trim(&stripped).to_owned()
}
fn object_end(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, ch) in text[open..].char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        // Source findJsonObjectEnd escapes next code unit even outside strings.
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        if ch == '{' {
            depth += 1;
        }
        if ch == '}' {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some(open + offset + 1);
            }
        }
    }
    None
}
pub fn extract_first_json_object(text: &str) -> Option<String> {
    if text.len() > MAX_CONTRACT_BYTES {
        return None;
    }
    let open = text.find('{')?;
    let end = object_end(text, open)?;
    Some(text[open..end].into())
}
/// start/end are Source JavaScript UTF16 offsets, not UTF8 bytes or native scalars.
#[derive(Clone, Debug, PartialEq)]
pub struct TaggedJsonSegment {
    pub tag: String,
    pub value: Value,
    pub start: usize,
    pub end: usize,
}
pub fn extract_tagged_json(text: &str, tag: &str) -> Option<TaggedJsonSegment> {
    if text.len() > MAX_CONTRACT_BYTES || !matches!(tag, "DOSSIER" | "SYNTHESIZE" | "PROBE") {
        return None;
    }
    let marker = format!("{}:", tag.to_ascii_lowercase());
    let start = text.to_ascii_lowercase().find(&marker)?;
    let open = start + marker.len() + text[start + marker.len()..].find('{')?;
    let end = object_end(text, open)?;
    Some(TaggedJsonSegment {
        tag: tag.into(),
        value: serde_json::from_str(&text[open..end]).ok()?,
        start: text[..start].encode_utf16().count(),
        end: text[..end].encode_utf16().count(),
    })
}
pub fn parse_judge_output(text: &str) -> Option<JudgeOutput> {
    if text.len() > MAX_CONTRACT_BYTES {
        return None;
    }
    let stripped = strip_json_fences(&strip_reasoning_tags(text));
    let candidate = extract_first_json_object(&stripped).unwrap_or(stripped);
    let parsed = serde_json::from_str::<Value>(&candidate);
    // JS JSON.parse admits overflow as Infinity; serde_json cannot retain that
    // value. Refuse this native representation boundary instead of taking a
    // misleading loose match (e.g. score:1e400 becoming the score 1).
    if parsed
        .as_ref()
        .is_err_and(|error| error.to_string().starts_with("number out of range"))
    {
        return None;
    }
    if let Ok(value) = parsed
        && let (Some(score), Some(rationale)) = (
            value.get("score").and_then(Value::as_f64),
            value.get("rationale").and_then(Value::as_str),
        )
    {
        return Some(JudgeOutput {
            score: clamp_score(score),
            rationale: rationale.into(),
        });
    }
    static SCORE: OnceLock<Regex> = OnceLock::new();
    static RATIONALE: OnceLock<Regex> = OnceLock::new();
    let score = SCORE.get_or_init(|| {
        Regex::new(&format!(
            r#"(?i-u:"?score"?)[{JS_SPACE}]*[:=][{JS_SPACE}]*([0-9]+)"#
        ))
        .unwrap()
    });
    let rationale = RATIONALE.get_or_init(|| {
        Regex::new(&format!(
            r#"(?i-u:"?rationale"?)[{JS_SPACE}]*[:=][{JS_SPACE}]*"([^"]+)""#
        ))
        .unwrap()
    });
    let captures = score.captures(&candidate)?;
    let score = captures[1].parse::<f64>().ok()?;
    let rationale = rationale
        .captures(&candidate)
        .map(|m| m[1].into())
        .unwrap_or_else(|| {
            "The draft does part of the work and leaves the rest to the writer.".into()
        });
    Some(JudgeOutput {
        score: clamp_score(score),
        rationale,
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResearchTargetKind {
    Quote,
    Work,
    Person,
    Statistic,
    Claim,
    Event,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResearchTarget {
    pub id: String,
    pub kind: ResearchTargetKind,
    pub anchor: String,
    pub reason: String,
    pub query: String,
    pub importance: u8,
}

// Exact slice only when its UTF16 endpoint is a native scalar boundary. Refuse
// unpaired surrogate output rather than silently changing Source or panicking.
fn slice_utf16(text: &str, max: usize) -> Option<&str> {
    let mut units = 0;
    for (offset, c) in text.char_indices() {
        if units == max {
            return Some(&text[..offset]);
        }
        units += c.len_utf16();
        if units > max {
            return None;
        }
    }
    Some(text)
}
fn hash_token(value: &str) -> String {
    let mut hash = 0x811c9dc5u32;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x01000193);
    }
    let mut n = hash;
    let mut digits = Vec::new();
    loop {
        let d = n % 36;
        digits.push(char::from_digit(d, 36).unwrap());
        n /= 36;
        if n == 0 {
            break;
        }
    }
    digits.iter().rev().collect()
}
fn target_list(value: &Value) -> Vec<&Value> {
    match value {
        Value::Array(values) => values.iter().filter(|v| v.is_object()).collect(),
        Value::Object(object) => ["targets", "items", "results"]
            .iter()
            .find_map(|key| object.get(*key).filter(|v| v.is_array()).map(target_list))
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}
fn clean_targets(candidate: &str) -> Result<Vec<ResearchTarget>, &'static str> {
    let value = match serde_json::from_str::<Value>(candidate) {
        Ok(value) => value,
        Err(error) if error.to_string().starts_with("number out of range") => {
            return Err("Unsupported Source nonfinite JSON number");
        }
        Err(_) => return Ok(Vec::new()),
    };
    let records = target_list(&value);
    if records.len() > MAX_TARGET_RECORDS {
        return Err("Research record limit exceeded");
    }
    let mut anchors = HashSet::new();
    let mut queries = HashSet::new();
    let mut targets = Vec::new();
    for record in records {
        let anchor = js_trim(record.get("anchor").and_then(Value::as_str).unwrap_or(""));
        let raw_query = js_trim(record.get("query").and_then(Value::as_str).unwrap_or(""));
        let query = if raw_query.encode_utf16().count() >= 3 {
            slice_utf16(raw_query, 160)
        } else {
            slice_utf16(anchor, 80)
        }
        .ok_or("Unsupported Source UTF16 slice boundary")?;
        if anchor.encode_utf16().count() < 3 || query.encode_utf16().count() < 3 {
            continue;
        }
        let anchor_key = anchor.to_lowercase();
        let query_key = query.to_lowercase();
        if anchors.contains(&anchor_key) || queries.contains(&query_key) {
            continue;
        }
        anchors.insert(anchor_key.clone());
        queries.insert(query_key);
        let reason = js_trim(record.get("reason").and_then(Value::as_str).unwrap_or(""));
        let reason = if reason.is_empty() {
            "Needs a verifiable source"
        } else {
            slice_utf16(reason, 240).ok_or("Unsupported Source UTF16 slice boundary")?
        };
        let importance = record
            .get("importance")
            .and_then(Value::as_f64)
            .map_or(3, |v| v.round().clamp(1.0, 5.0) as u8);
        let kind = match record.get("kind").and_then(Value::as_str) {
            Some("quote") => ResearchTargetKind::Quote,
            Some("work") => ResearchTargetKind::Work,
            Some("person") => ResearchTargetKind::Person,
            Some("statistic") => ResearchTargetKind::Statistic,
            Some("event") => ResearchTargetKind::Event,
            _ => ResearchTargetKind::Claim,
        };
        targets.push(ResearchTarget {
            id: format!("k-{}-{}", targets.len(), hash_token(&anchor_key)),
            kind,
            anchor: slice_utf16(anchor, 200)
                .ok_or("Unsupported Source UTF16 slice boundary")?
                .into(),
            reason: reason.into(),
            query: query.into(),
            importance,
        });
    }
    targets.sort_by_key(|t| std::cmp::Reverse(t.importance));
    Ok(targets)
}
/// The native cap is applied after Source filtering/dedupe/stable importance sort.
/// No cap, invalid response or unsupported UTF16 cut produces invented targets.
pub fn parse_research_targets(
    text: &str,
    max_targets: usize,
) -> Result<Vec<ResearchTarget>, String> {
    if text.len() > MAX_CONTRACT_BYTES {
        return Err("Research reply byte limit exceeded".into());
    }
    let stripped = strip_json_fences(&strip_reasoning_tags(text));
    if let Some(first) = extract_first_json_object(&stripped) {
        let mut targets = clean_targets(&first).map_err(str::to_owned)?;
        if !targets.is_empty() {
            targets.truncate(max_targets);
            return Ok(targets);
        }
    }
    if let Some(open) = stripped.find('[') {
        let mut targets = clean_targets(&stripped[open..]).map_err(str::to_owned)?;
        targets.truncate(max_targets);
        return Ok(targets);
    }
    Ok(Vec::new())
}
