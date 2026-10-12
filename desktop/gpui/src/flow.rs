//! Offline rhythm functions ported from the original flow-state/profile/session.
//!
//! These functions never receive words. Times are explicit epoch milliseconds;
//! local hours and edit deltas come from the application. Sampling is bounded,
//! and classification belongs on the one-second tick, not the input path.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeSet, VecDeque};

pub const FLOW_TICK_MS: u64 = 1_000;
pub const REACH_DWELL_MS: u64 = 600;
pub const MANUAL_OVERRIDE_MS: u64 = 10 * 60_000;
pub const SAMPLE_RETENTION_MS: f64 = 10. * 60_000.;
pub const MAX_RHYTHM_SAMPLES: usize = 65_536;
pub const MAX_PROFILE_SAMPLES: usize = 240;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FlowMode {
    Away,
    #[default]
    Working,
    Settling,
    Flow,
    Stuck,
}
impl FlowMode {
    pub const fn id(self) -> &'static str {
        match self {
            Self::Away => "away",
            Self::Working => "working",
            Self::Settling => "settling",
            Self::Flow => "flow",
            Self::Stuck => "stuck",
        }
    }
    pub const fn label(self) -> &'static str {
        match self {
            Self::Away => "away",
            Self::Working => "writing",
            Self::Settling => "settling in",
            Self::Flow => "in flow",
            Self::Stuck => "paused",
        }
    }
    pub const fn title(self) -> &'static str {
        match self {
            Self::Away => "No keys for a while.",
            Self::Working => "Twyne is reading your pace. The margin brings things in freely.",
            Self::Settling => "A steady run is building. New margin notes wait until you pause.",
            Self::Flow => {
                "You're in flow. The margin holds everything until you pause; Escape brings it back."
            }
            Self::Stuck => "A long pause. The margin offers one way back in.",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct KeySample {
    pub at: f64,
    pub inserted: f64,
    pub deleted: f64,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowThresholds {
    pub gap_ms: f64,
    pub settle_ms: f64,
    pub flow_ms: f64,
    pub stuck_pause_ms: f64,
    pub exit_pause_ms: f64,
    pub away_ms: f64,
    pub max_delete_ratio: f64,
    pub min_active_ratio: f64,
}
pub const DEFAULT_THRESHOLDS: FlowThresholds = FlowThresholds {
    gap_ms: 4_000.,
    settle_ms: 30_000.,
    flow_ms: 90_000.,
    stuck_pause_ms: 18_000.,
    exit_pause_ms: 25_000.,
    away_ms: 180_000.,
    max_delete_ratio: 0.3,
    min_active_ratio: 0.45,
};
impl Default for FlowThresholds {
    fn default() -> Self {
        DEFAULT_THRESHOLDS
    }
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct FlowContext {
    pub struggle: Option<f64>,
    #[serde(default)]
    pub reaching: bool,
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowReading {
    pub mode: FlowMode,
    pub run_ms: f64,
    /// Infinity before the first key, exactly as in the original pure function.
    pub pause_ms: f64,
    pub active_ratio: f64,
    pub delete_ratio: f64,
    pub wpm: f64,
    pub recent_churn: f64,
    pub reason: String,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FlowSnapshot {
    pub enabled: bool,
    pub mode: FlowMode,
    pub reading: Option<FlowReading>,
}
impl FlowSnapshot {
    pub fn label(&self) -> String {
        let minutes = if self.mode == FlowMode::Flow {
            self.reading
                .as_ref()
                .map_or(0., |reading| (reading.run_ms / 60_000.).floor())
        } else {
            0.
        };
        if minutes > 0. {
            format!("in flow · {minutes} min")
        } else {
            self.mode.label().into()
        }
    }
    pub fn accessibility_label(&self) -> String {
        format!("{}. {}", self.label(), self.mode.title())
    }
}

pub fn is_quiet(mode: FlowMode) -> bool {
    matches!(mode, FlowMode::Flow | FlowMode::Settling)
}
/// Like the original function, removes only the old prefix of ordered samples.
pub fn trim_samples(samples: &[KeySample], now: f64, keep_ms: f64) -> &[KeySample] {
    let cutoff = now - keep_ms;
    let first = samples
        .iter()
        .position(|sample| sample.at >= cutoff)
        .unwrap_or(samples.len());
    &samples[first..]
}

pub fn read_flow(
    samples: &[KeySample],
    now: f64,
    previous: FlowMode,
    thresholds: &FlowThresholds,
    context: FlowContext,
) -> FlowReading {
    let Some(last) = samples.last() else {
        return FlowReading {
            mode: FlowMode::Working,
            run_ms: 0.,
            pause_ms: f64::INFINITY,
            active_ratio: 0.,
            delete_ratio: 0.,
            wpm: 0.,
            recent_churn: 0.,
            reason: "No writing yet.".into(),
        };
    };
    let pause_ms = (now - last.at).max(0.);
    let mut first = samples.len() - 1;
    while first > 0 && samples[first].at - samples[first - 1].at <= thresholds.gap_ms {
        first -= 1;
    }
    let run = &samples[first..];
    let run_ms = last.at - run[0].at;
    let (mut inserted, mut deleted) = (0., 0.);
    let mut seconds = BTreeSet::new();
    for sample in run {
        inserted += sample.inserted;
        deleted += sample.deleted;
        seconds.insert((sample.at / 1_000.).floor() as i64);
    }
    let delete_ratio = deleted / (inserted + deleted).max(1.);
    let active_ratio = if run_ms < 1_000. {
        1.
    } else {
        (seconds.len() as f64 / (run_ms / 1_000.).ceil()).min(1.)
    };
    let wpm = if run_ms > 0. {
        (inserted / 5.) * (60_000. / run_ms)
    } else {
        0.
    };
    let (mut recent_in, mut recent_out) = (0., 0.);
    for sample in samples
        .iter()
        .rev()
        .take_while(|sample| last.at - sample.at <= 60_000.)
    {
        recent_in += sample.inserted;
        recent_out += sample.deleted;
    }
    let recent_churn = recent_out / (recent_in + recent_out).max(1.);
    let steady =
        delete_ratio <= thresholds.max_delete_ratio && active_ratio >= thresholds.min_active_ratio;
    let at = |mode, reason: &str| FlowReading {
        mode,
        run_ms,
        pause_ms,
        active_ratio,
        delete_ratio,
        wpm,
        recent_churn,
        reason: reason.into(),
    };
    if pause_ms >= thresholds.away_ms {
        return at(FlowMode::Away, "No keys for a while.");
    }
    if context.reaching {
        return at(FlowMode::Working, "Reached for the room.");
    }
    if previous == FlowMode::Flow {
        return if pause_ms >= thresholds.exit_pause_ms {
            at(FlowMode::Working, "A long pause ended the run.")
        } else {
            at(FlowMode::Flow, "Still in the run.")
        };
    }
    let circling = recent_churn >= 0.4 || context.struggle.unwrap_or(0.) >= 0.5;
    if pause_ms >= thresholds.stuck_pause_ms && circling {
        return at(FlowMode::Stuck, "A long pause after cutting and circling.");
    }
    if previous == FlowMode::Stuck && pause_ms >= thresholds.gap_ms {
        return at(FlowMode::Stuck, "Still paused.");
    }
    if pause_ms <= thresholds.gap_ms && steady {
        if run_ms >= thresholds.flow_ms {
            return at(FlowMode::Flow, "A steady run held.");
        }
        if run_ms >= thresholds.settle_ms {
            return at(FlowMode::Settling, "A steady run is building.");
        }
    }
    if previous == FlowMode::Settling
        && pause_ms <= thresholds.gap_ms
        && run_ms >= thresholds.settle_ms
    {
        return at(FlowMode::Settling, "The run continues.");
    }
    at(
        FlowMode::Working,
        if steady { "Writing." } else { "Revising." },
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SampleError {
    Invalid,
    OutOfOrder,
    Capacity,
}
impl std::fmt::Display for SampleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Invalid => "Flow needs finite timestamps and non-negative edit counts.",
            Self::OutOfOrder => "The flow clock moved before the previous edit.",
            Self::Capacity => "The flow rhythm history reached its native sample limit.",
        })
    }
}
impl std::error::Error for SampleError {}
/// Additional native bound: saturation is explicit; samples are never silently
/// dropped from the current run. Caller may disable/reset the reading on error.
#[derive(Clone, Debug, Default)]
pub struct FlowSampler {
    samples: VecDeque<KeySample>,
}
impl FlowSampler {
    pub fn push(&mut self, sample: KeySample) -> Result<bool, SampleError> {
        if !sample.at.is_finite()
            || !sample.inserted.is_finite()
            || !sample.deleted.is_finite()
            || sample.inserted < 0.
            || sample.deleted < 0.
        {
            return Err(SampleError::Invalid);
        }
        if sample.inserted == 0. && sample.deleted == 0. {
            return Ok(false);
        }
        if self.samples.back().is_some_and(|last| sample.at < last.at) {
            return Err(SampleError::OutOfOrder);
        }
        let cutoff = sample.at - SAMPLE_RETENTION_MS;
        while self.samples.front().is_some_and(|first| first.at < cutoff) {
            self.samples.pop_front();
        }
        if self.samples.len() >= MAX_RHYTHM_SAMPLES {
            return Err(SampleError::Capacity);
        }
        self.samples.push_back(sample);
        Ok(true)
    }
    pub fn read(
        &mut self,
        now: f64,
        previous: FlowMode,
        thresholds: &FlowThresholds,
        context: FlowContext,
    ) -> FlowReading {
        // Original trim happens on a key, not on ticks: a silent folio still
        // retains its last sample and reads away, rather than no writing yet.
        read_flow(
            self.samples.make_contiguous(),
            now,
            previous,
            thresholds,
            context,
        )
    }
    pub fn len(&self) -> usize {
        self.samples.len()
    }
    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }
    pub fn last(&self) -> Option<KeySample> {
        self.samples.back().copied()
    }
    pub fn clear(&mut self) {
        self.samples.clear();
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowProfile {
    pub version: u8,
    pub pauses: Vec<f64>,
    pub runs: Vec<f64>,
    pub flow_entries: Vec<f64>,
    pub hours: Vec<f64>,
    /// Kept as compatible JSON because the original normalizer retains unknown
    /// kind entries and fields without destructively validating them.
    pub kinds: Value,
    pub overrides: f64,
    pub updated_at: f64,
}
impl Default for FlowProfile {
    fn default() -> Self {
        Self {
            version: 1,
            pauses: Vec::new(),
            runs: Vec::new(),
            flow_entries: Vec::new(),
            hours: vec![0.; 24],
            kinds: json!({}),
            overrides: 0.,
            updated_at: 0.,
        }
    }
}
fn numbers(value: Option<&Value>) -> Vec<f64> {
    value
        .and_then(Value::as_array)
        .map_or_else(Vec::new, |array| {
            array
                .iter()
                .filter_map(Value::as_f64)
                .filter(|number| number.is_finite())
                .collect()
        })
}
fn recent(mut values: Vec<f64>) -> Vec<f64> {
    if values.len() > MAX_PROFILE_SAMPLES {
        values.drain(..values.len() - MAX_PROFILE_SAMPLES);
    }
    values
}
pub fn normalize_profile(value: &Value) -> FlowProfile {
    if !value.is_object() && !value.is_array() {
        return FlowProfile::default();
    }
    let hours = numbers(value.get("hours"));
    FlowProfile {
        version: 1,
        pauses: recent(numbers(value.get("pauses"))),
        runs: recent(numbers(value.get("runs"))),
        flow_entries: recent(numbers(value.get("flowEntries"))),
        hours: if hours.len() == 24 {
            hours
        } else {
            vec![0.; 24]
        },
        kinds: value
            .get("kinds")
            .filter(|kinds| kinds.is_object() || kinds.is_array())
            .cloned()
            .unwrap_or_else(|| json!({})),
        overrides: value.get("overrides").and_then(Value::as_f64).unwrap_or(0.),
        updated_at: value.get("updatedAt").and_then(Value::as_f64).unwrap_or(0.),
    }
}
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}
fn push_profile(list: &mut Vec<f64>, value: f64) {
    list.push(js_round(value));
    if list.len() > MAX_PROFILE_SAMPLES {
        list.drain(..list.len() - MAX_PROFILE_SAMPLES);
    }
}
pub fn record_pause(profile: &FlowProfile, ms: f64, now: f64) -> FlowProfile {
    if !(1_500. ..=600_000.).contains(&ms) {
        return profile.clone();
    }
    let mut next = profile.clone();
    push_profile(&mut next.pauses, ms);
    next.updated_at = now;
    next
}
/// The application supplies its current local hour, 0 through 23. Invalid hours
/// are rejected before profile mutation, rather than inferred from UTC.
pub fn record_run(
    profile: &FlowProfile,
    ms: f64,
    now: f64,
    local_hour: u8,
) -> Result<FlowProfile, &'static str> {
    if local_hour >= 24 {
        return Err("The local writing hour must be between 0 and 23.");
    }
    if ms < 5_000. {
        return Ok(profile.clone());
    }
    let mut next = profile.clone();
    push_profile(&mut next.runs, ms);
    next.hours[usize::from(local_hour)] += ms / 60_000.;
    next.updated_at = now;
    Ok(next)
}
pub fn record_flow_entry(profile: &FlowProfile, run_ms: f64, now: f64) -> FlowProfile {
    let mut next = profile.clone();
    push_profile(&mut next.flow_entries, run_ms);
    next.updated_at = now;
    next
}
pub fn record_override(profile: &FlowProfile, now: f64) -> FlowProfile {
    let mut next = profile.clone();
    next.overrides += 1.;
    next.updated_at = now;
    next
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemOutcome {
    Shown,
    Engaged,
    Dismissed,
}
impl ItemOutcome {
    fn key(self) -> &'static str {
        match self {
            Self::Shown => "shown",
            Self::Engaged => "engaged",
            Self::Dismissed => "dismissed",
        }
    }
}
pub fn record_item(
    profile: &FlowProfile,
    kind: &str,
    outcome: ItemOutcome,
    now: f64,
) -> FlowProfile {
    let mut next = profile.clone();
    let mut kinds = match &profile.kinds {
        Value::Object(object) => object.clone(),
        Value::Array(array) => array
            .iter()
            .enumerate()
            .map(|(index, value)| (index.to_string(), value.clone()))
            .collect(),
        _ => Map::new(),
    };
    let original = kinds
        .get(kind)
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or_else(|| json!({"shown":0,"engaged":0,"dismissed":0}));
    let mut stats = original.as_object().cloned().unwrap_or_default();
    let count = stats
        .get(outcome.key())
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN);
    stats.insert(outcome.key().into(), Value::from(count + 1.));
    kinds.insert(kind.into(), Value::Object(stats));
    next.kinds = Value::Object(kinds);
    next.updated_at = now;
    next
}
pub fn quantile(values: &[f64], q: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let index = ((sorted.len() - 1) as f64 * q).clamp(0., (sorted.len() - 1) as f64);
    let (lo, hi) = (index.floor() as usize, index.ceil() as usize);
    Some(sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo as f64))
}
pub fn thresholds_for(profile: &FlowProfile) -> FlowThresholds {
    let mut thresholds = DEFAULT_THRESHOLDS;
    if profile.pauses.len() >= 12 {
        thresholds.stuck_pause_ms =
            (quantile(&profile.pauses, 0.75).unwrap() * 2.).clamp(12_000., 60_000.);
        thresholds.exit_pause_ms =
            (quantile(&profile.pauses, 0.9).unwrap() * 1.5).clamp(15_000., 45_000.);
    }
    if profile.flow_entries.len() >= 5 {
        thresholds.flow_ms = quantile(&profile.flow_entries, 0.5)
            .unwrap()
            .clamp(60_000., 240_000.);
        thresholds.settle_ms = js_round(thresholds.flow_ms / 3.);
    }
    thresholds
}
pub fn kind_weight(profile: &FlowProfile, kind: &str) -> f64 {
    let Some(stats) = profile.kinds.get(kind).filter(|value| !value.is_null()) else {
        return 1.;
    };
    let engaged = stats
        .get("engaged")
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN);
    let dismissed = stats
        .get("dismissed")
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN);
    ((engaged + 1.) / (engaged + dismissed + 2.) * 2.).clamp(0.2, 1.8)
}
pub fn writing_hours(profile: &FlowProfile, top: usize) -> Vec<usize> {
    let mut hours: Vec<_> = profile
        .hours
        .iter()
        .copied()
        .enumerate()
        .filter(|(_, minutes)| *minutes > 0.)
        .collect();
    hours.sort_by(|left, right| right.1.total_cmp(&left.1));
    hours.into_iter().take(top).map(|(hour, _)| hour).collect()
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FlowSessionEnd {
    Pause,
    Reached,
    Manual,
    Away,
    Closed,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowSession {
    pub id: String,
    pub folio_id: String,
    pub started_at: f64,
    pub ended_at: f64,
    pub flow_ms: f64,
    pub words: f64,
    pub wpm: f64,
    pub waited: usize,
    pub amendments: usize,
    pub ended: FlowSessionEnd,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryInput {
    pub folio_id: String,
    pub started_at: f64,
    pub ended_at: f64,
    /// Computed at explicit session boundaries, never by this detector.
    pub start_words: f64,
    pub end_words: f64,
    pub waited: BTreeSet<String>,
    pub amendments: BTreeSet<String>,
    pub ended: FlowSessionEnd,
}
pub fn summarize_session(input: &SessionSummaryInput) -> Option<FlowSession> {
    let flow_ms = (input.ended_at - input.started_at).max(0.);
    let words = js_round(input.end_words - input.start_words).max(0.);
    if flow_ms < 60_000. && words < 40. {
        return None;
    }
    Some(FlowSession {
        id: format!("{}:{}", input.folio_id, input.started_at),
        folio_id: input.folio_id.clone(),
        started_at: input.started_at,
        ended_at: input.ended_at,
        flow_ms,
        words,
        wpm: if flow_ms > 0. {
            js_round(words * 60_000. / flow_ms)
        } else {
            0.
        },
        waited: input.waited.len(),
        amendments: input.amendments.len(),
        ended: input.ended,
    })
}
pub fn append_session(list: &[FlowSession], session: FlowSession, max: usize) -> Vec<FlowSession> {
    if max == 0 {
        return Vec::new();
    }
    // Map replacement retains the original position, so stable sort ties match
    // JavaScript insertion order instead of sorting IDs lexicographically.
    let mut distinct: Vec<FlowSession> = Vec::new();
    for entry in list.iter().cloned().chain(std::iter::once(session)) {
        if let Some(existing) = distinct.iter_mut().find(|item| item.id == entry.id) {
            *existing = entry;
        } else {
            distinct.push(entry);
        }
    }
    distinct.sort_by(|left, right| {
        left.ended_at
            .total_cmp(&right.ended_at)
            .then_with(|| left.started_at.total_cmp(&right.started_at))
    });
    if distinct.len() > max {
        distinct.drain(..distinct.len() - max);
    }
    distinct
}

pub use local_store::{
    FlowLoad, FlowPreferences, FlowRecord, FlowSaveRequest, FlowStore, MAX_FLOW_STORE_BYTES,
};

mod local_store {
    use super::{FlowProfile, FlowSession, normalize_profile};
    use crate::workspace::ExtraFields;
    use anyhow::{Context, Result, ensure};
    use fs2::FileExt;
    use serde::{Deserialize, Serialize};
    use serde_json::{Map, Value, json};
    use std::{
        fs::{self, File},
        io::{ErrorKind, Read, Write},
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
    };
    use tempfile::NamedTempFile;
    use uuid::Uuid;

    const FORMAT: &str = "twyne-gpui-flow";
    const VERSION: u64 = 1;
    pub const MAX_FLOW_STORE_BYTES: usize = 1024 * 1024;

    #[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
    pub struct FlowPreferences {
        #[serde(
            rename = "flow-reading-enabled",
            skip_serializing_if = "Option::is_none"
        )]
        pub flow_reading_enabled: Option<bool>,
        #[serde(
            rename = "live-review-enabled",
            skip_serializing_if = "Option::is_none"
        )]
        pub live_review_enabled: Option<bool>,
        #[serde(
            rename = "in-flow-tools-enabled",
            skip_serializing_if = "Option::is_none"
        )]
        pub in_flow_tools_enabled: Option<bool>,
    }
    impl FlowPreferences {
        /// Missing values default on only after the caller's actual load succeeds.
        pub fn flow_enabled(self) -> bool {
            self.flow_reading_enabled != Some(false) && self.live_review_enabled != Some(false)
        }
        pub fn tools_enabled(self) -> bool {
            self.in_flow_tools_enabled != Some(false)
        }
    }
    #[derive(Clone, Debug, Default, PartialEq)]
    struct DiskBase {
        primary: Option<Arc<[u8]>>,
        /// Needed only when the acknowledged record came from recovery.
        recovery: Option<Arc<[u8]>>,
    }
    #[derive(Clone, Debug, Default, PartialEq)]
    pub struct FlowRecord {
        pub generation: u64,
        pub updated_at: u64,
        pub preferences: FlowPreferences,
        pub profile: FlowProfile,
        pub sessions: Vec<FlowSession>,
        pub extra: ExtraFields,
        settings_extra: Map<String, Value>,
        profile_extra: Map<String, Value>,
        session_extras: Vec<(FlowSession, Map<String, Value>)>,
        disk_base: DiskBase,
    }
    impl FlowRecord {
        pub fn request(&self, candidate: Self) -> FlowSaveRequest {
            FlowSaveRequest {
                request_id: Uuid::new_v4(),
                base: self.clone(),
                candidate,
            }
        }
        pub fn to_value(&self) -> Result<Value> {
            let mut settings = self.settings_extra.clone();
            settings.extend(
                serde_json::to_value(self.preferences)?
                    .as_object()
                    .context("Invalid flow settings")?
                    .clone(),
            );
            let mut profile = self.profile_extra.clone();
            profile.extend(
                serde_json::to_value(&self.profile)?
                    .as_object()
                    .context("Invalid flow profile")?
                    .clone(),
            );
            let sessions = self
                .sessions
                .iter()
                .map(|session| {
                    let extras = self
                        .session_extras
                        .iter()
                        .rev()
                        .find(|(original, _)| original == session)
                        .or_else(|| {
                            self.session_extras
                                .iter()
                                .rev()
                                .find(|(original, _)| original.id == session.id)
                        });
                    let mut raw = extras.map_or_else(Map::new, |(_, extra)| extra.clone());
                    raw.extend(
                        serde_json::to_value(session)?
                            .as_object()
                            .context("Invalid flow session")?
                            .clone(),
                    );
                    Ok(Value::Object(raw))
                })
                .collect::<Result<Vec<_>>>()?;
            let mut value: Map<String, Value> = self.extra.clone().into_iter().collect();
            value.extend([
                ("format".into(), json!(FORMAT)),
                ("version".into(), json!(VERSION)),
                ("generation".into(), json!(self.generation)),
                ("updatedAt".into(), json!(self.updated_at)),
                ("settings".into(), Value::Object(settings)),
                ("profile".into(), Value::Object(profile)),
                ("sessions".into(), Value::Array(sessions)),
            ]);
            Ok(Value::Object(value))
        }
        pub fn from_value(value: &Value) -> Result<Self> {
            let raw = value
                .as_object()
                .context("The local flow record is not an object.")?;
            ensure!(
                raw.get("format").and_then(Value::as_str) == Some(FORMAT),
                "This file is not a native Twyne flow record."
            );
            ensure!(
                raw.get("version").and_then(Value::as_u64) == Some(VERSION),
                "These flow preferences need another version of Twyne."
            );
            let generation = raw
                .get("generation")
                .and_then(Value::as_u64)
                .context("Flow preferences have no valid save generation.")?;
            let updated_at = raw.get("updatedAt").and_then(Value::as_u64).unwrap_or(0);
            let settings = raw
                .get("settings")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let preferences = FlowPreferences {
                flow_reading_enabled: settings
                    .get("flow-reading-enabled")
                    .and_then(Value::as_bool),
                live_review_enabled: settings.get("live-review-enabled").and_then(Value::as_bool),
                in_flow_tools_enabled: settings
                    .get("in-flow-tools-enabled")
                    .and_then(Value::as_bool),
            };
            let settings_extra = settings
                .into_iter()
                .filter(|(key, value)| {
                    !matches!(
                        key.as_str(),
                        "flow-reading-enabled" | "live-review-enabled" | "in-flow-tools-enabled"
                    ) || !value.is_boolean()
                })
                .collect();
            let profile_value = raw.get("profile").unwrap_or(&Value::Null);
            ensure!(
                profile_value
                    .get("version")
                    .and_then(Value::as_u64)
                    .is_none_or(|version| version <= 1),
                "This flow profile needs another version of Twyne."
            );
            let profile = normalize_profile(profile_value);
            let profile_extra = profile_value
                .as_object()
                .into_iter()
                .flat_map(|profile| profile.iter())
                .filter(|(key, _)| {
                    !matches!(
                        key.as_str(),
                        "version"
                            | "pauses"
                            | "runs"
                            | "flowEntries"
                            | "hours"
                            | "kinds"
                            | "overrides"
                            | "updatedAt"
                    )
                })
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            let mut sessions = Vec::new();
            let mut session_extras = Vec::new();
            if let Some(list) = raw.get("sessions") {
                let list = list
                    .as_array()
                    .context("The saved flow slips are not a list.")?;
                for entry in &list[list.len().saturating_sub(30)..] {
                    let session: FlowSession = serde_json::from_value(entry.clone())
                        .context("A saved flow slip could not be read.")?;
                    ensure!(
                        [
                            session.started_at,
                            session.ended_at,
                            session.flow_ms,
                            session.words,
                            session.wpm
                        ]
                        .iter()
                        .all(|number| number.is_finite()),
                        "A saved flow slip has invalid numbers."
                    );
                    let extras = entry
                        .as_object()
                        .context("A saved flow slip is not an object.")?
                        .iter()
                        .filter(|(key, _)| {
                            !matches!(
                                key.as_str(),
                                "id" | "folioId"
                                    | "startedAt"
                                    | "endedAt"
                                    | "flowMs"
                                    | "words"
                                    | "wpm"
                                    | "waited"
                                    | "amendments"
                                    | "ended"
                            )
                        })
                        .map(|(key, value)| (key.clone(), value.clone()))
                        .collect();
                    session_extras.push((session.clone(), extras));
                    sessions.push(session);
                }
            }
            let extra = raw
                .iter()
                .filter(|(key, _)| {
                    !matches!(
                        key.as_str(),
                        "format"
                            | "version"
                            | "generation"
                            | "updatedAt"
                            | "settings"
                            | "profile"
                            | "sessions"
                    )
                })
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            Ok(Self {
                generation,
                updated_at,
                preferences,
                profile,
                sessions,
                extra,
                settings_extra,
                profile_extra,
                session_extras,
                disk_base: DiskBase::default(),
            })
        }
    }
    #[derive(Clone, Debug)]
    pub struct FlowLoad {
        pub record: FlowRecord,
        pub warnings: Vec<String>,
    }
    #[derive(Clone, Debug, PartialEq)]
    pub struct FlowSaveRequest {
        pub request_id: Uuid,
        pub base: FlowRecord,
        pub candidate: FlowRecord,
    }
    impl FlowSaveRequest {
        fn normalized_candidate(&self, now: u64) -> Result<FlowRecord> {
            let mut candidate = self.candidate.clone();
            candidate.generation = self
                .base
                .generation
                .checked_add(1)
                .context("Flow preferences have exhausted their save generation.")?;
            candidate.updated_at = now;
            candidate.profile = normalize_profile(&serde_json::to_value(&candidate.profile)?);
            candidate.sessions =
                candidate.sessions[candidate.sessions.len().saturating_sub(30)..].to_vec();
            Ok(candidate)
        }
        /// Full intended persisted value, including normalization and unknown
        /// fields. Computing it does not constitute a persistence acknowledgement.
        pub fn expected_value(&self, now: u64) -> Result<Value> {
            let value = self.normalized_candidate(now)?.to_value()?;
            FlowRecord::from_value(&value)?;
            Ok(value)
        }
    }
    #[derive(Clone)]
    pub struct FlowStore {
        state: Arc<StoreState>,
    }
    struct StoreState {
        path: PathBuf,
        writer: Mutex<()>,
    }
    impl FlowStore {
        pub fn open(root: impl Into<PathBuf>) -> Result<Self> {
            let root = root.into();
            fs::create_dir_all(&root).context("Could not create the local flow folder.")?;
            Ok(Self {
                state: Arc::new(StoreState {
                    path: root.join("flow.json"),
                    writer: Mutex::new(()),
                }),
            })
        }
        pub fn path(&self) -> &Path {
            &self.state.path
        }
        fn file_lock(&self) -> Result<File> {
            let file = File::options()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(self.path().with_extension("lock"))
                .context("Could not open the local flow writer lock.")?;
            file.lock_exclusive()
                .context("Could not lock the local flow writer.")?;
            Ok(file)
        }
        pub fn load(&self) -> Result<FlowLoad> {
            let _writer = self
                .state
                .writer
                .lock()
                .map_err(|_| anyhow::anyhow!("The local flow writer stopped unexpectedly."))?;
            let _file_lock = self.file_lock()?;
            self.load_locked()
        }
        /// Join an earlier pending save only when an actual primary file now
        /// contains the complete intended record. A recovered backup is not
        /// an acknowledgement of that newer save; generation alone is insufficient.
        pub fn acknowledge_request(
            &self,
            request: &FlowSaveRequest,
            now: u64,
        ) -> Result<Option<FlowRecord>> {
            let _writer = self
                .state
                .writer
                .lock()
                .map_err(|_| anyhow::anyhow!("The local flow writer stopped unexpectedly."))?;
            let _file_lock = self.file_lock()?;
            let current = self.load_locked()?.record;
            if current.disk_base.primary.is_some()
                && current.disk_base.recovery.is_none()
                && current.to_value()? == request.expected_value(now)?
            {
                Ok(Some(current))
            } else {
                Ok(None)
            }
        }
        fn load_locked(&self) -> Result<FlowLoad> {
            let primary = read_optional(self.path())?;
            if let Some(bytes) = &primary {
                match serde_json::from_slice::<Value>(bytes) {
                    Ok(value) => {
                        // Valid JSON with another format/version is never
                        // treated as corruption or replaced with an old backup.
                        let mut record = FlowRecord::from_value(&value)?;
                        record.disk_base.primary = primary;
                        return Ok(FlowLoad {
                            record,
                            warnings: Vec::new(),
                        });
                    }
                    Err(error) => {
                        let recovery = read_optional(&self.path().with_extension("json.bak"))?
                            .with_context(|| format!("Could not read the local flow record: {error}. The damaged file is kept."))?;
                        let mut record = read_record(&recovery)
                            .context("Could not recover the previous flow save.")?;
                        record.disk_base = DiskBase {
                            primary,
                            recovery: Some(recovery),
                        };
                        return Ok(FlowLoad { record, warnings: vec!["Recovered flow preferences from their previous save. The damaged file is kept until another save.".into()] });
                    }
                }
            }
            if let Some(recovery) = read_optional(&self.path().with_extension("json.bak"))? {
                let mut record = read_record(&recovery)?;
                record.disk_base.recovery = Some(recovery);
                return Ok(FlowLoad { record, warnings: vec!["Recovered flow preferences from their previous save. The recovery file is kept.".into()] });
            }
            Ok(FlowLoad {
                record: FlowRecord::default(),
                warnings: Vec::new(),
            })
        }
        /// A request is an intent. Only this returned record acknowledges an
        /// actual synced save. Source text and manuscript files are never read.
        pub fn save_request(&self, request: &FlowSaveRequest, now: u64) -> Result<FlowRecord> {
            let _writer = self
                .state
                .writer
                .lock()
                .map_err(|_| anyhow::anyhow!("The local flow writer stopped unexpectedly."))?;
            let _file_lock = self.file_lock()?;
            let current = self.load_locked()?.record;
            ensure!(
                current == request.base && request.candidate.generation == request.base.generation,
                "Flow preferences changed before this save. Reload them before trying again."
            );
            let candidate = request.normalized_candidate(now)?;
            let bytes = serde_json::to_vec(&candidate.to_value()?)?;
            ensure!(
                bytes.len() <= MAX_FLOW_STORE_BYTES,
                "Flow preferences exceed the 1 MiB limit. The previous save was kept."
            );
            // Reparse before writing so even manually-constructed public data
            // cannot persist a record the application could not reopen.
            let mut saved = read_record(&bytes)?;
            if let Some(previous) = &current.disk_base.primary {
                if current.disk_base.recovery.is_some() {
                    atomic_write(
                        &self
                            .path()
                            .with_extension(format!("json.damaged-{}", Uuid::new_v4())),
                        previous,
                    )?;
                } else {
                    atomic_write(&self.path().with_extension("json.bak"), previous)?;
                }
            }
            atomic_write(self.path(), &bytes)
                .context("Could not save flow preferences on this device.")?;
            saved.disk_base.primary = Some(bytes.into());
            Ok(saved)
        }
    }
    fn read_record(bytes: &[u8]) -> Result<FlowRecord> {
        FlowRecord::from_value(&serde_json::from_slice(bytes)?)
    }
    fn read_optional(path: &Path) -> Result<Option<Arc<[u8]>>> {
        let file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error).context("Could not open the local flow record."),
        };
        ensure!(
            file.metadata()?.is_file(),
            "The local flow record is not a regular file."
        );
        let mut bytes = Vec::new();
        file.take(MAX_FLOW_STORE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        ensure!(
            bytes.len() <= MAX_FLOW_STORE_BYTES,
            "Flow preferences are too large to open safely."
        );
        Ok(Some(bytes.into()))
    }
    fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
        let parent = path
            .parent()
            .context("The flow record has no parent folder.")?;
        let mut temporary = NamedTempFile::new_in(parent)?;
        temporary.write_all(bytes)?;
        temporary.as_file().sync_all()?;
        temporary.persist(path).map_err(|error| error.error)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    }
}

