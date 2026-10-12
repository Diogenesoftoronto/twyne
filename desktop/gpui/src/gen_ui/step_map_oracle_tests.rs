use super::step_map::StepMap;
use serde_json::Value;

fn oracle() -> Value {
    serde_json::from_str(include_str!("../../fixtures/gen-ui/step-map-oracle.json")).unwrap()
}

#[test]
fn step_positions_deletion_boundaries_and_recovery_match_executed_prosemirror() {
    for case in oracle()["cases"].as_array().unwrap() {
        let input = &case["input"];
        let mut map = if let Some(offset) = input["offset"].as_i64() {
            StepMap::offset(offset).unwrap()
        } else {
            StepMap::new(
                input["ranges"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|range| std::array::from_fn(|n| range[n].as_u64().unwrap() as usize))
                    .collect(),
            )
            .unwrap()
        };
        if case["inverted"].as_bool().unwrap() {
            map = map.invert();
        }
        assert_eq!(
            serde_json::to_value(map.changed_ranges()).unwrap(),
            case["changed"],
            "{}",
            input["id"]
        );
        for frame in case["frames"].as_array().unwrap() {
            let pos = frame["pos"].as_u64().unwrap() as usize;
            let assoc = frame["assoc"].as_i64().unwrap() as i32;
            let context = format!(
                "{} inverted={} pos={pos} assoc={assoc}",
                input["id"], case["inverted"]
            );
            let actual = map.map_result(pos, assoc).unwrap();
            assert_eq!(
                actual.pos,
                frame["mapped"].as_u64().unwrap() as usize,
                "{context}"
            );
            assert_eq!(map.map(pos, assoc).unwrap(), actual.pos, "{context}");
            assert_eq!(
                actual.del_info as u64,
                frame["delInfo"].as_u64().unwrap(),
                "{context}"
            );
            for (actual, field) in [
                (actual.deleted(), "deleted"),
                (actual.deleted_before(), "deletedBefore"),
                (actual.deleted_after(), "deletedAfter"),
                (actual.deleted_across(), "deletedAcross"),
            ] {
                assert_eq!(
                    actual,
                    frame[field].as_bool().unwrap(),
                    "{context}: {field}"
                );
            }
            assert_eq!(
                actual.recover.map(|t| t.value()),
                frame["recover"].as_f64(),
                "{context}: token"
            );
            assert_eq!(
                actual
                    .recover
                    .and_then(|t| map.recover(t))
                    .map(|n| n as u64),
                frame["recovered"].as_u64(),
                "{context}: recover"
            );
            assert_eq!(
                actual
                    .recover
                    .and_then(|t| map.invert().recover(t))
                    .map(|n| n as u64),
                frame["inverseRecovered"].as_u64(),
                "{context}: inverse recover"
            );
            if let Some(token) = actual.recover {
                for (pos, expected) in case["positions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .zip(frame["touched"].as_array().unwrap())
                {
                    assert_eq!(
                        map.touches(pos.as_u64().unwrap() as usize, token),
                        expected.as_bool().unwrap(),
                        "{context}: touches {pos}"
                    );
                }
            }
        }
    }
}

#[test]
fn invalid_native_coordinate_maps_are_refused_before_arithmetic() {
    assert!(StepMap::new(vec![[5, 4, 1], [6, 1, 1]]).is_err());
    assert!(StepMap::offset(i64::MIN).is_err());
    assert!(StepMap::new(vec![[0, usize::MAX, 0]]).is_err());
    assert!(StepMap::empty().map_result(usize::MAX, 1).is_err());
}

#[cfg(feature = "native-typst")]
#[test]
fn step_map_oracle_matches_the_current_installed_source() {
    use sha2::{Digest, Sha256};
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (path, expected) in oracle()["hashes"].as_object().unwrap() {
        let bytes = std::fs::read(project.join(path)).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)),
            expected.as_str().unwrap(),
            "Source drift: {path}"
        );
    }
}
