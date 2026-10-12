use super::seed::{
    SavedToolConfig, SeedOptions, ToolKind, offline_fill, seed_spec, split_sentences, word_count,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[test]
fn deterministic_seeds_and_offline_fill_match_original_typescript() {
    let oracle: Value =
        serde_json::from_str(include_str!("../../fixtures/gen-ui/seed-oracle.json")).unwrap();
    for case in oracle["cases"].as_array().unwrap() {
        let kind = match case["kind"].as_str().unwrap() {
            "sentence-lab" => ToolKind::SentenceLab,
            "rhythm-strip" => ToolKind::RhythmStrip,
            "claim-check" => ToolKind::ClaimCheck,
            "reader-questions" => ToolKind::ReaderQuestions,
            _ => unreachable!(),
        };
        let options = &case["options"];
        let attempts = options["activity"]["attempts"]
            .as_object()
            .map(|m| {
                m.iter()
                    .map(|(key, value)| {
                        (
                            key.parse().unwrap(),
                            value
                                .as_array()
                                .unwrap()
                                .iter()
                                .map(|a| a.as_str().unwrap().to_owned())
                                .collect(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        let filled: BTreeMap<String, bool> = options["classification"]["filled"]
            .as_object()
            .map(|m| {
                m.iter()
                    .map(|(k, v)| (k.clone(), v.as_bool().unwrap()))
                    .collect()
            })
            .unwrap_or_default();
        let input = SeedOptions {
            sentence_index: options["sentenceIndex"].as_i64(),
            claim_index: options["classification"]["claimIndex"].as_i64(),
            attempts,
            filled,
            config: SavedToolConfig {
                target_min: options["config"]["targetMin"].as_f64(),
                target_max: options["config"]["targetMax"].as_f64(),
                slots: options["config"]["slots"]
                    .as_array()
                    .map(|s| s.iter().map(|s| s.as_str().unwrap().to_owned()).collect()),
                angle: options["config"]["angle"].as_str().map(str::to_owned),
            },
        };
        let seed = seed_spec(kind, case["passage"].as_str().unwrap(), &input);
        assert_eq!(
            seed, case["expected"]["seed"],
            "Source seed: {}",
            case["id"]
        );
        let (filled, notice) = offline_fill(&seed);
        assert_eq!(
            filled, case["expected"]["filled"],
            "Source offline fill: {}",
            case["id"]
        );
        assert_eq!(
            json!(notice),
            case["expected"]["notice"],
            "Source notice: {}",
            case["id"]
        );
    }
    for case in oracle["sentences"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let spans: Vec<Value> = split_sentences(text)
            .iter()
            .map(|s| json!({"text":s.text,"from":s.from,"to":s.to}))
            .collect();
        assert_eq!(
            json!(spans),
            case["spans"],
            "Source sentence spans: {text:?}"
        );
        assert_eq!(json!(word_count(text)), case["words"]);
    }
}
