use super::budget::SystemOneBudget;
use serde_json::Value;

fn oracle() -> Value {
    serde_json::from_str(include_str!("../../fixtures/gen-ui/budget-oracle.json")).unwrap()
}

#[test]
fn shared_budget_waits_match_the_executed_source_queue_and_backoff() {
    for case in oracle()["cases"].as_array().unwrap() {
        let mut budget = SystemOneBudget::default();
        for (index, (step, expected)) in case["steps"]
            .as_array()
            .unwrap()
            .iter()
            .zip(case["frames"].as_array().unwrap())
            .enumerate()
        {
            let at = step["at"].as_f64().unwrap();
            match step["op"].as_str().unwrap() {
                "spend" => budget.spend(at),
                "fail" => budget.back_off(at),
                "reset" => budget.reset(),
                "wait" => (),
                op => panic!("Unknown Source budget operation {op}"),
            }
            assert_eq!(
                budget.wait(at),
                expected.as_f64().unwrap(),
                "{}: frame {index}",
                case["id"]
            );
        }
    }
}

#[cfg(feature = "native-typst")]
#[test]
fn budget_oracle_matches_the_current_original_source_file() {
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
