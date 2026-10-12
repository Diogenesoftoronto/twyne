//! Retained offline Rubric metadata. No model calls, manuscript conversion or
//! grade generation happen here. Artifact paths supply scope; a row's optional
//! `folioId` is retained data and is never used as an ownership alias.

use crate::{exchange::OptionalField, house::is_js_whitespace, workspace::ExtraFields};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

pub const RUBRIC_FORMAT: &str = "twyne-gpui-rubric";
pub const RUBRIC_VERSION: u64 = 1;
pub const MAX_RUBRIC_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_HISTORY: usize = 50;
pub const MIN_WEIGHT: f64 = 0.25;
pub const MAX_WEIGHT: f64 = 3.0;

/// Web values remain raw, including malformed values. Local changes are
/// explicit overlays rather than silent repairs of imported metadata.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RubricArtifacts {
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub result: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub criteria: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub history: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub live_review: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub local_criteria: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub local_history: OptionalField<Value>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RubricRecord {
    pub format: String,
    pub version: u64,
    pub generation: u64,
    #[serde(default)]
    pub folios: BTreeMap<String, RubricArtifacts>,
    /// Unscoped artifacts are inspectable retained data, never active-folio data.
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub legacy: OptionalField<Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub live_review_enabled: OptionalField<Value>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl Default for RubricRecord {
    fn default() -> Self {
        Self {
            format: RUBRIC_FORMAT.into(),
            version: RUBRIC_VERSION,
            generation: 0,
            folios: BTreeMap::new(),
            legacy: OptionalField::Missing,
            live_review_enabled: OptionalField::Missing,
            extra: ExtraFields::new(),
        }
    }
}
impl RubricRecord {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.format == RUBRIC_FORMAT && self.version == RUBRIC_VERSION,
            "This Rubric format needs a compatible version of Twyne. Its file was kept."
        );
        for scope in self.folios.keys() {
            ensure!(
                !scope.is_empty(),
                "Rubric artifacts need an explicit folio scope."
            );
        }
        Ok(())
    }
}

pub fn parse_rubric_json(bytes: &[u8]) -> Result<RubricRecord> {
    ensure!(
        bytes.len() <= MAX_RUBRIC_BYTES,
        "Rubric exceeds its 16 MiB metadata limit."
    );
    let record: RubricRecord = serde_json::from_slice(bytes)?;
    record.validate()?;
    Ok(record)
}

