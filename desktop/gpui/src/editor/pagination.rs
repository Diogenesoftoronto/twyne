//! Arithmetic from the original `pagination-geometry.ts`. Pagination changes
//! presentation only: positions identify blocks, never inserted document text.

use serde::{Deserialize, Serialize};

use crate::workspace::{LayoutSettings, PaginationMode};

pub const PAGE_GAP_REM: f64 = 1.5;
pub const SPACER_EPSILON_PX: f64 = 0.5;
pub const PAGINATION_MAX_BLOCKS: usize = 20_000;
pub const PAGINATION_MAX_PAGES: usize = 2_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlockMetric {
    /// Native scalar start. The algorithm treats this as an opaque identity,
    /// just as the Source function treats its ProseMirror position.
    pub pos: usize,
    pub height: f64,
    pub margin_top: f64,
    pub margin_bottom: f64,
    #[serde(default)]
    pub forced_break: bool,
    #[serde(default)]
    pub keep_with_next: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageGeometry {
    pub page_h: f64,
    pub page_w: f64,
    pub gap: f64,
    pub margin_top: f64,
    pub margin_bottom: f64,
    pub margin_left: f64,
    pub margin_right: f64,
    pub content_h: f64,
    pub content_w: f64,
}

impl PageGeometry {
    pub fn from_layout(layout: &LayoutSettings, root_px: f64, gap_rem: f64) -> Self {
        let setup = layout.resolve_page_setup();
        let margins = layout.resolve_margins();
        let margin_top = margins.top * root_px;
        let margin_bottom = margins.bottom * root_px;
        let margin_left = margins.left * root_px;
        let margin_right = margins.right * root_px;
        let page_w = if setup.pagination == PaginationMode::Continuous {
            layout.width_rem() * root_px + margin_left + margin_right
        } else {
            setup.width_in * 96.
        };
        let page_h = setup.height_in * 96.;
        Self {
            page_h,
            page_w,
            gap: gap_rem * root_px,
            margin_top,
            margin_bottom,
            margin_left,
            margin_right,
            content_h: (page_h - margin_top - margin_bottom).max(1.),
            content_w: (page_w - margin_left - margin_right).max(1.),
        }
    }

    pub fn period(self) -> f64 {
        self.page_h + self.gap
    }

    pub fn sheet_top(self, page: usize) -> f64 {
        page as f64 * self.period()
    }

    pub fn canvas_height(self, pages: usize) -> f64 {
        if pages == 0 {
            0.
        } else {
            pages as f64 * self.period() - self.gap
        }
    }

    fn valid(self) -> bool {
        [
            self.page_h,
            self.page_w,
            self.gap,
            self.margin_top,
            self.margin_bottom,
            self.margin_left,
            self.margin_right,
            self.content_h,
            self.content_w,
        ]
        .into_iter()
        .all(f64::is_finite)
            && self.page_h > 0.
            && self.page_w > 0.
            && self.gap >= 0.
            && self.content_h > 0.
            && self.content_w > 0.
            && self.period().is_finite()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageBreak {
    pub block_index: usize,
    pub pos: usize,
    pub height: f64,
    pub forced: bool,
    pub page: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaginationResult {
    pub breaks: Vec<PageBreak>,
    pub page_count: usize,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaginateOptions {
    #[serde(default)]
    pub tail_height: f64,
    pub max_pages: Option<usize>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaginationError {
    InvalidGeometry,
    InvalidMetric { block_index: usize },
    InvalidTail,
    UnrepresentableExtent,
}

/// Adjacent margins use the Source `max`, including its handling of negative
/// margins. A manual break truncates the following margin and occupies no ink.
pub fn build_natural_stack(metrics: &[BlockMetric]) -> Vec<f64> {
    let mut tops = Vec::with_capacity(metrics.len());
    for (index, metric) in metrics.iter().enumerate() {
        let mt = if metric.forced_break {
            0.
        } else {
            metric.margin_top
        };
        let y = if index == 0 {
            mt
        } else {
            let previous = &metrics[index - 1];
            let (height, collapsed) = if previous.forced_break {
                (0., 0.)
            } else {
                (previous.height, previous.margin_bottom.max(mt))
            };
            tops[index - 1] + height + collapsed
        };
        tops.push(y);
    }
    tops
}

fn ink_bottom(metrics: &[BlockMetric], tops: &[f64], index: usize) -> f64 {
    tops[index]
        + if metrics[index].forced_break {
            0.
        } else {
            metrics[index].height
        }
}

/// Source-exact atomic-block pagination over valid finite measurements. The
/// finite-input check is a native safety boundary; it does not sanitize inputs
/// or change authored settings. The Source page cap stops the scan and caps the
/// reported count; it does not claim that the unmeasured suffix fits the cap.
pub fn paginate(
    metrics: &[BlockMetric],
    geometry: PageGeometry,
    options: PaginateOptions,
) -> Result<PaginationResult, PaginationError> {
    if !geometry.valid() {
        return Err(PaginationError::InvalidGeometry);
    }
    if !options.tail_height.is_finite() || options.tail_height < 0. {
        return Err(PaginationError::InvalidTail);
    }
    for (block_index, metric) in metrics.iter().enumerate() {
        if ![metric.height, metric.margin_top, metric.margin_bottom]
            .into_iter()
            .all(f64::is_finite)
            || metric.height < 0.
        {
            return Err(PaginationError::InvalidMetric { block_index });
        }
    }
    if metrics.is_empty() {
        return Ok(PaginationResult {
            breaks: Vec::new(),
            page_count: 1,
        });
    }
    let tops = build_natural_stack(metrics);
    if tops.iter().any(|top| !top.is_finite()) {
        return Err(PaginationError::UnrepresentableExtent);
    }
    let max_pages = options.max_pages.unwrap_or(usize::MAX);
    let period = geometry.period();
    let mut breaks = Vec::new();
    let mut run_start = 0;
    let mut run_page = 0usize;
    let mut index = 1;
    while index < metrics.len() {
        if run_page >= max_pages {
            break;
        }
        let forced = metrics[index].forced_break;
        let overflows = ink_bottom(metrics, &tops, index) - tops[run_start] > geometry.content_h;
        let fits_alone = ink_bottom(metrics, &tops, index) - tops[index] <= geometry.content_h;
        let run_fits =
            ink_bottom(metrics, &tops, index - 1) - tops[run_start] <= geometry.content_h;
        if !forced && (!overflows || (!fits_alone && run_fits)) {
            index += 1;
            continue;
        }
        let mut break_at = index;
        if !forced {
            while break_at > run_start + 1 && metrics[break_at - 1].keep_with_next {
                break_at -= 1;
            }
        }
        let ink_extent = ink_bottom(metrics, &tops, break_at - 1) - tops[run_start];
        let used = tops[break_at] - tops[run_start];
        let mut spanned = (ink_extent / period).ceil().max(1.);
        // Algebraic equivalent of the Source while loop, with no work
        // proportional to an adversarially large margin/height measurement.
        if spanned * period - used < geometry.gap {
            spanned = spanned.max(((used + geometry.gap) / period).ceil());
            if spanned * period - used < geometry.gap {
                spanned += 1.;
            }
        }
        if !spanned.is_finite() || spanned >= usize::MAX as f64 {
            return Err(PaginationError::UnrepresentableExtent);
        }
        let height = spanned * period - used;
        let page = run_page
            .checked_add(spanned as usize)
            .ok_or(PaginationError::UnrepresentableExtent)?;
        if !height.is_finite() || height < geometry.gap {
            return Err(PaginationError::UnrepresentableExtent);
        }
        breaks.push(PageBreak {
            block_index: break_at,
            pos: metrics[break_at].pos,
            height,
            forced,
            page,
        });
        run_start = break_at;
        run_page = page;
        index = if break_at < index {
            break_at + 1
        } else {
            index + 1
        };
    }
    let final_ink =
        ink_bottom(metrics, &tops, metrics.len() - 1) - tops[run_start] + options.tail_height;
    let final_spanned = (final_ink / period).ceil().max(1.);
    if !final_spanned.is_finite() || final_spanned >= usize::MAX as f64 {
        return Err(PaginationError::UnrepresentableExtent);
    }
    let page_count = run_page
        .checked_add(final_spanned as usize)
        .ok_or(PaginationError::UnrepresentableExtent)?
        .min(max_pages);
    Ok(PaginationResult { breaks, page_count })
}

pub fn same_breaks(left: &[PageBreak], right: &[PageBreak]) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(left, right)| {
            left.block_index == right.block_index
                && left.pos == right.pos
                && left.page == right.page
                && left.forced == right.forced
                && (left.height - right.height).abs() < SPACER_EPSILON_PX
        })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpacerRange {
    pub before_block: usize,
    pub start: f64,
    pub end: f64,
    pub forced: bool,
    pub page: usize,
}

/// The presentation transform has a stable block index and local coordinate.
/// Scalar/UTF16 offsets never gain an artificial gap character. Consumers
/// should use `block_top + local_y`, including for opaque container descendants.
#[derive(Clone, Debug, PartialEq)]
pub struct StackPlacement {
    pub natural_tops: Vec<f64>,
    pub rendered_tops: Vec<f64>,
    pub spacers: Vec<SpacerRange>,
}

impl StackPlacement {
    pub fn new(metrics: &[BlockMetric], breaks: &[PageBreak]) -> Self {
        let natural_tops = build_natural_stack(metrics);
        let mut rendered_tops = Vec::with_capacity(metrics.len());
        let mut spacers = Vec::with_capacity(breaks.len());
        let mut cumulative = 0.;
        let mut cursor = 0;
        for (index, top) in natural_tops.iter().copied().enumerate() {
            while cursor < breaks.len() && breaks[cursor].block_index == index {
                let page_break = breaks[cursor];
                let start = top + cumulative;
                cumulative += page_break.height;
                spacers.push(SpacerRange {
                    before_block: index,
                    start,
                    end: top + cumulative,
                    forced: page_break.forced,
                    page: page_break.page,
                });
                cursor += 1;
            }
            rendered_tops.push(top + cumulative);
        }
        Self {
            natural_tops,
            rendered_tops,
            spacers,
        }
    }

    pub fn rendered_y(&self, block: usize, local_y: f64) -> Option<f64> {
        self.rendered_tops.get(block).map(|top| top + local_y)
    }

    pub fn local_y(&self, block: usize, rendered_y: f64) -> Option<f64> {
        self.rendered_tops.get(block).map(|top| rendered_y - top)
    }

    pub fn spacer_at(&self, rendered_y: f64) -> Option<SpacerRange> {
        let index = self
            .spacers
            .partition_point(|spacer| spacer.end <= rendered_y);
        self.spacers
            .get(index)
            .filter(|spacer| rendered_y >= spacer.start && rendered_y < spacer.end)
            .copied()
    }

    pub fn ink_bottom(&self, metrics: &[BlockMetric]) -> f64 {
        metrics.last().map_or(0., |metric| {
            self.rendered_tops.last().copied().unwrap_or(0.)
                + if metric.forced_break {
                    0.
                } else {
                    metric.height
                }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::{Command, RichDocument, RichEditor, Selection};

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReferenceCase {
        name: String,
        geometry: PageGeometry,
        metrics: Vec<BlockMetric>,
        #[serde(default)]
        options: PaginateOptions,
        natural_tops: Vec<f64>,
        result: PaginationResult,
        rendered_tops: Vec<f64>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GeometryCase {
        name: String,
        layout: LayoutSettings,
        root_px: f64,
        gap_rem: f64,
        geometry: PageGeometry,
    }

    #[derive(Deserialize)]
    struct Corpus {
        cases: Vec<ReferenceCase>,
        geometries: Vec<GeometryCase>,
    }

    fn corpus() -> Corpus {
        serde_json::from_str(include_str!(
            "../../fixtures/pagination/source-geometry.json"
        ))
        .unwrap()
    }

    fn close(actual: f64, expected: f64, name: &str) {
        assert!(
            (actual - expected).abs() < 1e-8,
            "{name}: {actual} != {expected}"
        );
    }

    #[test]
    fn executes_original_pagination_and_geometry_corpus() {
        let reference = corpus();
        assert!(reference.cases.len() >= 25);
        for case in reference.cases {
            let tops = build_natural_stack(&case.metrics);
            assert_eq!(tops.len(), case.natural_tops.len(), "{}", case.name);
            for (actual, expected) in tops.iter().zip(&case.natural_tops) {
                close(*actual, *expected, &case.name);
            }
            let result = paginate(&case.metrics, case.geometry, case.options).unwrap();
            assert_eq!(result.page_count, case.result.page_count, "{}", case.name);
            assert_eq!(
                result.breaks.len(),
                case.result.breaks.len(),
                "{}",
                case.name
            );
            for (actual, expected) in result.breaks.iter().zip(&case.result.breaks) {
                assert_eq!(
                    (actual.block_index, actual.pos, actual.forced, actual.page),
                    (
                        expected.block_index,
                        expected.pos,
                        expected.forced,
                        expected.page
                    ),
                    "{}",
                    case.name
                );
                close(actual.height, expected.height, &case.name);
            }
            let placement = StackPlacement::new(&case.metrics, &result.breaks);
            for (index, expected) in case.rendered_tops.iter().copied().enumerate() {
                close(
                    placement.rendered_y(index, 0.).unwrap(),
                    expected,
                    &case.name,
                );
                for local in [0., 0.25, case.metrics[index].height] {
                    let rendered = placement.rendered_y(index, local).unwrap();
                    close(
                        placement.local_y(index, rendered).unwrap(),
                        local,
                        &case.name,
                    );
                }
            }
            for spacer in &placement.spacers {
                assert!(spacer.end > spacer.start);
                assert_eq!(
                    placement.spacer_at((spacer.start + spacer.end) / 2.),
                    Some(*spacer)
                );
            }
        }
        for case in reference.geometries {
            let actual = PageGeometry::from_layout(&case.layout, case.root_px, case.gap_rem);
            let actual = serde_json::to_value(actual).unwrap();
            let expected = serde_json::to_value(case.geometry).unwrap();
            for (key, expected) in expected.as_object().unwrap() {
                close(
                    actual[key].as_f64().unwrap(),
                    expected.as_f64().unwrap(),
                    &case.name,
                );
            }
        }
    }

    #[test]
    fn page_reflow_is_neutral_to_source_selection_clipboard_and_history() {
        let html = "<p><strong>A 🦊é</strong></p><div data-type=\"page-break\" data-future=\"keep\"></div><p><sup data-type=\"footnote\" data-endnote-text=\"note\"></sup>Tail</p>";
        let mut editor = RichEditor::new(RichDocument::from_html(html).unwrap());
        editor.set_selection(Selection::new(4, 1)).unwrap();
        let before = editor.document().clone();
        let selection = editor.selection();
        let fixture = corpus()
            .cases
            .into_iter()
            .find(|case| case.name == "trailing-break")
            .unwrap();
        for content_h in [800., 1., 800.] {
            let geometry = PageGeometry {
                content_h,
                ..fixture.geometry
            };
            let result = paginate(&fixture.metrics, geometry, fixture.options).unwrap();
            let _ = StackPlacement::new(&fixture.metrics, &result.breaks);
            assert_eq!(editor.document(), &before);
            assert_eq!(editor.selection(), selection);
            assert!(!editor.can_undo());
        }
        editor.execute(Command::InsertText("x".into())).unwrap();
        editor.execute(Command::Undo).unwrap();
        assert_eq!(editor.document(), &before);
        assert_eq!(editor.selection(), selection);
    }

    #[test]
    fn finite_resource_boundary_refuses_invalid_measurements_without_sanitizing() {
        let case = corpus()
            .cases
            .into_iter()
            .find(|case| !case.metrics.is_empty())
            .unwrap();
        let invalid = PageGeometry {
            content_h: f64::NAN,
            ..case.geometry
        };
        assert_eq!(
            paginate(&case.metrics, invalid, PaginateOptions::default()),
            Err(PaginationError::InvalidGeometry)
        );
        let mut metrics = case.metrics;
        metrics[0].height = f64::INFINITY;
        assert_eq!(
            paginate(&metrics, case.geometry, PaginateOptions::default()),
            Err(PaginationError::InvalidMetric { block_index: 0 })
        );
    }

    #[test]
    fn spacer_jitter_uses_original_strict_half_pixel_boundary() {
        let case = corpus()
            .cases
            .into_iter()
            .find(|case| !case.result.breaks.is_empty())
            .unwrap();
        let mut jitter = case.result.breaks.clone();
        jitter[0].height += 0.499;
        assert!(same_breaks(&case.result.breaks, &jitter));
        jitter[0].height = case.result.breaks[0].height + 0.5;
        assert!(!same_breaks(&case.result.breaks, &jitter));
    }
}
