use serde_json::{Map, Value, json};

use super::props::{ValidationError, validate_component_props};

/// Match `validateToolSpec`, including json-render's wrapper normalization.
/// Only `elements.tool` receives the original component-specific props check.
/// Other elements still require a catalog name, object props and string children.
pub fn validate_tool_spec(value: &Value) -> Result<Value, ValidationError> {
    let normalized = validate_tool_wrapper(value)?;
    let tool = &normalized["elements"]["tool"];
    validate_component_props(
        tool["type"].as_str().ok_or(ValidationError)?,
        &tool["props"],
    )?;
    Ok(normalized)
}

pub(crate) fn validate_tool_wrapper(value: &Value) -> Result<Value, ValidationError> {
    let object = value.as_object().ok_or(ValidationError)?;
    let root = object
        .get("root")
        .and_then(Value::as_str)
        .ok_or(ValidationError)?;
    let elements = object
        .get("elements")
        .and_then(Value::as_object)
        .ok_or(ValidationError)?;
    let mut normalized = Map::new();
    for (key, element) in elements {
        let element = element.as_object().ok_or(ValidationError)?;
        let name = element
            .get("type")
            .and_then(Value::as_str)
            .ok_or(ValidationError)?;
        if !matches!(
            name,
            "SentenceLab" | "RhythmStrip" | "ClaimCheck" | "ReaderQuestions"
        ) {
            return Err(ValidationError);
        }
        let props = element
            .get("props")
            .filter(|props| props.is_object())
            .ok_or(ValidationError)?;
        let children = element
            .get("children")
            .and_then(Value::as_array)
            .ok_or(ValidationError)?;
        if children.iter().any(|child| !child.is_string()) {
            return Err(ValidationError);
        }
        normalized.insert(
            key.clone(),
            json!({"type": name, "props": props, "children": children}),
        );
    }
    normalized.get("tool").ok_or(ValidationError)?;
    Ok(json!({"root": root, "elements": normalized}))
}

#[cfg(test)]
mod tests {
    use super::validate_tool_spec;
    use serde_json::json;

    #[test]
    fn strips_wrapper_metadata_but_preserves_props_metadata() {
        let spec = json!({"root":"other","extra":true,"elements":{"tool":{
            "type":"SentenceLab","extra":true,"children":[],
            "props":{"sentence":"A sentence.","attempts":[],"variants":[],"extra":true}
        }}});
        let result = validate_tool_spec(&spec).unwrap();
        assert!(result.get("extra").is_none());
        assert!(result["elements"]["tool"].get("extra").is_none());
        assert_eq!(result["elements"]["tool"]["props"]["extra"], true);
        assert_eq!(result["root"], "other");
    }
}
