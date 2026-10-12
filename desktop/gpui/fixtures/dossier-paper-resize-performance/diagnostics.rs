//! Proposed ui-tests-only preparation timings. No paint/input hook or image Arc.
//! These are CPU boundary durations, not presentation or interaction latency.

use super::DossierPaperMetrics;
use gpui_kit::Window;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
    time::Instant,
};

const MAX_ROWS: usize = 64;
const KIND_COUNT: usize = 7;
const PHASE_COUNT: usize = 9;

#[derive(Clone, Copy)]
pub(crate) enum Kind {
    BoundsObserver,
    PaletteObserver,
    HostPreparation,
    CandidatePreparation,
    StampBoundary,
    Paper,
    Multiply,
}

const KINDS: [&str; KIND_COUNT] = [
    "boundsObserver",
    "paletteObserver",
    "hostPreparation",
    "candidatePreparation",
    "stampBoundary",
    "paper",
    "multiply",
];

#[derive(Clone, Copy)]
pub(crate) enum Phase {
    Validation,
    CacheWait,
    CacheLookup,
    SvgBuild,
    RendererAndParse,
    RasterAndBgraConversion,
    PremultipliedValidation,
    InstallAndEviction,
    LeaseReplacement,
}

const PHASES: [&str; PHASE_COUNT] = [
    "validation",
    "cacheLockWait",
    "cacheLookup",
    "svgBuild",
    "rendererAndParse",
    "rasterAndBgraConversion",
    "premultipliedValidation",
    "installAndEviction",
    "leaseReplacement",
];

#[derive(Clone, Copy)]
struct Metrics {
    width_bits: u32,
    height_bits: u32,
    scale_bits: u32,
    raster_size: Option<(u32, u32)>,
}

impl Metrics {
    fn validated(metrics: DossierPaperMetrics) -> Self {
        Self {
            width_bits: metrics.width().to_bits(),
            height_bits: metrics.height().to_bits(),
            scale_bits: metrics.scale_factor().to_bits(),
            raster_size: Some(metrics.raster_size()),
        }
    }

    fn json(self) -> Value {
        json!({
            "widthBits": self.width_bits,
            "heightBits": self.height_bits,
            "scaleBits": self.scale_bits,
            "validatedRasterSize": self.raster_size.map(|(width, height)| json!({
                "width": width, "height": height,
                "pixels": (u64::from(width) * u64::from(height)).to_string(),
            })),
        })
    }
}

struct Row {
    sequence: u64,
    kind: Kind,
    window_id: Option<u64>,
    metrics: Metrics,
    outcome: &'static str,
    raster_returned: bool,
    total_us: u64,
    phases_us: [u64; PHASE_COUNT],
    cache_len_before: Option<usize>,
    cache_evictions: Option<usize>,
}

#[derive(Default)]
struct Trace {
    sequence: u64,
    exhausted: bool,
    rows_dropped: u64,
    calls: [u64; KIND_COUNT],
    rows: VecDeque<Row>,
}

fn trace() -> &'static Mutex<Trace> {
    static TRACE: OnceLock<Mutex<Trace>> = OnceLock::new();
    TRACE.get_or_init(|| Mutex::new(Trace::default()))
}

fn micros(start: Instant) -> u64 {
    start.elapsed().as_micros().min(u128::from(u64::MAX)) as u64
}

/// One bounded row per actual preparation boundary. `mark` ends the phase
/// started by the preceding mark/start. Unfinished/error phases remain in
/// totalUs minus completed phases; do not infer a successful raster from them.
pub(crate) struct Operation {
    start: Instant,
    phase_start: Instant,
    row: Row,
}

impl Operation {
    pub(crate) fn for_metrics(kind: Kind, metrics: DossierPaperMetrics) -> Self {
        Self::new(kind, None, Metrics::validated(metrics))
    }

    pub(crate) fn for_window(kind: Kind, window: &Window) -> Self {
        let viewport = window.viewport_size();
        Self::new(
            kind,
            Some(window.window_handle().window_id().as_u64()),
            Metrics {
                width_bits: f32::from(viewport.width).to_bits(),
                height_bits: f32::from(viewport.height).to_bits(),
                scale_bits: window.scale_factor().to_bits(),
                raster_size: None,
            },
        )
    }

