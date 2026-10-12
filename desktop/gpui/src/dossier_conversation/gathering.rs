//! Gathering state for the dossier conversation: prior manuscript material,
//! document/link references, typed probes/particulars, and starter projections.
//!
//! Gathering preserves raw writer words, source provenance, and exact HTML
//! starter projections without loss. Word counts and measurements are bounded
//! and run on quiet/explicit boundaries rather than on every keystroke.

use crate::{
    dossier::{PriorMaterial, ReferenceDraft, material_word_count, validate_probe_answer},
    workspace::{DossierAttachment, DossierProbe, ProbeAnswer, ProjectInterviewAnswers},
};
use anyhow::Result;
use serde::{Deserialize, Serialize};

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Fixture-tested convenience projection. Canonical filing uses the original
/// semantic helper; this Rust copy is not a complete JS-string equivalence proof.
pub fn build_starter_document(answers: &ProjectInterviewAnswers) -> String {
    let title = escape_html(answers.working_title.trim());
    let format = escape_html(answers.format.trim());
    let audience = escape_html(answers.audience.trim());
    let goal = escape_html(answers.goal.trim());
    let tone = escape_html(answers.tone.trim());
    let constraints = escape_html(answers.constraints.trim());
    let success_signal = escape_html(answers.success_signal.trim());

    let starter = format!(
        "<h1>{title}</h1>\n    <p><strong>Anti-tabula rasa brief</strong>: this draft starts with context, not emptiness.</p>\n    <h2>Working context</h2>\n    <ul>\n      <li><strong>Format:</strong> {format}</li>\n      <li><strong>Audience:</strong> {audience}</li>\n      <li><strong>Goal:</strong> {goal}</li>\n      <li><strong>Tone:</strong> {tone}</li>\n      <li><strong>Constraints:</strong> {constraints}</li>\n      <li><strong>Success signal:</strong> {success_signal}</li>\n    </ul>\n    <h2>Starter prompt</h2>\n    <blockquote>\n      <p>{goal}</p>\n    </blockquote>\n    <p>Begin the draft here. The room will use the brief above as the anchor.</p>"
    );
    starter.trim().to_string()
}

/// Fixture-tested convenience projection. Multiple blank-line and JS trim
/// classes are not fully equivalent; do not use this for canonical filing.
pub fn build_imported_material_document(
    answers: &ProjectInterviewAnswers,
    raw: &str,
    filename: Option<&str>,
) -> String {
    let title = escape_html(answers.working_title.trim());
    let source_label = match filename.map(str::trim).filter(|f| !f.is_empty()) {
        Some(f) => format!("Imported from {}", escape_html(f)),
        None => "Imported material".to_string(),
    };

    // Paragraphs split by \n{2,}
    let paragraphs: Vec<String> = raw
        .trim()
        .split("\n\n")
        .map(|paragraph| {
            let escaped = escape_html(paragraph.trim()).replace('\n', "<br>");
            format!("<p>{escaped}</p>")
        })
        .collect();

    let body = paragraphs.join("\n");

    let imported = format!(
        "<h1>{title}</h1>\n    <p><strong>{source_label}</strong>: this material was brought into the room during onboarding.</p>\n    {body}"
    );
    imported.trim().to_string()
}

/// Upserts a probe into the answered list, replacing any probe with the same
/// ID while keeping earlier answered order, as Source `upsertProbe` does.
pub fn upsert_probe(probes: &mut Vec<DossierProbe>, answered: DossierProbe) {
    let index = probes.iter().position(|p| p.id == answered.id);
    if let Some(i) = index {
        probes[i] = answered;
    } else {
        probes.push(answered);
    }
}

