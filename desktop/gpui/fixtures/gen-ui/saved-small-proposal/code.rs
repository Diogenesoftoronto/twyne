use serde_json::{Map, Number, Value};

use crate::native_ai::request::js_trim;

const TOOL_KINDS: [&str; 4] = [
    "sentence-lab",
    "rhythm-strip",
    "claim-check",
    "reader-questions",
];

#[derive(Debug, Clone)]
pub struct SavedToolError {
    message: String,
}

impl SavedToolError {
    fn new(message: &str) -> Self {
        Self { message: message.to_string() }
    }
}

impl std::fmt::Display for SavedToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SavedToolError {}

fn js_slice_utf16(text: &str, max: usize) -> Result<String, SavedToolError> {
    let mut units = 0usize;
    for (index, ch) in text.char_indices() {
        let width = ch.len_utf16();
        if units + width > max {
            if units < max {
                return Err(SavedToolError::new("saved tool text splits a UTF-16 surrogate pair"));
            }
            return Ok(text[..index].to_string());
        }
        units += width;
    }
    Ok(text.to_string())
}

fn js_int(value: Option<&Value>, min: f64, max: f64) -> Option<i64> {
    let number = value?.as_f64()?;
    if !number.is_finite() {
        return None;
    }
    let rounded = (number + 0.5).floor();
    Some(rounded.max(min).min(max) as i64)
}

fn decode_slots(value: &Value) -> Result<Vec<Value>, SavedToolError> {
    let items = match value {
        Value::Array(items) => items,
        _ => return Ok(Vec::new()),
    };
    let mut slots = Vec::new();
    for item in items {
        if let Value::String(text) = item {
            if js_trim(text).is_empty() {
                continue;
            }
            slots.push(Value::String(js_slice_utf16(text, 60)?));
        }
    }
    slots.truncate(5);
    Ok(slots)
}

pub fn normalize_saved_tool(value: &Value) -> Result<Option<Value>, SavedToolError> {
    let raw = match value {
        Value::Object(map) => map,
        _ => return Ok(None),
    };
    let id = match raw.get("id") {
        Some(Value::String(id)) if !id.is_empty() => id.clone(),
        _ => return Ok(None),
    };
    let kind = match raw.get("kind") {
        Some(Value::String(kind)) if TOOL_KINDS.contains(&kind.as_str()) => kind.clone(),
        _ => return Ok(None),
    };
    let config = match raw.get("config") {
        Some(Value::Object(map)) => Some(map),
        _ => None,
    };

    let mut clean = Map::new();
    if let Some(min) = js_int(config.and_then(|c| c.get("targetMin")), 1.0, 80.0) {
        clean.insert("targetMin".into(), Value::Number(Number::from(min)));
    }
    if let Some(max) = js_int(config.and_then(|c| c.get("targetMax")), 2.0, 120.0) {
        clean.insert("targetMax".into(), Value::Number(Number::from(max)));
    }
    if let Some(slots) = config.and_then(|c| c.get("slots")) {
        let slots = decode_slots(slots)?;
        if !slots.is_empty() {
            clean.insert("slots".into(), Value::Array(slots));
        }
    }
    if let Some(Value::String(angle)) = config.and_then(|c| c.get("angle")) {
        let trimmed = js_trim(angle);
        if !trimmed.is_empty() {
            clean.insert("angle".into(), Value::String(js_slice_utf16(&trimmed, 200)?));
        }
    }

    let name = match raw.get("name") {
        Some(Value::String(name)) => {
            let trimmed = js_trim(name);
            if trimmed.is_empty() {
                kind.clone()
            } else {
                js_slice_utf16(&trimmed, 60)?
            }
        }
        _ => kind.clone(),
    };
    let saved_at = match raw.get("savedAt") {
        Some(Value::Number(number)) => number.clone(),
        _ => Number::from(0),
    };

    let mut out = Map::new();
    out.insert("id".into(), Value::String(id));
    out.insert("kind".into(), Value::String(kind));
    out.insert("name".into(), Value::String(name));
    out.insert("config".into(), Value::Object(clean));
    out.insert("savedAt".into(), Value::Number(saved_at));
    Ok(Some(Value::Object(out)))
}

pub fn decode_saved_tools(value: &Value) -> Result<Vec<Value>, SavedToolError> {
    let items = match value {
        Value::Array(items) => items,
        _ => return Ok(Vec::new()),
    };
    let mut tools = Vec::new();
    for item in items {
        if let Some(tool) = normalize_saved_tool(item)? {
            tools.push(tool);
        }
    }
    Ok(tools)
}
