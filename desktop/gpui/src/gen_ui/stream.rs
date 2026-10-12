use super::spec::{validate_tool_spec, validate_tool_wrapper};
use crate::native_ai::request::js_trim;
use serde_json::Value;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Target {
    Variants,
    Questions,
}

impl Target {
    fn path(self) -> &'static str {
        match self {
            Self::Variants => "/elements/tool/props/variants/-",
            Self::Questions => "/elements/tool/props/questions/-",
        }
    }

    fn list_key(self) -> &'static str {
        match self {
            Self::Variants => "variants",
            Self::Questions => "questions",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StreamError {
    InvalidSeed,
    UnrepresentableUtf16Boundary,
}

impl fmt::Display for StreamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSeed => f.write_str("invalid tool spec"),
            Self::UnrepresentableUtf16Boundary => {
                f.write_str("cumulative offset falls inside a UTF-16 surrogate pair")
            }
        }
    }
}

impl std::error::Error for StreamError {}

pub struct ToolStream {
    accumulated: Value,
    latest: Value,
    target: Option<Target>,
    consumed_utf16: usize,
    buffer: String,
    max: usize,
}

impl ToolStream {
    pub fn new(seed: Value, max: usize) -> Result<Self, StreamError> {
        // Source opens deterministic writer material without applying the
        // model-output limits to it. Every appended candidate is still checked.
        validate_tool_wrapper(&seed).map_err(|_| StreamError::InvalidSeed)?;
        let tool = seed
            .get("elements")
            .and_then(Value::as_object)
            .and_then(|elements| elements.get("tool"))
            .and_then(Value::as_object)
            .ok_or(StreamError::InvalidSeed)?;
        let component = tool
            .get("type")
            .and_then(Value::as_str)
            .ok_or(StreamError::InvalidSeed)?;
        let target = match component {
            "SentenceLab" => Some(Target::Variants),
            "ReaderQuestions" => Some(Target::Questions),
            "RhythmStrip" | "ClaimCheck" => None,
            _ => return Err(StreamError::InvalidSeed),
        };

        Ok(Self {
            accumulated: seed.clone(),
            latest: seed,
            target,
            consumed_utf16: 0,
            buffer: String::new(),
            max,
        })
    }

    pub fn push(&mut self, cumulative_text: &str) -> Result<&Value, StreamError> {
        let suffix = suffix_from_utf16(cumulative_text, self.consumed_utf16)?;
        self.buffer.push_str(suffix);
        self.consumed_utf16 = cumulative_text.encode_utf16().count();

        let mut lines = Vec::new();
        while let Some(newline) = self.buffer.find('\n') {
            lines.push(self.buffer[..newline].to_owned());
            self.buffer.drain(..=newline);
        }
        self.feed(&lines);
        Ok(&self.latest)
    }

    pub fn finish(&mut self) -> Result<&Value, StreamError> {
        let rest = std::mem::take(&mut self.buffer);
        if !js_trim(&rest).is_empty() {
            self.feed(&[rest]);
        }
        Ok(&self.latest)
    }

    pub fn snapshot(&self) -> &Value {
        &self.latest
    }

    fn feed(&mut self, lines: &[String]) {
        let Some(target) = self.target else {
            return;
        };

        let path = target.path();
        let mut changed = false;
        for line in lines {
            let Some(value) = accepted_value(line, path) else {
                continue;
            };
            let Some(list) = self
                .accumulated
                .get_mut("elements")
                .and_then(Value::as_object_mut)
                .and_then(|elements| elements.get_mut("tool"))
                .and_then(Value::as_object_mut)
                .and_then(|tool| tool.get_mut("props"))
                .and_then(Value::as_object_mut)
                .and_then(|props| props.get_mut(target.list_key()))
                .and_then(Value::as_array_mut)
            else {
                continue;
            };
            list.push(Value::String(value));
            changed = true;
        }
        if !changed {
            return;
        }

        let mut candidate = self.accumulated.clone();
        if let Some(list) = candidate
            .get_mut("elements")
            .and_then(Value::as_object_mut)
            .and_then(|elements| elements.get_mut("tool"))
            .and_then(Value::as_object_mut)
            .and_then(|tool| tool.get_mut("props"))
            .and_then(Value::as_object_mut)
            .and_then(|props| props.get_mut(target.list_key()))
            .and_then(Value::as_array_mut)
        {
            list.truncate(self.max);
        }

        if let Ok(valid) = validate_tool_spec(&candidate) {
            self.latest = valid;
        }
    }
}

fn accepted_value(line: &str, expected_path: &str) -> Option<String> {
    let trimmed = js_trim(line);
    if !trimmed.starts_with('{') {
        return None;
    }
    let patch: Value = serde_json::from_str(trimmed).ok()?;
    if patch.get("op").and_then(Value::as_str) != Some("add")
        || patch.get("path").and_then(Value::as_str) != Some(expected_path)
    {
        return None;
    }
    patch.get("value")?.as_str().map(ToOwned::to_owned)
}

fn suffix_from_utf16(text: &str, offset: usize) -> Result<&str, StreamError> {
    let mut units = 0;
    for (byte_index, character) in text.char_indices() {
        if units == offset {
            return Ok(&text[byte_index..]);
        }
        let width = character.len_utf16();
        if units < offset && offset < units + width {
            return Err(StreamError::UnrepresentableUtf16Boundary);
        }
        units += width;
    }
    if units == offset {
        Ok(&text[text.len()..])
    } else {
        Ok("")
    }
}

#[cfg(test)]
mod tests {
    use super::ToolStream;
    use serde_json::{Value, json};