    fn new(kind: Kind, window_id: Option<u64>, metrics: Metrics) -> Self {
        let start = Instant::now();
        Self {
            start,
            phase_start: start,
            row: Row {
                sequence: 0,
                kind,
                window_id,
                metrics,
                outcome: "errorOrIncomplete",
                raster_returned: false,
                total_us: 0,
                phases_us: [0; PHASE_COUNT],
                cache_len_before: None,
                cache_evictions: None,
            },
        }
    }

    pub(crate) fn mark(&mut self, phase: Phase) {
        if matches!(phase, Phase::RasterAndBgraConversion) {
            self.row.raster_returned = true;
        }
        let elapsed = micros(self.phase_start);
        self.row.phases_us[phase as usize] =
            self.row.phases_us[phase as usize].saturating_add(elapsed);
        self.phase_start = Instant::now();
    }

    pub(crate) fn measure_since(&mut self, phase: Phase, start: Instant) {
        self.row.phases_us[phase as usize] =
            self.row.phases_us[phase as usize].saturating_add(micros(start));
    }

    pub(crate) fn outcome(&mut self, outcome: &'static str) {
        self.row.outcome = outcome;
    }

    pub(crate) fn cache_before(&mut self, entries: usize) {
        self.row.cache_len_before = Some(entries);
    }

    pub(crate) fn evictions(&mut self, entries: usize) {
        self.row.cache_evictions = Some(entries);
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        self.row.total_us = micros(self.start);
        // Instrumentation must not alter a preparation's error or turn a
        // poisoned diagnostics lock into a product failure.
        let Ok(mut trace) = trace().lock() else {
            return;
        };
        trace.calls[self.row.kind as usize] =
            trace.calls[self.row.kind as usize].saturating_add(1);
        let Some(sequence) = trace.sequence.checked_add(1) else {
            trace.exhausted = true;
            return;
        };
        trace.sequence = sequence;
        self.row.sequence = sequence;
        if trace.rows.len() == MAX_ROWS {
            trace.rows.pop_front();
            trace.rows_dropped = trace.rows_dropped.saturating_add(1);
        }
        let row = Row {
            sequence,
            kind: self.row.kind,
            window_id: self.row.window_id,
            metrics: self.row.metrics,
            outcome: self.row.outcome,
            raster_returned: self.row.raster_returned,
            total_us: self.row.total_us,
            phases_us: self.row.phases_us,
            cache_len_before: self.row.cache_len_before,
            cache_evictions: self.row.cache_evictions,
        };
        trace.rows.push_back(row);
    }
}

/// Read only at an explicit Parent diagnostic/capture boundary. This does not
/// notify, schedule a frame, prepare an image or run from production paint.
pub(crate) fn snapshot() -> Value {
    let Ok(trace) = trace().lock() else {
        return json!({"schemaVersion": 1, "available": false, "reason": "poisoned"});
    };
    json!({
        "schemaVersion": 1,
        "available": true,
        "scope": "processCpuPreparationBoundaries",
        "maxRows": MAX_ROWS,
        "latestSequence": trace.sequence.to_string(),
        "rowsDropped": trace.rows_dropped.to_string(),
        "sequenceExhausted": trace.exhausted,
        "calls": KINDS.iter().enumerate().map(|(index, kind)| json!({
            "kind": kind, "count": trace.calls[index].to_string(),
        })).collect::<Vec<_>>(),
        "rows": trace.rows.iter().map(|row| json!({
            "sequence": row.sequence.to_string(),
            "kind": KINDS[row.kind as usize],
            "windowId": row.window_id.map(|id| id.to_string()),
            "metrics": row.metrics.json(),
            "outcome": row.outcome,
            "rasterReturned": row.raster_returned,
            "totalUs": row.total_us.to_string(),
            "completedPhasesUs": PHASES.iter().enumerate().map(|(index, phase)| json!({
                "phase": phase, "us": row.phases_us[index].to_string(),
            })).collect::<Vec<_>>(),
            "cacheEntriesBefore": row.cache_len_before,
            "cacheEvictions": row.cache_evictions,
        })).collect::<Vec<_>>(),
    })
}
