//! A page frame owns placement, not document content. Native child elements
//! retain dispatch, input, focus and accessibility; all geometry is moved in
//! prepaint, before any caret/comment/note/drag consumer records its bounds.

use std::cell::Cell;

use super::*;
use crate::editor::pagination::{
    BlockMetric, PAGE_GAP_REM, PAGINATION_MAX_BLOCKS, PAGINATION_MAX_PAGES, PageBreak,
    PageGeometry, PaginateOptions, PaginationError, PaginationResult, StackPlacement, paginate,
    same_breaks,
};
use crate::workspace::{LayoutSettings, PaginationMode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaginationFallback {
    Continuous,
    TooManyBlocks,
    UnsupportedColumns,
    InvalidMeasurement,
    /// Original CSS can shorten a paragraph after a spacer clears its float,
    /// removing that spacer and restoring the longer paragraph. Refuse an
    /// alternating page/shape plan rather than publishing mismatched bounds.
    UnstableFloatGeometry,
}

const MAX_FLOAT_MEASUREMENTS: usize = 8;

#[derive(Clone, Debug, PartialEq)]
pub struct PaginationInfo {
    pub generation: u64,
    pub page_count: usize,
    pub geometry: PageGeometry,
    pub active: bool,
    pub fallback: Option<PaginationFallback>,
    /// Mirrors Source's capped count. An oversized suffix can still extend
    /// beyond the last painted sheet; this must not be reported as fitting.
    pub page_limit_reached: bool,
    pub content_width_px: f32,
    pub editor_height_px: f32,
}

impl PaginationInfo {
    pub fn chrome_geometry(&self) -> Option<crate::page_furniture::PageChromeGeometry> {
        self.active
            .then_some(crate::page_furniture::PageChromeGeometry {
                page_count: self.page_count,
                page_height_px: self.geometry.page_h as f32,
                gap_px: self.geometry.gap as f32,
                margins: crate::page_furniture::PageMarginsPx {
                    left: self.geometry.margin_left as f32,
                    right: self.geometry.margin_right as f32,
                    top: self.geometry.margin_top as f32,
                    bottom: self.geometry.margin_bottom as f32,
                },
            })
    }
}

/// Root adjusts its actual ScrollHandle by this delta only while the owner,
/// generation, revision and selection still match. The engine never scrolls
/// an assumed ancestor or changes selection to stabilize the view.
#[derive(Clone, Debug, PartialEq)]
pub struct PaginationScrollAnchor {
    pub generation: u64,
    pub revision: u64,
    pub selection: Selection,
    pub delta_y: Pixels,
}

#[derive(Clone, Debug)]
struct Configuration {
    layout: Arc<LayoutSettings>,
    geometry: PageGeometry,
    width: Pixels,
    tail_height: f64,
}

impl PartialEq for Configuration {
    fn eq(&self, other: &Self) -> bool {
        self.geometry == other.geometry
            && self.width == other.width
            && self.tail_height == other.tail_height
            && (Arc::ptr_eq(&self.layout, &other.layout) || self.layout == other.layout)
    }
}

#[derive(Clone, Copy)]
struct AnchorBefore {
    revision: u64,
    selection: Selection,
    top: Pixels,
}

#[derive(Default)]
pub(super) struct PaginationState {
    config: Option<Configuration>,
    published: Option<PaginationInfo>,
    pending_anchor: Option<AnchorBefore>,
    scroll_anchor: Option<PaginationScrollAnchor>,
    next_generation: Cell<u64>,
    latest_generation: Cell<u64>,
    latest_info: RefCell<Option<PaginationInfo>>,
    latest_result: RefCell<Option<PaginationResult>>,
    latest_placement: RefCell<Option<Arc<StackPlacement>>>,
    cached_text_frame: RefCell<Option<(FrameKey, Arc<FramePlan>)>>,
    last_frame: RefCell<Option<(FrameKey, Arc<FramePlan>)>>,
    refresh_generation: u64,
}

impl RichEditorView {
    /// The host supplies the exact logical column width after page padding.
    /// Sheet mode has a physical width and may scroll horizontally. Passing
    /// None restores the existing continuous element and preserves history.
    pub fn set_pagination_layout(
        &mut self,
        layout: Option<LayoutSettings>,
        content_width_px: f32,
        tail_height_px: f32,
        cx: &mut Context<Self>,
    ) {
        let next = layout.map(|layout| Configuration {
            geometry: PageGeometry::from_layout(&layout, f64::from(theme::REM_PX), PAGE_GAP_REM),
            layout: Arc::new(layout),
            width: px(content_width_px),
            tail_height: f64::from(tail_height_px),
        });
        if self.pagination.config == next {
            return;
        }
        self.capture_pagination_anchor();
        self.pagination.config = next;
        self.pagination.published = None;
        self.pagination.scroll_anchor = None;
        *self.pagination.latest_info.borrow_mut() = None;
        *self.pagination.latest_result.borrow_mut() = None;
        *self.pagination.latest_placement.borrow_mut() = None;
        *self.pagination.cached_text_frame.borrow_mut() = None;
        *self.pagination.last_frame.borrow_mut() = None;
        cx.notify();
    }

    /// Refresh after a font/image/diagram or measured collected-note change.
    /// No document/history transaction is emitted by this presentation method.
    pub fn refresh_pagination(&mut self, cx: &mut Context<Self>) {
        self.capture_pagination_anchor();
        self.pagination.refresh_generation = self.pagination.refresh_generation.wrapping_add(1);
        *self.pagination.cached_text_frame.borrow_mut() = None;
        *self.pagination.last_frame.borrow_mut() = None;
        cx.notify();
    }

    pub fn pagination_info(&self) -> Option<PaginationInfo> {
        self.pagination.published.clone()
    }

    pub fn pagination_placement(&self) -> Option<Arc<StackPlacement>> {
        self.pagination.latest_placement.borrow().clone()
    }

    pub(super) fn pagination_min_height(&self) -> Pixels {
        self.pagination
            .config
            .as_ref()
            .filter(|config| {
                enabled(config) && self.document().nodes().len() <= PAGINATION_MAX_BLOCKS
            })
            // PageFlow's accepted plan owns its exact active content minimum
            // or inactive natural minimum. Applying a second sheet minimum
            // here would leave a first-frame fallback taller than its plan.
            .map_or(px(400.), |_| px(0.))
    }

    pub fn pagination_scroll_anchor(&self, generation: u64) -> Option<PaginationScrollAnchor> {
        self.pagination
            .scroll_anchor
            .as_ref()
            .filter(|anchor| anchor.generation == generation)
            .cloned()
    }

    /// Read by block image styling before the actual image is measured.
    pub(super) fn pagination_image_max_height(&self) -> Option<f32> {
        let config = self.pagination.config.as_ref()?;
        (enabled(config) && self.document().nodes().len() <= PAGINATION_MAX_BLOCKS)
            .then_some(config.geometry.content_h as f32)
    }

    fn capture_pagination_anchor(&mut self) {
        self.pagination.pending_anchor = self.caret_bounds().map(|bounds| AnchorBefore {
            revision: self.revision(),
            selection: self.selection(),
            top: bounds.top(),
        });
    }

    /// Called before clearing the previous frame's measured block cache.
    pub(super) fn prepare_pagination_frame(&mut self) {
        if self.pagination.pending_anchor.is_none() {
            self.capture_pagination_anchor();
        }
    }

    /// Continuous/fallback frames retain the established element tree. Their
    /// publication is deferred until that tree has populated its real bounds.
    pub(super) fn finish_pagination_frame(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(mut info) = self
            .pagination
            .latest_info
            .borrow()
            .clone()
            .filter(|info| !info.active)
        else {
            return;
        };
        if self.pagination.published.as_ref() == Some(&info) {
            return;
        }
        let generation = self.pagination.next_generation.get().wrapping_add(1);
        self.pagination.next_generation.set(generation);
        self.pagination.latest_generation.set(generation);
        info.generation = generation;
        let revision = self.revision();
        let config = self.pagination.config.clone();
        let view = cx.entity().downgrade();
        window.defer(cx, move |_, cx| {
            let _ = view.update(cx, |view, cx| {
                if view.revision() != revision
                    || view.pagination.config != config
                    || view.pagination.latest_generation.get() != generation
                {
                    return;
                }
                view.publish_pagination(info, cx);
            });
        });
    }

    fn publish_pagination(&mut self, info: PaginationInfo, cx: &mut Context<Self>) {
        self.pagination.scroll_anchor = self.pagination.pending_anchor.take().and_then(|before| {
            if before.revision != self.revision() || before.selection != self.selection() {
                return None;
            }
            let delta_y = self.caret_bounds()?.top() - before.top;
            (delta_y.abs() > px(1.)).then_some(PaginationScrollAnchor {
                generation: info.generation,
                revision: before.revision,
                selection: before.selection,
                delta_y,
            })
        });
        if self.pagination.published.as_ref() != Some(&info) {
            let generation = info.generation;
            self.pagination.published = Some(info);
            cx.emit(RichEditorEvent::PaginationChanged { generation });
        }
    }
}

fn enabled(config: &Configuration) -> bool {
    config.layout.resolve_page_setup().pagination == PaginationMode::Paginated
        && config.layout.resolve_columns() == 1
        && f32::from(config.width).is_finite()
        && config.width > px(0.)
        && config.tail_height.is_finite()
        && config.tail_height >= 0.
        && paginate(&[], config.geometry, PaginateOptions::default()).is_ok()
}

/// Shared by the old fractional flow and the page frame. The continuous
/// adapter's layout/caches remain untouched; page consumers cannot accidentally
/// retrieve an unshifted text bound while dragging uses the shifted outer box.
#[derive(Clone)]
pub(super) enum BlockPlacement {
    Continuous(text_flow::BlockPlacement),
    Page {
        frame: Rc<FramePlacement>,
        index: usize,
    },
}

impl From<text_flow::BlockPlacement> for BlockPlacement {
    fn from(placement: text_flow::BlockPlacement) -> Self {
        Self::Continuous(placement)
    }
}

impl BlockPlacement {
    pub(super) fn content(&self) -> Option<(Bounds<Pixels>, Arc<ParagraphLayout>)> {
        match self {
            Self::Continuous(placement) => placement.content(),
            Self::Page { frame, index } => {
                let plan = frame.plan.borrow();
                let block = plan.as_ref()?.blocks.get(*index)?;
                Some((
                    Bounds::new(frame.origin.get() + block.bounds.origin, block.bounds.size),
                    block.layout.as_ref()?.clone(),
                ))
            }
        }
    }

    pub(super) fn outer(&self) -> Option<Bounds<Pixels>> {
        match self {
            Self::Continuous(placement) => placement.outer(),
            Self::Page { frame, index } => {
                let plan = frame.plan.borrow();
                let block = plan.as_ref()?.blocks.get(*index)?;
                Some(Bounds::new(
                    frame.origin.get() + block.outer.origin,
                    block.outer.size,
                ))
            }
        }
    }

    pub(super) fn measured_layout(&self) -> Option<Arc<ParagraphLayout>> {
        match self {
            Self::Continuous(placement) => placement.measured_layout(),
            Self::Page { frame, index } => frame
                .plan
                .borrow()
                .as_ref()?
                .blocks
                .get(*index)?
                .layout
                .clone(),
        }
    }
}

#[derive(Default)]
pub(super) struct FramePlacement {
    plan: RefCell<Option<Arc<FramePlan>>>,
    origin: Cell<Point<Pixels>>,
}

struct Entry {
    node: Node,
    pos: usize,
    block: Option<Arc<RichBlock>>,
    initial: bool,
}

struct FrameBlock {
    bounds: Bounds<Pixels>,
    outer: Bounds<Pixels>,
    layout: Option<Arc<ParagraphLayout>>,
    /// Native roots can have a computed margin offset. Preserve horizontal
    /// centering; compensate its Y offset once when using Source stack tops.
    child_offset: Point<Pixels>,
    ornament: Option<(ShapedLine, Point<Pixels>)>,
    carry: FloatReservation,
}

struct FramePlan {
    width: Pixels,
    extent: Size<Pixels>,
    blocks: Vec<FrameBlock>,
    placement: Arc<StackPlacement>,
    info: PaginationInfo,
    forced_labels: Vec<ForcedLabel>,
    float_measurements: usize,
    opening_scope: Arc<[Node]>,
}

#[derive(Clone, Copy)]
struct OpeningFloat {
    top: f64,
    reservation: FloatReservation,
}

impl OpeningFloat {
    fn before(self, top: f64) -> FloatReservation {
        let height = self.reservation.height - px((top - self.top) as f32);
        if height <= px(0.) {
            FloatReservation::default()
        } else {
            FloatReservation {
                width: self.reservation.width,
                height,
            }
        }
    }
}

/// Incremental Source natural-stack recurrence. Keeping previous updated
/// metrics here means a reflowed paragraph immediately affects the next one;
/// it does not leave a stale top vector in the final carry/IME layout.
fn next_top(previous: Option<(&BlockMetric, f64)>, current: &BlockMetric) -> f64 {
    let margin_top = if current.forced_break {
        0.
    } else {
        current.margin_top
    };
    previous.map_or(margin_top, |(previous, top)| {
        if previous.forced_break {
            top
        } else {
            top + previous.height + previous.margin_bottom.max(margin_top)
        }
    })
}

#[derive(Clone, PartialEq)]
struct FrameKey {
    revision: u64,
    config: Configuration,
    opening: OpeningInitial,
    atom_revision: u64,
    inline_math: Option<Arc<super::math_source_flow::InlineMathReservation>>,
    language: Arc<str>,
    ink: u32,
    refresh_generation: u64,
}

impl FrameKey {
    fn same_context(&self, other: &Self) -> bool {
        self.config == other.config
            && self.opening == other.opening
            && self.atom_revision == other.atom_revision
            && self.inline_math == other.inline_math
            && self.language == other.language
            && self.ink == other.ink
            && self.refresh_generation == other.refresh_generation
    }
}

struct ForcedLabel {
    origin: Point<Pixels>,
    width: Pixels,
    tracking: TrackedText,
}

fn ordinary_text(node: &Node) -> bool {
    node.as_element().is_some_and(|element| {
        matches!(element.kind, NodeKind::Paragraph | NodeKind::Heading(1..=6))
            && element
                .shell
                .attr("data-indent")
                .is_none_or(|indent| indent.parse::<f32>().is_ok_and(|indent| indent == 0.))
    })
}

/// These are the current native outer styles from render_node_content, not
/// character-count estimates. Border/padding/controls are measured natively.
fn margins(node: &Node) -> (f64, f64) {
    let Some(element) = node.as_element() else {
        return (0., 0.);
    };
    if element.is_text_block {
        let (after, before) = paragraph_margins(node);
        return (f64::from(before), f64::from(after));
    }
    let value = match element.kind {
        NodeKind::PageBreak => 0.,
        NodeKind::Image => 25.2,
        NodeKind::Math(_) | NodeKind::Mermaid => 16.,
        NodeKind::HorizontalRule => 18.,
        NodeKind::BlockQuote => 27.,
        NodeKind::List(_) => 8.,
        NodeKind::RawTypst(_) => 12.,
        _ => 0.,
    };
    (value, value)
}

pub(super) fn render_nodes(
    nodes: &[Node],
    first_paragraph: Option<usize>,
    renderer: &RichRender<'_>,
) -> Vec<AnyElement> {
    let Some(config) = renderer.state.pagination.config.as_ref() else {
        return text_flow::render_nodes(nodes, first_paragraph, renderer);
    };
    let fallback = if nodes.len() > PAGINATION_MAX_BLOCKS {
        Some(PaginationFallback::TooManyBlocks)
    } else if config.layout.resolve_page_setup().pagination == PaginationMode::Continuous {
        Some(PaginationFallback::Continuous)
    } else if config.layout.resolve_columns() != 1 {
        Some(PaginationFallback::UnsupportedColumns)
    } else if !enabled(config)
        || nodes.iter().any(|node| {
            let (before, after) = margins(node);
            !before.is_finite() || !after.is_finite()
        })
    {
        Some(PaginationFallback::InvalidMeasurement)
    } else {
        None
    };
    if let Some(fallback) = fallback {
        publish_continuous(renderer, config, fallback);
        return text_flow::render_nodes(nodes, first_paragraph, renderer);
    }
    let frame = Rc::new(FramePlacement::default());
    let mut entries = Vec::with_capacity(nodes.len());
    let mut children = Vec::with_capacity(nodes.len());
    let mut pos = 0;
    for (index, node) in nodes.iter().enumerate() {
        let initial = first_paragraph == Some(index);
        let block = ordinary_text(node).then(|| renderer.state.cached_block(node, vec![index]));
        let child = if block.is_some() {
            render_node_with_placement(
                node,
                vec![index],
                pos,
                renderer,
                initial,
                Some(BlockPlacement::Page {
                    frame: frame.clone(),
                    index,
                }),
            )
        } else if node
            .as_element()
            .is_some_and(|element| element.kind == NodeKind::PageBreak)
        {
            dragging::measure(
                node,
                vec![index],
                div().w_full().h(px(0.)).into_any_element(),
                renderer,
                None,
            )
        } else {
            render_node(node, vec![index], pos, renderer, initial)
        };
        entries.push(Entry {
            node: node.clone(),
            pos,
            block,
            initial,
        });
        children.push(child);
        pos += node.projection_len();
    }
    vec![
        PageFlowElement {
            view: renderer.entity.clone(),
            config: config.clone(),
            revision: renderer.state.revision(),
            entries,
            children,
            frame,
        }
        .into_any_element(),
    ]
}

fn publish_continuous(
    renderer: &RichRender<'_>,
    config: &Configuration,
    fallback: PaginationFallback,
) {
    let state = &renderer.state.pagination;
    *state.latest_info.borrow_mut() = Some(PaginationInfo {
        generation: state.latest_generation.get(),
        page_count: 1,
        geometry: config.geometry,
        active: false,
        fallback: Some(fallback),
        page_limit_reached: false,
        content_width_px: f32::from(config.width),
        editor_height_px: 0.,
    });
}

struct PageFlowElement {
    view: Entity<RichEditorView>,
    config: Configuration,
    revision: u64,
    entries: Vec<Entry>,
    children: Vec<AnyElement>,
    frame: Rc<FramePlacement>,
}

impl PageFlowElement {
    fn measure(&mut self, window: &mut Window, cx: &mut App) -> Arc<FramePlan> {
        let text_only = self.entries.iter().all(|entry| {
            entry.block.is_some()
                || entry
                    .node
                    .as_element()
                    .is_some_and(|element| element.kind == NodeKind::PageBreak)
        });
        let view = self.view.read(cx);
        let key = FrameKey {
            revision: self.revision,
            config: self.config.clone(),
            opening: view.opening,
            atom_revision: view.atom_revision,
            inline_math: view.inline_math_flow.frame_key(),
            language: view.language.clone(),
            ink: theme::palette(cx).ink,
            refresh_generation: view.pagination.refresh_generation,
        };
        if text_only
            && let Some((cached_key, frame)) = view.pagination.cached_text_frame.borrow().as_ref()
            && *cached_key == key
        {
            return frame.clone();
        }
        // Source measures with its accepted spacers still in the DOM. Seed
        // that presentation only when its complete opening prefix and shape
        // context are unchanged. This avoids reshaping an untouched cleared
        // paragraph through natural/carry variants on every unrelated edit.
        let seed: Vec<PageBreak> = view
            .pagination
            .last_frame
            .borrow()
            .as_ref()
            .filter(|(previous_key, frame)| {
                previous_key.same_context(&key)
                    && frame.info.active
                    && !frame.opening_scope.is_empty()
                    && frame.opening_scope.len() <= self.entries.len()
                    && frame
                        .opening_scope
                        .iter()
                        .zip(&self.entries)
                        .all(|(old, entry)| old.shares_storage_with(&entry.node))
            })
            .map(|(_, frame)| {
                frame
                    .placement
                    .spacers
                    .iter()
                    .filter(|spacer| spacer.before_block < frame.opening_scope.len())
                    .map(|spacer| PageBreak {
                        block_index: spacer.before_block,
                        pos: self.entries[spacer.before_block].pos,
                        height: spacer.end - spacer.start,
                        forced: spacer.forced,
                        page: spacer.page,
                    })
                    .collect()
            })
            .unwrap_or_default();
        let width = self.config.width;
        let mut metrics = Vec::with_capacity(self.entries.len());
        let mut blocks = Vec::with_capacity(self.entries.len());
        let mut natural_top = 0.;
        let mut opening = None::<OpeningFloat>;
        let mut extra = 0.;
        let mut spacer = 0;
        for (index, (entry, child)) in self.entries.iter().zip(&mut self.children).enumerate() {
            let (margin_top, margin_bottom) = margins(&entry.node);
            let forced_break = entry
                .node
                .as_element()
                .is_some_and(|element| element.kind == NodeKind::PageBreak);
            let keep_with_next = entry.node.as_element().is_some_and(|element| {
                matches!(element.kind, NodeKind::Heading(_))
                    || element.shell.attr("data-keep-with-next") == Some("true")
            });
            let mut metric = BlockMetric {
                pos: entry.pos,
                height: 0.,
                margin_top,
                margin_bottom,
                forced_break,
                keep_with_next,
            };
            natural_top = next_top(
                metrics.last().map(|previous| (previous, natural_top)),
                &metric,
            );
            while seed
                .get(spacer)
                .is_some_and(|page_break| page_break.block_index == index)
            {
                extra += seed[spacer].height;
                spacer += 1;
            }
            let rendered_top = natural_top + extra;
            let carry = entry
                .block
                .as_ref()
                .filter(|block| block.kind == NodeKind::Paragraph && !entry.initial)
                .and(opening)
                .map_or(FloatReservation::default(), |opening| {
                    opening.before(rendered_top)
                });
            let layout = entry.block.as_ref().map(|block| {
                self.view.read(cx).layout_block_with_carry(
                    block,
                    width,
                    entry.initial,
                    carry,
                    window,
                    cx,
                )
            });
            let (bounds, child_offset) = if let Some(layout) = &layout {
                (Bounds::new(Point::default(), layout.size), Point::default())
            } else {
                // This is before the frame's root layout, not a measured-layout
                // callback. The public native child API retains its own full
                // subtree, controls and final opaque border-box measurement.
                let id = child.request_layout(window, cx);
                child.layout_as_root(
                    size(AvailableSpace::Definite(width), AvailableSpace::MinContent),
                    window,
                    cx,
                );
                let bounds = window.layout_bounds(id);
                (bounds, point(px(0.), -bounds.origin.y))
            };
            let ornament = if entry
                .block
                .as_ref()
                .is_some_and(|block| block.kind == NodeKind::Heading(1))
            {
                let mut run = window.text_style().to_run("✦".len());
                run.color = rgb(theme::palette(cx).vermilion).into();
                let shape = window
                    .text_system()
                    .shape_line("✦".into(), px(16.), &[run], None);
                let origin = point((width - shape.width) / 2., bounds.size.height + px(4.8));
                Some((shape, origin))
            } else {
                None
            };
            let height = if forced_break {
                0.
            } else {
                f64::from(f32::from(bounds.size.height))
                    + if ornament.is_some() { 22.4 } else { 0. }
            };
            metric.height = height;
            metrics.push(metric);
            if entry.initial {
                opening = layout
                    .as_ref()
                    .filter(|layout| layout.float_reservation.height > px(0.))
                    .map(|layout| OpeningFloat {
                        top: rendered_top,
                        reservation: layout.float_reservation,
                    });
            } else if !forced_break
                && entry
                    .block
                    .as_ref()
                    .is_none_or(|block| block.kind != NodeKind::Paragraph)
            {
                // Preserve the established opaque-barrier contract. A zero
                // manual-break node alone is not a float-clearing barrier:
                // Source's actual inserted spacer consumes its remaining ink.
                opening = None;
            }
            blocks.push(FrameBlock {
                bounds: Bounds::new(point(bounds.origin.x, px(0.)), bounds.size),
                outer: Bounds::new(
                    point(bounds.origin.x, px(0.)),
                    size(bounds.size.width, px(height as f32)),
                ),
                layout,
                child_offset,
                ornament,
                carry,
            });
        }
        let options = PaginateOptions {
            tail_height: self.config.tail_height,
            max_pages: Some(PAGINATION_MAX_PAGES),
        };
        let computed = paginate(&metrics, self.config.geometry, options);
        let (mut result, mut fallback) = match computed {
            Ok(result) => (result, None),
            Err(
                PaginationError::InvalidGeometry
                | PaginationError::InvalidMetric { .. }
                | PaginationError::InvalidTail
                | PaginationError::UnrepresentableExtent,
            ) => (
                PaginationResult {
                    breaks: Vec::new(),
                    page_count: 1,
                },
                Some(PaginationFallback::InvalidMeasurement),
            ),
        };
        // Source does not dispatch sub-half-pixel spacer jitter. Adopt that
        // accepted furniture before resolving the float, so the final shape
        // consumes exactly the spacer heights all later consumers receive.
        let state = &self.view.read(cx).pagination;
        if fallback.is_none()
            && let Some(previous) = state.latest_result.borrow().as_ref()
            && state.latest_info.borrow().as_ref().is_some_and(|info| {
                info.geometry == self.config.geometry
                    && info.content_width_px == f32::from(width)
                    && info.fallback == fallback
            })
            && previous.page_count == result.page_count
            && same_breaks(&previous.breaks, &result.breaks)
        {
            result.breaks.clone_from(&previous.breaks);
        }
        let mut float_measurements = 1;
        if fallback.is_none()
            && self.entries.iter().zip(&blocks).any(|(entry, block)| {
                entry.initial
                    && block
                        .layout
                        .as_ref()
                        .is_some_and(|layout| layout.float_reservation.height > px(0.))
            })
        {
            let mut seen = vec![result.clone()];
            loop {
                let changed =
                    self.reflow_opening(&mut metrics, &mut blocks, &result, width, window, cx);
                if !changed {
                    break;
                }
                float_measurements += 1;
                let candidate = match paginate(&metrics, self.config.geometry, options) {
                    Ok(candidate) => candidate,
                    Err(_) => {
                        fallback = Some(PaginationFallback::InvalidMeasurement);
                        break;
                    }
                };
                if same_breaks(&result.breaks, &candidate.breaks) {
                    // Like Source's no-dispatch guard: retain accepted spacer
                    // heights, while publishing its fresh tail/page count.
                    result.page_count = candidate.page_count;
                    break;
                }
                if seen.contains(&candidate) || float_measurements >= MAX_FLOAT_MEASUREMENTS {
                    fallback = Some(PaginationFallback::UnstableFloatGeometry);
                    break;
                }
                seen.push(candidate.clone());
                result = candidate;
            }
        }
        if fallback.is_some() {
            result = PaginationResult {
                breaks: Vec::new(),
                page_count: 1,
            };
            // No stale page-specific line layout survives an inactive
            // fallback, including rejected measurements. Natural carry and
            // all input geometry agree again.
            self.reflow_opening(&mut metrics, &mut blocks, &result, width, window, cx);
        }
        let placement = Arc::new(StackPlacement::new(&metrics, &result.breaks));
        for (index, block) in blocks.iter_mut().enumerate() {
            let top = px(placement.rendered_tops[index] as f32);
            block.bounds.origin.y = top;
            block.outer.origin.y = top;
            block.child_offset.y += top;
            if let Some((_, origin)) = &mut block.ornament {
                origin.y += top;
            }
        }
        let terminal_margin = metrics
            .last()
            .filter(|metric| !metric.forced_break)
            .map_or(0., |metric| metric.margin_bottom);
        let height = (placement.ink_bottom(&metrics) + terminal_margin)
            .max(if fallback.is_none() {
                self.config.geometry.content_h
            } else {
                400.
            })
            .max(0.);
        let view = self.view.read(cx);
        let changed = view
            .pagination
            .latest_result
            .borrow()
            .as_ref()
            .is_none_or(|previous| {
                !same_breaks(&previous.breaks, &result.breaks)
                    || previous.page_count != result.page_count
            })
            || view
                .pagination
                .latest_info
                .borrow()
                .as_ref()
                .is_none_or(|previous| {
                    previous.geometry != self.config.geometry
                        || previous.content_width_px != f32::from(width)
                        || previous.editor_height_px != height as f32
                        || previous.fallback != fallback
                });
        let generation = if changed {
            let generation = view.pagination.next_generation.get().wrapping_add(1);
            view.pagination.next_generation.set(generation);
            view.pagination.latest_generation.set(generation);
            generation
        } else {
            view.pagination.latest_generation.get()
        };
        let info = PaginationInfo {
            generation,
            page_count: result.page_count,
            geometry: self.config.geometry,
            active: fallback.is_none(),
            fallback,
            page_limit_reached: result.page_count >= PAGINATION_MAX_PAGES,
            content_width_px: f32::from(width),
            editor_height_px: height as f32,
        };
        *view.pagination.latest_info.borrow_mut() = Some(info.clone());
        *view.pagination.latest_result.borrow_mut() = Some(result.clone());
        *view.pagination.latest_placement.borrow_mut() = Some(placement.clone());
        let forced_labels = placement
            .spacers
            .iter()
            .filter(|spacer| spacer.forced)
            .map(|spacer| {
                let mut run = window.text_style().to_run("PAGE BREAK".len());
                run.font = font(TYPEWRITER_FONT);
                run.color = rgb(theme::palette(cx).ink_muted).into();
                let shape =
                    window
                        .text_system()
                        .shape_line("PAGE BREAK".into(), px(8.8), &[run], None);
                let tracking = TrackedText::new(&shape, px(1.76));
                let label_width = shape.width + tracking.shift_at(shape.text.len());
                ForcedLabel {
                    origin: point(
                        (width - label_width) / 2.,
                        px(((spacer.start + spacer.end) / 2.) as f32) - px(7.92),
                    ),
                    width: label_width,
                    tracking,
                }
            })
            .collect();
        let opening_scope = self.opening_scope(&metrics, &blocks);
        let frame = Arc::new(FramePlan {
            width,
            extent: size(width, px(height as f32)),
            blocks,
            placement,
            info,
            forced_labels,
            float_measurements,
            opening_scope,
        });
        if text_only {
            *self.view.read(cx).pagination.cached_text_frame.borrow_mut() =
                Some((key.clone(), frame.clone()));
        }
        *self.view.read(cx).pagination.last_frame.borrow_mut() = Some((key, frame.clone()));
        frame
    }

    /// Walk the initial's contiguous paragraph section, reshaping only blocks
    /// whose carry changed. Updated heights and accepted spacers determine
    /// every later top immediately, using the same parent shape/cache path.
    fn reflow_opening(
        &self,
        metrics: &mut [BlockMetric],
        blocks: &mut [FrameBlock],
        result: &PaginationResult,
        width: Pixels,
        window: &mut Window,
        cx: &App,
    ) -> bool {
        let mut opening = None::<OpeningFloat>;
        let mut changed = false;
        let mut natural_top = 0.;
        let mut extra = 0.;
        let mut spacer = 0;
        for (index, entry) in self.entries.iter().enumerate() {
            natural_top = next_top(
                index
                    .checked_sub(1)
                    .map(|previous| (&metrics[previous], natural_top)),
                &metrics[index],
            );
            while result
                .breaks
                .get(spacer)
                .is_some_and(|page_break| page_break.block_index == index)
            {
                extra += result.breaks[spacer].height;
                spacer += 1;
            }
            let top = natural_top + extra;
            if entry.initial {
                let Some(layout) = blocks[index]
                    .layout
                    .as_ref()
                    .filter(|layout| layout.float_reservation.height > px(0.))
                else {
                    break;
                };
                opening = Some(OpeningFloat {
                    top,
                    reservation: layout.float_reservation,
                });
                continue;
            }
            let Some(active) = opening else {
                continue;
            };
            if metrics[index].forced_break {
                continue;
            }
            let Some(block) = entry
                .block
                .as_ref()
                .filter(|block| block.kind == NodeKind::Paragraph)
            else {
                break;
            };
            let carry = active.before(top);
            if blocks[index].carry != carry {
                let layout = self
                    .view
                    .read(cx)
                    .layout_block_with_carry(block, width, false, carry, window, cx);
                changed |= metrics[index].height != f64::from(f32::from(layout.size.height));
                metrics[index].height = f64::from(f32::from(layout.size.height));
                blocks[index].bounds.size = layout.size;
                blocks[index].outer.size = layout.size;
                blocks[index].layout = Some(layout);
                blocks[index].carry = carry;
            }
        }
        changed
    }

    /// A small persistent prefix guard permits accepted-spacer reuse after
    /// unrelated edits. Natural tops conservatively include paragraphs that
    /// might regain a float when a spacer changes; opaque barriers end scope.
    fn opening_scope(&self, metrics: &[BlockMetric], blocks: &[FrameBlock]) -> Arc<[Node]> {
        let mut opening = None::<OpeningFloat>;
        let mut natural_top = 0.;
        let mut end = 0;
        for (index, entry) in self.entries.iter().enumerate() {
            natural_top = next_top(
                index
                    .checked_sub(1)
                    .map(|previous| (&metrics[previous], natural_top)),
                &metrics[index],
            );
            if entry.initial {
                let Some(layout) = blocks[index]
                    .layout
                    .as_ref()
                    .filter(|layout| layout.float_reservation.height > px(0.))
                else {
                    break;
                };
                opening = Some(OpeningFloat {
                    top: natural_top,
                    reservation: layout.float_reservation,
                });
                end = index + 1;
            } else if let Some(opening) = opening {
                // This block's text cannot affect earlier float geometry once
                // its natural top is already beyond the initial. Guard the
                // preceding dependencies, not this unrelated tail node. Its
                // current margins/type are still measured and reconciled on
                // every changed frame before accepting the final plan.
                if opening.before(natural_top).height <= px(0.) {
                    break;
                }
                end = index + 1;
                if !metrics[index].forced_break
                    && entry
                        .block
                        .as_ref()
                        .is_none_or(|block| block.kind != NodeKind::Paragraph)
                {
                    break;
                }
            }
        }
        self.entries[..end]
            .iter()
            .map(|entry| entry.node.clone())
            .collect()
    }
}

impl IntoElement for PageFlowElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl gpui_kit::Element for PageFlowElement {
    type RequestLayoutState = Arc<FramePlan>;
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Arc<FramePlan>) {
        let plan = self.measure(window, cx);
        debug_assert!(plan.float_measurements <= MAX_FLOAT_MEASUREMENTS);
        *self.frame.plan.borrow_mut() = Some(plan.clone());
        // Paragraph child layout consumes the accepted plan. Opaque children
        // were measured above; neither path reflows at edge-snapped prepaint.
        for child in &mut self.children {
            child.layout_as_root(
                size(
                    AvailableSpace::Definite(plan.width),
                    AvailableSpace::MinContent,
                ),
                window,
                cx,
            );
        }
        let mut style = Style::default();
        style.size.width = plan.extent.width.into();
        style.size.height = plan.extent.height.into();
        style.flex_shrink = 0.;
        (window.request_layout(style, [], cx), plan)
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        plan: &mut Arc<FramePlan>,
        window: &mut Window,
        cx: &mut App,
    ) {
        debug_assert!(
            (bounds.size.width - plan.width).abs() <= px(1. / window.scale_factor() + 0.001)
        );
        self.frame.origin.set(bounds.origin);
        debug_assert_eq!(plan.placement.rendered_tops.len(), plan.blocks.len());
        for (child, block) in self.children.iter_mut().zip(&plan.blocks) {
            child.prepaint_at(bounds.origin + block.child_offset, window, cx);
        }
        let config = self.config.clone();
        let revision = self.revision;
        let info = plan.info.clone();
        let view = self.view.downgrade();
        window.defer(cx, move |_, cx| {
            let _ = view.update(cx, |view, cx| {
                if view.revision() != revision
                    || view.pagination.config.as_ref() != Some(&config)
                    || view.pagination.latest_generation.get() != info.generation
                {
                    return;
                }
                view.publish_pagination(info, cx);
            });
        });
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        plan: &mut Arc<FramePlan>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        for child in &mut self.children {
            child.paint(window, cx);
        }
        for block in &plan.blocks {
            if let Some((shape, origin)) = &block.ornament {
                let _ = shape.paint(
                    bounds.origin + *origin,
                    px(17.6),
                    TextAlign::Left,
                    None,
                    window,
                    cx,
                );
            }
        }
        for label in &plan.forced_labels {
            let origin = bounds.origin + label.origin;
            window.paint_quad(fill(
                Bounds::new(
                    origin - point(px(8.), px(0.)),
                    size(label.width + px(16.), px(15.84)),
                ),
                rgb(theme::palette(cx).page),
            ));
            for part in &label.tracking.parts {
                let _ = part.shape.paint(
                    origin + point(part.x, px(0.)),
                    px(15.84),
                    TextAlign::Left,
                    None,
                    window,
                    cx,
                );
            }
        }
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{AnyWindowHandle, ScrollHandle, TestAppContext, WindowBounds, WindowOptions};

    struct PageRoom {
        editor: Entity<RichEditorView>,
        scroll: ScrollHandle,
    }

    struct SheetRoom {
        editor: Entity<RichEditorView>,
        scroll: ScrollHandle,
        layout: LayoutSettings,
        tail_height: f32,
    }

    impl Render for SheetRoom {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            use crate::page_furniture::{
                PageCanvasGeometry, PageChromeGeometry, PageChromeText, PageMarginsPx,
                page_canvas_paginated,
            };
            let geometry = PageCanvasGeometry::resolve_paginated(
                &self.layout,
                f32::from(window.viewport_size().width),
                false,
            );
            let metrics = self
                .editor
                .read(cx)
                .pagination_info()
                .and_then(|info| info.chrome_geometry())
                .unwrap_or(PageChromeGeometry {
                    page_count: 1,
                    page_height_px: 1056.,
                    gap_px: 24.,
                    margins: PageMarginsPx {
                        left: 32.,
                        right: 32.,
                        top: 320.,
                        bottom: 320.,
                    },
                });
            let content = div().relative().w_full().child(self.editor.clone()).when(
                self.tail_height > 0.,
                |this| {
                    this.child(
                        div()
                            .id("pagination-measured-notes")
                            .test_support()
                            .mt(px(40.))
                            .pt(px(24.))
                            .border_t_1()
                            .child(
                                div()
                                    .h(px(self.tail_height - 25.))
                                    .child("One retained note."),
                            ),
                    )
                },
            );
            div()
                .id("sheet-scroll")
                .size_full()
                .overflow_y_scroll()
                .overflow_x_scroll()
                .track_scroll(&self.scroll)
                .child(page_canvas_paginated(
                    &self.layout,
                    geometry,
                    metrics,
                    PageChromeText::default(),
                    content.into_any_element(),
                    cx,
                ))
        }
    }

    impl Render for PageRoom {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
                .id("pagination-scroll")
                .size_full()
                .overflow_y_scroll()
                .track_scroll(&self.scroll)
                .child(div().w_full().p(px(20.)).child(self.editor.clone()))
        }
    }

    fn layout() -> LayoutSettings {
        LayoutSettings {
            pagination: Some(PaginationMode::Paginated),
            margin_top: Some(20.),
            margin_bottom: Some(20.),
            ..LayoutSettings::default()
        }
    }

    fn room(
        cx: &mut TestAppContext,
        html: &str,
        width: f32,
    ) -> (AnyWindowHandle, Entity<RichEditorView>, ScrollHandle) {
        room_with_events(cx, html, width, None)
    }

    fn room_with_events(
        cx: &mut TestAppContext,
        html: &str,
        width: f32,
        events: Option<Rc<RefCell<Vec<u64>>>>,
    ) -> (AnyWindowHandle, Entity<RichEditorView>, ScrollHandle) {
        let document = RichDocument::from_html(html).unwrap();
        cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            let scroll = ScrollHandle::new();
            let (handle, room) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                        Point::default(),
                        size(px(width + 40.), px(400.)),
                    ))),
                    ..Default::default()
                },
                cx,
                |_, cx| {
                    let editor = cx.new(|cx| {
                        let mut view = RichEditorView::new(document, cx);
                        view.set_opening_initial(
                            OpeningInitial {
                                mode: InitialMode::Off,
                                ..Default::default()
                            },
                            cx,
                        );
                        view.set_pagination_layout(Some(layout()), width, 0., cx);
                        view
                    });
                    // App::open_window draws and flushes its first frame
                    // before returning. Subscribe before that initial draw,
                    // then observe its actual deferred publication once.
                    if let Some(received) = events {
                        cx.subscribe(&editor, move |_, event: &RichEditorEvent, _| {
                            if let RichEditorEvent::PaginationChanged { generation } = event {
                                received.borrow_mut().push(*generation);
                            }
                        })
                        .detach();
                    }
                    cx.new(|_| PageRoom {
                        editor,
                        scroll: scroll.clone(),
                    })
                },
            )
            .unwrap();
            (handle, room.read(cx).editor.clone(), scroll)
        })
    }

    fn close(actual: Pixels, expected: f64) {
        assert!(
            (f64::from(f32::from(actual)) - expected).abs() < 0.002,
            "{actual} != {expected}"
        );
    }

    #[gpui_kit::test]
    fn shifted_frame_unifies_real_caret_ime_comment_note_and_drag_geometry(
        cx: &mut TestAppContext,
    ) {
        let html = concat!(
            "<p>First<br>two<br>three<br>four<br>five<br>six</p>",
            "<p>Second<br>two<br>three<br>four<br>five<br>six</p>",
            "<h2>Kept section</h2>",
            "<p>Body<br>two<br>three<br>four<br>five<br>six</p>",
            "<div data-type=\"page-break\" data-future=\"retain\"></div>",
            "<blockquote><p>Quote<br>second</p></blockquote>",
            "<table><tr><td><p>Cell 東京</p></td><td><p>Other</p></td></tr></table>",
            "<p><span data-comment-id=\"tail\" data-future=\"keep\">Tail 🦊é東京</span>",
            "<sup data-type=\"footnote\" data-endnote-text=\"kept note\"></sup><br>two<br>three<br>four<br>five<br>six</p>"
        );
        let (handle, view, scroll) = room(cx, html, 320.);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let (before, tail_start, first_layout, placement) = {
                let current = view.read(cx);
                let placement = current.pagination_placement().unwrap();
                let placed = current.placed.borrow();
                assert!(placement.spacers.len() >= 2);
                for index in [0, 1, 2, 3, 7] {
                    close(
                        placed[&vec![index]].bounds.top(),
                        20. + placement.rendered_tops[index],
                    );
                    assert_eq!(
                        placed[&vec![index]].bounds.size,
                        placed[&vec![index]].layout.size
                    );
                }
                let quote = current.block_bounds(&[5]).unwrap();
                close(quote.top(), 20. + placement.rendered_tops[5]);
                assert!(placed[&vec![5, 0]].bounds.top() >= quote.top());
                assert!(placed[&vec![5, 0]].bounds.bottom() <= quote.bottom());
                assert!(current.block_bounds(&[6]).unwrap().top() >= quote.bottom());
                (
                    current.snapshot(),
                    current.document().offset_of_node(&[7]).unwrap(),
                    placed[&vec![0]].layout.clone(),
                    placement,
                )
            };
            scroll.scroll_to_bottom();
            window.render_frame(cx);
            let point_at = {
                let current = view.read(cx);
                let placed = current.placed.borrow();
                let tail = &placed[&vec![7]];
                tail.bounds.origin + tail.layout.position(5).unwrap() + point(px(0.01), px(4.))
            };
            let root = window.find("twyne-rich-manuscript").bounds().origin;
            window.click_at("twyne-rich-manuscript", point_at - root, cx);
            assert_eq!(view.read(cx).selection(), Selection::caret(tail_start + 5));
            view.update(cx, |view, cx| {
                let utf16 = view.document().scalar_to_utf16(tail_start + 5).unwrap();
                let caret = view.caret_bounds().unwrap();
                assert_eq!(
                    view.bounds_for_range(utf16..utf16, Bounds::default(), window, cx)
                        .unwrap()
                        .origin,
                    caret.origin
                );
                assert_eq!(
                    view.character_index_for_point(point_at, window, cx),
                    Some(utf16)
                );
                view.replace_and_mark_text_in_range(
                    Some(utf16..utf16),
                    "に",
                    Some(1..1),
                    window,
                    cx,
                );
                view.replace_text_in_range(None, "日本🦊", window, cx);
            });
            window.render_frame(cx);
            assert!(Arc::ptr_eq(
                &first_layout,
                &view.read(cx).placed.borrow()[&vec![0]].layout
            ));
            window.press("ctrl-z", cx);
            window.render_frame(cx);
            assert_eq!(view.read(cx).document(), &before);
            assert_eq!(view.read(cx).selection(), Selection::caret(tail_start + 5));
            assert!(!view.read(cx).can_undo());
            let current = view.read(cx);
            let mark = current.comment_anchor_bounds("tail").unwrap();
            let tail_top = current.placed.borrow()[&vec![7]].bounds.top();
            assert!(mark[0][0].top() >= tail_top);
            let note = current.note_references().last().unwrap().clone();
            assert!(current.note_bounds(&note).unwrap().top() >= tail_top - px(10.));
            scroll.set_offset(point(px(0.), px(40. - placement.rendered_tops[2] as f32)));
            window.render_frame(cx);
            window.click("twyne-section-drag-2", cx);
            window.press("enter", cx);
            assert!(view.read(cx).is_dragging());
            window.press("escape", cx);
            assert!(!view.read(cx).is_dragging());
            assert_eq!(view.read(cx).document(), &before);
            assert!(!view.read(cx).can_undo());
            let focus = view.read(cx).focus.clone();
            window.focus(&focus, cx);
            view.update(cx, |view, cx| {
                view.set_selection(Selection::new(tail_start + 8, tail_start), cx)
                    .unwrap()
            });
            window.press("ctrl-c", cx);
            assert_eq!(
                cx.read_from_clipboard().unwrap().text().as_deref(),
                Some("Tail 🦊é")
            );
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn width_reflow_and_continuous_restore_preserve_tree_and_final_scroll_extent(
        cx: &mut TestAppContext,
    ) {
        let html = "<p data-future=\"keep\">A measured paragraph with enough original words to wrap differently across narrow and wider columns. 東京 🦊 é.</p>".repeat(40);
        let (handle, view, scroll) = room(cx, &html, 320.);
        let before = view.read_with(cx, |view, _| view.snapshot());
        for width in [320., 240., 320.] {
            view.update(cx, |view, cx| {
                view.set_pagination_layout(Some(layout()), width, 0., cx)
            });
            cx.simulate_window_resize(handle, size(px(width + 40.), px(400.)));
            cx.update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                let current = view.read(cx);
                let info = current.pagination.latest_info.borrow().clone().unwrap();
                let placed = current.placed.borrow();
                close(placed[&vec![39]].bounds.size.width, f64::from(width));
                let scale = window.scale_factor();
                // This frame requests a definite Style height. The pinned
                // GPUI AbsoluteLength conversion rounds to the nearest device
                // pixel; measured-size callbacks' outward ceil is a separate
                // path. Retain exact scroll extent and final-ink reachability.
                let expected = (info.editor_height_px * scale).round() / scale + 40. - 400.;
                close(scroll.max_offset().y, f64::from(expected));
                assert_eq!(current.document(), &before);
                assert!(!current.can_undo());
                drop(placed);
                scroll.scroll_to_bottom();
                window.render_frame(cx);
                let current = view.read(cx);
                let placed = current.placed.borrow();
                assert!(placed[&vec![39]].bounds.bottom() <= scroll.bounds().bottom() + px(0.5));
            })
            .unwrap();
        }
        view.update(cx, |view, cx| {
            view.set_pagination_layout(None, 320., 0., cx)
        });
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let current = view.read(cx);
            assert!(current.pagination_placement().is_none());
            assert!(current.pagination_info().is_none());
            assert_eq!(current.document(), &before);
            assert!(!current.can_undo());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn terminal_manual_break_and_read_only_reflow_keep_an_empty_final_sheet(
        cx: &mut TestAppContext,
    ) {
        let html = "<p>Before</p><div data-type=\"page-break\" data-page-break=\"true\" data-future=\"keep\"></div>";
        let (handle, view, _) = room(cx, html, 320.);
        let before = view.read_with(cx, |view, _| view.snapshot());
        view.update(cx, |view, cx| view.set_read_only(true, cx));
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let current = view.read(cx);
            let result = current.pagination.latest_result.borrow();
            let result = result.as_ref().unwrap();
            assert_eq!(result.page_count, 2);
            assert_eq!(result.breaks.len(), 1);
            assert!(result.breaks[0].forced);
            assert_eq!(current.block_bounds(&[1]).unwrap().size.height, px(0.));
            assert_eq!(current.document(), &before);
            assert!(!current.can_undo());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn measured_sheet_chrome_retains_physical_width_and_an_empty_last_sheet_extent(
        cx: &mut TestAppContext,
    ) {
        let document = RichDocument::from_html(
            "<p>Before</p><div data-type=\"page-break\" data-future=\"keep\"></div>",
        )
        .unwrap();
        let (handle, room, scroll) = cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            let scroll = ScrollHandle::new();
            let (handle, room) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                        Point::default(),
                        size(px(840.), px(400.)),
                    ))),
                    ..Default::default()
                },
                cx,
                |_, cx| {
                    cx.new(|cx| {
                        let settings = layout();
                        let editor = cx.new(|cx| {
                            let mut editor = RichEditorView::new(document, cx);
                            editor.set_opening_initial(
                                OpeningInitial {
                                    mode: InitialMode::Off,
                                    ..Default::default()
                                },
                                cx,
                            );
                            let width =
                                crate::page_furniture::PageCanvasGeometry::resolve_paginated(
                                    &settings, 840., false,
                                )
                                .content_width_px();
                            editor.set_pagination_layout(Some(settings.clone()), width, 0., cx);
                            editor
                        });
                        cx.subscribe(&editor, |_, _, _, cx| cx.notify()).detach();
                        SheetRoom {
                            editor,
                            scroll: scroll.clone(),
                            layout: settings,
                            tail_height: 0.,
                        }
                    })
                },
            )
            .unwrap();
            (handle, room, scroll)
        });
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .unwrap();
        cx.run_until_parked();
        let editor = room.read_with(cx, |room, _| room.editor.clone());
        for width in [840., 620., 840.] {
            cx.simulate_window_resize(handle, size(px(width), px(400.)));
            cx.update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                let canvas = window.find("manuscript-page-canvas").bounds();
                let first_sheet = window.find(("page-sheet", 0usize)).bounds();
                let last_sheet = window.find(("page-sheet", 1usize)).bounds();
                close(canvas.size.width, 816.);
                close(canvas.size.height, 2136.);
                close(first_sheet.size.height, 1056.);
                close(last_sheet.top() - first_sheet.top(), 1080.);
                close(last_sheet.bottom(), f64::from(f32::from(canvas.bottom())));
                close(scroll.max_offset().y, 1736.);
                assert!(editor.read(cx).pagination_info().unwrap().active);
                assert!(!editor.read(cx).can_undo());
                if width < 816. {
                    close(scroll.max_offset().x, 816. - f64::from(width));
                }
                scroll.scroll_to_bottom();
                window.render_frame(cx);
                close(
                    window.find(("page-sheet", 1usize)).bounds().bottom(),
                    f64::from(f32::from(scroll.bounds().bottom())),
                );
            })
            .unwrap();
        }
    }

    #[gpui_kit::test]
    fn short_ink_with_a_measured_tail_retains_source_minimum_and_one_sheet_overflow(
        cx: &mut TestAppContext,
    ) {
        let document = RichDocument::from_html(
            "<p>Short prose.<sup data-type=\"footnote\" data-endnote-text=\"One retained note.\"></sup></p>",
        )
        .unwrap();
        let before = document.clone();
        let (handle, room, scroll) = cx.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
            let scroll = ScrollHandle::new();
            let (handle, room) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                        Point::default(),
                        size(px(900.), px(400.)),
                    ))),
                    ..Default::default()
                },
                cx,
                |_, cx| {
                    cx.new(|cx| {
                        let settings = LayoutSettings {
                            pagination: Some(PaginationMode::Paginated),
                            ..LayoutSettings::default()
                        };
                        let width = crate::page_furniture::PageCanvasGeometry::resolve_paginated(
                            &settings, 900., false,
                        )
                        .content_width_px();
                        let editor = cx.new(|cx| {
                            let mut editor = RichEditorView::new(document, cx);
                            editor.set_opening_initial(
                                OpeningInitial {
                                    mode: InitialMode::Off,
                                    ..Default::default()
                                },
                                cx,
                            );
                            editor.set_pagination_layout(Some(settings.clone()), width, 0., cx);
                            editor
                        });
                        cx.subscribe(&editor, |_, _, _, cx| cx.notify()).detach();
                        SheetRoom {
                            editor,
                            scroll: scroll.clone(),
                            layout: settings,
                            tail_height: 85.,
                        }
                    })
                },
            )
            .unwrap();
            (handle, room, scroll)
        });
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let measured = window.find("pagination-measured-notes").bounds();
            close(measured.size.height, 85.);
            room.update(cx, |room, cx| {
                let width = crate::page_furniture::PageCanvasGeometry::resolve_paginated(
                    &room.layout,
                    900.,
                    false,
                )
                .content_width_px();
                room.editor.update(cx, |editor, cx| {
                    editor.set_pagination_layout(
                        Some(room.layout.clone()),
                        width,
                        f32::from(measured.size.height),
                        cx,
                    )
                });
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let editor = room.read(cx).editor.clone();
            let info = editor.read(cx).pagination_info().unwrap();
            assert_eq!(info.page_count, 1);
            assert!(info.active);
            close(px(info.editor_height_px), 1024.);
            close(
                window.find("manuscript-page-canvas").bounds().size.height,
                1181.,
            );
            close(
                window.find(("page-sheet", 0usize)).bounds().size.height,
                1056.,
            );
            close(scroll.max_offset().y, 781.);
            assert_eq!(editor.read(cx).document(), &before);
            assert!(!editor.read(cx).can_undo());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn unchanged_large_text_frame_is_cached_and_does_not_republish_on_caret_frames(
        cx: &mut TestAppContext,
    ) {
        let html = (0..1000)
            .map(|index| format!("<p data-future=\"keep\">Entry {index}</p>"))
            .collect::<String>();
        let cold_start = Instant::now();
        let events = Rc::new(RefCell::new(Vec::new()));
        let (handle, view, _) = room_with_events(cx, &html, 320., Some(events.clone()));
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .unwrap();
        cx.run_until_parked();
        let cold = cold_start.elapsed();
        let (frame, first_layout, before) = view.read_with(cx, |view, _| {
            (
                view.pagination
                    .cached_text_frame
                    .borrow()
                    .as_ref()
                    .unwrap()
                    .1
                    .clone(),
                view.placed.borrow()[&vec![0]].layout.clone(),
                view.snapshot(),
            )
        });
        assert_eq!(events.borrow().len(), 1);
        let warm_start = Instant::now();
        for index in [0, 50, 999, 0] {
            view.update(cx, |view, cx| {
                let offset = view.document().offset_of_node(&[index]).unwrap();
                view.set_selection(Selection::caret(offset), cx).unwrap();
            });
            cx.update_window(handle, |_, window, cx| window.render_frame(cx))
                .unwrap();
            cx.run_until_parked();
            view.read_with(cx, |view, _| {
                assert!(Arc::ptr_eq(
                    &frame,
                    &view
                        .pagination
                        .cached_text_frame
                        .borrow()
                        .as_ref()
                        .unwrap()
                        .1
                ));
                assert_eq!(view.document(), &before);
                assert!(!view.can_undo());
            });
            assert_eq!(events.borrow().len(), 1);
        }
        let warm = warm_start.elapsed();
        let typing_start = Instant::now();
        view.update(cx, |view, cx| {
            view.set_selection(Selection::caret(view.document().text_len() - 1), cx)
                .unwrap()
        });
        cx.update_window(handle, |_, window, cx| {
            let focus = view.read(cx).focus.clone();
            window.focus(&focus, cx);
            for _ in 0..20 {
                window.input(" x", cx);
                window.render_frame(cx);
            }
        })
        .unwrap();
        cx.run_until_parked();
        let typing = typing_start.elapsed();
        view.read_with(cx, |view, _| {
            assert!(Arc::ptr_eq(
                &first_layout,
                &view.placed.borrow()[&vec![0]].layout
            ))
        });
        eprintln!(
            "Pagination test-platform boundary (1000 paragraphs): cold={cold:?}; 4 cached caret frames={warm:?}; 20 two-character input/frame samples={typing:?}. These are not X11 GPU/browser or latency-percentile measurements."
        );
    }

    fn opening_metrics(
        view: &RichEditorView,
        width: Pixels,
        window: &mut Window,
        cx: &App,
    ) -> (f64, f64, f64) {
        let first = view.cached_block(&view.document().nodes()[0], vec![0]);
        let second = view.cached_block(&view.document().nodes()[1], vec![1]);
        let opening = view.layout_block_with_carry(
            &first,
            width,
            true,
            FloatReservation::default(),
            window,
            cx,
        );
        let gap = margins(&first.node).1.max(margins(&second.node).0);
        let top = f64::from(f32::from(opening.size.height)) + gap;
        let carry = OpeningFloat {
            top: 0.,
            reservation: opening.float_reservation,
        }
        .before(top);
        let carried = view.layout_block_with_carry(&second, width, false, carry, window, cx);
        let full = view.layout_block_with_carry(
            &second,
            width,
            false,
            FloatReservation::default(),
            window,
            cx,
        );
        (
            top,
            f64::from(f32::from(carried.size.height)),
            f64::from(f32::from(full.size.height)),
        )
    }

    fn short_height_layout(content_height: f64) -> LayoutSettings {
        let margin = (1056. - content_height) / (2. * f64::from(theme::REM_PX));
        LayoutSettings {
            pagination: Some(PaginationMode::Paginated),
            margin_top: Some(margin),
            margin_bottom: Some(margin),
            ..LayoutSettings::default()
        }
    }

    /// Select a real test-platform wrap threshold at setup, without depending
    /// on its synthetic font's glyph advances. The eventual document remains
    /// unchanged throughout the resize/edit/undo checks below.
    fn prepare_float_fixture(
        view: &Entity<RichEditorView>,
        window: &mut Window,
        cx: &mut App,
        widths: &[f32],
        manual_tail: bool,
    ) {
        for count in 0..16 {
            let body = format!("Following 🦊é東京{}.", " word".repeat(count));
            let tail = if manual_tail {
                "<div data-type=\"page-break\" data-future=\"manual\"></div><p>After the deliberate break.</p><p>Unrelated tail.</p>"
            } else {
                ""
            };
            let document = RichDocument::from_html(&format!(
                "<p data-future=\"keep\">The</p><p><span data-comment-id=\"float-note\" data-future=\"keep\"><em>{body}</em></span></p>{tail}"
            ))
            .unwrap();
            view.update(cx, |view, cx| view.set_document(document, false, cx));
            let fits = widths.iter().all(|width| {
                let (top, carried, full) = opening_metrics(view.read(cx), px(*width), window, cx);
                carried > full && top + full > carried
            });
            if fits {
                return;
            }
        }
        panic!("No actual native float wrap threshold in the bounded fixture corpus");
    }

    #[gpui_kit::test]
    fn opening_float_uses_shared_spacer_geometry_for_resize_caret_ime_and_undo(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, scroll) = room(cx, "<p>The</p><p>Fixture setup.</p>", 320.);
        view.update(cx, |view, cx| {
            view.set_opening_initial(OpeningInitial::default(), cx)
        });
        cx.update_window(handle, |_, window, cx| {
            prepare_float_fixture(&view, window, cx, &[320., 240.], true);
            window.render_frame(cx);
            let current = view.read(cx);
            let placed = current.placed.borrow();
            let first = &placed[&vec![0]].layout;
            let second = &placed[&vec![1]].layout;
            assert!(second.float_reservation.height > px(0.));
            close(
                second.pieces[0].origin.x,
                f64::from(f32::from(first.float_reservation.width)),
            );
            assert!(placed[&vec![3]].layout.float_reservation == FloatReservation::default());
        })
        .unwrap();
        let before = view.read_with(cx, |view, _| view.snapshot());

        for width in [320., 240., 320.] {
            cx.simulate_window_resize(handle, size(px(width + 40.), px(400.)));
            cx.update_window(handle, |_, window, cx| {
                // Thresholds come from the actual common paragraph shaper,
                // not a guessed text height or paint/baseline adjustment.
                let (top, carried, full) =
                    view.read_with(cx, |view, cx| opening_metrics(view, px(width), window, cx));
                assert!(
                    carried > full,
                    "Fixture must cross a real float wrap threshold"
                );
                let full_total = top + full;
                assert!(full_total > carried, "Stable atomic threshold must exist");
                let content_height = (carried + full_total) / 2.;
                view.update(cx, |view, cx| {
                    view.set_pagination_layout(
                        Some(short_height_layout(content_height)),
                        width,
                        0.,
                        cx,
                    )
                });
                window.render_frame(cx);
                let (placement, cleared, start) = {
                    let current = view.read(cx);
                    let placement = current.pagination_placement().unwrap();
                    assert!(
                        placement
                            .spacers
                            .iter()
                            .any(|spacer| spacer.before_block == 1)
                    );
                    assert!(
                        current
                            .pagination
                            .latest_info
                            .borrow()
                            .as_ref()
                            .unwrap()
                            .active
                    );
                    let placed = current.placed.borrow();
                    assert!(
                        placed[&vec![1]].layout.float_reservation == FloatReservation::default()
                    );
                    assert!(
                        placed[&vec![3]].layout.float_reservation == FloatReservation::default()
                    );
                    close(placed[&vec![1]].layout.pieces[0].origin.x, 0.);
                    (
                        placement,
                        placed[&vec![1]].layout.clone(),
                        current.document().offset_of_node(&[1]).unwrap(),
                    )
                };
                scroll.set_offset(point(px(0.), px(40. - placement.rendered_tops[1] as f32)));
                window.render_frame(cx);
                let point_at = {
                    let current = view.read(cx);
                    let placed = current.placed.borrow();
                    placed[&vec![1]].bounds.origin
                        + placed[&vec![1]].layout.position(4).unwrap()
                        + point(px(0.01), px(4.))
                };
                let root = window.find("twyne-rich-manuscript").bounds().origin;
                window.click_at("twyne-rich-manuscript", point_at - root, cx);
                assert_eq!(view.read(cx).selection(), Selection::caret(start + 4));
                view.update(cx, |view, cx| {
                    let utf16 = view.document().scalar_to_utf16(start + 4).unwrap();
                    let caret = view.caret_bounds().unwrap();
                    assert_eq!(
                        view.bounds_for_range(utf16..utf16, Bounds::default(), window, cx)
                            .unwrap()
                            .origin,
                        caret.origin
                    );
                    assert_eq!(
                        view.character_index_for_point(point_at, window, cx),
                        Some(utf16)
                    );
                });
                let focus = view.read(cx).focus.clone();
                window.focus(&focus, cx);
                view.update(cx, |view, cx| {
                    view.set_selection(Selection::caret(view.document().text_len() - 1), cx)
                        .unwrap()
                });
                window.input(" x", cx);
                window.render_frame(cx);
                assert!(
                    Arc::ptr_eq(&cleared, &view.read(cx).placed.borrow()[&vec![1]].layout),
                    "Unrelated tail input must retain the cleared paragraph Arc"
                );
                window.press("ctrl-z", cx);
                window.render_frame(cx);
                assert_eq!(view.read(cx).document(), &before);
                assert!(!view.read(cx).can_undo());
            })
            .unwrap();
        }
    }

    #[gpui_kit::test]
    fn demonstrated_float_break_feedback_falls_back_once_with_coherent_natural_input(
        cx: &mut TestAppContext,
    ) {
        let (handle, view, _) = room(cx, "<p>The</p><p>Fixture setup.</p>", 320.);
        view.update(cx, |view, cx| {
            view.set_opening_initial(OpeningInitial::default(), cx)
        });
        let events = Rc::new(RefCell::new(Vec::new()));
        let received = events.clone();
        cx.update(|cx| {
            cx.subscribe(&view, move |_, event: &RichEditorEvent, _| {
                if let RichEditorEvent::PaginationChanged { generation } = event {
                    received.borrow_mut().push(*generation);
                }
            })
            .detach()
        });
        cx.update_window(handle, |_, window, cx| {
            prepare_float_fixture(&view, window, cx, &[320.], false);
            let before = view.read(cx).snapshot();
            let (top, carried, full) =
                view.read_with(cx, |view, cx| opening_metrics(view, px(320.), window, cx));
            assert!(carried > full);
            let lower = carried.max(top + full);
            let upper = top + carried;
            assert!(lower < upper);
            view.update(cx, |view, cx| {
                view.set_pagination_layout(
                    Some(short_height_layout((lower + upper) / 2.)),
                    320.,
                    0.,
                    cx,
                )
            });
            window.render_frame(cx);
            let current = view.read(cx);
            let info = current.pagination.latest_info.borrow().clone().unwrap();
            assert!(!info.active);
            assert_eq!(
                info.fallback,
                Some(PaginationFallback::UnstableFloatGeometry)
            );
            assert_eq!(info.page_count, 1);
            assert!(current.pagination_placement().unwrap().spacers.is_empty());
            assert!(
                current.placed.borrow()[&vec![1]]
                    .layout
                    .float_reservation
                    .height
                    > px(0.)
            );
            assert_eq!(current.document(), &before);
            assert!(!current.can_undo());
        })
        .unwrap();
        cx.run_until_parked();
        let count = events.borrow().len();
        assert_eq!(count, 1);
        for offset in [0, 1, 0] {
            view.update(cx, |view, cx| {
                view.set_selection(Selection::caret(offset), cx).unwrap()
            });
            cx.update_window(handle, |_, window, cx| window.render_frame(cx))
                .unwrap();
            cx.run_until_parked();
            assert_eq!(events.borrow().len(), count);
        }
    }
}
