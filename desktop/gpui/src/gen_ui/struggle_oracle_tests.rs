use super::struggle::*;
use serde_json::Value;

fn oracle() -> Value {
    serde_json::from_str(include_str!("../../fixtures/gen-ui/struggle-oracle.json")).unwrap()
}

#[test]
fn paragraph_edits_pauses_readings_and_cooldowns_match_executed_source() {
    for case in oracle()["cases"].as_array().unwrap() {
        let input = &case["input"];
        let id = input["id"].as_str().unwrap();
        let mut activity = empty_activity(
            input["initial"].as_str().unwrap(),
            input["startAt"].as_f64().unwrap_or(0.),
        );
        let expected: BlockActivity = serde_json::from_value(case["initial"].clone()).unwrap();
        assert_eq!(activity, expected, "{id}: initial activity");
        for (index, (step, frame)) in input["steps"]
            .as_array()
            .unwrap()
            .iter()
            .zip(case["frames"].as_array().unwrap())
            .enumerate()
        {
            match step["op"].as_str().unwrap() {
                "edit" => record_edit_with_undo(
                    &mut activity,
                    step["text"].as_str().unwrap(),
                    step["at"].as_f64().unwrap(),
                    step["undo"].as_bool().unwrap_or(false),
                ),
                "commit" => commit_version(&mut activity),
                "cool" => {
                    if let Some(ms) = step["ms"].as_f64() {
                        cool_down_for(&mut activity, step["at"].as_f64().unwrap(), ms);
                    } else {
                        cool_down(&mut activity, step["at"].as_f64().unwrap());
                    }
                }
                "patch" => {
                    let mut value = serde_json::to_value(&activity).unwrap();
                    value
                        .as_object_mut()
                        .unwrap()
                        .extend(step["values"].as_object().unwrap().clone());
                    activity = serde_json::from_value(value).unwrap();
                }
                "read" => {
                    let expected: StruggleReading =
                        serde_json::from_value(frame["reading"].clone()).unwrap();
                    assert_eq!(
                        read_struggle(
                            &activity,
                            step["at"].as_f64().unwrap(),
                            ReadContext {
                                cursor_at_end: step["cursorAtEnd"].as_bool().unwrap_or(false),
                            },
                        ),
                        expected,
                        "{id}: reading {index}"
                    );
                }
                op => panic!("Unknown Source oracle operation {op}"),
            }
            let expected: BlockActivity =
                serde_json::from_value(frame["activity"].clone()).unwrap();
            assert_eq!(activity, expected, "{id}: activity {index}");
        }
    }
}

#[test]
fn hedge_matching_uses_the_same_ascii_word_boundaries_and_case_folding() {
    for case in oracle()["hedges"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        assert_eq!(
            hedge_count(text),
            case["count"].as_u64().unwrap() as usize,
            "{text}"
        );
    }
}

#[cfg(feature = "native-typst")]
#[test]
fn struggle_oracle_matches_the_current_original_source_file() {
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
