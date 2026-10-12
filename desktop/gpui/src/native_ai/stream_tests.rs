//! Differential assertions against executed, unchanged TypeScript Source.

use super::*;
use serde_json::{Value, json};

fn vectors() -> Value {
    serde_json::from_str(include_str!(
        "../../fixtures/native-ai/stream-contract/source-vectors.json"
    ))
    .expect("Executed Source vectors")
}

fn string<'a>(row: &'a Value, key: &str) -> &'a str {
    row[key].as_str().expect("Source string field")
}

fn input(row: &Value) -> GenerationStreamInput {
    match string(row, "type") {
        "text-delta" => GenerationStreamInput::TextDelta(string(row, "text").into()),
        "reasoning-start" => GenerationStreamInput::ReasoningStart,
        "reasoning-delta" => GenerationStreamInput::ReasoningDelta(string(row, "text").into()),
        "reasoning-end" => GenerationStreamInput::ReasoningEnd,
        "finish" => GenerationStreamInput::Finish,
        "error" => GenerationStreamInput::Error(String::new()),
        other => panic!("Unrecognized Source input: {other}"),
    }
}

#[test]
fn original_reasoning_tag_functions_match_every_source_case() {
    for row in vectors()["reasoning"].as_array().unwrap() {
        let raw = string(row, "raw");
        let actual = json!({
            "strip": strip_reasoning_tags(raw),
            "extract": extract_tagged_reasoning(raw),
            "open": has_open_reasoning_block(raw),
            "hasTags": has_reasoning_tags(raw),
            "removeMarkers": remove_reasoning_tag_markers(raw),
            "trimPartial": trim_partial_reasoning_tag(raw),
        });
        for key in [
            "strip",
            "extract",
            "open",
            "hasTags",
            "removeMarkers",
            "trimPartial",
        ] {
            assert_eq!(actual[key], row[key], "Source {}: {key}", row["name"]);
        }
    }
}

#[test]
fn every_stream_push_matches_original_source_state_and_null_wire_shape() {
    for row in vectors()["generation"].as_array().unwrap() {
        let mut accumulator = GenerationStreamAccumulator::new();
        assert_eq!(
            serde_json::to_value(accumulator.snapshot()).unwrap(),
            row["initial"]
        );
        for (index, event) in row["inputs"].as_array().unwrap().iter().enumerate() {
            let actual = serde_json::to_value(accumulator.push(input(event))).unwrap();
            assert_eq!(
                actual, row["snapshots"][index],
                "Source {} push {index}",
                row["name"]
            );
        }
    }
    assert_eq!(serde_json::to_value(ActivePart::None).unwrap(), Value::Null);
    assert!(serde_json::from_value::<ActivePart>(json!("none")).is_err());
}

#[test]
fn interview_contract_suppression_is_exact_and_consumer_specific() {
    for row in vectors()["interview"].as_array().unwrap() {
        let actual =
            create_interview_stream_snapshot(string(row, "raw"), string(row, "nativeReasoning"));
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            row["snapshot"],
            "Source {}",
            row["name"]
        );
    }
}

#[test]
fn restored_and_finished_snapshot_states_match_original_source() {
    let vectors = vectors();
    for row in vectors["textSnapshots"].as_array().unwrap() {
        let status = serde_json::from_value(row["status"].clone()).unwrap();
        let actual = text_snapshot(string(row, "text").into(), status);
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            row["snapshot"],
            "Source {}",
            row["name"]
        );
    }
    for row in vectors["snapshotFromRecord"].as_array().unwrap() {
        let record = &row["row"];
        let phase = serde_json::from_value(record["phase"].clone()).unwrap();
        let status = serde_json::from_value(record["status"].clone()).unwrap();
        let actual = snapshot_from_record(
            string(record, "text").into(),
            string(record, "reasoning").into(),
            phase,
            status,
        );
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            row["snapshot"],
            "Source {}",
            row["name"]
        );
        if status == StreamRunStatus::Complete {
            let finished = GenerationStreamSnapshot::completed(
                string(record, "text").into(),
                string(record, "reasoning").into(),
            );
            assert_eq!(serde_json::to_value(finished).unwrap(), row["snapshot"]);
        }
    }
}
