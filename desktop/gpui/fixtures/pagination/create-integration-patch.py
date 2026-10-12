"""Read frozen runtime files and write the proposed patch; never apply it."""

from pathlib import Path
import difflib


ROOT = Path(__file__).resolve().parents[4]
CHANGES = {}


def source(path):
    return (ROOT / path).read_text()


def replace_once(text, before, after):
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one integration seam, found {count}: {before[:80]!r}")
    return text.replace(before, after, 1)


path = "desktop/gpui/src/editor/mod.rs"
text = source(path)
CHANGES[path] = replace_once(text, "mod model;\n", "mod model;\npub mod pagination;\n")

path = "desktop/gpui/src/editor/view.rs"
text = source(path)
text = replace_once(
    text,
    '#[path = "view_flow.rs"]\nmod text_flow;\n',
    '#[path = "view_flow.rs"]\nmod text_flow;\n'
    '#[path = "view_pagination.rs"]\nmod paginated;\n'
    'pub use paginated::{PaginationFallback, PaginationInfo, PaginationScrollAnchor};\n',
)
text = replace_once(
    text,
    "    SelectionChanged,\n",
    "    SelectionChanged,\n    /// A fresh measured page frame is ready; presentation only.\n"
    "    PaginationChanged {\n        generation: u64,\n    },\n",
)
text = replace_once(
    text,
    "    drag: dragging::DragState,\n",
    "    drag: dragging::DragState,\n    pagination: paginated::PaginationState,\n",
)
text = replace_once(
    text,
    "            drag: dragging::DragState::default(),\n",
    "            drag: dragging::DragState::default(),\n"
    "            pagination: paginated::PaginationState::default(),\n",
)
text = replace_once(
    text,
    "        self.prepare_drag_frame(window, cx);\n",
    "        self.prepare_pagination_frame();\n        self.prepare_drag_frame(window, cx);\n",
)
text = replace_once(
    text,
    "        let children = text_flow::render_nodes(&nodes, first_paragraph, &renderer);\n"
    "        self.drag.finish_render();\n",
    "        let children = paginated::render_nodes(&nodes, first_paragraph, &renderer);\n"
    "        self.drag.finish_render();\n        self.finish_pagination_frame(window, cx);\n",
)
text = replace_once(text, "            .min_h(px(400.))\n", "            .min_h(self.pagination_min_height())\n")
text = replace_once(
    text,
    "    ) -> Arc<ParagraphLayout> {\n"
    "        let colors = *theme::palette(cx);\n"
    "        let carry = self.opening_flow_before(block, width, window, cx);\n"
    "        let typography = self.typography_for_path(&block.path);\n",
    "    ) -> Arc<ParagraphLayout> {\n"
    "        let carry = self.opening_flow_before(block, width, window, cx);\n"
    "        self.layout_block_with_carry(block, width, initial, carry, window, cx)\n"
    "    }\n\n"
    "    // Both continuous and paginated flow share the exact shape/cache path.\n"
    "    // Page frames supply carry after their measured spacer transform.\n"
    "    fn layout_block_with_carry(\n"
    "        &self,\n        block: &RichBlock,\n        width: Pixels,\n"
    "        initial: bool,\n        carry: FloatReservation,\n"
    "        window: &mut Window,\n        cx: &App,\n"
    "    ) -> Arc<ParagraphLayout> {\n"
    "        let colors = *theme::palette(cx);\n"
    "        let typography = self.typography_for_path(&block.path);\n",
)
text = text.replace("text_flow::BlockPlacement", "paginated::BlockPlacement")
text = replace_once(
    text,
    "                            img(source)\n                                .w_full()\n",
    "                            img(source)\n                                .w_full()\n"
    "                                .when_some(renderer.state.pagination_image_max_height(), |image, height| {\n"
    "                                    image.max_h(px(height)).object_fit(gpui_kit::ObjectFit::Contain)\n"
    "                                })\n",
)
text = replace_once(
    text,
    "        if element.kind == NodeKind::PageBreak {\n"
    "            return div()\n                .w_full()\n                .h(px(1.))\n"
    "                .my(px(24.))\n                .bg(rgb(colors.rule))\n"
    "                .into_any_element();\n        }\n",
    "        if element.kind == NodeKind::PageBreak {\n"
    "            // Source page-break nodes are invisible in both modes.\n"
    "            // The active pagination frame paints the inert spacer label.\n"
    "            return div().w_full().h(px(0.)).into_any_element();\n        }\n",
)
CHANGES[path] = text

path = "desktop/gpui/src/editor/view_flow.rs"
CHANGES[path] = replace_once(source(path), "                Some(placement),\n", "                Some(placement.into()),\n")

path = "desktop/gpui/src/editor/view_drag.rs"
text = source(path)
if text.count("text_flow::BlockPlacement") != 2:
    raise RuntimeError("Native drag placement seam changed; inspect it before regenerating")
