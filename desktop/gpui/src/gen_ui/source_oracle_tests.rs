use super::{spec::validate_tool_spec, stream::ToolStream};
use serde_json::Value;

#[test]
fn validation_matches_original_typescript_oracle() {
    let oracle: Value =
        serde_json::from_str(include_str!("../../fixtures/gen-ui/source-oracle.json")).unwrap();
    for case in oracle["validations"].as_array().unwrap() {
        let result = validate_tool_spec(&case["input"])
            .ok()
            .unwrap_or(Value::Null);
        assert_eq!(
            result, case["expected"],
            "Source validation: {}",
            case["id"]
        );
    }
}

#[test]
fn cumulative_stream_matches_every_original_typescript_snapshot() {
    let oracle: Value =
        serde_json::from_str(include_str!("../../fixtures/gen-ui/source-oracle.json")).unwrap();
    for case in oracle["streams"].as_array().unwrap() {
        let mut stream =
            ToolStream::new(case["seed"].clone(), case["max"].as_u64().unwrap() as usize).unwrap();
        for (i, step) in case["steps"].as_array().unwrap().iter().enumerate() {
            let result = if let Some(text) = step.get("text") {
                stream.push(text.as_str().unwrap()).unwrap()
            } else {
                stream.finish().unwrap()
            };
            assert_eq!(
                *result, case["expected"][i],
                "Source stream: {} step {}",
                case["id"], i
            );
        }
    }
}
