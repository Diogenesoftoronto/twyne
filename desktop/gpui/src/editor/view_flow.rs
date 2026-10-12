//! Fractional top-level text flow. The framework measures the whole run once;
//! rich text paint, input and geometry caches share its exact frame placement.
//! Opaque containers retain their ordinary GPUI element/layout paths.

use std::cell::Cell;

use super::*;

struct FlowSpec {
    block: Arc<RichBlock>,
    initial: bool,
    before: Pixels,
    after: Pixels,
}

struct FrameBlock {
    content: Bounds<Pixels>,
    outer: Bounds<Pixels>,
    layout: Arc<ParagraphLayout>,
    ornament: Option<Ornament>,
}

struct Ornament {
    shape: ShapedLine,
    origin: Point<Pixels>,
}

struct FramePlan {
    width: Pixels,
    extent: Size<Pixels>,
    blocks: Vec<FrameBlock>,
}

#[derive(Default)]
struct FramePlacement {
    plan: RefCell<Option<Arc<FramePlan>>>,
    origin: Cell<Point<Pixels>>,
}

/// Only the ordinary text surface uses fractional bounds. Real native controls
/// keep the normal AnyElement dispatch/accessibility/edge-snapping path.
#[derive(Clone)]
pub(super) struct BlockPlacement {
    frame: Rc<FramePlacement>,
    index: usize,
}

impl BlockPlacement {
    pub(super) fn content(&self) -> Option<(Bounds<Pixels>, Arc<ParagraphLayout>)> {
        let plan = self.frame.plan.borrow();
        let block = plan.as_ref()?.blocks.get(self.index)?;
        Some((
            Bounds::new(
                self.frame.origin.get() + block.content.origin,
                block.content.size,
            ),
            block.layout.clone(),
        ))
    }

    pub(super) fn outer(&self) -> Option<Bounds<Pixels>> {
        let plan = self.frame.plan.borrow();
        let block = plan.as_ref()?.blocks.get(self.index)?;
        Some(Bounds::new(
            self.frame.origin.get() + block.outer.origin,
            block.outer.size,
        ))
    }

    pub(super) fn measured_layout(&self) -> Option<Arc<ParagraphLayout>> {
        let plan = self.frame.plan.borrow();
        let plan = plan.as_ref()?;
        plan.blocks
            .get(self.index)
            .map(|block| block.layout.clone())
    }
}

fn eligible(node: &Node) -> bool {
    let Some(element) = node.as_element() else {
        return false;
    };
    if !matches!(element.kind, NodeKind::Paragraph | NodeKind::Heading(1..=6)) {
        return false;
    }
    // Imported nonstandard indentation and negative/invalid spacing retain the
    // established opaque layout until their own source-backed contract is gated.
    if element
        .shell
        .attr("data-indent")
        .is_some_and(|value| value.parse::<f32>().is_ok_and(|value| value != 0.))
    {
        return false;
    }
    let (after, before) = paragraph_margins(node);
    after.is_finite() && before.is_finite() && after >= 0. && before >= 0.
}

pub(super) fn render_nodes(
    nodes: &[Node],
    first_paragraph: Option<usize>,
    renderer: &RichRender<'_>,
) -> Vec<AnyElement> {
    let mut children = Vec::new();
    let mut index = 0;
    let mut global_start = 0;
    while index < nodes.len() {
        if !eligible(&nodes[index]) {
            children.push(render_node(
                &nodes[index],
                vec![index],
                global_start,
                renderer,
                first_paragraph == Some(index),
            ));
            global_start += nodes[index].projection_len();
            index += 1;
            continue;
        }

        let frame = Rc::new(FramePlacement::default());
        let mut specs = Vec::new();
        let mut elements = Vec::new();
        let mut previous_after = px(renderer.state.previous_margin(&[index]));
        while index < nodes.len() && eligible(&nodes[index]) {
            let node = &nodes[index];
            let block = renderer.state.cached_block(node, vec![index]);
            let (after, before) = paragraph_margins(node);
            specs.push(FlowSpec {
                block,
                initial: first_paragraph == Some(index),
                before: (px(before) - previous_after).max(px(0.)),
                after: px(after),
            });
            let placement = BlockPlacement {
                frame: frame.clone(),
                index: elements.len(),
            };
            elements.push(render_node_with_placement(
                node,
                vec![index],
                global_start,
                renderer,
                first_paragraph == Some(index),
                Some(placement.into()),
            ));
            previous_after = px(after);
            global_start += node.projection_len();
            index += 1;
        }
        children.push(
            TextFlowElement {
                view: renderer.entity.clone(),
                specs: Arc::from(specs),
                frame,
                children: elements,
            }
            .into_any_element(),
        );
    }
    children
}

