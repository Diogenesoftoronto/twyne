use super::{
    notebook::normalize_notebook,
    passage::Passage,
    position::{self, Rect, Viewport},
    saved::{decode_saved_tools, normalize_saved_tool},
};
use crate::editor::RichDocument;
use serde_json::Value;

fn oracle() -> Value {
    serde_json::from_str(include_str!(
        "../../fixtures/gen-ui/integration-oracle.json"
    ))
    .unwrap()
}
#[test]
fn kept_tools_and_uncapped_loads_match_executed_original_code() {
    let oracle = oracle();
    for case in oracle["saved"].as_array().unwrap() {
        let result = normalize_saved_tool(&case["input"]);
        if case["unpairedOutput"] == true {
            assert!(
                result.is_err(),
                "unrepresentable Source slice {}",
                case["id"]
            );
        } else {
            assert_eq!(
                result.unwrap().unwrap_or(Value::Null),
                case["expected"],
                "{}",
                case["id"]
            );
        }
    }
    for case in oracle["savedLoads"].as_array().unwrap() {
        assert_eq!(
            serde_json::to_value(decode_saved_tools(&case["input"]).unwrap()).unwrap(),
            case["expected"],
            "{}",
            case["id"]
        );
    }
}
#[test]
fn notebook_normalization_preserves_the_same_writer_metadata() {
    for case in oracle()["notebooks"].as_array().unwrap() {
        assert_eq!(
            normalize_notebook(&case["input"]),
            case["expected"],
            "{}",
            case["id"]
        );
    }
}
#[test]
fn paragraph_offsets_match_source_prosemirror_with_explicit_scalar_boundaries() {
    for case in oracle()["spans"].as_array().unwrap() {
        let document = RichDocument::from_html(case["html"].as_str().unwrap()).unwrap();
        let passage = Passage::at(&document, 0).unwrap();
        assert_eq!(
            passage.text,
            case["text"].as_str().unwrap(),
            "{}",
            case["id"]
        );
        for position in case["positions"].as_array().unwrap() {
            let original = position["projectionUtf16"].as_u64().unwrap() as usize;
            let actual = passage
                .position(position["offset"].as_u64().unwrap() as usize)
                .ok();
            assert_eq!(
                actual,
                document.utf16_to_scalar(original),
                "{} offset {}",
                case["id"],
                position["offset"]
            );
        }
    }
}
#[test]
fn rail_and_popover_positions_match_extracted_source_arithmetic() {
    let rect = |value: &Value| Rect {
        left: value["left"].as_f64().unwrap() as f32,
        top: value["top"].as_f64().unwrap() as f32,
        right: value["right"].as_f64().unwrap() as f32,
        bottom: value["bottom"].as_f64().unwrap() as f32,
    };
    for case in oracle()["geometries"].as_array().unwrap() {
        let actual = position::position(
            rect(&case["canvas"]),
            rect(&case["scroller"]),
            rect(&case["anchor"]),
            Viewport {
                width: case["viewport"]["width"].as_f64().unwrap() as f32,
                height: case["viewport"]["height"].as_f64().unwrap() as f32,
            },
        );
        let expected = &case["expected"];
        assert_eq!(actual.rail, expected["rail"].as_bool().unwrap());
        assert_eq!(actual.shelf, expected["shelf"].as_bool().unwrap());
        for (number, key) in [
            (actual.x, "x"),
            (actual.top, "top"),
            (actual.connector_top, "connectorTop"),
        ] {
            assert!(
                (number - expected[key].as_f64().unwrap() as f32).abs() < 0.0001,
                "{key}: {case}"
            );
        }
    }
}

#[cfg(feature = "native-typst")]
#[test]
fn integration_oracle_matches_the_current_source_files() {
    use sha2::{Digest, Sha256};
    let oracle = oracle();
    for (path, bytes) in [
        (
            "src/utils/saved-tools.ts",
            include_bytes!("../../../../src/utils/saved-tools.ts").as_slice(),
        ),
        (
            "src/utils/writing-tools-storage.ts",
            include_bytes!("../../../../src/utils/writing-tools-storage.ts").as_slice(),
        ),
        (
            "src/components/editor/extensions/struggle-tracker.ts",
            include_bytes!("../../../../src/components/editor/extensions/struggle-tracker.ts")
                .as_slice(),
        ),
        (
            "src/components/in-flow/margin-rail.tsx",
            include_bytes!("../../../../src/components/in-flow/margin-rail.tsx").as_slice(),
        ),
    ] {
        assert_eq!(
            oracle["hashes"][path].as_str(),
            Some(format!("{:x}", Sha256::digest(bytes)).as_str()),
            "Source input drift: {path}"
        );
    }
}
