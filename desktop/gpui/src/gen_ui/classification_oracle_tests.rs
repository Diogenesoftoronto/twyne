use super::classification::*;
use serde_json::Value;

fn oracle() -> Value {
    serde_json::from_str(include_str!(
        "../../fixtures/gen-ui/classification-oracle.json"
    ))
    .unwrap()
}

#[test]
fn batched_requests_and_answers_match_executed_source_classification() {
    for case in oracle()["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let input: ClassifyInput = serde_json::from_value(case["input"].clone()).unwrap();
        let slots: Vec<String> = serde_json::from_value(case["slots"].clone()).unwrap();
        assert_eq!(
            make_request(&input, &slots),
            case["requestJson"].as_str().unwrap(),
            "{id}: exact request JSON"
        );
        let classification = read_response(&input, &case["response"], &slots);
        if case["error"] == true {
            assert!(
                classification.is_err(),
                "{id}: Source rejects this response"
            );
        } else {
            let expected: Classification =
                serde_json::from_value(case["expected"].clone()).unwrap();
            assert_eq!(
                classification.unwrap(),
                expected,
                "{id}: answer interpretation"
            );
        }
    }
}

#[test]
fn unavailable_classification_uses_only_the_same_strong_first_hint() {
    for case in oracle()["fallbacks"].as_array().unwrap() {
        let hints: Vec<ClassificationHint> = serde_json::from_value(case["hints"].clone()).unwrap();
        let expected: Classification = serde_json::from_value(case["expected"].clone()).unwrap();
        assert_eq!(fallback_classification(&hints), expected, "{}", case["id"]);
    }
}

#[cfg(feature = "native-typst")]
#[test]
fn classification_oracle_matches_the_current_original_source_files() {
    use sha2::{Digest, Sha256};
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (path, hash) in oracle()["hashes"].as_object().unwrap() {
        let bytes = std::fs::read(project.join(path)).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)),
            hash.as_str().unwrap(),
            "Source drift: {path}"
        );
    }
}
