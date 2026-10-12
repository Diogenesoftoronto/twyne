//! Retained local component state, separate from validated model suggestions.

use super::seed::{SeedOptions, ToolKind, offline_fill, seed_spec};
use super::{props::ValidationError, spec::validate_tool_spec};
use crate::native_ai::request::js_trim;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[derive(Clone)]
pub struct ToolSnapshot {
    pub id: Uuid,
    spec: Value,
    pub filling: bool,
    pub reason: String,
    pub tentative: bool,
    pub notice: Option<String>,
    pub saved_id: Option<String>,
}
impl ToolSnapshot {
    pub fn new(id: Uuid, spec: Value) -> Result<Self, ValidationError> {
        Ok(Self::initialized(id, validate_tool_spec(&spec)?))
    }
    /// Source's `open` keeps the writer's full material, including sentences
    /// longer than the bounds imposed on model-produced candidates.
    pub fn seeded(
        id: Uuid,
        kind: ToolKind,
        passage: &str,
        options: &SeedOptions,
    ) -> Result<Self, ValidationError> {
        let spec = seed_spec(kind, passage, options);
        if kind == ToolKind::RhythmStrip
            && ["targetMin", "targetMax"]
                .iter()
                .any(|key| spec["elements"]["tool"]["props"][key].as_f64().is_none())
        {
            return Err(ValidationError);
        }
        Ok(Self::initialized(id, spec))
    }
    pub fn fill_offline(mut self) -> Self {
        let (spec, notice) = offline_fill(&self.spec);
        self.spec = spec;
        self.notice = notice.map(str::to_owned);
        self.filling = false;
        self
    }
    fn initialized(id: Uuid, spec: Value) -> Self {
        Self {
            id,
            spec,
            filling: false,
            reason: String::new(),
            tentative: false,
            notice: None,
            saved_id: None,
        }
    }
    pub fn spec(&self) -> &Value {
        &self.spec
    }
    pub fn props(&self) -> &Value {
        &self.spec["elements"]["tool"]["props"]
    }
    pub fn component(&self) -> &str {
        self.spec["elements"]["tool"]["type"]
            .as_str()
            .expect("validated catalog component")
    }
    pub fn title(&self) -> &'static str {
        match self.component() {
            "SentenceLab" => "Sentence Lab",
            "RhythmStrip" => "Rhythm Strip",
            "ClaimCheck" => "Claim Check",
            "ReaderQuestions" => "Reader Questions",
            _ => unreachable!(),
        }
    }
    /// Source `configFor` reads spec props, including ClaimCheck's original
    /// labels; its local checkbox/additional support state is not persisted.
    pub fn kept_config(&self) -> Value {
        let props = self.props();
        match self.component() {
            "RhythmStrip" => json!({"targetMin":props["targetMin"],"targetMax":props["targetMax"]}),
            "ClaimCheck" => {
                json!({"slots":props["slots"].as_array().unwrap().iter().map(|s|s["label"].clone()).collect::<Vec<_>>()})
            }
            "ReaderQuestions" if props["angle"].as_str().unwrap() != "" => {
                json!({"angle":props["angle"]})
            }
            _ => json!({}),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SupportSlot {
    pub label: String,
    pub filled: bool,
}

pub struct ToolModel {
    pub snapshot: ToolSnapshot,
    pub working: String,
    pub slots: Vec<SupportSlot>,
    pub angle: String,
    pub answered: BTreeSet<String>,
    pub jotted: BTreeSet<String>,
    pub research_message: String,
    researching: Option<Uuid>,
    jotting: BTreeMap<Uuid, String>,
    retired: bool,
}
impl ToolModel {
    pub fn new(snapshot: ToolSnapshot) -> Self {
        let props = snapshot.props();
        let working = props
            .get("sentence")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let angle = props
            .get("angle")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let slots = if snapshot.component() == "ClaimCheck" {
            props["slots"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| SupportSlot {
                    label: s["label"].as_str().unwrap().to_owned(),
                    filled: s["filled"].as_bool().unwrap(),
                })
                .collect()
        } else {
            Vec::new()
        };
        Self {
            snapshot,
            working,
            slots,
            angle,
            answered: BTreeSet::new(),
            jotted: BTreeSet::new(),
            research_message: String::new(),
            researching: None,
            jotting: BTreeMap::new(),
            retired: false,
        }
    }
    /// Same Qwik key/component retains its input state across streamed props.
    /// A different key/component requires a newly constructed native entity.
    pub fn update(&mut self, snapshot: ToolSnapshot) -> bool {
        if self.retired
            || snapshot.id != self.snapshot.id
            || snapshot.component() != self.snapshot.component()
        {
            return false;
        }
        self.snapshot = snapshot;
        true
    }
    pub fn writable(&self) -> bool {
        !self.retired
    }
    pub fn retire(&mut self) {
        self.retired = true;
        self.researching = None;
        self.jotting.clear();
    }
    pub fn variant_to_apply(&self) -> Option<String> {
        if !self.writable()
            || self.snapshot.component() != "SentenceLab"
            || self.working == self.snapshot.props()["sentence"].as_str().unwrap()
            || js_trim(&self.working).is_empty()
        {
            return None;
        }
        Some(js_trim(&self.working).to_owned())
    }
    pub fn add_support(&mut self, text: &str) -> bool {
        if !self.writable() || self.snapshot.component() != "ClaimCheck" || self.slots.len() >= 5 {
            return false;
        }
        let trimmed = js_trim(text);
        // serde_json/Rust strings cannot hold the lone surrogate produced by
        // JS slice(0,60). Keep that input intact until a UTF-16 bridge exists.
        let mut units = 0;
        let mut end = trimmed.len();
        for (byte, ch) in trimmed.char_indices() {
            if units == 60 {
                end = byte;
                break;
            }
            units += ch.len_utf16();
            if units > 60 {
                return false;
            }
        }
        let label = &trimmed[..end];
        if label.is_empty() {
            return false;
        }
        if !self.slots.iter().any(|s| s.label == label) {
            self.slots.push(SupportSlot {
                label: label.to_owned(),
                filled: false,
            });
        }
        true
    }
    pub fn researching(&self) -> bool {
        self.researching.is_some()
    }
    pub fn begin_research(&mut self) -> Option<(Uuid, String)> {
        if !self.writable() || self.researching() || self.snapshot.component() != "ClaimCheck" {
            return None;
        }
        let id = Uuid::new_v4();
        self.researching = Some(id);
        self.research_message.clear();
        Some((
            id,
            self.snapshot.props()["claim"].as_str().unwrap().to_owned(),
        ))
    }
    /// Host acknowledgment means the actual Apparatus request was accepted.
    pub fn finish_research(&mut self, request: Uuid, result: Result<(), String>) -> bool {
        if !self.writable() || self.researching != Some(request) {
            return false;
        }
        self.researching = None;
        self.research_message = result
            .err()
            .unwrap_or_else(|| "Searching — results land in the Apparatus.".to_owned());
        true
    }
    pub fn begin_jot(&mut self, question: &str) -> Option<Uuid> {
        if !self.writable()
            || self.snapshot.component() != "ReaderQuestions"
            || self.jotted.contains(question)
            || !self.snapshot.props()["questions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|q| q.as_str() == Some(question))
        {
            return None;
        }
        let id = Uuid::new_v4();
        self.jotting.insert(id, question.to_owned());
        Some(id)
    }
    /// Mark Jotted only after the host confirms the real scraps write.
    pub fn finish_jot(&mut self, request: Uuid, saved: bool) -> bool {
        if !self.writable() {
            return false;
        }
        let Some(question) = self.jotting.remove(&request) else {
            return false;
        };
        if saved {
            self.jotted.insert(question);
        }
        true
    }
}

pub fn rhythm_summary(props: &Value) -> String {
    let min = props["targetMin"].as_f64().unwrap();
    let max = props["targetMax"].as_f64().unwrap();
    let words: Vec<f64> = props["sentences"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["words"].as_f64().unwrap())
        .collect();
    let largest = words.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let smallest = words.iter().copied().fold(f64::INFINITY, f64::min);
    if words.len() >= 4 && largest - smallest <= 4.0 {
        return "The sentences are all about the same length.".to_owned();
    }
    let long = words.iter().filter(|&&n| n > max).count();
    let short = words.iter().filter(|&&n| n < min).count();
    let mut parts = Vec::new();
    if long > 0 {
        parts.push(format!(
            "{long} run{} long",
            if long == 1 { "s" } else { "" }
        ));
    }
    if short > 0 {
        parts.push(format!(
            "{short} {} clipped",
            if short == 1 { "is" } else { "are" }
        ));
    }
    if parts.is_empty() {
        "The lengths vary within the band.".to_owned()
    } else {
        format!("{}.", parts.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot(component: &str, props: Value) -> ToolSnapshot {
        ToolSnapshot::new(Uuid::new_v4(),json!({"root":"tool","elements":{"tool":{"type":component,"props":props,"children":[]}}})).unwrap()
    }
    #[test]
    fn long_writer_seed_remains_editable_without_admitting_it_as_model_output() {
        let sentence = "x".repeat(1201);
        let snapshot = ToolSnapshot::seeded(
            Uuid::new_v4(),
            ToolKind::SentenceLab,
            &sentence,
            &SeedOptions::default(),
        )
        .unwrap()
        .fill_offline();
        assert!(validate_tool_spec(snapshot.spec()).is_err());
        let mut model = ToolModel::new(snapshot);
        assert_eq!(model.working, sentence);
        model.working = "My chosen wording.".into();
        assert_eq!(
            model.variant_to_apply().as_deref(),
            Some("My chosen wording.")
        );
        assert_eq!(
            model.snapshot.notice.as_deref(),
            Some("Your own attempts only — connect a model in Settings for fresh variants.")
        );
    }
    #[test]
    fn unrelated_props_metadata_does_not_create_another_components_state() {
        let seed = snapshot(
            "SentenceLab",
            json!({"sentence":"Original.","attempts":[],"variants":[],"slots":[null]}),
        );
        let model = ToolModel::new(seed);
        assert!(model.slots.is_empty());
        assert_eq!(model.working, "Original.");
        assert_eq!(model.snapshot.props()["slots"], json!([null]));
    }
    #[test]
    fn streamed_suggestions_preserve_the_writers_current_working_copy() {
        let seed = snapshot(
            "SentenceLab",
            json!({"sentence":"Original.","attempts":[],"variants":[]}),
        );
        let mut model = ToolModel::new(seed.clone());
        model.working = "  My own edit.  ".into();
        let mut spec = seed.spec().clone();
        spec["elements"]["tool"]["props"]["variants"] = json!(["A suggestion."]);
        assert!(model.update(ToolSnapshot::new(seed.id, spec).unwrap()));
        assert_eq!(model.variant_to_apply().as_deref(), Some("My own edit."));
        assert_eq!(model.snapshot.props()["variants"], json!(["A suggestion."]));
        let other = snapshot(
            "SentenceLab",
            json!({"sentence":"Different.","attempts":[],"variants":[]}),
        );
        assert!(!model.update(other));
        assert_eq!(model.working, "  My own edit.  ");
    }
    #[test]
    fn support_checkboxes_and_additions_remain_local_as_in_source() {
        let mut model = ToolModel::new(snapshot(
            "ClaimCheck",
            json!({"claim":"A claim.","slots":[{"label":"A source","filled":false}]}),
        ));
        model.slots[0].filled = true;
        assert!(model.add_support("\u{feff}Another example  "));
        assert!(model.add_support("Another example"));
        assert_eq!(model.slots.len(), 2);
        assert_eq!(model.snapshot.kept_config(), json!({"slots":["A source"]}));
    }
    #[test]
    fn jot_requires_an_exact_successful_live_acknowledgment() {
        let mut model = ToolModel::new(snapshot(
            "ReaderQuestions",
            json!({"angle":"","questions":["Why now?"]}),
        ));
        let id = model.begin_jot("Why now?").unwrap();
        assert!(!model.finish_jot(Uuid::new_v4(), true));
        assert!(model.jotted.is_empty());
        assert!(model.finish_jot(id, false));
        assert!(model.jotted.is_empty());
        let id = model.begin_jot("Why now?").unwrap();
        assert!(model.finish_jot(id, true));
        assert!(model.jotted.contains("Why now?"));
        assert!(model.begin_jot("Why now?").is_none());
    }
    #[test]
    fn retired_tool_discards_pending_research_results() {
        let mut model = ToolModel::new(snapshot(
            "ClaimCheck",
            json!({"claim":"A claim.","slots":[{"label":"A source","filled":false}]}),
        ));
        let (id, _) = model.begin_research().unwrap();
        model.retire();
        assert!(!model.finish_research(id, Ok(())));
        assert!(model.research_message.is_empty());
    }
}