macro_rules! open_enum {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub enum $name { $($variant,)+ Other(String) }
        impl $name {
            pub fn as_str(&self) -> &str {
                match self { $(Self::$variant => $wire,)+ Self::Other(value) => value }
            }
        }
        impl Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok,S::Error> {
                serializer.serialize_str(self.as_str())
            }
        }
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> std::result::Result<Self,D::Error> {
                let value = String::deserialize(deserializer)?;
                Ok(match value.as_str() { $($wire => Self::$variant,)+ _ => Self::Other(value) })
            }
        }
    };
}
open_enum!(CriterionSource { Spine => "spine", Custom => "custom" });
open_enum!(ScoringMethod { Judgement => "judgement", Room => "room" });
open_enum!(PassageKind { Nothing => "nothing", Advice => "advice", Question => "question", Evidence => "evidence", Cut => "cut" });

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RubricCriterionSpec {
    pub id: String,
    pub label: String,
    pub description: String,
    pub source: CriterionSource,
    pub enabled: bool,
    pub weight: f64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
impl RubricCriterionSpec {
    pub fn custom(label: &str, description: &str) -> Result<Self> {
        let label = label.trim_matches(is_js_whitespace);
        ensure!(
            !label.is_empty(),
            "Give the custom criterion a name before adding it."
        );
        Ok(Self {
            id: format!("custom-{}", Uuid::new_v4()),
            label: label.into(),
            description: description.trim_matches(is_js_whitespace).into(),
            source: CriterionSource::Custom,
            enabled: true,
            weight: 1.0,
            extra: ExtraFields::new(),
        })
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RubricCriterion {
    pub id: String,
    pub label: String,
    pub description: String,
    pub score: f64,
    pub max_score: f64,
    pub feedback: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RubricHistoryEntry {
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub scoring_method: OptionalField<ScoringMethod>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub folio_id: OptionalField<String>,
    pub at: f64,
    pub overall: f64,
    pub grade: String,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub target_fit: OptionalField<f64>,
    pub per_criterion: BTreeMap<String, f64>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JudgeResult {
    pub persona_id: String,
    pub score: f64,
    pub rationale: String,
    pub provider: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GradedCriterion {
    pub id: String,
    pub score: f64,
    pub level: f64,
    pub confidence: f64,
    pub probabilities: BTreeMap<String, f64>,
    pub legend: BTreeMap<String, String>,
    pub bimodal: bool,
    pub modal: f64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct RubricUsage {
    pub input_tokens: f64,
    pub output_tokens: f64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RubricGrade {
    pub at: f64,
    pub model: String,
    pub criteria: BTreeMap<String, GradedCriterion>,
    pub usage: RubricUsage,
    pub cost_usd: f64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StaticFeatures {
    pub word_count: f64,
    pub paragraph_count: f64,
    pub sentence_count: f64,
    pub avg_sentence_length: f64,
    pub sentence_length_std_dev: f64,
    pub citation_count: f64,
    pub citation_density: f64,
    pub avg_word_length: f64,
    pub unique_words_ratio: f64,
    pub short_paragraph_ratio: f64,
    pub long_paragraph_ratio: f64,
    pub duplicate_paragraph_ratio: f64,
    pub filler_word_ratio: f64,
    pub vague_word_ratio: f64,
    pub unsupported_universal_claim_count: f64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StaticPerFeature {
    pub length: f64,
    pub structure: f64,
    pub pacing: f64,
    pub evidence: f64,
    pub vocabulary: f64,
    pub paragraph_shape: f64,
    pub integrity: f64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StaticScore {
    pub features: StaticFeatures,
    pub per_feature: StaticPerFeature,
    pub total: f64,
    pub feedback: Vec<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RubricResult {
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub judgement_grade: OptionalField<RubricGrade>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub draft_fingerprint: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub scoring_method: OptionalField<ScoringMethod>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub folio_id: OptionalField<String>,
    pub criteria: Vec<RubricCriterion>,
    pub overall_score: f64,
    pub overall_grade: String,
    pub summary: String,
    pub timestamp: f64,
    pub judges: Vec<JudgeResult>,
    pub static_score: StaticScore,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub review: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub review_provider: OptionalField<String>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub target_fit: OptionalField<f64>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub writer_score: OptionalField<f64>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Passage {
    pub id: String,
    pub text: String,
    pub from: f64,
    pub to: f64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct TriagedPassage {
    pub passage: Passage,
    pub kind: PassageKind,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub confidence: OptionalField<f64>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub criticality: OptionalField<f64>,
    pub priority: f64,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveReview {
    pub folio_id: String,
    pub fingerprint: String,
    pub at: f64,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub rubric: OptionalField<RubricResult>,
    /// Brief, lens and note-verdict contracts are retained verbatim, without
    /// pretending this Rubric slice evaluates or executes them.
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub brief: OptionalField<Value>,
    pub passages: Vec<TriagedPassage>,
    pub coverage: String,
    pub lenses: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "OptionalField::is_missing")]
    pub notes: OptionalField<Vec<Value>>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectionState {
    Missing,
    Null,
    Value,
    Malformed,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionIssue {
    pub path: String,
    pub message: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct MetadataProjection<T> {
    pub state: ProjectionState,
    pub value: Option<T>,
    pub issues: Vec<ProjectionIssue>,
}
trait DisplayValue: for<'de> Deserialize<'de> {
    fn validate_display(&self) -> Result<()>;
}
fn project<T: DisplayValue>(raw: &OptionalField<Value>, path: &str) -> MetadataProjection<T> {
    let state = match raw {
        OptionalField::Missing => ProjectionState::Missing,
        OptionalField::Null => ProjectionState::Null,
        OptionalField::Value(_) => ProjectionState::Value,
    };
    let Some(raw) = raw.as_ref() else {
        return MetadataProjection {
            state,
            value: None,
            issues: Vec::new(),
        };
    };
    let parsed = serde_json::from_value::<T>(raw.clone())
        .map_err(anyhow::Error::from)
        .and_then(|value| {
            value.validate_display()?;
            Ok(value)
        });
    match parsed {
        Ok(value) => MetadataProjection {
            state,
            value: Some(value),
            issues: Vec::new(),
        },
        Err(error) => MetadataProjection {
            state: ProjectionState::Malformed,
            value: None,
            issues: vec![ProjectionIssue {
                path: path.into(),
                message: format!("This retained Rubric value cannot be displayed safely: {error}"),
            }],
        },
    }
}
fn score_in_range(value: f64, max: f64, name: &str) -> Result<()> {
    ensure!(
        value.is_finite() && max.is_finite() && max > 0.0 && (0.0..=max).contains(&value),
        "{name} must be a finite score from 0 to {max}."
    );
    Ok(())
}
impl DisplayValue for Vec<RubricCriterionSpec> {
    fn validate_display(&self) -> Result<()> {
        for (index, spec) in self.iter().enumerate() {
            ensure!(
                spec.weight.is_finite(),
                "Criterion {index} has a non-finite weight."
            );
        }
        Ok(())
    }
}
impl DisplayValue for RubricArtifacts {
    fn validate_display(&self) -> Result<()> {
        Ok(())
    }
}
impl DisplayValue for Vec<RubricHistoryEntry> {
    fn validate_display(&self) -> Result<()> {
        for entry in self {
            ensure!(entry.at.is_finite(), "History has a non-finite timestamp.");
            score_in_range(entry.overall, 100.0, "History overall")?;
            if let Some(fit) = entry.target_fit.as_ref() {
                score_in_range(*fit, 10.0, "History target fit")?;
            }
            for score in entry.per_criterion.values() {
                score_in_range(*score, 10.0, "History criterion")?;
            }
        }
        Ok(())
    }
}
impl DisplayValue for RubricResult {
    fn validate_display(&self) -> Result<()> {
        score_in_range(self.overall_score, 100.0, "Overall")?;
        ensure!(
            self.timestamp.is_finite(),
            "The result has a non-finite timestamp."
        );
        for criterion in &self.criteria {
            score_in_range(criterion.score, criterion.max_score, "Criterion")?;
        }
        for judge in &self.judges {
            score_in_range(judge.score, 10.0, "Editor")?;
        }
        for (value, name) in [
            (&self.target_fit, "Target fit"),
            (&self.writer_score, "Writer score"),
        ] {
            if let Some(value) = value.as_ref() {
                score_in_range(
                    *value,
                    if name == "Writer score" { 100.0 } else { 10.0 },
                    name,
                )?;
            }
        }
        self.static_score.validate_display()?;
        if let Some(grade) = self.judgement_grade.as_ref() {
            ensure!(
                grade.at.is_finite() && grade.cost_usd.is_finite() && grade.cost_usd >= 0.0,
                "The judgement timestamp or cost is invalid."
            );
            ensure!(
                grade.usage.input_tokens.is_finite()
                    && grade.usage.output_tokens.is_finite()
                    && grade.usage.input_tokens >= 0.0
                    && grade.usage.output_tokens >= 0.0,
                "Judgement usage is invalid."
            );
            for mark in grade.criteria.values() {
                score_in_range(mark.score, 10.0, "Judgement criterion")?;
                ensure!(
                    mark.level.is_finite() && mark.modal.is_finite(),
                    "Judgement levels are invalid."
                );
                score_in_range(mark.confidence, 1.0, "Judgement concentration")?;
                for probability in mark.probabilities.values() {
                    score_in_range(*probability, 1.0, "Judgement probability")?;
                }
            }
        }
        Ok(())
    }
}
impl StaticScore {
    pub fn validate_display(&self) -> Result<()> {
        score_in_range(self.total, 10.0, "Static total")?;
        for value in [
            self.per_feature.length,
            self.per_feature.structure,
            self.per_feature.pacing,
            self.per_feature.evidence,
            self.per_feature.vocabulary,
            self.per_feature.paragraph_shape,
            self.per_feature.integrity,
        ] {
            score_in_range(value, 10.0, "Static feature")?;
        }
        // These are measurements, not inferred editorial marks. Never clamp or
        // invent a replacement if the retained number is malformed.
        for value in [
            self.features.word_count,
            self.features.paragraph_count,
            self.features.sentence_count,
            self.features.avg_sentence_length,
            self.features.sentence_length_std_dev,
            self.features.citation_count,
            self.features.citation_density,
            self.features.avg_word_length,
            self.features.unique_words_ratio,
            self.features.short_paragraph_ratio,
            self.features.long_paragraph_ratio,
            self.features.duplicate_paragraph_ratio,
            self.features.filler_word_ratio,
            self.features.vague_word_ratio,
            self.features.unsupported_universal_claim_count,
        ] {
            ensure!(
                value.is_finite() && value >= 0.0,
                "A retained static measurement is invalid."
            );
        }
        Ok(())
    }
}
impl DisplayValue for LiveReview {
    fn validate_display(&self) -> Result<()> {
        ensure!(
            self.at.is_finite(),
            "Live review has a non-finite timestamp."
        );
        if let Some(result) = self.rubric.as_ref() {
            result.validate_display()?;
        }
        for passage in &self.passages {
            ensure!(
                passage.passage.from.is_finite()
                    && passage.passage.to.is_finite()
                    && passage.passage.from >= 0.0
                    && passage.passage.to >= passage.passage.from,
                "A retained passage has invalid draft offsets."
            );
            ensure!(
                passage.priority.is_finite(),
                "A retained passage has invalid priority."
            );
            for value in [&passage.confidence, &passage.criticality] {
                if let Some(value) = value.as_ref() {
                    score_in_range(*value, 1.0, "Passage concentration")?;
                }
            }
        }
        ensure!(
            self.brief.as_ref().is_none_or(Value::is_object),
            "A retained brief reading is not an object."
        );
        ensure!(
            self.lenses.values().all(Value::is_object),
            "A retained lens reading is not an object."
        );
        ensure!(
            self.notes
                .as_ref()
                .is_none_or(|notes| notes.iter().all(Value::is_object)),
            "A retained note reading is not an object."
        );
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CachedScoreSet {
    /// Exact initial Board/full-route projection: saved visible criteria.
    VisibleCriteria,
    /// Exact Board criteria-edit projection: all saved raw judgement marks.
    AllJudgement,
}
impl RubricResult {
    pub fn cached_scores(&self, source: CachedScoreSet) -> BTreeMap<String, f64> {
        if source == CachedScoreSet::AllJudgement
            && let Some(grade) = self.judgement_grade.as_ref()
        {
            return grade
                .criteria
                .values()
                .map(|mark| (mark.id.clone(), mark.score))
                .collect();
        }
        self.criteria
            .iter()
            .map(|criterion| (criterion.id.clone(), criterion.score))
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RubricDisplay {
    /// The original artifact scope, independent of every row's folioId.
    pub folio_id: String,
    pub result: MetadataProjection<RubricResult>,
    pub criteria: Vec<RubricCriterionSpec>,
    pub criteria_editable: bool,
    pub history: Vec<RubricHistoryEntry>,
    pub history_appendable: bool,
    pub live_review: MetadataProjection<LiveReview>,
    pub issues: Vec<ProjectionIssue>,
}
impl RubricDisplay {
    pub fn writer_score(&self, source: CachedScoreSet) -> Option<f64> {
        if !self.criteria_editable {
            return None;
        }
        weighted_criteria_score(
            &self.criteria,
            &self.result.value.as_ref()?.cached_scores(source),
        )
    }
    pub fn comparable_history(&self) -> Vec<&RubricHistoryEntry> {
        let method = self
            .result
            .value
            .as_ref()
            .and_then(|result| result.scoring_method.as_ref());
        comparable_history(&self.history, method)
    }
}
impl RubricArtifacts {
    fn effective_criteria(&self) -> &OptionalField<Value> {
        if self.local_criteria.is_missing() {
            &self.criteria
        } else {
            &self.local_criteria
        }
    }
    fn effective_history(&self) -> &OptionalField<Value> {
        if self.local_history.is_missing() {
            &self.history
        } else {
            &self.local_history
        }
    }
    pub fn display(&self, scope: &str) -> RubricDisplay {
        let path = |field| format!("folios[{scope:?}].{field}");
        let result = project(&self.result, &path("result"));
        let raw_criteria = project::<Vec<RubricCriterionSpec>>(&self.criteria, &path("criteria"));
        let raw_history = project::<Vec<RubricHistoryEntry>>(&self.history, &path("history"));
        let local_criteria =
            project::<Vec<RubricCriterionSpec>>(&self.local_criteria, &path("localCriteria"));
        let local_history =
            project::<Vec<RubricHistoryEntry>>(&self.local_history, &path("localHistory"));
        let active_criteria = if self.local_criteria.is_missing() {
            &raw_criteria
        } else {
            &local_criteria
        };
        let active_history = if self.local_history.is_missing() {
            &raw_history
        } else {
            &local_history
        };
        let live_review = project(&self.live_review, &path("liveReview"));
        let issues = [
            &result.issues,
            &raw_criteria.issues,
            &raw_history.issues,
            &local_criteria.issues,
            &local_history.issues,
            &live_review.issues,
        ]
        .into_iter()
        .flat_map(|issues| issues.iter().cloned())
        .collect();
        RubricDisplay {
            folio_id: scope.into(),
            criteria: reconcile_specs(active_criteria.value.as_deref()),
            criteria_editable: active_criteria.state != ProjectionState::Malformed,
            history: active_history.value.clone().unwrap_or_default(),
            history_appendable: active_history.state != ProjectionState::Malformed,
            result,
            live_review,
            issues,
        }
    }
}
impl RubricRecord {
    /// An inspection-only projection. It has no active folio or import target.
    pub fn legacy_artifacts(&self) -> MetadataProjection<RubricArtifacts> {
        if self.legacy.as_ref().is_some_and(|value| !value.is_object()) {
            return MetadataProjection {
                state: ProjectionState::Malformed,
                value: None,
                issues: vec![ProjectionIssue {
                    path: "legacy".into(),
                    message: "This retained unscoped Rubric value is not an artifact object."
                        .into(),
                }],
            };
        }
        project(&self.legacy, "legacy")
    }
    pub fn display(&self, scope: &str) -> Result<RubricDisplay> {
        ensure!(
            !scope.is_empty(),
            "Rubric artifacts need an explicit folio scope."
        );
        Ok(self
            .folios
            .get(scope)
            .cloned()
            .unwrap_or_default()
            .display(scope))
    }
    /// Only literal false pauses review, exactly as the source preference.
    /// This preference does not imply that an offline provider is available.
    pub fn automatic_review_enabled(&self) -> bool {
        self.live_review_enabled.as_ref() != Some(&Value::Bool(false))
    }
}

pub fn default_criteria_specs() -> Vec<RubricCriterionSpec> {
    #[derive(Deserialize)]
    struct Spine {
        id: String,
        label: String,
        description: String,
    }
    static SPINE: OnceLock<Vec<Spine>> = OnceLock::new();
    SPINE
        .get_or_init(|| {
            serde_json::from_str(include_str!("../fixtures/rubric/spine.json"))
                .expect("the source Rubric spine is valid")
        })
        .iter()
        .map(|criterion| RubricCriterionSpec {
            id: criterion.id.clone(),
            label: criterion.label.clone(),
            description: criterion.description.clone(),
            source: CriterionSource::Spine,
            enabled: true,
            weight: 1.0,
            extra: ExtraFields::new(),
        })
        .collect()
}
pub fn clamp_weight(weight: f64) -> f64 {
    if weight.is_finite() {
        weight.clamp(MIN_WEIGHT, MAX_WEIGHT)
    } else {
        1.0
    }
}
pub fn step_weight(weight: f64, direction: i8) -> f64 {
    let next = clamp_weight(weight) + f64::from(direction.signum()) * 0.25;
    clamp_weight((next * 100.0 + 0.5).floor() / 100.0)
}
/// Exact valid-source reconciliation: last matching ID supplies spine choices,
/// code supplies shipped prose, retired non-custom rows disappear, custom
/// rows retain order/prose/extra fields and weights are clamped.
pub fn reconcile_specs(stored: Option<&[RubricCriterionSpec]>) -> Vec<RubricCriterionSpec> {
    let mut spine = default_criteria_specs();
    let Some(stored) = stored.filter(|stored| !stored.is_empty()) else {
        return spine;
    };
    for criterion in &mut spine {
        if let Some(saved) = stored.iter().rfind(|saved| saved.id == criterion.id) {
            criterion.enabled = saved.enabled;
            criterion.weight = clamp_weight(saved.weight);
        }
    }
    spine.extend(
        stored
            .iter()
            .filter(|criterion| {
                criterion.source == CriterionSource::Custom
                    && !criterion.label.trim_matches(is_js_whitespace).is_empty()
            })
            .cloned()
            .map(|mut criterion| {
                criterion.weight = clamp_weight(criterion.weight);
                criterion
            }),
    );
    spine
}
pub fn active_custom_criteria(specs: &[RubricCriterionSpec]) -> Vec<&RubricCriterionSpec> {
    specs
        .iter()
        .filter(|spec| spec.source == CriterionSource::Custom && spec.enabled)
        .collect()
}
pub fn weighted_criteria_score(
    specs: &[RubricCriterionSpec],
    scores: &BTreeMap<String, f64>,
) -> Option<f64> {
    let customised = specs
        .iter()
        .any(|spec| spec.source == CriterionSource::Custom && spec.enabled)
        || specs.iter().any(|spec| {
            spec.source == CriterionSource::Spine && (!spec.enabled || spec.weight != 1.0)
        });
    if !customised {
        return None;
    }
    let mut numerator = 0.0;
    let mut denominator = 0.0;
    for spec in specs
        .iter()
        .filter(|spec| spec.enabled && spec.id != "engagement")
    {
        if let Some(score) = scores.get(&spec.id) {
            if !score.is_finite() {
                return None;
            }
            let weight = clamp_weight(spec.weight);
            numerator += score * weight;
            denominator += weight;
        }
    }
    if denominator <= 0.0 {
        return None;
    }
    Some((numerator / denominator * 10.0 + 0.5).floor())
}
pub fn comparable_history<'a>(
    history: &'a [RubricHistoryEntry],
    method: Option<&ScoringMethod>,
) -> Vec<&'a RubricHistoryEntry> {
    let method = method.map_or("room", ScoringMethod::as_str);
    history
        .iter()
        .filter(|entry| {
            entry
                .scoring_method
                .as_ref()
                .map_or("room", ScoringMethod::as_str)
                == method
        })
        .collect()
}
#[derive(Clone, Debug, PartialEq)]
pub struct SparklinePoint<'a> {
    pub x: f64,
    pub y: f64,
    pub entry: &'a RubricHistoryEntry,
}
pub fn sparkline_points<'a>(history: &[&'a RubricHistoryEntry]) -> Vec<SparklinePoint<'a>> {
    if history.len() < 2 {
        return Vec::new();
    }
    let min = history
        .iter()
        .map(|entry| entry.overall)
        .fold(f64::INFINITY, f64::min);
    let max = history
        .iter()
        .map(|entry| entry.overall)
        .fold(f64::NEG_INFINITY, f64::max);
    let span = if max == min { 1.0 } else { max - min };
    history
        .iter()
        .enumerate()
        .map(|(i, entry)| SparklinePoint {
            x: i as f64 / (history.len() - 1) as f64,
            y: (entry.overall - min) / span,
            entry,
        })
        .collect()
}
pub fn score_delta(history: &[&RubricHistoryEntry]) -> Option<f64> {
    (history.len() >= 2)
        .then(|| history[history.len() - 1].overall - history[history.len() - 2].overall)
}
/// This never grades a manuscript. The caller supplies an existing history
/// entry. Only an explicit append applies the source's last-50 retention cap.
pub fn append_history(
    history: &[RubricHistoryEntry],
    entry: &RubricHistoryEntry,
    scope: &str,
) -> Result<Vec<RubricHistoryEntry>> {
    ensure!(
        !scope.is_empty(),
        "Rubric history needs an explicit folio scope."
    );
    let mut entry = entry.clone();
    entry.folio_id = OptionalField::Value(scope.into());
    vec![entry.clone()].validate_display()?;
    let mut next = history
        .iter()
        .skip(history.len().saturating_sub(MAX_HISTORY - 1))
        .cloned()
        .collect::<Vec<_>>();
    next.push(entry);
    Ok(next)
}
pub fn score_word(score: f64, max: f64) -> &'static str {
    let ratio = if max > 0.0 { score / max } else { 0.0 };
    if ratio >= 0.8 {
        "strong"
    } else if ratio >= 0.6 {
        "solid"
    } else if ratio >= 0.4 {
        "uneven"
    } else {
        "weak"
    }
}
pub fn grade_verdict(score: f64) -> &'static str {
    if score >= 80.0 {
        "A strong draft."
    } else if score >= 65.0 {
        "Getting there."
    } else if score >= 50.0 {
        "A working draft with clear gaps."
    } else {
        "Early days — the next pass matters most."
    }
}
pub fn next_move_for(id: &str) -> &'static str {
    match id {
        "targetFit" => {
            "Reread who the brief is for and what it should do. Find the section that serves neither, then cut it or point it back."
        }
        "thesis" => {
            "Say your main point in one sentence near the top. Then check that each section supports it."
        }
        "evidence" => {
            "Pick your two shakiest claims and back each one with a source, an example or a number."
        }
        "sufficiency" => {
            "Find the point you move past fastest and give it one more paragraph: an example, a consequence, or an objection answered."
        }
        "integrity" => {
            "Swap claims about “always” and “everyone” for ones you can show. Cut the filler words."
        }
        "structure" => {
            "Where the argument changes direction, add a break or a linking sentence. Cut a paragraph that repeats one before it."
        }
        "pacing" => "Break one long sentence into two or three, and join two short ones.",
        "voice" => {
            "Rewrite your first line in the tone you want, and let it set the pitch for the rest."
        }
        "vocabulary" => {
            "Swap three abstract words for concrete ones, and cut one piece of jargon per paragraph."
        }
        "paragraph" => {
            "Split any paragraph longer than about six sentences, so each one does a single job."
        }
        "engagement" => {
            "Give the reader a reason to keep going in the first 100 words: a stake, or a question."
        }
        _ => "Make the one change that would lift this score most, then reread.",
    }
}
pub fn weakest_criterion(criteria: &[RubricCriterion]) -> Option<&RubricCriterion> {
    criteria.iter().reduce(|lowest, criterion| {
        if criterion.score / criterion.max_score < lowest.score / lowest.max_score {
            criterion
        } else {
            lowest
        }
    })
}
/// Display-only UTF-16 clipping follows the existing 120-unit panel preview.
/// A JS slice can cut a surrogate pair; native display renders that lone unit
/// as the same replacement glyph, while retained summary text is untouched.
pub fn summary_preview(summary: &str) -> String {
    const LIMIT: usize = 120;
    let units = summary.encode_utf16().collect::<Vec<_>>();
    if units.len() <= LIMIT {
        return summary.into();
    }
    format!(
        "{}…",
        String::from_utf16_lossy(&units[..LIMIT - 1]).trim_end_matches(is_js_whitespace)
    )
}

#[derive(Clone, Debug, PartialEq)]
pub enum RubricEdit {
    ToggleCriterion {
        folio_id: String,
        id: String,
    },
    SetWeight {
        folio_id: String,
        id: String,
        weight: f64,
    },
    /// Generate the custom ID once, before requesting a save, so retry uses
    /// precisely the same full candidate and does not add another criterion.
    AddCustom {
        folio_id: String,
        criterion: RubricCriterionSpec,
    },
    RemoveCustom {
        folio_id: String,
        id: String,
    },
    AppendHistory {
        folio_id: String,
        entry: RubricHistoryEntry,
    },
    /// Scope must come from an explicit original artifact key/path. No row
    /// folioId, catalog order or current-folio fallback is consulted.
    ImportScoped {
        folio_id: String,
        artifacts: Box<RubricArtifacts>,
    },
    RetainLegacy(OptionalField<Value>),
    Batch(Vec<RubricEdit>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RubricEffect {
    CriteriaChanged { folio_id: String },
    HistoryAppended { folio_id: String },
    ArtifactsImported { folio_id: String },
    LegacyRetained,
}
#[derive(Clone, Debug, PartialEq)]
pub struct RubricRequest {
    pub request_id: Uuid,
    pub expected_generation: u64,
    pub base: Arc<RubricRecord>,
    pub candidate: Arc<RubricRecord>,
    pub effects: Vec<RubricEffect>,
}
fn apply_edit(
    record: &mut RubricRecord,
    edit: &RubricEdit,
    effects: &mut Vec<RubricEffect>,
) -> Result<()> {
    match edit {
        RubricEdit::Batch(edits) => {
            for edit in edits {
                apply_edit(record, edit, effects)?;
            }
        }
        RubricEdit::RetainLegacy(legacy) => {
            record.legacy = legacy.clone();
            effects.push(RubricEffect::LegacyRetained);
        }
        RubricEdit::ImportScoped {
            folio_id,
            artifacts,
        } => {
            ensure!(
                !folio_id.is_empty(),
                "Rubric artifacts need an explicit folio scope."
            );
            record
                .folios
                .insert(folio_id.clone(), (**artifacts).clone());
            effects.push(RubricEffect::ArtifactsImported {
                folio_id: folio_id.clone(),
            });
        }
        RubricEdit::AppendHistory { folio_id, entry } => {
            ensure!(
                !folio_id.is_empty(),
                "Rubric history needs an explicit folio scope."
            );
            let artifacts = record.folios.entry(folio_id.clone()).or_default();
            let active =
                project::<Vec<RubricHistoryEntry>>(artifacts.effective_history(), "history");
            ensure!(
                active.state != ProjectionState::Malformed,
                "This retained Rubric history cannot be appended safely. Its raw data was kept."
            );
            let next =
                append_history(active.value.as_deref().unwrap_or_default(), entry, folio_id)?;
            artifacts.local_history = OptionalField::Value(serde_json::to_value(next)?);
            effects.push(RubricEffect::HistoryAppended {
                folio_id: folio_id.clone(),
            });
        }
        RubricEdit::ToggleCriterion { folio_id, .. }
        | RubricEdit::SetWeight { folio_id, .. }
        | RubricEdit::AddCustom { folio_id, .. }
        | RubricEdit::RemoveCustom { folio_id, .. } => {
            ensure!(
                !folio_id.is_empty(),
                "Rubric criteria need an explicit folio scope."
            );
            let empty = RubricArtifacts::default();
            let active = project::<Vec<RubricCriterionSpec>>(
                record
                    .folios
                    .get(folio_id)
                    .unwrap_or(&empty)
                    .effective_criteria(),
                "criteria",
            );
            ensure!(
                active.state != ProjectionState::Malformed,
                "These retained Rubric criteria cannot be edited safely. Their raw data was kept."
            );
            let mut specs = reconcile_specs(active.value.as_deref());
            match edit {
                RubricEdit::ToggleCriterion { id, .. } => {
                    ensure!(
                        specs.iter().any(|spec| &spec.id == id),
                        "That Rubric criterion is no longer present."
                    );
                    for spec in specs.iter_mut().filter(|spec| &spec.id == id) {
                        spec.enabled = !spec.enabled;
                    }
                }
                RubricEdit::SetWeight { id, weight, .. } => {
                    ensure!(
                        specs.iter().any(|spec| &spec.id == id),
                        "That Rubric criterion is no longer present."
                    );
                    for spec in specs.iter_mut().filter(|spec| &spec.id == id) {
                        spec.weight = clamp_weight(*weight);
                    }
                }
                RubricEdit::AddCustom { criterion, .. } => {
                    ensure!(
                        criterion.source == CriterionSource::Custom
                            && !criterion.label.trim_matches(is_js_whitespace).is_empty(),
                        "Only a named custom criterion can be added here."
                    );
                    ensure!(
                        !specs.iter().any(|spec| spec.id == criterion.id),
                        "That custom criterion ID is already present."
                    );
                    ensure!(!criterion.id.is_empty(), "A custom criterion needs an ID.");
                    let mut criterion = criterion.clone();
                    criterion.weight = clamp_weight(criterion.weight);
                    specs.push(criterion);
                }
                RubricEdit::RemoveCustom { id, .. } => {
                    if !specs
                        .iter()
                        .any(|spec| &spec.id == id && spec.source == CriterionSource::Custom)
                    {
                        return Ok(()); // Source spine rows are undeletable.
                    }
                    specs.retain(|spec| &spec.id != id || spec.source == CriterionSource::Spine);
                }
                _ => unreachable!(),
            }
            record
                .folios
                .entry(folio_id.clone())
                .or_default()
                .local_criteria = OptionalField::Value(serde_json::to_value(specs)?);
            effects.push(RubricEffect::CriteriaChanged {
                folio_id: folio_id.clone(),
            });
        }
    }
    Ok(())
}

pub struct RubricSession {
    saved: Arc<RubricRecord>,
    pending: Option<RubricRequest>,
    error: Option<String>,
}
impl RubricSession {
    pub fn new(record: Arc<RubricRecord>) -> Self {
        Self {
            saved: record,
            pending: None,
            error: None,
        }
    }
    pub fn saved(&self) -> &Arc<RubricRecord> {
        &self.saved
    }
    pub fn pending(&self) -> Option<&RubricRequest> {
        self.pending.as_ref()
    }
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }
    pub fn request(&mut self, edit: RubricEdit) -> Result<Option<RubricRequest>> {
        ensure!(
            self.pending.is_none(),
            "Finish the previous Rubric save before filing another change."
        );
        let mut candidate = (*self.saved).clone();
        let mut effects = Vec::new();
        apply_edit(&mut candidate, &edit, &mut effects)?;
        if candidate == *self.saved {
            return Ok(None);
        }
        candidate.generation = candidate
            .generation
            .checked_add(1)
            .context("Rubric has exhausted its save generation.")?;
        candidate.validate()?;
        ensure!(
            serde_json::to_vec(&candidate)?.len() <= MAX_RUBRIC_BYTES,
            "Rubric exceeds its 16 MiB metadata limit. Its previous save was kept."
        );
        let request = RubricRequest {
            request_id: Uuid::new_v4(),
            expected_generation: self.saved.generation,
            base: self.saved.clone(),
            candidate: Arc::new(candidate),
            effects,
        };
        self.pending = Some(request.clone());
        self.error = None;
        Ok(Some(request))
    }
    pub fn acknowledge_saved(&mut self, request_id: Uuid, record: Arc<RubricRecord>) -> bool {
        if !self.pending.as_ref().is_some_and(|request| {
            request.request_id == request_id
                && request.base == self.saved
                && request.candidate == record
        }) {
            return false;
        }
        self.saved = record;
        self.pending = None;
        self.error = None;
        true
    }
    pub fn report_error(&mut self, request_id: Uuid, message: impl Into<String>) -> bool {
        if self.pending.as_ref().map(|request| request.request_id) != Some(request_id) {
            return false;
        }
        self.error = Some(message.into());
        true
    }
    pub fn retry(&mut self) -> Option<RubricRequest> {
        self.error.take()?;
        self.pending.clone()
    }
    pub fn replace_record(&mut self, record: Arc<RubricRecord>) -> bool {
        if self.pending.is_some()
            || record.generation < self.saved.generation
            || (record.generation == self.saved.generation && record != self.saved)
        {
            return false;
        }
        self.saved = record;
        self.error = None;
        true
    }
}

#[derive(Clone, Debug)]
pub struct RubricLoad {
    pub record: Arc<RubricRecord>,
    pub warnings: Vec<String>,
}
#[derive(Clone)]
pub struct RubricStore {
    inner: Arc<StoreInner>,
}
struct StoreInner {
    path: PathBuf,
    writer: Mutex<()>,
}
impl RubricStore {
    /// The host holds its existing library OS lock while detached writers use
    /// cloned store handles. The per-store mutex serializes those clones.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        fs::create_dir_all(&root).context("Could not create the Rubric folder.")?;
        Ok(Self {
            inner: Arc::new(StoreInner {
                path: root.join("rubric.json"),
                writer: Mutex::new(()),
            }),
        })
    }
    pub fn path(&self) -> &Path {
        &self.inner.path
    }
    pub fn load(&self) -> Result<RubricLoad> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The Rubric writer stopped unexpectedly."))?;
        self.load_locked()
    }
    fn load_locked(&self) -> Result<RubricLoad> {
        let backup = self.path().with_extension("json.bak");
        if !self.path().exists() {
            return if backup.exists() {
                Ok(RubricLoad {
                    record: Arc::new(read_record(&backup)?),
                    warnings: vec![
                        "Recovered Rubric from its previous save. The recovery file is kept."
                            .into(),
                    ],
                })
            } else {
                Ok(RubricLoad {
                    record: Arc::new(RubricRecord::default()),
                    warnings: Vec::new(),
                })
            };
        }
        match read_record(self.path()) {
            Ok(record) => Ok(RubricLoad {
                record: Arc::new(record),
                warnings: Vec::new(),
            }),
            Err(error) => {
                let bytes = read_bounded(self.path())?;
                // Valid future/wrong-schema JSON is never replaced by an old
                // backup or reinterpreted as legacy web metadata.
                if serde_json::from_slice::<Value>(&bytes).is_ok() {
                    return Err(error);
                }
                if backup.exists() {
                    Ok(RubricLoad { record: Arc::new(read_record(&backup)
                        .with_context(|| format!("Could not recover Rubric: {error}"))?),
                        warnings: vec!["Recovered Rubric from its previous save. The damaged file is kept until another save.".into()] })
                } else {
                    Err(error.context("Could not open Rubric. Its damaged file has been kept."))
                }
            }
        }
    }
    pub fn save_request(&self, request: &RubricRequest) -> Result<Arc<RubricRecord>> {
        let _guard = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("The Rubric writer stopped unexpectedly."))?;
        request.base.validate()?;
        request.candidate.validate()?;
        ensure!(
            request.expected_generation == request.base.generation
                && Some(request.candidate.generation) == request.base.generation.checked_add(1),
            "The Rubric request has an invalid save generation."
        );
        let bytes = serde_json::to_vec_pretty(&*request.candidate)?;
        ensure!(
            bytes.len() <= MAX_RUBRIC_BYTES,
            "Rubric exceeds its 16 MiB metadata limit. Its previous save was kept."
        );
        let current = self.load_locked()?.record;
        if current == request.candidate
            && read_record(self.path()).ok().as_ref() == Some(&*request.candidate)
        {
            File::open(self.path())?.sync_all()?;
            sync_parent(self.path())?;
            return Ok(request.candidate.clone());
        }
        ensure!(
            current.generation == request.expected_generation && current == request.base,
            "Rubric changed before this edit could be filed. Reload it before saving."
        );
        if self.path().exists() {
            let previous = read_bounded(self.path())?;
            if read_record(self.path()).is_ok() {
                atomic_write(&self.path().with_extension("json.bak"), &previous)?;
            } else {
                atomic_write(
                    &self
                        .path()
                        .with_extension(format!("json.damaged-{}", Uuid::new_v4())),
                    &previous,
                )?;
            }
        }
        atomic_write(self.path(), &bytes).context("Rubric could not be saved on this device.")?;
        Ok(request.candidate.clone())
    }
}
fn read_record(path: &Path) -> Result<RubricRecord> {
    parse_rubric_json(&read_bounded(path)?)
}
fn read_bounded(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_RUBRIC_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= MAX_RUBRIC_BYTES,
        "Rubric is too large to open safely."
    );
    Ok(bytes)
}
fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path.parent().context("Rubric has no parent folder.")?)?.sync_all()?;
    Ok(())
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("Rubric has no parent folder.")?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    sync_parent(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SCOPE: &str = "original/path/folio:café";
    fn source() -> Value {
        serde_json::from_str(include_str!("../fixtures/rubric/source-reference.json")).unwrap()
    }
    fn retained() -> RubricRecord {
        parse_rubric_json(include_bytes!("../fixtures/rubric/retained-native.json")).unwrap()
    }
    fn accept(session: &mut RubricSession, edit: RubricEdit) -> RubricRequest {
        let request = session.request(edit).unwrap().unwrap();
        assert!(session.acknowledge_saved(request.request_id, request.candidate.clone()));
        request
    }

    #[test]
    fn source_reference_matches_reconciliation_weights_history_and_writer_copy() {
        let source = source();
        let defaults: Vec<RubricCriterionSpec> =
            serde_json::from_value(source["defaults"].clone()).unwrap();
        assert_eq!(default_criteria_specs(), defaults);
        let stored =
            serde_json::from_value::<Vec<RubricCriterionSpec>>(source["stored"].clone()).unwrap();
        let expected =
            serde_json::from_value::<Vec<RubricCriterionSpec>>(source["reconciled"].clone())
                .unwrap();
        assert_eq!(reconcile_specs(Some(&stored)), expected);
        assert_eq!(reconcile_specs(None), defaults);
        assert_eq!(reconcile_specs(Some(&[])), defaults);
        assert_eq!(expected[6].label, "Rhythm");
        assert_eq!(expected[6].weight, 0.5); // Last duplicate ID wins for the spine.
        assert!(
            expected
                .iter()
                .all(|entry| entry.id != "retired" && entry.id != "custom-blank")
        );
        assert_eq!(
            expected.last().unwrap().extra["future"],
            json!({"retained":null})
        );
        for case in source["weightedCases"].as_array().unwrap() {
            let specs =
                serde_json::from_value::<Vec<RubricCriterionSpec>>(case["specs"].clone()).unwrap();
            let scores = serde_json::from_value(case["scores"].clone()).unwrap();
            assert_eq!(
                weighted_criteria_score(&specs, &scores),
                case["expected"].as_f64(),
                "{}",
                case["name"]
            );
        }
        for case in source["weights"].as_array().unwrap() {
            let input = case["input"].as_f64().unwrap();
            assert_eq!(clamp_weight(input), case["clamped"].as_f64().unwrap());
            assert_eq!(step_weight(input, 1), case["up"].as_f64().unwrap());
            assert_eq!(step_weight(input, -1), case["down"].as_f64().unwrap());
        }
        for weight in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(clamp_weight(weight), 1.0);
        }
        let history =
            serde_json::from_value::<Vec<RubricHistoryEntry>>(source["history"].clone()).unwrap();
        let room = comparable_history(&history, None);
        assert_eq!(
            room.iter().map(|entry| entry.at).collect::<Vec<_>>(),
            vec![1.0, 3.0, 4.0]
        );
        let points = sparkline_points(&room);
        for (point, expected) in points.iter().zip(source["points"].as_array().unwrap()) {
            assert_eq!(point.x, expected["x"].as_f64().unwrap());
            assert_eq!(point.y, expected["y"].as_f64().unwrap());
        }
        assert_eq!(score_delta(&room), source["delta"].as_f64());
        assert_eq!(
            comparable_history(&history, Some(&ScoringMethod::Judgement)).len(),
            1
        );
        assert_eq!(
            comparable_history(
                &history,
                Some(&ScoringMethod::Other("future-method".into()))
            )
            .len(),
            1
        );
        assert!(sparkline_points(&room[..1]).is_empty());
        assert_eq!(score_delta(&room[..1]), None);
        for case in source["copy"].as_array().unwrap() {
            let score = case["score"].as_f64().unwrap();
            assert_eq!(score_word(score, 10.0), case["word"].as_str().unwrap());
            assert_eq!(
                grade_verdict(score * 10.0),
                case["verdict"].as_str().unwrap()
            );
        }
        for case in source["moves"].as_array().unwrap() {
            assert_eq!(
                next_move_for(case["id"].as_str().unwrap()),
                case["move"].as_str().unwrap()
            );
        }
        for case in source["summaries"].as_array().unwrap() {
            assert_eq!(
                summary_preview(case["input"].as_str().unwrap()),
                case["expected"].as_str().unwrap()
            );
        }
    }

    #[test]
    fn retained_nullable_unknown_provenance_roundtrips_without_scope_aliases() {
        let record = retained();
        let bytes = serde_json::to_vec(&record).unwrap();
        let parsed = parse_rubric_json(&bytes).unwrap();
        assert_eq!(parsed, record);
        assert_eq!(serde_json::to_vec(&parsed).unwrap(), bytes);
        let display = parsed.display(SCOPE).unwrap();
        assert_eq!(display.folio_id, SCOPE);
        assert!(display.issues.is_empty());
        let result = display.result.value.as_ref().unwrap();
        assert_eq!(result.folio_id.as_ref().unwrap(), "row-alias-is-not-scope");
        assert_eq!(result.review, OptionalField::Null);
        assert_eq!(result.target_fit, OptionalField::Null);
        assert_eq!(result.writer_score, OptionalField::Missing);
        assert_eq!(result.extra["futureResult"], json!({"untouched":true}));
        let grade = result.judgement_grade.as_ref().unwrap();
        assert_eq!(grade.criteria["voice"].score, 9.0);
        assert_eq!(grade.criteria["voice"].probabilities.len(), 4);
        assert_eq!(grade.criteria["voice"].legend["future"], "Future rating");
        assert_eq!(grade.extra["futureGrade"], json!({"untouched":true}));
        let live = display.live_review.value.as_ref().unwrap();
        assert_eq!(live.folio_id, "another-row-alias");
        assert_eq!(live.rubric, OptionalField::Null);
        assert_eq!(live.passages[0].confidence, OptionalField::Null);
        assert_eq!(live.notes.as_ref().unwrap()[0]["verdict"], Value::Null);
        assert_eq!(
            parsed.display("unimported").unwrap().result.state,
            ProjectionState::Missing
        );
        assert!(
            parsed
                .display("row-alias-is-not-scope")
                .unwrap()
                .result
                .value
                .is_none()
        );
        assert!(parsed.display("").is_err());
        assert!(parsed.legacy_artifacts().value.is_some());
    }

    #[test]
    fn raw_missing_null_and_malformed_fields_and_overlays_remain_distinct() {
        let raw = json!({"format":RUBRIC_FORMAT,"version":RUBRIC_VERSION,"generation":0,
            "folios":{
                "missing":{},
                "null":{"result":null,"criteria":null,"history":null,"liveReview":null,"future":null},
                "bad":{"result":["not a grade"],"criteria":{"not":"criteria"},"history":"not history","liveReview":{},
                    "localCriteria":[{"id":"bad"}],"localHistory":false}
            },"legacy":null,"liveReviewEnabled":null,"futureTop":{"keep":true}});
        let record = parse_rubric_json(&serde_json::to_vec(&raw).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(&record).unwrap(), raw);
        let missing = record.display("missing").unwrap();
        assert_eq!(missing.result.state, ProjectionState::Missing);
        let null = record.display("null").unwrap();
        assert_eq!(null.result.state, ProjectionState::Null);
        assert_eq!(null.live_review.state, ProjectionState::Null);
        assert_eq!(null.criteria, default_criteria_specs());
        assert!(null.issues.is_empty());
        assert!(null.criteria_editable && null.history_appendable);
        let bad = record.display("bad").unwrap();
        assert_eq!(bad.result.state, ProjectionState::Malformed);
        assert_eq!(bad.live_review.state, ProjectionState::Malformed);
        assert!(!bad.criteria_editable && !bad.history_appendable);
        assert!(bad.result.value.is_none() && bad.live_review.value.is_none());
        assert_eq!(bad.issues.len(), 6);
        assert!(
            bad.issues
                .iter()
                .all(|issue| issue.path.starts_with("folios[\"bad\"]."))
        );
        assert_eq!(record.legacy_artifacts().state, ProjectionState::Null);
        let mut session = RubricSession::new(Arc::new(record));
        assert!(
            session
                .request(RubricEdit::ToggleCriterion {
                    folio_id: "bad".into(),
                    id: "voice".into()
                })
                .is_err()
        );
        assert!(session.pending().is_none());
        assert_eq!(serde_json::to_value(session.saved()).unwrap(), raw);
        assert!(session.saved().automatic_review_enabled());
    }

    #[test]
    fn malformed_judgements_never_become_loaded_grades_or_weighted_scores() {
        let mut record = retained();
        let original = record.clone();
        let OptionalField::Value(result) = &mut record.folios.get_mut(SCOPE).unwrap().result else {
            unreachable!()
        };
        result["judgementGrade"]["criteria"]["thesis"]["confidence"] = json!("not calibrated");
        let display = record.display(SCOPE).unwrap();
        assert_eq!(display.result.state, ProjectionState::Malformed);
        assert!(display.result.value.is_none());
        assert_eq!(display.writer_score(CachedScoreSet::AllJudgement), None);
        assert_eq!(display.issues.len(), 1);
        assert_eq!(
            record.folios["unmounted/foreign"],
            original.folios["unmounted/foreign"]
        );
        let bad_bytes = serde_json::to_vec(&record).unwrap();
        assert_eq!(
            serde_json::to_vec(&parse_rubric_json(&bad_bytes).unwrap()).unwrap(),
            bad_bytes
        );
    }

    #[test]
    fn scoped_local_edits_reuse_saved_scores_without_rewriting_grades_or_history() {
        let original = retained();
        let mut session = RubricSession::new(Arc::new(original.clone()));
        let before = session.saved().display(SCOPE).unwrap();
        assert_eq!(
            before.writer_score(CachedScoreSet::VisibleCriteria),
            Some(58.0)
        );
        assert_eq!(
            before.writer_score(CachedScoreSet::AllJudgement),
            Some(64.0)
        );
        assert!(
            session
                .request(RubricEdit::RemoveCustom {
                    folio_id: SCOPE.into(),
                    id: "thesis".into()
                })
                .unwrap()
                .is_none()
        );
        accept(
            &mut session,
            RubricEdit::SetWeight {
                folio_id: SCOPE.into(),
                id: "thesis".into(),
                weight: 3.0,
            },
        );
        accept(
            &mut session,
            RubricEdit::ToggleCriterion {
                folio_id: SCOPE.into(),
                id: "voice".into(),
            },
        );
        let custom = RubricCriterionSpec::custom(
            "\u{feff} Ends on an image \u{00a0}",
            " \u{feff}A concrete closing image.\u{00a0}",
        )
        .unwrap();
        assert_eq!(custom.label, "Ends on an image");
        assert_eq!(custom.description, "A concrete closing image.");
        let id = custom.id.clone();
        accept(
            &mut session,
            RubricEdit::AddCustom {
                folio_id: SCOPE.into(),
                criterion: custom,
            },
        );
        assert!(
            session
                .request(RubricEdit::SetWeight {
                    folio_id: SCOPE.into(),
                    id: id.clone(),
                    weight: f64::NAN,
                })
                .unwrap()
                .is_none()
        ); // Non-finite input is the unchanged neutral 1x.
        let current = session.saved().display(SCOPE).unwrap();
        assert_eq!(
            current.writer_score(CachedScoreSet::AllJudgement),
            Some(65.0)
        ); // New unscored custom omitted.
        assert_eq!(
            current.writer_score(CachedScoreSet::VisibleCriteria),
            Some(65.0)
        );
        accept(
            &mut session,
            RubricEdit::RemoveCustom {
                folio_id: SCOPE.into(),
                id,
            },
        );
        let artifacts = &session.saved().folios[SCOPE];
        assert_eq!(artifacts.result, original.folios[SCOPE].result);
        assert_eq!(artifacts.criteria, original.folios[SCOPE].criteria);
        assert_eq!(artifacts.history, original.folios[SCOPE].history);
        assert_eq!(artifacts.live_review, original.folios[SCOPE].live_review);
        assert_eq!(artifacts.extra, original.folios[SCOPE].extra);
        assert_eq!(
            session.saved().folios["unmounted/foreign"],
            original.folios["unmounted/foreign"]
        );
        assert_eq!(session.saved().legacy, original.legacy);
        assert_eq!(session.saved().extra, original.extra);
        assert!(artifacts.local_history.is_missing());
        assert!(!artifacts.local_criteria.is_missing());
    }

    #[test]
    fn null_criteria_are_edited_explicitly_while_original_null_is_retained() {
        let original = RubricArtifacts {
            criteria: OptionalField::Null,
            ..RubricArtifacts::default()
        };
        let record = RubricRecord {
            folios: BTreeMap::from([(SCOPE.into(), original.clone())]),
            ..RubricRecord::default()
        };
        let mut session = RubricSession::new(Arc::new(record));
        accept(
            &mut session,
            RubricEdit::ToggleCriterion {
                folio_id: SCOPE.into(),
                id: "pacing".into(),
            },
        );
        assert_eq!(session.saved().folios[SCOPE].criteria, OptionalField::Null);
        assert_eq!(session.saved().folios[SCOPE].result, OptionalField::Missing);
        assert_eq!(
            session
                .saved()
                .display(SCOPE)
                .unwrap()
                .writer_score(CachedScoreSet::AllJudgement),
            None
        );
        assert!(
            !session
                .saved()
                .display(SCOPE)
                .unwrap()
                .criteria
                .iter()
                .find(|spec| spec.id == "pacing")
                .unwrap()
                .enabled
        );
        assert!(RubricCriterionSpec::custom("\u{feff}\u{00a0}", "").is_err());
        assert!(
            session
                .request(RubricEdit::ToggleCriterion {
                    folio_id: "".into(),
                    id: "pacing".into()
                })
                .is_err()
        );
    }

    #[test]
    fn undeletable_spine_and_unknown_custom_do_not_create_an_empty_artifact_scope() {
        let record = Arc::new(RubricRecord::default());
        let mut session = RubricSession::new(record.clone());
        for id in ["thesis", "missing-custom"] {
            assert!(
                session
                    .request(RubricEdit::RemoveCustom {
                        folio_id: SCOPE.into(),
                        id: id.into(),
                    })
                    .unwrap()
                    .is_none()
            );
        }
        assert_eq!(session.saved(), &record);
        assert!(session.saved().folios.is_empty());
        assert!(session.pending().is_none());
    }

    #[test]
    fn history_is_uncapped_on_read_and_caps_only_a_new_explicit_append() {
        let mut record = retained();
        let exemplar = record.display(SCOPE).unwrap().history[0].clone();
        let history = (0..60)
            .map(|index| RubricHistoryEntry {
                at: index as f64,
                extra: BTreeMap::from([("retained".into(), json!(index))]),
                ..exemplar.clone()
            })
            .collect::<Vec<_>>();
        record.folios.get_mut(SCOPE).unwrap().history =
            OptionalField::Value(serde_json::to_value(&history).unwrap());
        assert_eq!(record.display(SCOPE).unwrap().history.len(), 60);
        let before = record.clone();
        let entry = RubricHistoryEntry {
            at: 60.0,
            folio_id: OptionalField::Value("wrong-row-alias".into()),
            ..exemplar
        };
        let mut session = RubricSession::new(Arc::new(record));
        accept(
            &mut session,
            RubricEdit::AppendHistory {
                folio_id: SCOPE.into(),
                entry,
            },
        );
        assert_eq!(
            session.saved().folios[SCOPE].history,
            before.folios[SCOPE].history
        );
        let active = session.saved().display(SCOPE).unwrap();
        assert_eq!(active.history.len(), MAX_HISTORY);
        assert_eq!(active.history.first().unwrap().at, 11.0);
        assert_eq!(active.history.first().unwrap().extra["retained"], json!(11));
        assert_eq!(
            active.history.last().unwrap().folio_id.as_ref().unwrap(),
            SCOPE
        );
        assert_eq!(
            session.saved().folios[SCOPE].result,
            before.folios[SCOPE].result
        );
        assert_eq!(
            session.saved().folios["unmounted/foreign"],
            before.folios["unmounted/foreign"]
        );
    }

    #[test]
    fn failed_write_holds_candidate_retry_is_idempotent_and_ack_is_exact() {
        let folder = tempfile::tempdir().unwrap();
        let store = RubricStore::open(folder.path()).unwrap();
        let mut init = RubricSession::new(store.load().unwrap().record);
        let import = init
            .request(RubricEdit::ImportScoped {
                folio_id: SCOPE.into(),
                artifacts: Box::new(retained().folios[SCOPE].clone()),
            })
            .unwrap()
            .unwrap();
        let base = store.save_request(&import).unwrap();
        assert!(init.acknowledge_saved(import.request_id, base.clone()));
        let mut session = RubricSession::new(base.clone());
        let custom =
            RubricCriterionSpec::custom("Keep this criterion", "Retain this exact request.")
                .unwrap();
        let custom_id = custom.id.clone();
        let request = session
            .request(RubricEdit::AddCustom {
                folio_id: SCOPE.into(),
                criterion: custom,
            })
            .unwrap()
            .unwrap();
        assert_eq!(session.saved(), &base); // No optimistic accepted-state mutation.
        assert!(
            session
                .request(RubricEdit::ToggleCriterion {
                    folio_id: SCOPE.into(),
                    id: "voice".into()
                })
                .is_err()
        );
        assert!(!session.replace_record(Arc::new(RubricRecord::default())));
        fs::create_dir(store.path().with_extension("json.bak")).unwrap();
        assert!(store.save_request(&request).is_err());
        assert_eq!(store.load().unwrap().record, base);
        assert!(session.report_error(request.request_id, "disk failure"));
        let retry = session.retry().unwrap();
        assert_eq!(retry, request);
        assert!(session.error().is_none());
        fs::remove_dir(store.path().with_extension("json.bak")).unwrap();
        let saved = store.clone().save_request(&retry).unwrap();
        assert_eq!(store.save_request(&retry).unwrap(), saved); // Durable but lost ACK.
        assert!(!session.acknowledge_saved(Uuid::new_v4(), saved.clone()));
        assert!(!session.acknowledge_saved(retry.request_id, base.clone()));
        assert!(session.acknowledge_saved(retry.request_id, saved.clone()));
        assert!(!session.report_error(retry.request_id, "late error"));
        assert_eq!(
            session
                .saved()
                .display(SCOPE)
                .unwrap()
                .criteria
                .iter()
                .filter(|spec| spec.id == custom_id)
                .count(),
            1
        );
        let next = session
            .request(RubricEdit::ToggleCriterion {
                folio_id: SCOPE.into(),
                id: "voice".into(),
            })
            .unwrap()
            .unwrap();
        assert!(!session.acknowledge_saved(retry.request_id, saved));
        assert_eq!(session.pending().unwrap().request_id, next.request_id);
        let reopened = RubricStore::open(folder.path())
            .unwrap()
            .load()
            .unwrap()
            .record;
        assert_eq!(reopened, retry.candidate);
    }

    #[test]
    fn full_candidate_cas_rejects_other_sessions_and_same_generation_unknown_changes() {
        let folder = tempfile::tempdir().unwrap();
        let store = RubricStore::open(folder.path()).unwrap();
        let base = store.load().unwrap().record;
        let mut a = RubricSession::new(base.clone());
        let mut b = RubricSession::new(base.clone());
        let first = a
            .request(RubricEdit::ToggleCriterion {
                folio_id: SCOPE.into(),
                id: "voice".into(),
            })
            .unwrap()
            .unwrap();
        let stale = b
            .request(RubricEdit::ToggleCriterion {
                folio_id: SCOPE.into(),
                id: "pacing".into(),
            })
            .unwrap()
            .unwrap();
        let saved = store.save_request(&first).unwrap();
        assert!(store.save_request(&stale).is_err());
        let mut altered = (*saved).clone();
        altered
            .extra
            .insert("other-same-generation".into(), json!(true));
        let mut incompatible = RubricSession::new(Arc::new(altered));
        let request = incompatible
            .request(RubricEdit::ToggleCriterion {
                folio_id: SCOPE.into(),
                id: "pacing".into(),
            })
            .unwrap()
            .unwrap();
        assert!(store.save_request(&request).is_err());
        assert_eq!(store.load().unwrap().record, saved);
        assert!(!a.acknowledge_saved(first.request_id, request.candidate));
        assert!(a.acknowledge_saved(first.request_id, saved));
    }

    #[test]
    fn damaged_recovery_preserves_primary_and_future_or_web_json_is_never_reinterpreted() {
        let folder = tempfile::tempdir().unwrap();
        let store = RubricStore::open(folder.path()).unwrap();
        let base = retained();
        fs::write(
            store.path().with_extension("json.bak"),
            serde_json::to_vec(&base).unwrap(),
        )
        .unwrap();
        let damaged = b"{ damaged rubric";
        fs::write(store.path(), damaged).unwrap();
        let recovered = store.load().unwrap();
        assert_eq!(*recovered.record, base);
        assert!(!recovered.warnings.is_empty());
        assert_eq!(fs::read(store.path()).unwrap(), damaged);
        let mut session = RubricSession::new(recovered.record);
        let request = session
            .request(RubricEdit::ToggleCriterion {
                folio_id: SCOPE.into(),
                id: "voice".into(),
            })
            .unwrap()
            .unwrap();
        store.save_request(&request).unwrap();
        let preserved = fs::read_dir(folder.path())
            .unwrap()
            .find_map(|entry| {
                let entry = entry.unwrap();
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains("json.damaged-")
                    .then(|| fs::read(entry.path()).unwrap())
            })
            .unwrap();
        assert_eq!(preserved, damaged);
        let mut future = base;
        future.version += 1;
        for bytes in [
            serde_json::to_vec(&future).unwrap(),
            b"[]".to_vec(),
            b"{\"criteria\":null}".to_vec(),
        ] {
            fs::write(store.path(), &bytes).unwrap();
            assert!(store.load().is_err());
            assert_eq!(fs::read(store.path()).unwrap(), bytes);
        }
        assert!(parse_rubric_json(&vec![b' '; MAX_RUBRIC_BYTES + 1]).is_err());
    }
}