CHANGES[path] = text.replace("text_flow::BlockPlacement", "paginated::BlockPlacement")

path = "desktop/gpui/src/page_furniture.rs"
text = source(path)
text = replace_once(
    text,
    "    pub fn content_width_px(self) -> f32 {\n",
    """    /// Physical sheet mode preserves width even in a narrow viewport. The
    /// host's real manuscript scroller supplies horizontal overflow. Unlike
    /// continuous Zen, paginated Zen retains original margin/ornament padding.
    pub fn resolve_paginated(
        layout: &LayoutSettings,
        viewport_width_px: f32,
        zen: bool,
    ) -> Self {
        let page = crate::editor::pagination::PageGeometry::from_layout(
            layout,
            f64::from(REM_PX),
            crate::editor::pagination::PAGE_GAP_REM,
        );
        let width_px = page.page_w as f32;
        let guides = PageMarginsPx::from_layout(layout);
        // PageChrome dims in Zen; its original border style and clearance
        // remain. Source's Zen padding override excludes .is-paginated.
        let border = PageBorderGeometry::resolve(layout, width_px, false);
        let ornate = matches!(
            border.style,
            PageBorderStyle::Botanical | PageBorderStyle::Engraved | PageBorderStyle::Illuminated
        );
        let clearance = if ornate {
            if viewport_width_px <= 639. { 2.75 * REM_PX } else { 5. * REM_PX }
        } else { 0. };
        Self {
            width_px,
            padding_left_px: guides.left.max(clearance),
            padding_right_px: guides.right.max(clearance),
            padding_top_px: guides.top.max(clearance),
            padding_bottom_px: guides.bottom.max(clearance),
            guides,
            border,
            ruler_width_rem: f64::from(width_px / REM_PX),
            ruler_space_px: if zen || viewport_width_px <= 640. { 0. } else { RULER_SPACE_PX },
            zen,
        }
    }

    pub fn content_width_px(self) -> f32 {
""",
)
text = replace_once(
    text,
    "pub fn page_canvas(\n"
    "    layout: &LayoutSettings,\n    geometry: PageCanvasGeometry,\n"
    "    child: AnyElement,\n    cx: &App,\n"
    ") -> impl IntoElement + gpui_kit::Styled + gpui_kit::ParentElement + use<> {\n"
    "    let color = rgb(theme::palette(cx).vermilion).opacity(0.28);\n",
    """pub fn page_canvas(
    layout: &LayoutSettings,
    geometry: PageCanvasGeometry,
    child: AnyElement,
    cx: &App,
) -> impl IntoElement + gpui_kit::Styled + gpui_kit::ParentElement + use<> {
    page_canvas_surface(layout, geometry, child, None, cx)
}

/// The engine supplies accepted measured sheets. It does not estimate count
/// from words or copy the editor into a second, noninteractive surface.
pub fn page_canvas_paginated(
    layout: &LayoutSettings,
    geometry: PageCanvasGeometry,
    metrics: PageChromeGeometry,
    text: PageChromeText<'_>,
    child: AnyElement,
    cx: &App,
) -> impl IntoElement + gpui_kit::Styled + gpui_kit::ParentElement + use<> {
    page_canvas_surface(layout, geometry, child, Some((metrics, text)), cx)
}

fn page_canvas_surface(
    layout: &LayoutSettings,
    geometry: PageCanvasGeometry,
    child: AnyElement,
    chrome: Option<(PageChromeGeometry, PageChromeText<'_>)>,
    cx: &App,
) -> impl IntoElement + gpui_kit::Styled + gpui_kit::ParentElement + use<> {
    let color = rgb(theme::palette(cx).vermilion).opacity(0.28);
""",
)
text = replace_once(
    text,
    "        .w(px(geometry.width_px))\n        .max_w_full()\n",
    "        .w(px(geometry.width_px))\n"
    "        .when(chrome.is_none(), |this| this.max_w_full())\n"
    "        .when(chrome.is_some(), |this| this.flex_shrink_0())\n",
)
text = replace_once(
    text,
    "        .child(border_layer(geometry.border, cx))\n",
    "        .when(chrome.is_none(), |this| this.child(border_layer(geometry.border, cx)))\n"
    "        .when_some(chrome, |this, (metrics, text)| {\n"
    "            this.min_h(px(metrics.total_height_px()))\n"
    "                .child(page_chrome(layout, metrics, text, geometry.width_px, geometry.zen, cx))\n"
    "        })\n",
)
CHANGES[path] = text

patch = []
for path, after in CHANGES.items():
    before = source(path)
    patch.extend(difflib.unified_diff(
        before.splitlines(keepends=True),
        after.splitlines(keepends=True),
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
    ))
target = Path(__file__).with_name("integration.patch")
target.write_text("".join(patch))
print(f"Proposed integration only: {len(CHANGES)} existing files, {len(patch)} patch lines. No runtime files changed.")