    fn sentence_lab() -> Value {
        json!({
            "root": "tool",
            "elements": {
                "tool": {
                    "type": "SentenceLab",
                    "props": {
                        "sentence": "It decided nothing.",
                        "attempts": [],
                        "variants": []
                    },
                    "children": []
                }
            }
        })
    }

    fn line(op: &str, path: &str, value: &str) -> String {
        json!({"op": op, "path": path, "value": value}).to_string()
    }

    const VARIANTS: &str = "/elements/tool/props/variants/-";

    #[test]
    fn split_json_line_across_cumulative_snapshots_and_ignore_repeated_snapshot() {
        let mut stream = ToolStream::new(sentence_lab(), 3).unwrap();
        let full = format!("{}\n", line("add", VARIANTS, "Another way."));
        let cut = full.len() - 5;
        assert_eq!(
            stream.push(&full[..cut]).unwrap()["elements"]["tool"]["props"]["variants"],
            json!([])
        );
        assert_eq!(
            stream.push(&full).unwrap()["elements"]["tool"]["props"]["variants"],
            json!(["Another way."])
        );
        assert_eq!(
            stream.push(&full).unwrap()["elements"]["tool"]["props"]["variants"],
            json!(["Another way."])
        );
    }

    #[test]
    fn finish_flushes_one_final_line_without_a_newline() {
        let mut stream = ToolStream::new(sentence_lab(), 3).unwrap();
        let final_line = line("add", VARIANTS, "Finished.");
        assert_eq!(
            stream.push(&final_line).unwrap()["elements"]["tool"]["props"]["variants"],
            json!([])
        );
        assert_eq!(
            stream.finish().unwrap()["elements"]["tool"]["props"]["variants"],
            json!(["Finished."])
        );
        assert_eq!(
            stream.finish().unwrap()["elements"]["tool"]["props"]["variants"],
            json!(["Finished."])
        );
    }

    #[test]
    fn ignores_unauthorized_operations_and_paths() {
        let mut stream = ToolStream::new(sentence_lab(), 3).unwrap();
        let text = [
            line("replace", VARIANTS, "Hijacked."),
            line("add", "/elements/tool/props/attempts/-", "Hijacked."),
            line("add", VARIANTS, "Kept."),
        ]
        .join("\n")
            + "\n";
        assert_eq!(
            stream.push(&text).unwrap()["elements"]["tool"]["props"]["variants"],
            json!(["Kept."])
        );
    }

    #[test]
    fn clips_only_the_candidate_to_the_cap() {
        let mut stream = ToolStream::new(sentence_lab(), 2).unwrap();
        let text = [
            line("add", VARIANTS, "A."),
            line("add", VARIANTS, "B."),
            line("add", VARIANTS, "C."),
        ]
        .join("\n")
            + "\n";
        assert_eq!(
            stream.push(&text).unwrap()["elements"]["tool"]["props"]["variants"],
            json!(["A.", "B."])
        );
    }

    #[test]
    fn preserves_seed_data_and_does_not_mutate_the_seed() {
        let mut seed = sentence_lab();
        seed["opaque"] = json!({"kept": true});
        seed["elements"]["tool"]["props"]["writerNote"] = json!("unchanged");
        let original = seed.clone();
        let mut stream = ToolStream::new(seed.clone(), 3).unwrap();
        stream
            .push(&format!("{}\n", line("add", VARIANTS, "New.")))
            .unwrap();
        assert_eq!(seed, original);
        assert!(stream.snapshot().get("opaque").is_none());
        assert_eq!(
            stream.snapshot()["elements"]["tool"]["props"]["writerNote"],
            json!("unchanged")
        );
        assert_eq!(
            stream.snapshot()["elements"]["tool"]["props"]["sentence"],
            json!("It decided nothing.")
        );
    }

    #[test]
    fn invalid_candidate_does_not_discard_accumulated_appends() {
        let mut stream = ToolStream::new(sentence_lab(), 3).unwrap();
        let first = format!("{}\n", line("add", VARIANTS, ""));
        stream.push(&first).unwrap();
        assert_eq!(
            stream.snapshot()["elements"]["tool"]["props"]["variants"],
            json!([])
        );
        stream
            .push(&format!("{first}{}\n", line("add", VARIANTS, "Valid.")))
            .unwrap();
        assert_eq!(
            stream.accumulated["elements"]["tool"]["props"]["variants"],
            json!(["", "Valid."])
        );
        assert_eq!(
            stream.snapshot()["elements"]["tool"]["props"]["variants"],
            json!([])
        );
    }

    #[test]
    fn nonstream_component_remains_unchanged() {
        let seed = json!({
            "root": "tool",
            "elements": {
                "tool": {
                    "type": "RhythmStrip",
                    "props": {
                        "sentences": [{"text": "A sentence.", "words": 2}],
                        "targetMin": 8,
                        "targetMax": 28
                    },
                    "children": []
                }
            }
        });
        let mut stream = ToolStream::new(seed.clone(), 3).unwrap();
        stream
            .push(&format!("{}\n", line("add", VARIANTS, "Ignored.")))
            .unwrap();
        assert_eq!(stream.snapshot(), &seed);
    }

    #[test]
    fn cumulative_suffix_uses_utf16_units_for_unicode_text() {
        let mut stream = ToolStream::new(sentence_lab(), 3).unwrap();
        let full = format!("{}\n", line("add", VARIANTS, "Café 😀 reads."));
        let emoji_end = full.find("😀").unwrap() + "😀".len();
        stream.push(&full[..emoji_end]).unwrap();
        assert_eq!(
            stream.push(&full).unwrap()["elements"]["tool"]["props"]["variants"],
            json!(["Café 😀 reads."])
        );
    }
}
