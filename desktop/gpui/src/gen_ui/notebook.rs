use serde_json::{Map, Value};

pub fn empty_notebook() -> Value {
    Value::Object(Map::from_iter([
        ("audience".to_string(), Value::String(String::new())),
        ("voiceSamples".to_string(), Value::Array(Vec::new())),
        ("scraps".to_string(), Value::Array(Vec::new())),
        ("sources".to_string(), Value::Array(Vec::new())),
        ("intentionalPromises".to_string(), Value::Array(Vec::new())),
    ]))
}

fn string_field<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    match object.get(key) {
        Some(Value::String(s)) => Some(s.as_str()),
        _ => None,
    }
}

fn passages(value: Option<&Value>) -> Vec<Value> {
    match value.and_then(Value::as_array) {
        Some(items) => items
            .iter()
            .filter(|item| {
                item.as_object()
                    .map(|object| {
                        string_field(object, "id").is_some()
                            && string_field(object, "text").is_some()
                    })
                    .unwrap_or(false)
            })
            .cloned()
            .collect(),
        None => Vec::new(),
    }
}

fn sources(value: Option<&Value>) -> Vec<Value> {
    match value.and_then(Value::as_array) {
        Some(items) => items
            .iter()
            .filter(|item| {
                item.as_object()
                    .map(|object| {
                        string_field(object, "id").is_some()
                            && string_field(object, "claim").is_some()
                            && string_field(object, "source").is_some()
                            && match object.get("previousClaim") {
                                None => true,
                                Some(Value::String(_)) => true,
                                Some(_) => false,
                            }
                    })
                    .unwrap_or(false)
            })
            .cloned()
            .collect(),
        None => Vec::new(),
    }
}

fn intentional_promises(value: Option<&Value>) -> Vec<Value> {
    match value.and_then(Value::as_array) {
        Some(items) => items.iter().filter(|id| id.is_string()).cloned().collect(),
        None => Vec::new(),
    }
}

pub fn normalize_notebook(value: &Value) -> Value {
    let object = match value.as_object() {
        Some(object) => object,
        None => return empty_notebook(),
    };
    let audience = string_field(object, "audience").unwrap_or("").to_string();
    let mut result = Map::with_capacity(5);
    result.insert("audience".to_string(), Value::String(audience));
    result.insert(
        "voiceSamples".to_string(),
        Value::Array(passages(object.get("voiceSamples"))),
    );
    result.insert(
        "scraps".to_string(),
        Value::Array(passages(object.get("scraps"))),
    );
    result.insert(
        "sources".to_string(),
        Value::Array(sources(object.get("sources"))),
    );
    result.insert(
        "intentionalPromises".to_string(),
        Value::Array(intentional_promises(object.get("intentionalPromises"))),
    );
    Value::Object(result)
}