/// Counts how many of the 7 brief fields are non-empty.
pub fn count_filled_fields(answers: &ProjectInterviewAnswers) -> usize {
    crate::house::DOSSIER_FIELDS
        .iter()
        .filter(|field| !crate::dossier::answer(answers, **field).trim().is_empty())
        .count()
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GatheringState {
    pub prior_material: PriorMaterial,
    pub attachments: Vec<DossierAttachment>,
    #[serde(default)]
    pub reference_draft: ReferenceDraft,
    #[serde(default)]
    pub active_probe: Option<DossierProbe>,
    #[serde(default)]
    pub answered_probes: Vec<DossierProbe>,
    #[serde(default)]
    pub material_words: usize,
}

impl GatheringState {
    pub fn new(prior_material: PriorMaterial, attachments: Vec<DossierAttachment>) -> Self {
        let material_words = material_word_count(&prior_material.text);
        Self {
            prior_material,
            attachments,
            reference_draft: ReferenceDraft::default(),
            active_probe: None,
            answered_probes: Vec::new(),
            material_words,
        }
    }

    pub fn set_prior_material_text(&mut self, text: String) {
        self.material_words = material_word_count(&text);
        self.prior_material.replace_text(text);
    }

    pub fn add_reference(&mut self, now: u64) -> Result<()> {
        let attachment = self.reference_draft.attachment(now)?;
        self.attachments.push(attachment);
        self.reference_draft = ReferenceDraft::default();
        Ok(())
    }

    pub fn remove_reference(&mut self, id: &str) {
        self.attachments.retain(|a| a.id != id);
    }

    pub fn answer_active_probe(&mut self, answer: ProbeAnswer) -> Result<DossierProbe> {
        let probe = self
            .active_probe
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No active probe to answer."))?;
        validate_probe_answer(probe, Some(&answer))?;
        let mut probe = probe.clone();
        probe.answer = Some(answer);
        self.active_probe = None;
        upsert_probe(&mut self.answered_probes, probe.clone());
        Ok(probe)
    }

    pub fn skip_active_probe(&mut self) -> Option<DossierProbe> {
        self.active_probe.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dossier::MAX_REFERENCE_UNITS;
    use crate::workspace::{AttachmentKind, BriefField, ProbeKind};

    #[test]
    fn starter_and_imported_documents_match_web_contract() {
        let fixture_val: serde_json::Value = serde_json::from_str(include_str!(
            "../../fixtures/dossier-conversation/web-conversation-contract.json"
        ))
        .unwrap();

        let sample_answers: ProjectInterviewAnswers =
            serde_json::from_value(fixture_val["sampleAnswers"].clone()).unwrap();

        let starter = build_starter_document(&sample_answers);
        assert_eq!(
            starter,
            fixture_val["documents"]["starterHtml"].as_str().unwrap()
        );

        let imported_with_file = build_imported_material_document(
            &sample_answers,
            "Paragraph one of previous material.\n\nParagraph two with notes.",
            Some("chapter-outline.txt"),
        );
        assert_eq!(
            imported_with_file,
            fixture_val["documents"]["importedHtmlWithFilename"]
                .as_str()
                .unwrap()
        );

        let imported_no_file =
            build_imported_material_document(&sample_answers, "Single block of pasted text.", None);
        assert_eq!(
            imported_no_file,
            fixture_val["documents"]["importedHtmlWithoutFilename"]
                .as_str()
                .unwrap()
        );
    }

    #[test]
    fn probe_upsert_replaces_only_by_id_and_retains_distinct_matching_prompts() {
        let mut probes = vec![DossierProbe {
            id: "p1".into(),
            kind: ProbeKind::Choice,
            prompt: "Which format?".into(),
            options: Some(vec!["Essay".into(), "Report".into()]),
            template: None,
            min: None,
            max: None,
            min_label: None,
            max_label: None,
            answer: Some(ProbeAnswer::Text("Essay".into())),
            relates_to: Some(BriefField::Format),
            extra: Default::default(),
        }];

        let updated = DossierProbe {
            id: "p1".into(),
            kind: ProbeKind::Choice,
            prompt: "Which format?".into(),
            options: Some(vec!["Essay".into(), "Report".into()]),
            template: None,
            min: None,
            max: None,
            min_label: None,
            max_label: None,
            answer: Some(ProbeAnswer::Text("Report".into())),
            relates_to: Some(BriefField::Format),
            extra: Default::default(),
        };

        upsert_probe(&mut probes, updated);
        assert_eq!(probes.len(), 1);
        assert_eq!(probes[0].answer, Some(ProbeAnswer::Text("Report".into())));

        // Second probe with different ID but matching prompt
        let prompt_match = DossierProbe {
            id: "p2-different-id".into(),
            kind: ProbeKind::Choice,
            prompt: "  Which   format?  ".into(),
            options: Some(vec!["Essay".into(), "Report".into()]),
            template: None,
            min: None,
            max: None,
            min_label: None,
            max_label: None,
            answer: Some(ProbeAnswer::Text("Essay".into())),
            relates_to: Some(BriefField::Format),
            extra: Default::default(),
        };

        upsert_probe(&mut probes, prompt_match);
        assert_eq!(probes.len(), 2);
        assert_eq!(probes[0].id, "p1");
        assert_eq!(probes[0].answer, Some(ProbeAnswer::Text("Report".into())));
        assert_eq!(probes[1].id, "p2-different-id");
        assert_eq!(probes[1].answer, Some(ProbeAnswer::Text("Essay".into())));
    }

    #[test]
    fn reference_clamping_and_attachment_creation() {
        let mut state = GatheringState::default();
        state.reference_draft.kind = AttachmentKind::Document;
        state.reference_draft.title = "Source Document".into();
        state.reference_draft.why = "Load-bearing evidence".into();
        // Text longer than 2000 utf16 units should truncate
        let long_text = "word ".repeat(500);
        state.reference_draft.replace_text(&long_text);

        assert!(state.reference_draft.truncated);
        assert!(state.reference_draft.text.encode_utf16().count() <= MAX_REFERENCE_UNITS);

        state.add_reference(1000).unwrap();
        assert_eq!(state.attachments.len(), 1);
        assert_eq!(state.attachments[0].title, "Source Document");
        assert_eq!(state.attachments[0].why, "Load-bearing evidence");
        assert!(state.attachments[0].text.is_some());
        assert_eq!(state.reference_draft.title, "");
    }
}