#[cfg(test)]
mod store_tests {
    use super::*;
    use std::fs;

    #[test]
    fn original_optional_gates_and_durable_record_survive_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let store = FlowStore::open(directory.path()).unwrap();
        let loaded = store.load().unwrap();
        assert!(!store.path().exists());
        assert!(loaded.warnings.is_empty());
        assert_eq!(loaded.record.preferences, FlowPreferences::default());
        assert!(loaded.record.preferences.flow_enabled());
        assert!(loaded.record.preferences.tools_enabled());
        for preferences in [
            FlowPreferences {
                flow_reading_enabled: Some(false),
                ..FlowPreferences::default()
            },
            FlowPreferences {
                live_review_enabled: Some(false),
                ..FlowPreferences::default()
            },
        ] {
            assert!(!preferences.flow_enabled());
        }
        assert!(
            FlowPreferences {
                in_flow_tools_enabled: Some(false),
                ..FlowPreferences::default()
            }
            .flow_enabled()
        );
        let mut candidate = loaded.record.clone();
        candidate.preferences.flow_reading_enabled = Some(false);
        candidate.profile = record_pause(&candidate.profile, 2_000., 9.);
        let request = loaded.record.request(candidate);
        assert!(!store.path().exists());
        let saved = store.save_request(&request, 10).unwrap();
        assert_eq!(saved.generation, 1);
        assert_eq!(saved.updated_at, 10);
        assert_eq!(
            saved,
            FlowStore::open(directory.path())
                .unwrap()
                .load()
                .unwrap()
                .record
        );
        assert_eq!(
            saved.to_value().unwrap()["settings"]["flow-reading-enabled"],
            false
        );
        assert!(
            saved.to_value().unwrap()["settings"]
                .get("live-review-enabled")
                .is_none()
        );
        assert!(store.save_request(&request, 11).is_err());
        assert_eq!(store.load().unwrap().record, saved);
    }
    #[test]
    fn compatible_fields_are_retained_across_profile_and_session_updates() {
        let directory = tempfile::tempdir().unwrap();
        let store = FlowStore::open(directory.path()).unwrap();
        let mut raw = FlowRecord::default().to_value().unwrap();
        raw["generation"] = json!(4);
        raw["futureEnvelope"] = json!({"keep":[1,2]});
        raw["settings"]["futureSetting"] = json!({"unchanged":true});
        raw["settings"]["live-review-enabled"] = json!(false);
        raw["profile"]["futureProfile"] = json!("kept");
        raw["profile"]["kinds"] =
            json!({"unknown":{"shown":1,"engaged":0,"dismissed":0,"futureKind":"kept"}});
        raw["sessions"] = json!([{"id":"f:0","folioId":"f","startedAt":0,"endedAt":60000,"flowMs":60000,"words":5,"wpm":5,"waited":2,"amendments":1,"ended":"closed","futureSlip":{"kept":true}}]);
        fs::write(store.path(), serde_json::to_vec(&raw).unwrap()).unwrap();
        let base = store.load().unwrap().record;
        let mut candidate = base.clone();
        candidate.profile = record_item(&candidate.profile, "unknown", ItemOutcome::Engaged, 2.);
        candidate.sessions[0].words = 6.;
        let saved = store.save_request(&base.request(candidate), 20).unwrap();
        let result = saved.to_value().unwrap();
        assert_eq!(result["futureEnvelope"], raw["futureEnvelope"]);
        assert_eq!(
            result["settings"]["futureSetting"],
            raw["settings"]["futureSetting"]
        );
        assert_eq!(result["settings"]["live-review-enabled"], false);
        assert_eq!(result["profile"]["futureProfile"], "kept");
        assert_eq!(result["profile"]["kinds"]["unknown"]["futureKind"], "kept");
        assert_eq!(
            result["profile"]["kinds"]["unknown"]["engaged"].as_f64(),
            Some(1.)
        );
        assert_eq!(
            result["sessions"][0]["futureSlip"],
            raw["sessions"][0]["futureSlip"]
        );
        assert_eq!(result["sessions"][0]["words"].as_f64(), Some(6.));
    }
    #[test]
    fn exact_base_rejects_same_generation_external_changes() {
        let directory = tempfile::tempdir().unwrap();
        let store = FlowStore::open(directory.path()).unwrap();
        let initial = store.load().unwrap().record;
        let base = store
            .save_request(&initial.request(initial.clone()), 1)
            .unwrap();
        let mut candidate = base.clone();
        candidate.preferences.live_review_enabled = Some(false);
        let request = base.request(candidate);
        let mut external = base.to_value().unwrap();
        external["futureWriter"] = json!("kept");
        fs::write(store.path(), serde_json::to_vec(&external).unwrap()).unwrap();
        assert!(store.save_request(&request, 2).is_err());
        assert_eq!(store.load().unwrap().record.to_value().unwrap(), external);
        let fresh = store.load().unwrap().record;
        let request = fresh.request(fresh.clone());
        let formatted = serde_json::to_vec_pretty(&external).unwrap();
        fs::write(store.path(), &formatted).unwrap();
        assert!(store.save_request(&request, 3).is_err());
        assert_eq!(fs::read(store.path()).unwrap(), formatted);
    }
    #[test]
    fn independent_handles_serialize_racing_saves() {
        let directory = tempfile::tempdir().unwrap();
        let stores = [
            FlowStore::open(directory.path()).unwrap(),
            FlowStore::open(directory.path()).unwrap(),
        ];
        let first = stores[0].load().unwrap().record;
        stores[0]
            .save_request(&first.request(first.clone()), 1)
            .unwrap();
        let requests: Vec<_> = stores
            .iter()
            .enumerate()
            .map(|(index, store)| {
                let base = store.load().unwrap().record;
                let mut candidate = base.clone();
                candidate.preferences.flow_reading_enabled = Some(index == 0);
                base.request(candidate)
            })
            .collect();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let outcomes = std::thread::scope(|scope| {
            stores
                .iter()
                .zip(&requests)
                .map(|(store, request)| {
                    let barrier = barrier.clone();
                    scope.spawn(move || {
                        barrier.wait();
                        store.save_request(request, 2)
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        let saved = outcomes.into_iter().find_map(Result::ok).unwrap();
        assert_eq!(saved.generation, 2);
        assert_eq!(stores[0].load().unwrap().record, saved);
    }
    #[test]
    fn interrupted_save_recovers_without_overwriting_future_versions() {
        let directory = tempfile::tempdir().unwrap();
        let store = FlowStore::open(directory.path()).unwrap();
        let first = store.load().unwrap().record;
        let before = store
            .save_request(&first.request(first.clone()), 1)
            .unwrap();
        let mut next = before.clone();
        next.preferences.live_review_enabled = Some(false);
        store.save_request(&before.request(next), 2).unwrap();
        fs::write(store.path(), b"interrupted flow write").unwrap();
        let recovered = store.load().unwrap();
        assert_eq!(
            recovered.record.to_value().unwrap(),
            before.to_value().unwrap()
        );
        assert_eq!(recovered.warnings.len(), 1);
        assert_eq!(fs::read(store.path()).unwrap(), b"interrupted flow write");
        let saved = store
            .save_request(&recovered.record.request(recovered.record.clone()), 3)
            .unwrap();
        assert_eq!(saved.generation, 2);
        let damaged = fs::read_dir(directory.path())
            .unwrap()
            .find_map(|entry| {
                let entry = entry.unwrap();
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".damaged-")
                    .then_some(entry.path())
            })
            .unwrap();
        assert_eq!(fs::read(damaged).unwrap(), b"interrupted flow write");
        let mut future = saved.to_value().unwrap();
        future["version"] = json!(2);
        let bytes = serde_json::to_vec(&future).unwrap();
        fs::write(store.path(), &bytes).unwrap();
        assert!(store.load().is_err());
        assert!(
            store
                .save_request(&saved.request(saved.clone()), 4)
                .is_err()
        );
        assert_eq!(fs::read(store.path()).unwrap(), bytes);
    }
    #[test]
    fn backup_io_failure_keeps_primary_and_same_request_can_retry() {
        let directory = tempfile::tempdir().unwrap();
        let store = FlowStore::open(directory.path()).unwrap();
        let first = store.load().unwrap().record;
        let base = store
            .save_request(&first.request(first.clone()), 1)
            .unwrap();
        let bytes = fs::read(store.path()).unwrap();
        let mut candidate = base.clone();
        candidate.profile = record_flow_entry(&candidate.profile, 90_000., 2.);
        let request = base.request(candidate);
        let backup = store.path().with_extension("json.bak");
        fs::create_dir(&backup).unwrap();
        assert!(store.save_request(&request, 2).is_err());
        assert_eq!(fs::read(store.path()).unwrap(), bytes);
        assert_eq!(store.load().unwrap().record, base);
        fs::remove_dir(&backup).unwrap();
        let saved = store.save_request(&request, 3).unwrap();
        assert_eq!(saved.generation, 2);
        assert_eq!(saved.profile.flow_entries, vec![90_000.]);
        assert_eq!(fs::read(backup).unwrap(), bytes);
        assert_eq!(store.load().unwrap().record, saved);
    }
    #[test]
    fn oversized_records_fail_before_mutation_and_recent_slips_are_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let store = FlowStore::open(directory.path()).unwrap();
        let base = store.load().unwrap().record;
        let mut candidate = base.clone();
        candidate
            .extra
            .insert("tooLarge".into(), json!("a".repeat(MAX_FLOW_STORE_BYTES)));
        assert!(store.save_request(&base.request(candidate), 1).is_err());
        assert!(!store.path().exists());
        let mut candidate = base.clone();
        for index in 0..40 {
            candidate.sessions.push(FlowSession {
                id: format!("f:{index}"),
                folio_id: "f".into(),
                started_at: f64::from(index),
                ended_at: f64::from(index) + 60_000.,
                flow_ms: 60_000.,
                words: 1.,
                wpm: 1.,
                waited: 0,
                amendments: 0,
                ended: FlowSessionEnd::Closed,
            });
        }
        let saved = store.save_request(&base.request(candidate), 2).unwrap();
        assert_eq!(saved.sessions.len(), 30);
        assert_eq!(saved.sessions.first().unwrap().id, "f:10");
        assert_eq!(store.load().unwrap().record, saved);
    }
    #[test]
    fn pending_save_acknowledgement_requires_actual_full_value_and_timestamp() {
        let directory = tempfile::tempdir().unwrap();
        let store = FlowStore::open(directory.path()).unwrap();
        let base = store.load().unwrap().record;
        let mut candidate = base.clone();
        candidate.profile = record_pause(&candidate.profile, 2_000., 3.);
        candidate
            .extra
            .insert("future".into(), json!({"kept":true}));
        let request = base.request(candidate);
        assert!(store.acknowledge_request(&request, 10).unwrap().is_none());
        let saved = store.save_request(&request, 10).unwrap();
        assert_eq!(
            saved.to_value().unwrap(),
            request.expected_value(10).unwrap()
        );
        assert_eq!(
            store.acknowledge_request(&request, 10).unwrap(),
            Some(saved.clone())
        );
        assert!(store.acknowledge_request(&request, 11).unwrap().is_none());
        let mut external = saved.to_value().unwrap();
        external["future"]["kept"] = json!(false);
        fs::write(store.path(), serde_json::to_vec(&external).unwrap()).unwrap();
        assert!(store.acknowledge_request(&request, 10).unwrap().is_none());
        // A good backup cannot acknowledge a missing/new damaged primary.
        fs::write(
            store.path().with_extension("json.bak"),
            serde_json::to_vec(&request.expected_value(10).unwrap()).unwrap(),
        )
        .unwrap();
        fs::remove_file(store.path()).unwrap();
        assert!(store.acknowledge_request(&request, 10).unwrap().is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference() -> Value {
        serde_json::from_str(include_str!("../fixtures/flow/web-reference.json")).unwrap()
    }
    fn assert_equivalent(actual: &Value, expected: &Value, path: &str) {
        match (actual, expected) {
            (Value::Number(actual), Value::Number(expected)) => {
                let (actual, expected) = (actual.as_f64().unwrap(), expected.as_f64().unwrap());
                assert!(
                    (actual - expected).abs() <= 1e-12 * expected.abs().max(1.),
                    "{path}: {actual} != {expected}"
                );
            }
            (Value::Array(actual), Value::Array(expected)) => {
                assert_eq!(actual.len(), expected.len(), "{path}");
                for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
                    assert_equivalent(actual, expected, &format!("{path}/{index}"));
                }
            }
            (Value::Object(actual), Value::Object(expected)) => {
                assert_eq!(actual.len(), expected.len(), "{path}");
                for (key, expected) in expected {
                    assert_equivalent(
                        actual
                            .get(key)
                            .unwrap_or_else(|| panic!("Missing {path}/{key}")),
                        expected,
                        &format!("{path}/{key}"),
                    );
                }
            }
            _ => assert_eq!(actual, expected, "{path}"),
        }
    }
    #[test]
    fn readings_match_executed_original_detector_traces() {
        let reference = reference();
        for case in reference["readings"].as_array().unwrap() {
            let input = &case["input"];
            let samples: Vec<KeySample> = serde_json::from_value(input["samples"].clone()).unwrap();
            let previous = serde_json::from_value(input["previous"].clone()).unwrap();
            let thresholds = serde_json::from_value(input["thresholds"].clone()).unwrap();
            let context = serde_json::from_value(input["context"].clone()).unwrap();
            let reading = read_flow(
                &samples,
                input["now"].as_f64().unwrap(),
                previous,
                &thresholds,
                context,
            );
            assert_equivalent(
                &serde_json::to_value(reading).unwrap(),
                &case["expected"],
                case["name"].as_str().unwrap(),
            );
        }
        assert_eq!(reference["readings"].as_array().unwrap().len(), 174);
    }
    #[test]
    fn retention_and_quiet_modes_match_original() {
        let reference = reference();
        for case in reference["trims"].as_array().unwrap() {
            let input = &case["input"];
            let samples: Vec<KeySample> = serde_json::from_value(input["samples"].clone()).unwrap();
            assert_equivalent(
                &serde_json::to_value(trim_samples(
                    &samples,
                    input["now"].as_f64().unwrap(),
                    input["keepMs"].as_f64().unwrap(),
                ))
                .unwrap(),
                &case["expected"],
                "trim",
            );
        }
        for case in reference["quiet"].as_array().unwrap() {
            assert_eq!(
                is_quiet(serde_json::from_value(case["mode"].clone()).unwrap()),
                case["expected"].as_bool().unwrap()
            );
        }
    }
    #[test]
    fn profile_normalization_and_updates_match_original_and_keep_kind_metadata() {
        let reference = reference();
        for case in reference["normalized"].as_array().unwrap() {
            assert_equivalent(
                &serde_json::to_value(normalize_profile(&case["input"])).unwrap(),
                &case["expected"],
                "normalize",
            );
        }
        for case in reference["recorded"].as_array().unwrap() {
            let profile: FlowProfile = serde_json::from_value(case["before"].clone()).unwrap();
            let untouched = profile.clone();
            let action = &case["action"];
            let now = action["now"].as_f64().unwrap();
            let next = match action["kind"].as_str().unwrap() {
                "pause" => record_pause(&profile, action["ms"].as_f64().unwrap(), now),
                "run" => record_run(
                    &profile,
                    action["ms"].as_f64().unwrap(),
                    now,
                    action["hour"].as_u64().unwrap() as u8,
                )
                .unwrap(),
                "entry" => record_flow_entry(&profile, action["ms"].as_f64().unwrap(), now),
                "override" => record_override(&profile, now),
                "item" => record_item(
                    &profile,
                    action["itemKind"].as_str().unwrap(),
                    serde_json::from_value(action["outcome"].clone()).unwrap(),
                    now,
                ),
                kind => panic!("Unknown fixture action {kind}"),
            };
            assert_equivalent(
                &serde_json::to_value(next).unwrap(),
                &case["expected"],
                "record",
            );
            assert_eq!(profile, untouched);
        }
        assert!(record_run(&FlowProfile::default(), 10_000., 0., 24).is_err());
    }
    #[test]
    fn learned_thresholds_weights_hours_and_quantiles_match_original() {
        let reference = reference();
        for case in reference["learned"].as_array().unwrap() {
            let profile = serde_json::from_value(case["input"].clone()).unwrap();
            assert_equivalent(
                &serde_json::to_value(thresholds_for(&profile)).unwrap(),
                &case["expected"],
                "thresholds",
            );
        }
        for case in reference["weights"].as_array().unwrap() {
            let profile = serde_json::from_value(case["input"].clone()).unwrap();
            assert_equivalent(
                &Value::from(kind_weight(&profile, case["kind"].as_str().unwrap())),
                &case["expected"],
                "weight",
            );
        }
        for case in reference["hours"].as_array().unwrap() {
            let profile = serde_json::from_value(case["input"].clone()).unwrap();
            assert_eq!(
                serde_json::to_value(writing_hours(
                    &profile,
                    case["top"].as_u64().unwrap() as usize
                ))
                .unwrap(),
                case["expected"]
            );
        }
        for case in reference["quantiles"].as_array().unwrap() {
            let values: Vec<f64> = serde_json::from_value(case["values"].clone()).unwrap();
            assert_equivalent(
                &serde_json::to_value(quantile(&values, case["q"].as_f64().unwrap())).unwrap(),
                &case["expected"],
                "quantile",
            );
        }
    }
    #[test]
    fn session_slips_match_original_qualification_rounding_and_stable_deduplication() {
        let reference = reference();
        for case in reference["summaries"].as_array().unwrap() {
            let input = serde_json::from_value(case["input"].clone()).unwrap();
            assert_equivalent(
                &serde_json::to_value(summarize_session(&input)).unwrap(),
                &case["expected"],
                "summary",
            );
        }
        for case in reference["appended"].as_array().unwrap() {
            let list: Vec<FlowSession> = serde_json::from_value(case["list"].clone()).unwrap();
            let untouched = list.clone();
            let session = serde_json::from_value(case["session"].clone()).unwrap();
            assert_equivalent(
                &serde_json::to_value(append_session(
                    &list,
                    session,
                    case["max"].as_u64().unwrap() as usize,
                ))
                .unwrap(),
                &case["expected"],
                "append",
            );
            assert_eq!(list, untouched);
        }
    }
    #[test]
    fn sampler_is_incremental_bounded_and_does_not_erase_away_on_silent_ticks() {
        let mut sampler = FlowSampler::default();
        assert_eq!(
            sampler.push(KeySample {
                at: 0.,
                inserted: 0.,
                deleted: 0.
            }),
            Ok(false)
        );
        assert!(sampler.is_empty());
        for second in 0..=90 {
            sampler
                .push(KeySample {
                    at: f64::from(second) * 1_000.,
                    inserted: 4.,
                    deleted: 0.,
                })
                .unwrap();
        }
        let reading = sampler.read(
            90_000.,
            FlowMode::Working,
            &DEFAULT_THRESHOLDS,
            FlowContext::default(),
        );
        assert_eq!(reading.mode, FlowMode::Flow);
        assert_eq!(
            sampler
                .read(
                    2_000_000.,
                    FlowMode::Flow,
                    &DEFAULT_THRESHOLDS,
                    FlowContext::default()
                )
                .mode,
            FlowMode::Away
        );
        assert_eq!(sampler.len(), 91);
        sampler
            .push(KeySample {
                at: 2_000_000.,
                inserted: 1.,
                deleted: 0.,
            })
            .unwrap();
        assert_eq!(sampler.len(), 1);
        assert_eq!(
            sampler.push(KeySample {
                at: 1.,
                inserted: 1.,
                deleted: 0.
            }),
            Err(SampleError::OutOfOrder)
        );
        assert_eq!(
            sampler.push(KeySample {
                at: f64::NAN,
                inserted: 1.,
                deleted: 0.
            }),
            Err(SampleError::Invalid)
        );
        sampler.clear();
        for _ in 0..MAX_RHYTHM_SAMPLES {
            sampler
                .push(KeySample {
                    at: 0.,
                    inserted: 1.,
                    deleted: 0.,
                })
                .unwrap();
        }
        assert_eq!(
            sampler.push(KeySample {
                at: 0.,
                inserted: 1.,
                deleted: 0.
            }),
            Err(SampleError::Capacity)
        );
        assert_eq!(sampler.len(), MAX_RHYTHM_SAMPLES);
    }
    #[test]
    fn ribbon_is_disabled_until_connected_and_uses_original_titles_and_minutes() {
        let mut snapshot = FlowSnapshot::default();
        assert!(!snapshot.enabled);
        snapshot.mode = FlowMode::Flow;
        snapshot.reading = Some(read_flow(
            &[
                KeySample {
                    at: 0.,
                    inserted: 1.,
                    deleted: 0.,
                },
                KeySample {
                    at: 179_999.,
                    inserted: 1.,
                    deleted: 0.,
                },
            ],
            179_999.,
            FlowMode::Flow,
            &FlowThresholds {
                gap_ms: 180_000.,
                ..DEFAULT_THRESHOLDS
            },
            FlowContext::default(),
        ));
        assert_eq!(snapshot.label(), "in flow · 2 min");
        assert_eq!(
            snapshot.accessibility_label(),
            "in flow · 2 min. You're in flow. The margin holds everything until you pause; Escape brings it back."
        );
    }
}