fn plan(
    specs: &[FlowSpec],
    view: &RichEditorView,
    width: Pixels,
    window: &mut Window,
    cx: &App,
) -> Arc<FramePlan> {
    let mut y = px(0.);
    let mut blocks = Vec::with_capacity(specs.len());
    for spec in specs {
        y += spec.before;
        let layout = view.layout_block(&spec.block, width, spec.initial, window, cx);
        let content = Bounds::new(point(px(0.), y), layout.size);
        y += layout.size.height;
        let ornament = if spec.block.kind == NodeKind::Heading(1) {
            let color = rgb(theme::palette(cx).vermilion).into();
            let mut text_run = window.text_style().to_run("✦".len());
            text_run.color = color;
            let shape = window
                .text_system()
                .shape_line("✦".into(), px(16.), &[text_run], None);
            let origin = point((width - shape.width) / 2., y + px(4.8));
            y += px(4.8 + 17.6);
            Some(Ornament { shape, origin })
        } else {
            None
        };
        blocks.push(FrameBlock {
            content,
            outer: Bounds::new(content.origin, size(width, y - content.origin.y)),
            layout,
            ornament,
        });
        y += spec.after;
    }
    Arc::new(FramePlan {
        width,
        extent: size(width, y),
        blocks,
    })
}

struct TextFlowElement {
    view: Entity<RichEditorView>,
    specs: Arc<[FlowSpec]>,
    frame: Rc<FramePlacement>,
    children: Vec<AnyElement>,
}

impl IntoElement for TextFlowElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl gpui_kit::Element for TextFlowElement {
    type RequestLayoutState = ();
    type PrepaintState = Arc<FramePlan>;

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
        _: &mut App,
    ) -> (LayoutId, ()) {
        let view = self.view.clone();
        let specs = self.specs.clone();
        let frame = self.frame.clone();
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.flex_shrink = 0.;
        let id = window.request_measured_layout(style, move |known, available, window, cx| {
            let width = known
                .width
                .or(match available.width {
                    AvailableSpace::Definite(width) => Some(width),
                    _ => None,
                })
                .unwrap_or(px(640.))
                .max(px(1.));
            let retained = frame
                .plan
                .borrow()
                .as_ref()
                .filter(|plan| plan.width == width)
                .cloned();
            let measured =
                retained.unwrap_or_else(|| plan(&specs, view.read(cx), width, window, cx));
            let result = measured.extent;
            *frame.plan.borrow_mut() = Some(measured);
            result
        });
        (id, ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Arc<FramePlan> {
        let measured = self
            .frame
            .plan
            .borrow()
            .as_ref()
            .cloned()
            .expect("Text flow must be measured before prepaint");
        // Absolute near/far edge snapping can change the wrapper width by at
        // most one device pixel. Reflowing at that width after layout would
        // invalidate the already allocated height at a word-wrap threshold.
        // Keep the measured logical width/rows/extent as one frame authority.
        debug_assert!(
            (measured.width - bounds.size.width).abs() <= px(1. / window.scale_factor() + 0.001),
            "Flow wrapper width must differ only by native edge snapping: {} vs {}",
            measured.width,
            bounds.size.width,
        );
        self.frame.origin.set(bounds.origin);
        for (child, block) in self.children.iter_mut().zip(&measured.blocks) {
            // Child root layout is deliberately outside the measured callback.
            // Native controls retain their real dispatch/accessibility traversal;
            // BlockElement obtains the exact content bounds from the frame plan.
            child.layout_as_root(
                size(
                    AvailableSpace::Definite(measured.width),
                    AvailableSpace::MinContent,
                ),
                window,
                cx,
            );
            child.prepaint_at(bounds.origin + block.outer.origin, window, cx);
        }
        measured
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        measured: &mut Arc<FramePlan>,
        window: &mut Window,
        cx: &mut App,
    ) {
        for child in &mut self.children {
            child.paint(window, cx);
        }
        for ornament in measured
            .blocks
            .iter()
            .filter_map(|block| block.ornament.as_ref())
        {
            let _ = ornament.shape.paint(
                bounds.origin + ornament.origin,
                px(17.6),
                TextAlign::Left,
                None,
                window,
                cx,
            );
        }
    }
}
