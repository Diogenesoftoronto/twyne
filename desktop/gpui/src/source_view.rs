//! Original Source presentation over the existing native editing entity.
//!
//! The engine still owns the rope, selection, IME, native search and history.
//! This module projects source-backed colors/spacing and paints the original
//! helpers disclosure from native display-only fragment rows. These rows
//! reserve layout/scroll height while the anchor keeps before-widget affinity.

use crate::{assets, theme};
use gpui_kit::base::TestSupportExt;
use gpui_kit::base::input::{
    DiagnosticColors, EditorGutterMetrics, FoldPlaceholderFragment, FoldPlaceholderPresentation,
    InputEditorPresentation, InputEditorStyle,
};
use gpui_kit::component::{
    Disableable, Sizable, Theme,
    button::{Button, ButtonCustomVariant, ButtonVariants},
    input::{Editor, EditorState, RopeExt},
    tooltip::Tooltip,
};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, AvailableSpace, Bounds, ContentMask, Edges, Element, ElementId, Entity,
    FontWeight, GlobalElementId, Hsla, InspectorElementId, LayoutId, MouseButton, Pixels,
    RenderOnce, Role, SharedString, TextRun, Window, div, font, px, relative, rgb, size,
};
use std::rc::Rc;
use std::sync::Arc;

pub const SOURCE_FONT_PX: f32 = 13.;
pub const SOURCE_LINE_HEIGHT: f32 = 1.65;
/// Browser layout rounds 13px × 1.65 to this exact CSS row height.
pub const SOURCE_ROW_HEIGHT_PX: f32 = 21.4375;
pub const SOURCE_CODE_INSET_PX: f32 = 16.;
pub const SOURCE_CONTENT_PADDING_PX: f32 = 16.;
pub const SOURCE_HEADING_HEIGHT_PX: f32 = 33.5;
pub const SOURCE_RIBBON_HEIGHT_PX: f32 = 40.;
pub const SOURCE_TOOL_HEIGHT_PX: f32 = 30.;
pub const SOURCE_TOOL_ICON_PX: f32 = 17.;
pub const SOURCE_GROUP_PADDING_PX: f32 = 6.;
pub const SOURCE_GROUP_GAP_PX: f32 = 1.;
pub const HELPER_HEADER: &str = "// twyne-document:1";
pub const HELPER_LABEL: &str = "Document helpers";

/// A Source child sharing the caller's original native editor state.
#[derive(IntoElement)]
pub struct SourceEditorView {
    state: Entity<EditorState>,
    readonly: bool,
}
impl SourceEditorView {
    pub fn new(state: &Entity<EditorState>) -> Self {
        Self {
            state: state.clone(),
            readonly: false,
        }
    }
    pub fn readonly(mut self, value: bool) -> Self {
        self.readonly = value;
        self
    }
}

/// The original CSS geometry with the fold glyph measured in the current
/// native source face. No document text is read, copied or rewritten here.
pub fn gutter_metrics(window: &mut Window) -> EditorGutterMetrics {
    let fold_width = window
        .text_system()
        .shape_line(
            "›".into(),
            px(SOURCE_FONT_PX),
            &[TextRun {
                len: "›".len(),
                font: theme::source_font(),
                ..Default::default()
            }],
            None,
        )
        .width();
    EditorGutterMetrics {
        min_digits: 1,
        min_number_width: px(20.),
        number_padding_left: px(5.),
        number_padding_right: px(3.),
        fold_icon_width: fold_width,
        fold_icon_height: px(18.),
        fold_icon_padding: px(1.),
        border_width: px(1.),
        text_gap: px(SOURCE_CODE_INSET_PX),
        always_show_folds: true,
        highlight_active_number: false,
    }
}

/// Persistent overrides survive the component's own projection every render.
pub fn source_presentation(window: &mut Window, cx: &App) -> InputEditorPresentation {
    let colors = *theme::palette(cx);
    let component = Theme::global(cx);
    let gutter = gutter_metrics(window);
    InputEditorPresentation {
        line_height: Some(px(SOURCE_ROW_HEIGHT_PX)),
        wrap_right_margin: Some(px(0.)),
        soft_wrap_policy: Some(gpui_kit::base::input::EditorSoftWrapPolicy::CssAsciiBreakSpaces),
        paddings: Some(Edges {
            top: px(SOURCE_CONTENT_PADDING_PX),
            right: px(SOURCE_CODE_INSET_PX),
            bottom: px(SOURCE_CONTENT_PADDING_PX),
            left: px(0.),
        }),
        gutter: Some(gutter),
        style: Some(InputEditorStyle {
            foreground: rgb(colors.ink).into(),
            muted_foreground: rgb(colors.ink_light).into(),
            background: rgb(colors.page).into(),
            border: rgb(colors.rule).into(),
            selection: Hsla::from(rgb(colors.vermilion)).alpha(0.16),
            caret: rgb(colors.ink).into(),
            diagnostics: DiagnosticColors {
                error: component.highlight_theme.style.status.error(cx),
                warning: component.highlight_theme.style.status.warning(cx),
                info: component.highlight_theme.style.status.info(cx),
                hint: component.highlight_theme.style.status.hint(cx),
            },
            highlight_styles: component.highlight_theme.clone(),
            editor_invisible: component.highlight_theme.style.editor_invisible,
            editor_active_line: Some(rgb(colors.paper_soft).into()),
            editor_gutter_background: Some(rgb(colors.paper_soft).into()),
            fold_icon_renderer: Some(Rc::new(move |_, folded| {
                div()
                    .w(gutter.fold_icon_width)
                    .h(gutter.fold_icon_height)
                    .font(theme::source_font())
                    .text_size(px(SOURCE_FONT_PX))
                    .line_height(px(18.))
                    .text_color(rgb(colors.ink_light))
                    .cursor_pointer()
                    .child(if folded { "›" } else { "⌄" })
                    .into_any_element()
            })),
        }),
    }
}

impl RenderOnce for SourceEditorView {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let presentation = source_presentation(window, cx);
        let placeholder = {
            let state = self.state.read(cx);
            (state.is_folded_at(0) && state.text().slice_line(0) == HELPER_HEADER)
                .then(|| helper_presentation(window))
        };
        self.state.update(cx, |state, cx| {
            state.set_editor_presentation_override(Some(presentation));
            state.set_fold_placeholder_presentation(placeholder, cx);
        });
        let editor = div()
            .relative()
            .size_full()
            .min_h_0()
            .bg(rgb(theme::palette(cx).page))
            .child(
                Editor::new(&self.state)
                    .h(relative(1.))
                    .appearance(false)
                    .bordered(false)
                    .font(theme::source_font())
                    .text_size(px(SOURCE_FONT_PX))
                    .line_height(relative(SOURCE_LINE_HEIGHT))
                    .readonly(self.readonly)
                    .aria_label("Typst source"),
            )
            .into_any_element();
        SourceElement {
            state: self.state,
            editor,
        }
    }
}

struct SourceElement {
    state: Entity<EditorState>,
    editor: AnyElement,
}
struct SourcePrepaint {
    disclosure: Option<AnyElement>,
    clip: Bounds<Pixels>,
}
impl IntoElement for SourceElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for SourceElement {
    type RequestLayoutState = ();
    type PrepaintState = SourcePrepaint;
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
    ) -> (LayoutId, ()) {
        (self.editor.request_layout(window, cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> SourcePrepaint {
        self.editor.prepaint(window, cx);
        let clip = bounds.intersect(&window.content_mask().bounds);
        let fragments = {
            let state = self.state.read(cx);
            (state.is_folded_at(0) && state.text().slice_line(0) == HELPER_HEADER)
                .then(|| state.fold_placeholder_bounds())
                .flatten()
                .map(|fragments| {
                    fragments
                        .iter()
                        .enumerate()
                        .map(|(i, bounds)| {
                            let mut bounds = *bounds;
                            // CSS inline margin is outside only the first/last
                            // sliced fragment. Every box begins1px below its row.
                            if i == 0 {
                                bounds.origin.x += px(1.);
                                bounds.size.width -= px(1.);
                            }
                            if i + 1 == fragments.len() {
                                bounds.size.width -= px(1.);
                            }
                            bounds.origin.y += px(1.);
                            bounds.size.height = px(20.);
                            bounds
                        })
                        .collect::<Vec<_>>()
                })
                .filter(|fragments| {
                    fragments.iter().any(|line| {
                        line.bottom() > clip.top()
                            && line.top() < clip.bottom()
                            && line.left() < clip.right()
                            && line.right() > clip.left()
                    })
                })
        };
        let disclosure = fragments.map(|fragments| {
            let (mut disclosure, origin) = helper_disclosure(&self.state, &fragments, cx);
            disclosure.layout_as_root(
                size(AvailableSpace::MaxContent, AvailableSpace::MaxContent),
                window,
                cx,
            );
            window.with_content_mask(Some(ContentMask { bounds: clip }), |window| {
                disclosure.prepaint_at(origin, window, cx);
            });
            disclosure
        });
        SourcePrepaint { disclosure, clip }
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        prepaint: &mut SourcePrepaint,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.editor.paint(window, cx);
        if let Some(disclosure) = &mut prepaint.disclosure {
            window.with_content_mask(
                Some(ContentMask {
                    bounds: prepaint.clip,
                }),
                |window| disclosure.paint(window, cx),
            );
        }
    }
}

fn helper_presentation(window: &mut Window) -> FoldPlaceholderPresentation {
    let measure = |text: &'static str| {
        window
            .text_system()
            .shape_line(
                text.into(),
                px(11.),
                &[TextRun {
                    len: text.len(),
                    font: font(theme::SOURCE_HELPER_FONT),
                    ..Default::default()
                }],
                None,
            )
            .width()
    };
    FoldPlaceholderPresentation {
        source_offset: HELPER_HEADER.len(),
        folded_row: 0,
        // The request is made only after matching the original generated
        // marker byte-for-byte. Its real CSS breaks follow space and hyphen.
        source_break_offsets: Some(
            HELPER_HEADER
                .char_indices()
                .filter_map(|(at, c)| matches!(c, ' ' | '-').then_some(at + c.len_utf8()))
                .collect::<Vec<_>>()
                .into(),
        ),
        fragments: Arc::from([
            FoldPlaceholderFragment {
                advance: px(1. + 7.) + measure("Document "),
                break_after: true,
            },
            FoldPlaceholderFragment {
                advance: measure("helpers") + px(7. + 1.),
                break_after: false,
            },
        ]),
    }
}

fn helper_disclosure(
    state: &Entity<EditorState>,
    fragments: &[Bounds<Pixels>],
    cx: &App,
) -> (AnyElement, gpui_kit::Point<Pixels>) {
    let colors = *theme::palette(cx);
    let union = fragments
        .iter()
        .copied()
        .reduce(|a, b| a.union(&b))
        .unwrap();
    let root = div()
        .id("source-document-helpers")
        .test_support()
        .role(Role::Button)
        .aria_label("folded code")
        .relative()
        .w(union.size.width)
        .h(union.size.height)
        .font_family(theme::SOURCE_HELPER_FONT)
        .font_weight(FontWeight::NORMAL)
        .text_size(px(11.))
        .line_height(px(14.))
        .text_color(rgb(colors.ink_light))
        .children(fragments.iter().enumerate().map(|(i, bounds)| {
            let state = state.clone();
            let first = i == 0;
            let last = i + 1 == fragments.len();
            div()
                .id(if first {
                    "source-document-helpers-document"
                } else {
                    "source-document-helpers-helpers"
                })
                .test_support()
                .absolute()
                .left(bounds.left() - union.left())
                .top(bounds.top() - union.top())
                .w(bounds.size.width)
                .h(bounds.size.height)
                .flex()
                .items_center()
                .py(px(2.))
                .border_t_1()
                .border_b_1()
                .when(first, |this| {
                    this.border_l_1().pl(px(6.)).rounded_l(px(2.2))
                })
                .when(last, |this| this.border_r_1().pr(px(6.)).rounded_r(px(2.2)))
                .border_color(rgb(colors.rule))
                .bg(rgb(colors.paper_soft))
                .whitespace_nowrap()
                .cursor_pointer()
                .tooltip(|window, cx| Tooltip::new("unfold").build(window, cx))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(move |_, _, cx| {
                    state.update(cx, |state, cx| {
                        state.set_folded(0, false, cx);
                    });
                    cx.stop_propagation();
                })
                .child(if first { "Document " } else { "helpers" })
        }));
    (root.into_any_element(), union.origin)
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SourceToolState {
    pub pressed: bool,
    pub disabled: bool,
}

/// Source ribbon geometry/style; the caller retains command dispatch.
pub fn ribbon_button(
    id: &'static str,
    label: &'static str,
    visible_label: Option<&'static str>,
    icon: &'static str,
    state: SourceToolState,
    cx: &App,
) -> Button {
    let colors = *theme::palette(cx);
    let foreground = if state.pressed {
        colors.vermilion
    } else {
        colors.ink_light
    };
    Button::new(id)
        .custom(
            ButtonCustomVariant::new(cx)
                .foreground(rgb(foreground).into())
                .hover(rgb(colors.paper_soft).into())
                .active(rgb(colors.paper_soft).into()),
        )
        .small()
        .rounded(px(2.))
        .h(px(SOURCE_TOOL_HEIGHT_PX))
        .min_w(px(SOURCE_TOOL_HEIGHT_PX))
        .px(px(8.))
        .text_color(rgb(foreground))
        .group(id)
        .accessibility_label(label)
        .disabled(state.disabled)
        .when(state.disabled, |this| this.opacity(0.4))
        .when(state.pressed, |this| {
            this.bg(rgb(colors.sidebar))
                .border_b_2()
                .border_color(rgb(colors.vermilion))
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(5.6))
                .font_family(theme::SANS_FONT)
                .text_size(px(12.))
                .when(!state.disabled, |this| {
                    // The styled Button installs its own hover background.
                    // Color its content through that parent group's hitbox.
                    this.group_hover(id, |this| this.text_color(rgb(colors.vermilion)))
                })
                .when_some(assets::icon_named(icon), |this, icon| {
                    this.child(icon.with_size(px(SOURCE_TOOL_ICON_PX)))
                })
                .when_some(visible_label, |this, label| this.child(label)),
        )
}

pub fn ribbon_group(
    label: &'static str,
    controls: impl IntoIterator<Item = AnyElement>,
    last: bool,
    cx: &App,
) -> AnyElement {
    div()
        .id(SharedString::from(format!("source-group-{label}")))
        .flex()
        .items_center()
        .gap(px(SOURCE_GROUP_GAP_PX))
        .h_full()
        .px(px(SOURCE_GROUP_PADDING_PX))
        .when(!last, |this| {
            this.border_r_1().border_color(rgb(theme::palette(cx).rule))
        })
        .role(Role::Group)
        .aria_label(label)
        .children(controls)
        .into_any_element()
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use crate::source_editor;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        AppContext, Context, HeadlessAppContext, NoopTextSystem, Render, ScrollDelta, TestApp,
        WindowHandle, point,
    };
    use std::sync::Arc;

    const NOTEBOOK: &str = include_str!("../fixtures/source_view/web-notebook.typ");

    struct SourceProbe {
        source: Entity<EditorState>,
        readonly: bool,
        ribbon: bool,
        tool_clicks: Vec<&'static str>,
        /// Fixture-only policy control around the same native EditorState.
        bare_policy: Option<Option<gpui_kit::base::input::EditorSoftWrapPolicy>>,
    }
    impl SourceProbe {
        fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
            // Match Root's Source-only CodeMirror Linux redo alias while
            // retaining Base's global Ctrl+Y native Redo binding.
            #[cfg(target_os = "linux")]
            cx.bind_keys([gpui_kit::KeyBinding::new(
                "ctrl-shift-z",
                gpui_kit::base::input::Redo,
                Some("TwyneSource"),
            )]);
            let source = cx.new(|cx| {
                let mut state = EditorState::new(window, cx)
                    .language("typst")
                    .soft_wrap(true)
                    .auto_close(false);
                source_editor::install_highlighter(&mut state, cx);
                state
            });
            source.update(cx, |state, cx| {
                source_editor::set_source(state, NOTEBOOK, window, cx)
            });
            Self {
                source,
                readonly: false,
                ribbon: false,
                tool_clicks: Vec::new(),
                bare_policy: None,
            }
        }

        fn ribbon(&self, cx: &mut Context<Self>) -> AnyElement {
            type Tool = (
                &'static str,
                &'static str,
                Option<&'static str>,
                &'static str,
                bool,
            );
            let groups: &[(&str, &[Tool])] = &[
                (
                    "Source history",
                    &[
                        ("source-undo", "Undo source edit", None, "undo", true),
                        ("source-redo", "Redo source edit", None, "redo", true),
                    ],
                ),
                (
                    "Source navigation",
                    &[
                        (
                            "source-find",
                            "Find and replace in source",
                            Some("Find"),
                            "search",
                            false,
                        ),
                        (
                            "source-go-to-line",
                            "Go to line",
                            Some("Go to line"),
                            "list",
                            false,
                        ),
                    ],
                ),
                (
                    "Insert Typst",
                    &[
                        (
                            "source-insert-bold",
                            "Insert bold",
                            None,
                            "text-bold",
                            false,
                        ),
                        (
                            "source-insert-italic",
                            "Insert italic",
                            None,
                            "text-italic",
                            false,
                        ),
                        (
                            "source-insert-heading",
                            "Insert heading",
                            None,
                            "heading",
                            false,
                        ),
                        (
                            "source-insert-equation",
                            "Insert equation",
                            None,
                            "math",
                            false,
                        ),
                        ("source-insert-link", "Insert link", None, "link", false),
                        (
                            "source-insert-page-break",
                            "Insert page break",
                            None,
                            "page",
                            false,
                        ),
                    ],
                ),
                (
                    "Code tools",
                    &[
                        (
                            "source-comment",
                            "Toggle comment",
                            Some("Comment"),
                            "code",
                            false,
                        ),
                        (
                            "source-wrap",
                            "Wrap lines",
                            Some("Wrap"),
                            "text-wrap",
                            false,
                        ),
                    ],
                ),
                (
                    "Source file",
                    &[(
                        "save-source-copy",
                        "Save source copy",
                        Some("Save .typ"),
                        "code-file",
                        false,
                    )],
                ),
            ];
            div()
                .id("source-ribbon")
                .test_support()
                .role(Role::Toolbar)
                .aria_label("Typst source tools")
                .flex()
                .items_center()
                .w_full()
                .h(px(SOURCE_RIBBON_HEIGHT_PX))
                .min_h(px(SOURCE_RIBBON_HEIGHT_PX))
                .flex_shrink_0()
                .bg(rgb(theme::palette(cx).paper_soft))
                .border_t_1()
                .border_color(rgb(theme::palette(cx).rule))
                .children(groups.iter().enumerate().map(|(index, (group, tools))| {
                    let controls = tools.iter().map(|&(id, label, visible, icon, disabled)| {
                        let disabled = disabled
                            || self.readonly
                                && matches!(
                                    id,
                                    "source-insert-bold"
                                        | "source-insert-italic"
                                        | "source-insert-heading"
                                        | "source-insert-equation"
                                        | "source-insert-link"
                                        | "source-insert-page-break"
                                        | "source-comment"
                                );
                        ribbon_button(
                            id,
                            label,
                            visible,
                            icon,
                            SourceToolState {
                                disabled,
                                pressed: id == "source-wrap",
                            },
                            cx,
                        )
                        .when(id == "source-wrap", |this| this.toggled(true))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.tool_clicks.push(id);
                            cx.notify();
                        }))
                        .into_any_element()
                    });
                    ribbon_group(group, controls.collect::<Vec<_>>(), index == 4, cx)
                }))
                .into_any_element()
        }
    }
    impl Render for SourceProbe {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let editor = if let Some(policy) = self.bare_policy {
                let mut presentation = source_presentation(window, cx);
                presentation.soft_wrap_policy = policy;
                self.source.update(cx, |state, cx| {
                    state.set_editor_presentation_override(Some(presentation));
                    state.set_fold_placeholder_presentation(None, cx);
                });
                div()
                    .relative()
                    .size_full()
                    .bg(rgb(theme::palette(cx).page))
                    .child(
                        Editor::new(&self.source)
                            .h(relative(1.))
                            .appearance(false)
                            .bordered(false)
                            .font(theme::source_font())
                            .text_size(px(SOURCE_FONT_PX))
                            .readonly(self.readonly),
                    )
                    .into_any_element()
            } else {
                SourceEditorView::new(&self.source)
                    .readonly(self.readonly)
                    .into_any_element()
            };
            div()
                .id("source-probe")
                .test_support()
                .key_context("TwyneSource")
                .size_full()
                .flex()
                .flex_col()
                .when(self.ribbon, |this| this.child(self.ribbon(cx)))
                .child(div().flex_1().min_h_0().child(editor))
        }
    }

    fn with_window<T>(
        app: &mut TestApp,
        handle: WindowHandle<SourceProbe>,
        update: impl FnOnce(&mut Window, &mut App) -> T,
    ) -> T {
        app.update(|cx| {
            cx.update_window(handle.into(), |_, window, cx| update(window, cx))
                .unwrap()
        })
    }
    fn app() -> TestApp {
        let mut app = TestApp::with_text_system_and_assets(
            Arc::new(NoopTextSystem::new()),
            Arc::new(assets::TwyneAssets),
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        app
    }

    fn source_row_texts<M: gpui_kit::base::input::InputModeKind>(
        state: &gpui_kit::base::input::InputBaseState<M>,
    ) -> Vec<String> {
        let text = state.text().slice_line(0).to_string();
        let mut rows = std::collections::BTreeMap::<i64, String>::new();
        for (offset, scalar) in text.char_indices() {
            let bounds = state.range_to_bounds(&(offset..offset)).unwrap();
            rows.entry((f32::from(bounds.top()) * 64.).round() as i64)
                .or_default()
                .push(scalar);
        }
        rows.into_values().collect()
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn ordinary_ascii_rows_match_codemirror_with_readonly_selection_and_ime() {
        use gpui_kit::EntityInputHandler;
        let reference: serde_json::Value = serde_json::from_str(include_str!(
            "../fixtures/source_view/hyphen-wrap/web-hyphen-wrap.json"
        ))
        .unwrap();
        let mut app = TestApp::with_text_system_and_assets(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let mut window = app.open_window(SourceProbe::new);
        let source = window.read(|probe, _| probe.source.clone());
        window.update(|probe, _, cx| {
            probe.readonly = true;
            cx.notify();
        });
        with_window(&mut app, window.handle(), |window, cx| {
            for case in reference["cases"].as_array().unwrap() {
                let width = case["width"].as_u64().unwrap() as f32;
                window.resize(size(px(width), px(606.)));
                window.bounds_changed(cx);
                for entry in case["results"].as_array().unwrap() {
                    let original = entry["source"].as_str().unwrap();
                    if !original
                        .trim_end_matches('\n')
                        .bytes()
                        .all(|b| (b' '..=b'~').contains(&b))
                    {
                        continue;
                    }
                    let selection = 3..original.len() - 2;
                    source.update(cx, |state, cx| {
                        source_editor::set_source(state, original, window, cx);
                        state.set_selected_range(selection.clone(), cx);
                        state.focus(window, cx);
                    });
                    window.render_frame(cx);
                    let state = source.read(cx);
                    assert_eq!(
                        serde_json::to_value(source_row_texts(state)).unwrap(),
                        entry["rowTexts"],
                        "{width}px {}",
                        entry["id"].as_str().unwrap()
                    );
                    assert_eq!(state.selected_range(), selection);
                    let at = selection.end;
                    let caret = state.range_to_bounds(&(at..at)).unwrap();
                    let text_bounds = state.text_bounds().unwrap();
                    source.update(cx, |state, cx| {
                        let ime = state
                            .bounds_for_range(at..at, text_bounds, window, cx)
                            .unwrap();
                        assert_eq!(ime.origin, caret.origin);
                        assert_eq!(ime.size.height, px(SOURCE_ROW_HEIGHT_PX));
                    });
                    window.input("X", cx);
                    assert_eq!(source.read(cx).text().to_string(), original);
                    assert_eq!(source.read(cx).selected_range(), selection);
                    assert!(!source.read(cx).can_undo() && !source.read(cx).can_redo());
                }
            }
        });
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn ordinary_ascii_edit_resize_and_real_redo_preserve_source_caret_and_history() {
        let before = "openingconcrete-after-midnight\n";
        let after = "opening-concrete-after-midnight\n";
        let reference: serde_json::Value = serde_json::from_str(include_str!(
            "../fixtures/source_view/hyphen-wrap/web-hyphen-wrap.json"
        ))
        .unwrap();
        let mut app = TestApp::with_text_system_and_assets(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let window = app.open_window(SourceProbe::new);
        let source = window.read(|probe, _| probe.source.clone());
        with_window(&mut app, window.handle(), |window, cx| {
            window.resize(size(px(160.), px(606.)));
            window.bounds_changed(cx);
            source.update(cx, |state, cx| {
                source_editor::set_source(state, before, window, cx);
                state.set_selected_range(7..7, cx);
                state.focus(window, cx);
            });
            window.render_frame(cx);
            window.input("-", cx);
            window.render_frame(cx);
            assert_eq!(source.read(cx).text().to_string(), after);
            assert_eq!(source.read(cx).selected_range(), 8..8);
            assert!(source.read(cx).can_undo() && !source.read(cx).can_redo());
            for case in reference["cases"].as_array().unwrap() {
                let width = case["width"].as_u64().unwrap() as f32;
                let entry = case["results"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|entry| entry["id"] == "ascii-hyphen")
                    .unwrap();
                window.resize(size(px(width), px(606.)));
                window.bounds_changed(cx);
                window.render_frame(cx);
                assert_eq!(
                    serde_json::to_value(source_row_texts(source.read(cx))).unwrap(),
                    entry["rowTexts"]
                );
                assert_eq!(source.read(cx).text().to_string(), after);
                assert_eq!(source.read(cx).selected_range(), 8..8);
                assert!(source.read(cx).can_undo() && !source.read(cx).can_redo());
                let caret = source.read(cx).range_to_bounds(&(8..8)).unwrap();
                let expected = entry["boundaries"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|boundary| boundary["byte"] == 8)
                    .unwrap();
                // Chrome's physical glyph top differs from GPUI's logical row
                // top. Only the source-row affinity and native row height apply.
                let reference_row = ((expected["y"].as_f64().unwrap()
                    - entry["boundaries"][0]["y"].as_f64().unwrap())
                    / f64::from(SOURCE_ROW_HEIGHT_PX))
                .round() as f32;
                assert!(
                    (f32::from(caret.top()) - (16. + reference_row * SOURCE_ROW_HEIGHT_PX)).abs()
                        < 0.05
                );
            }
            window.press("ctrl-z", cx);
            window.render_frame(cx);
            assert_eq!(source.read(cx).text().to_string(), before);
            assert_eq!(source.read(cx).selected_range(), 7..7);
            assert!(!source.read(cx).can_undo() && source.read(cx).can_redo());
            window.press("ctrl-y", cx);
            assert_eq!(source.read(cx).text().to_string(), after);
            window.press("ctrl-z", cx);
            window.press("ctrl-shift-z", cx);
            window.render_frame(cx);
            assert_eq!(source.read(cx).text().to_string(), after);
            assert_eq!(source.read(cx).selected_range(), 8..8);
            assert!(source.read(cx).can_undo() && !source.read(cx).can_redo());
        });
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn optional_ascii_wrap_restores_none_and_preserves_unsupported_rows() {
        use gpui_kit::base::input::EditorSoftWrapPolicy;
        let mut app = TestApp::with_text_system_and_assets(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let mut window = app.open_window(SourceProbe::new);
        let source = window.read(|probe, _| probe.source.clone());
        window.update(|probe, _, cx| {
            probe.bare_policy = Some(None);
            cx.notify();
        });
        with_window(&mut app, window.handle(), |window, cx| {
            let probe = window.root::<SourceProbe>().unwrap().unwrap();
            window.resize(size(px(160.), px(606.)));
            window.bounds_changed(cx);
            for original in [
                "opening-concrete-after-midnight\n",
                "Café-opening-concrete-after-midnight\n",
                "opening-\tconcrete-after-midnight\n",
                "opening-\rconcrete-after-midnight\n",
                "opening-\u{0007}concrete-after-midnight\n",
            ] {
                source.update(cx, |state, cx| {
                    source_editor::set_source(state, original, window, cx);
                    state.set_selected_range(0..7, cx);
                });
                window.render_frame(cx);
                let baseline = source_row_texts(source.read(cx));
                probe.update(cx, |probe, cx| {
                    probe.bare_policy = Some(Some(EditorSoftWrapPolicy::CssAsciiBreakSpaces));
                    cx.notify();
                });
                window.render_frame(cx);
                let styled = source_row_texts(source.read(cx));
                if original
                    .trim_end_matches('\n')
                    .bytes()
                    .all(|b| (b' '..=b'~').contains(&b))
                {
                    assert_eq!(styled, ["opening-", "concrete-", "after-", "midnight"]);
                    assert_ne!(styled, baseline);
                } else {
                    assert_eq!(styled, baseline, "unsupported row keeps upstream wrapping");
                }
                probe.update(cx, |probe, cx| {
                    probe.bare_policy = Some(None);
                    cx.notify();
                });
                window.render_frame(cx);
                assert_eq!(
                    source_row_texts(source.read(cx)),
                    baseline,
                    "None restores upstream"
                );
                assert_eq!(source.read(cx).text().to_string(), original);
                assert_eq!(source.read(cx).selected_range(), 0..7);
                assert!(!source.read(cx).can_undo() && !source.read(cx).can_redo());
            }
        });
    }

    /// Exercise the real supported atomic-token path. Code Editor deliberately
    /// discards InputContent tokens, so it cannot prove inline-metric exclusion.
    struct InlineMetricProbe {
        input: Entity<gpui_kit::base::input::TextareaState>,
        policy: Option<gpui_kit::base::input::EditorSoftWrapPolicy>,
    }
    impl InlineMetricProbe {
        fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
            Self {
                input: cx.new(|cx| gpui_kit::base::input::TextareaState::new(window, cx)),
                policy: None,
            }
        }
    }
    impl Render for InlineMetricProbe {
        fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let mut presentation = source_presentation(window, cx);
            presentation.soft_wrap_policy = self.policy;
            self.input.update(cx, |state, _| {
                state.set_editor_presentation_override(Some(presentation));
            });
            div().size_full().child(
                gpui_kit::component::input::Textarea::new(&self.input)
                    .h(relative(1.))
                    .appearance(false)
                    .bordered(false)
                    .font(theme::source_font())
                    .text_size(px(SOURCE_FONT_PX))
                    .line_height(px(SOURCE_ROW_HEIGHT_PX)),
            )
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn optional_ascii_wrap_preserves_actual_inline_token_metrics() {
        use gpui_kit::base::input::{EditorSoftWrapPolicy, InlineToken, InputContent};
        let original = "opening-concrete-after-midnight\n";
        let mut app = TestApp::with_text_system_and_assets(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let window = app.open_window(InlineMetricProbe::new);
        let handle = window.handle();
        let input = window.read(|probe, _| probe.input.clone());
        app.update(|cx| {
            cx.update_window(handle.into(), |root, window, cx| {
                let probe = root.downcast::<InlineMetricProbe>().unwrap();
                window.resize(size(px(130.), px(606.)));
                window.bounds_changed(cx);
                input.update(cx, |state, cx| {
                    state.set_value(original, window, cx);
                });
                window.render_frame(cx);
                window.render_frame(cx);
                let unstyled = source_row_texts(input.read(cx));
                probe.update(cx, |probe, cx| {
                    probe.policy = Some(EditorSoftWrapPolicy::CssAsciiBreakSpaces);
                    cx.notify();
                });
                window.render_frame(cx);
                window.render_frame(cx);
                assert_ne!(
                    source_row_texts(input.read(cx)),
                    unstyled,
                    "the optional policy reaches this actual textarea before installing a token"
                );
                probe.update(cx, |probe, cx| {
                    probe.policy = None;
                    cx.notify();
                });
                input.update(cx, |state, cx| {
                    let content = InputContent::new(original)
                        .with_token(
                            8..16,
                            InlineToken::new("fixture", "concrete").with_label("X"),
                        )
                        .unwrap();
                    state.set_value(content, window, cx);
                });
                window.render_frame(cx);
                window.render_frame(cx);
                let baseline = source_row_texts(input.read(cx));
                assert_eq!(input.read(cx).tokens().len(), 1);
                let token_width = input.read(cx).range_to_bounds(&(8..16)).unwrap().size.width;
                assert!(
                    token_width < px(50.),
                    "actual token metrics replace the 62.4px source run"
                );
                probe.update(cx, |probe, cx| {
                    probe.policy = Some(EditorSoftWrapPolicy::CssAsciiBreakSpaces);
                    cx.notify();
                });
                window.render_frame(cx);
                window.render_frame(cx);
                assert_eq!(
                    source_row_texts(input.read(cx)),
                    baseline,
                    "inline metrics keep upstream wrapping"
                );
                assert_eq!(input.read(cx).text().to_string(), original);
                assert_eq!(input.read(cx).tokens().len(), 1);
                assert_eq!(
                    input.read(cx).range_to_bounds(&(8..16)).unwrap().size.width,
                    token_width
                );
                assert!(!input.read(cx).can_undo() && !input.read(cx).can_redo());
            })
            .unwrap();
        });
    }

    #[test]
    fn disclosure_unfolds_without_changing_source_selection_or_history() {
        let mut app = app();
        let window = app.open_window(SourceProbe::new);
        let handle = window.handle();
        let source = window.read(|probe, _| probe.source.clone());
        let before = app.read(|cx| {
            let state = source.read(cx);
            (
                state.text().to_string(),
                state.selected_range(),
                state.can_undo(),
                state.can_redo(),
            )
        });
        with_window(&mut app, handle, |window, cx| {
            window.resize(size(px(640.), px(606.)));
            window.bounds_changed(cx);
            window.render_frame(cx);
            let target = window.find("source-document-helpers");
            assert_eq!(target.role(), Some(Role::Button));
            assert_eq!(target.label(), Some("folded code"));
            assert!(target.visible());
            window.click("source-document-helpers", cx);
            assert!(window.try_find("source-document-helpers").is_none());
        });
        app.read(|cx| {
            let state = source.read(cx);
            assert!(!state.is_folded_at(0));
            assert_eq!(state.text().to_string(), before.0);
            assert_eq!(state.selected_range(), before.1);
            assert_eq!(state.can_undo(), before.2);
            assert_eq!(state.can_redo(), before.3);
        });
    }

    #[test]
    fn mounted_original_ribbon_handles_hover_disabled_tools_and_disclosure() {
        let mut app = app();
        let mut window = app.open_window(SourceProbe::new);
        let handle = window.handle();
        let source = window.read(|probe, _| probe.source.clone());
        window.update(|probe, _, cx| {
            probe.ribbon = true;
            cx.notify();
        });
        with_window(&mut app, handle, |window, cx| {
            window.resize(size(px(1280.), px(606.)));
            window.bounds_changed(cx);
            window.render_frame(cx);
            let ribbon = window.find("source-ribbon");
            assert_eq!(ribbon.role(), Some(Role::Toolbar));
            assert_eq!(ribbon.label(), Some("Typst source tools"));
            assert_eq!(ribbon.bounds().size.height, px(40.));
            for id in [
                "source-undo",
                "source-redo",
                "source-find",
                "source-go-to-line",
                "source-insert-bold",
                "source-insert-italic",
                "source-insert-heading",
                "source-insert-equation",
                "source-insert-link",
                "source-insert-page-break",
                "source-comment",
                "source-wrap",
                "save-source-copy",
            ] {
                let button = window.find(id);
                assert_eq!(button.role(), Some(Role::Button));
                assert!(button.visible(), "mounted source tool: {id}");
                assert_eq!(button.bounds().size.height, px(30.));
                window.hover(id, cx);
            }
            // Disabled metadata belongs to this same actual button node;
            // disabled interaction is also tested through dispatch below.
            window.click("source-undo", cx);
            window.click("source-find", cx);
            window.click("source-wrap", cx);
            window.click("source-document-helpers", cx);
            assert!(!source.read(cx).is_folded_at(0));
            assert_eq!(source.read(cx).text().to_string(), NOTEBOOK);
            assert!(!source.read(cx).can_undo());
            assert!(!source.read(cx).can_redo());
        });
        window.read(|probe, _| {
            assert_eq!(probe.tool_clicks, ["source-find", "source-wrap"]);
        });
    }

    #[test]
    fn readonly_rejects_native_input_but_still_allows_helper_disclosure() {
        let mut app = app();
        let mut window = app.open_window(SourceProbe::new);
        let handle = window.handle();
        let source = window.read(|probe, _| probe.source.clone());
        window.update(|probe, _, cx| {
            probe.readonly = true;
            cx.notify();
        });
        with_window(&mut app, handle, |window, cx| {
            window.render_frame(cx);
            source.update(cx, |state, cx| state.focus(window, cx));
            window.input("preserved readonly source 🦊", cx);
            window.press("backspace", cx);
            window.click("source-document-helpers", cx);
        });
        app.read(|cx| {
            let state = source.read(cx);
            assert_eq!(state.text().to_string(), NOTEBOOK);
            assert!(!state.can_undo());
            assert!(!state.can_redo());
            assert!(!state.is_folded_at(0));
        });
    }

    #[test]
    fn readonly_ribbon_exposes_the_same_disabled_native_node_and_enabled_unfold() {
        let mut app = app();
        let mut window = app.open_window(SourceProbe::new);
        let handle = window.handle();
        let source = window.read(|probe, _| probe.source.clone());
        window.update(|probe, _, cx| {
            probe.readonly = true;
            probe.ribbon = true;
            cx.notify();
        });
        with_window(&mut app, handle, |window, cx| {
            window.resize(size(px(1280.), px(606.)));
            window.bounds_changed(cx);
            window.render_frame(cx);
            for id in [
                "source-undo",
                "source-redo",
                "source-insert-bold",
                "source-insert-italic",
                "source-insert-heading",
                "source-insert-equation",
                "source-insert-link",
                "source-insert-page-break",
                "source-comment",
            ] {
                let node = window.find(id);
                assert_eq!(node.role(), Some(Role::Button));
                assert_eq!(node.disabled(), Some(true), "disabled node: {id}");
                assert_eq!(node.bounds().size.height, px(30.));
                window.click(id, cx);
            }
            for id in [
                "source-find",
                "source-go-to-line",
                "source-wrap",
                "save-source-copy",
            ] {
                assert_ne!(window.find(id).disabled(), Some(true), "enabled node: {id}");
            }
            let disclosure = window.find("source-document-helpers");
            assert_eq!(disclosure.role(), Some(Role::Button));
            assert_ne!(disclosure.disabled(), Some(true));
            window.click("source-document-helpers", cx);
            assert!(window.try_find("source-document-helpers").is_none());
        });
        window.read(|probe, _| assert!(probe.tool_clicks.is_empty()));
        app.read(|cx| {
            let state = source.read(cx);
            assert_eq!(state.text().to_string(), NOTEBOOK);
            assert!(!state.is_folded_at(0));
            assert!(!state.can_undo());
            assert!(!state.can_redo());
        });
        window.update(|probe, _, cx| {
            probe.readonly = false;
            cx.notify();
        });
        with_window(&mut app, handle, |window, cx| {
            window.render_frame(cx);
            let node = window.find("source-insert-bold");
            assert_ne!(node.disabled(), Some(true));
            window.click("source-insert-bold", cx);
        });
        window.read(|probe, _| assert_eq!(probe.tool_clicks, ["source-insert-bold"]));
    }

    #[test]
    fn clipped_scrolled_and_non_helper_source_cannot_expose_a_stale_disclosure() {
        let mut app = app();
        let window = app.open_window(SourceProbe::new);
        let handle = window.handle();
        let source = window.read(|probe, _| probe.source.clone());
        with_window(&mut app, handle, |window, cx| {
            window.resize(size(px(160.), px(120.)));
            window.bounds_changed(cx);
            window.render_frame(cx);
            // The source header itself wraps beyond the right edge in this
            // virtual font. Any disclosure hitbox is clipped to the field.
            if let Some(target) = window.try_find("source-document-helpers") {
                assert!(target.bounds().origin.x >= px(0.));
            }
            let long = format!(
                "{NOTEBOOK}\n{}",
                "#text(\"A visible source line.\")\n".repeat(80)
            );
            source.update(cx, |state, cx| {
                source_editor::set_source(state, long, window, cx)
            });
            window.resize(size(px(640.), px(120.)));
            window.bounds_changed(cx);
            window.render_frame(cx);
            assert!(window.try_find("source-document-helpers").is_some());
            window.scroll(
                "source-probe",
                ScrollDelta::Pixels(point(px(0.), px(-240.))),
                cx,
            );
            window.render_frame(cx);
            assert!(source.read(cx).scroll_offset().y < px(0.));
            assert!(
                source
                    .read(cx)
                    .range_to_bounds(&(HELPER_HEADER.len()..HELPER_HEADER.len()))
                    .is_none()
            );
            assert!(window.try_find("source-document-helpers").is_none());
            source.update(cx, |state, cx| {
                source_editor::set_source(state, "= Ordinary source\n\nCafé 東京 🦊", window, cx)
            });
            window.render_frame(cx);
            assert!(window.try_find("source-document-helpers").is_none());
            assert_eq!(
                source.read(cx).text().to_string(),
                "= Ordinary source\n\nCafé 東京 🦊"
            );
        });
    }

    #[test]
    fn actual_source_preferences_and_geometry_match_executed_codemirror() {
        let reference: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/source_view/web-reference.json"))
                .unwrap();
        assert_eq!(reference["blockedNetworkRequests"], 0);
        assert_eq!(reference["cases"][0]["result"]["source"], NOTEBOOK);
        for case in reference["cases"].as_array().unwrap() {
            let result = &case["result"];
            assert_eq!(result["content"]["padding"], "16px 0px");
            assert_eq!(result["line"]["padding"], "0px 16px");
            assert_eq!(result["number"]["padding"], "0px 3px 0px 5px");
            assert_eq!(result["fold"]["padding"], "0px 1px");
            if let Some(unfold) = result["unfold"].as_object() {
                assert!(unfold.values().all(|value| value == true));
            }
        }
        let mut app = app();
        let window = app.open_window(SourceProbe::new);
        with_window(&mut app, window.handle(), |window, cx| {
            for preset in theme::ThemePreset::APPEARANCE_ORDER {
                theme::apply_preference(
                    &theme::ThemePreference {
                        preset: *preset,
                        ..Default::default()
                    },
                    cx,
                )
                .unwrap();
                let presentation = source_presentation(window, cx);
                assert_eq!(presentation.line_height, Some(px(SOURCE_ROW_HEIGHT_PX)));
                assert_eq!(presentation.wrap_right_margin, Some(px(0.)));
                let colors = *theme::palette(cx);
                let style = presentation.style.unwrap();
                assert_eq!(style.foreground, Hsla::from(rgb(colors.ink)));
                assert_eq!(style.muted_foreground, Hsla::from(rgb(colors.ink_light)));
                assert_eq!(style.background, Hsla::from(rgb(colors.page)));
                assert_eq!(style.caret, Hsla::from(rgb(colors.ink)));
                assert_eq!(style.selection.a, 0.16);
                assert_eq!(
                    style.editor_active_line,
                    Some(rgb(colors.paper_soft).into())
                );
                let padding = presentation.paddings.unwrap();
                assert_eq!(padding.top, px(16.));
                assert_eq!(padding.bottom, px(16.));
                assert_eq!(padding.right, px(16.));
                assert_eq!(padding.left, px(0.));
                let gutter = presentation.gutter.unwrap();
                assert_eq!(gutter.min_digits, 1);
                assert_eq!(gutter.min_number_width, px(20.));
                assert_eq!(gutter.number_padding_left, px(5.));
                assert_eq!(gutter.number_padding_right, px(3.));
                assert_eq!(gutter.fold_icon_padding, px(1.));
                assert_eq!(gutter.border_width, px(1.));
                assert_eq!(gutter.text_gap, px(16.));
                assert!(gutter.always_show_folds);
                assert!(!gutter.highlight_active_number);
            }
        });
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn wrapped_helper_matches_standards_rows_caret_ime_and_both_readonly_fragment_clicks() {
        use gpui_kit::EntityInputHandler;
        let reference: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/source_view/web-reference.json"))
                .unwrap();
        let mut app = TestApp::with_text_system_and_assets(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let mut window = app.open_window(SourceProbe::new);
        let source = window.read(|probe, _| probe.source.clone());
        let handle = window.handle();
        window.update(|probe, _, cx| {
            probe.readonly = true;
            cx.notify();
        });
        with_window(&mut app, handle, |window, cx| {
            source.update(cx, |state, cx| state.set_selected_range(19..19, cx));
            for (id, width, rows, source_rows) in [
                ("editorial", 1280., 1, 1),
                ("split", 640., 1, 1),
                ("narrow", 320., 2, 1),
                ("very-narrow", 160., 4, 2),
            ] {
                window.resize(size(px(width), px(606.)));
                window.bounds_changed(cx);
                window.render_frame(cx);
                let case = reference["cases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|c| c["id"] == id)
                    .unwrap();
                let state = source.read(cx);
                let next = state.text().line_start_offset(115);
                let authored = state.range_to_bounds(&(next..next)).unwrap();
                assert_eq!(
                    authored.top(),
                    px(16. + rows as f32 * SOURCE_ROW_HEIGHT_PX),
                    "{id}: reserved actual display rows"
                );
                let anchor = state.range_to_bounds(&(19..19)).unwrap();
                assert_eq!(
                    anchor.top(),
                    px(16. + (source_rows - 1) as f32 * SOURCE_ROW_HEIGHT_PX),
                    "{id}: before-widget anchor affinity"
                );
                let fragments = state.fold_placeholder_bounds().unwrap();
                assert_eq!(fragments.len(), 2);
                for (i, fragment) in fragments.iter().enumerate() {
                    let expected =
                        &case["result"]["placeholder"]["fragments"][if rows == 1 { 0 } else { i }];
                    let x = f32::from(fragment.left()) + if i == 0 { 1. } else { 0. };
                    if rows > 1 || i == 0 {
                        assert!(
                            (x - expected["x"].as_f64().unwrap() as f32).abs() < 0.08,
                            "{id}: source-derived fragment x"
                        );
                    }
                    assert_eq!(
                        fragment.top() + px(1.),
                        px(expected["y"].as_f64().unwrap() as f32)
                    );
                    if rows > 1 {
                        assert!(
                            (f32::from(fragment.size.width)
                                - 1.
                                - expected["width"].as_f64().unwrap() as f32)
                                .abs()
                                < 0.08
                        );
                    }
                }
                assert_eq!(state.text().to_string(), NOTEBOOK);
                assert_eq!(state.selected_range(), 19..19);
                assert!(!state.can_undo());
                assert!(!state.can_redo());
                let text_bounds = state.text_bounds().unwrap();
                source.update(cx, |state, cx| {
                    let ime = state
                        .bounds_for_range(19..19, text_bounds, window, cx)
                        .unwrap();
                    assert_eq!(ime.top(), anchor.top());
                    assert_eq!(ime.left(), anchor.left());
                    assert_eq!(ime.size.height, px(SOURCE_ROW_HEIGHT_PX));
                });
                let button = window.find("source-document-helpers");
                assert_eq!(button.role(), Some(Role::Button));
                assert_eq!(button.label(), Some("folded code"));
                assert_ne!(button.disabled(), Some(true));
            }
            // Each real sliced fragment is clickable in read-only Source.
            for id in [
                "source-document-helpers-document",
                "source-document-helpers-helpers",
            ] {
                window.click(id, cx);
                assert!(!source.read(cx).is_folded_at(0));
                assert!(source.read(cx).fold_placeholder_bounds().is_none());
                assert_eq!(source.read(cx).text().to_string(), NOTEBOOK);
                assert_eq!(source.read(cx).selected_range(), 19..19);
                assert!(!source.read(cx).can_undo());
                assert!(!source.read(cx).can_redo());
                // Removing the widget retains Source's exact ASCII marker
                // wrapping; the caret stays before any presentation content.
                assert_eq!(
                    source.read(cx).range_to_bounds(&(19..19)).unwrap().top(),
                    px(16. + SOURCE_ROW_HEIGHT_PX)
                );
                source.update(cx, |state, cx| {
                    assert!(state.set_folded(0, true, cx));
                });
                window.render_frame(cx);
            }
        });
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn wrapped_helper_resize_preserves_native_edit_undo_redo_and_replacement_clears_rows() {
        let mut app = TestApp::with_text_system_and_assets(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let window = app.open_window(SourceProbe::new);
        let source = window.read(|probe, _| probe.source.clone());
        with_window(&mut app, window.handle(), |window, cx| {
            window.resize(size(px(320.), px(606.)));
            window.bounds_changed(cx);
            window.render_frame(cx);
            let at = source.read(cx).text().line_start_offset(115);
            source.update(cx, |state, cx| {
                state.set_selected_range(at..at, cx);
                state.focus(window, cx);
            });
            window.input("Z", cx);
            let expected = format!("{}Z{}", &NOTEBOOK[..at], &NOTEBOOK[at..]);
            assert_eq!(source.read(cx).text().to_string(), expected);
            assert!(source.read(cx).can_undo());
            assert!(!source.read(cx).can_redo());
            let selection = source.read(cx).selected_range();
            for width in [160., 640., 1280., 320.] {
                window.resize(size(px(width), px(606.)));
                window.bounds_changed(cx);
                window.render_frame(cx);
                assert_eq!(source.read(cx).text().to_string(), expected);
                assert_eq!(source.read(cx).selected_range(), selection);
                assert!(source.read(cx).can_undo());
                assert!(!source.read(cx).can_redo());
            }
            window.press("ctrl-z", cx);
            assert_eq!(source.read(cx).text().to_string(), NOTEBOOK);
            assert!(!source.read(cx).can_undo());
            assert!(source.read(cx).can_redo());
            window.resize(size(px(160.), px(606.)));
            window.bounds_changed(cx);
            window.render_frame(cx);
            assert!(source.read(cx).can_redo());
            window.press("ctrl-y", cx);
            assert_eq!(source.read(cx).text().to_string(), expected);
            assert!(source.read(cx).can_undo());
            assert!(!source.read(cx).can_redo());
            window.press("ctrl-z", cx);
            assert_eq!(source.read(cx).text().to_string(), NOTEBOOK);
            assert!(source.read(cx).can_redo());
            window.press("ctrl-shift-z", cx);
            assert_eq!(source.read(cx).text().to_string(), expected);
            assert!(source.read(cx).can_undo());
            assert!(!source.read(cx).can_redo());

            source.update(cx, |state, cx| {
                source_editor::set_source(state, "= Ordinary source\nCafé 東京", window, cx);
            });
            window.render_frame(cx);
            assert!(source.read(cx).fold_placeholder_bounds().is_none());
            assert!(window.try_find("source-document-helpers").is_none());
            let next = source.read(cx).text().line_start_offset(1);
            let position = source.read(cx).range_to_bounds(&(next..next)).unwrap();
            // An ordinary long heading may wrap at160px; no helper display
            // rows remain in its following source line or its editing history.
            assert!(position.top() < px(16. + 4. * SOURCE_ROW_HEIGHT_PX));
            assert!(!source.read(cx).can_undo());
            assert!(!source.read(cx).can_redo());
            source.update(cx, |state, cx| {
                source_editor::set_source(state, NOTEBOOK, window, cx);
                state.set_soft_wrap(false, window, cx);
            });
            window.render_frame(cx);
            let next = source.read(cx).text().line_start_offset(115);
            assert_eq!(
                source
                    .read(cx)
                    .range_to_bounds(&(next..next))
                    .unwrap()
                    .top(),
                px(16. + SOURCE_ROW_HEIGHT_PX)
            );
            assert!(source.read(cx).fold_placeholder_bounds().is_some());
            assert_eq!(source.read(cx).text().to_string(), NOTEBOOK);
        });
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn real_native_source_layout_has_original_spacing_and_measured_helper_control() {
        let mut app = TestApp::with_text_system_and_assets(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let window = app.open_window(SourceProbe::new);
        let source = window.read(|probe, _| probe.source.clone());
        with_window(&mut app, window.handle(), |window, cx| {
            window.resize(size(px(640.), px(606.)));
            window.bounds_changed(cx);
            window.render_frame(cx);
            let state = source.read(cx);
            let first = state.range_to_bounds(&(0..0)).unwrap();
            assert!(
                (f32::from(first.origin.x) - 58.21875).abs() < 0.2,
                "native font's small advance difference is bounded: {first:?}"
            );
            assert_eq!(first.origin.y, px(16.));
            assert_eq!(state.line_height(), Some(px(SOURCE_ROW_HEIGHT_PX)));
            let disclosure = window.find("source-document-helpers").bounds();
            assert!(
                (f32::from(disclosure.size.width) - 108.0625).abs() < 0.3,
                "actual native helpers geometry: {disclosure:?}"
            );
            assert_eq!(disclosure.size.height, px(20.));
            assert_eq!(disclosure.origin.y, first.origin.y + px(1.));
            let line_end = state
                .range_to_bounds(&(HELPER_HEADER.len()..HELPER_HEADER.len()))
                .unwrap();
            assert!(
                (f32::from(disclosure.origin.x - line_end.origin.x) - 1.).abs()
                    <= 0.5 / window.scale_factor(),
                "inline margin may only drift within one physical rounding step"
            );
            assert!(disclosure.bottom() <= first.bottom());
        });
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires an explicit local GPU/software Vulkan renderer"]
    fn actual_native_gpu_source_fonts_preserve_caret_selection_and_comment_bytes() {
        let original = include_str!("../fixtures/source_view/source-cjk.typ");
        let reference: serde_json::Value = serde_json::from_str(include_str!(
            "../fixtures/source_view/font-evidence/web-cjk-fonts.json"
        ))
        .unwrap();
        assert_eq!(reference["geometry"]["source"], original);
        let mut app = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
            gpui_kit::platform::current_headless_renderer,
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let handle = app
            .open_window(size(px(640.), px(160.)), |window, cx| {
                cx.new(|cx| SourceProbe::new(window, cx))
            })
            .unwrap();
        let report = app
            .update_window(handle.into(), |root, window, cx| {
                let probe = root.downcast::<SourceProbe>().unwrap();
                probe.update(cx, |probe, cx| {
                    probe.readonly = true;
                    probe.source.update(cx, |state, cx| {
                        source_editor::set_source(state, original, window, cx);
                        let comment_start = original.find("// Source comment").unwrap();
                        state.set_selected_range(comment_start..original.len() - 1, cx);
                    });
                    cx.notify();
                });
                window.render_frame(cx);
                let source = probe.read(cx).source.clone();
                let state = source.read(cx);
                assert_eq!(state.text().to_string(), original);
                assert!(!state.can_undo());
                assert!(!state.can_redo());
                assert_eq!(state.selected_text().to_string(), "// Source comment: Café = #text(\"m\")");
                assert!(window.try_find("source-document-helpers").is_none());
                let selection = state.selected_range();
                let mut lines = Vec::new();
                for (row, reference) in reference["geometry"]["lines"]
                    .as_array().unwrap().iter().enumerate()
                {
                    let start = state.text().line_start_offset(row);
                    let mut glyphs = Vec::new();
                    for glyph in reference["glyphs"].as_array().unwrap() {
                        let offset = start + glyph["sourceByteOffset"].as_u64().unwrap() as usize;
                        let caret = state.range_to_bounds(&(offset..offset)).unwrap();
                        let browser_x = glyph["x"].as_f64().unwrap() as f32;
                        assert!((f32::from(caret.left()) - browser_x).abs() < 0.08,
                            "row{row} {:?}: native caret must retain measured original advance, {caret:?} vs {browser_x}", glyph["character"]);
                        assert_eq!(caret.top(), px(16. + row as f32 * SOURCE_ROW_HEIGHT_PX));
                        glyphs.push(serde_json::json!({"character":glyph["character"],"sourceByteOffset":offset,"nativeCaret":caret,"browserX":browser_x}));
                    }
                    lines.push(serde_json::json!({"row":row,"glyphs":glyphs}));
                }
                let caret_width = state.range_to_bounds(&(0..1)).unwrap().size.width;
                assert!((f32::from(caret_width) - 7.8).abs() < 0.001);
                serde_json::json!({"source":original,"sourceUnchanged":true,
                    "family":theme::SOURCE_FONT,"sourceSelectionBytes":selection,
                    "canUndo":state.can_undo(),"canRedo":state.can_redo(),
                    "commentBytesUnchanged":true,"readonly":true,"lines":lines,
                    "actualEditorRaster":true,"selectedFaceProof":"native-selected-faces.json",
                    "boundary":"Quarter-shear native oblique; actual Chromium synthetic AA/hint raster remains distinct. Droid CJK/kana explicit; Hangul/emoji platform-dependent.",
                    "deviceScaleFactor":window.scale_factor()})
            })
            .unwrap();
        let selected_screenshot = app.capture_screenshot(handle.into()).unwrap();
        // A second explicit fixture frame uses the original reference's caret
        // at byte0 for the raster comparison. The nonempty readonly selection
        // above has already been checked independently of this capture action.
        app.update_window(handle.into(), |root, window, cx| {
            let probe = root.downcast::<SourceProbe>().unwrap();
            let source = probe.read(cx).source.clone();
            source.update(cx, |state, cx| state.set_selected_range(0..0, cx));
            window.render_frame(cx);
            assert_eq!(source.read(cx).text().to_string(), original);
            assert!(!source.read(cx).can_undo());
            assert!(!source.read(cx).can_redo());
        })
        .unwrap();
        let screenshot = app.capture_screenshot(handle.into()).unwrap();
        if let Some(directory) = std::env::var_os("TWYNE_SOURCE_CAPTURE_DIR") {
            let directory = std::path::PathBuf::from(directory);
            std::fs::create_dir_all(&directory).unwrap();
            screenshot
                .save(directory.join("native-source-fonts.png"))
                .unwrap();
            selected_screenshot
                .save(directory.join("native-source-fonts-selected.png"))
                .unwrap();
            std::fs::write(
                directory.join("native-source-fonts.json"),
                serde_json::to_string_pretty(&report).unwrap(),
            )
            .unwrap();
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "actual ASCII wrap gate requires an explicit local GPU/software Vulkan renderer"]
    fn actual_native_gpu_source_hyphen_wrap_probe() {
        let reference_path = std::env::var_os("TWYNE_SOURCE_HYPHEN_REFERENCE")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("fixtures/source_view/hyphen-wrap/web-hyphen-wrap.json")
            });
        let reference: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(reference_path).unwrap()).unwrap();
        let mut app = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
            gpui_kit::platform::current_headless_renderer,
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let directory =
            std::env::var_os("TWYNE_SOURCE_HYPHEN_CAPTURE_DIR").map(std::path::PathBuf::from);
        if let Some(directory) = &directory {
            std::fs::create_dir_all(directory).unwrap();
        }
        let mut cases = Vec::new();
        for case in reference["cases"].as_array().unwrap() {
            let width = case["width"].as_u64().unwrap() as f32;
            let handle = app
                .open_window(size(px(width), px(606.)), |window, cx| {
                    cx.new(|cx| SourceProbe::new(window, cx))
                })
                .unwrap();
            let mut results = Vec::new();
            for entry in case["results"].as_array().unwrap() {
                let original = entry["source"].as_str().unwrap();
                let record = app
                    .update_window(handle.into(), |root, window, cx| {
                        let probe = root.downcast::<SourceProbe>().unwrap();
                        probe.update(cx, |probe, cx| {
                            probe.readonly = true;
                            probe.source.update(cx, |state, cx| {
                                source_editor::set_source(state, original, window, cx);
                                state.set_soft_wrap(true, window, cx);
                            });
                            cx.notify();
                        });
                        window.render_frame(cx);
                        let state = probe.read(cx).source.read(cx);
                        assert_eq!(state.text().to_string(), original);
                        assert!(!state.can_undo() && !state.can_redo());
                        assert!(state.fold_placeholder_bounds().is_none());
                        let text = state.text().slice_line(0).to_string();
                        let mut rows: std::collections::BTreeMap<i64, String> =
                            std::collections::BTreeMap::new();
                        let mut boundaries = Vec::new();
                        for (offset, scalar) in text.char_indices() {
                            let bounds = state.range_to_bounds(&(offset..offset)).unwrap();
                            rows.entry((f32::from(bounds.top()) * 64.).round() as i64)
                                .or_default()
                                .push(scalar);
                            boundaries.push(serde_json::json!({
                                "byte":offset,
                                "x":f32::from(bounds.left()),
                                "y":f32::from(bounds.top())
                            }));
                        }
                        let row_texts: Vec<_> = rows.into_values().collect();
                        let ascii_eligible = text.bytes().all(|byte| (b' '..=b'~').contains(&byte));
                        if ascii_eligible {
                            assert_eq!(serde_json::to_value(&row_texts).unwrap(), entry["rowTexts"],
                                "width {width}, {}: Source ASCII rows match executed CodeMirror",
                                entry["id"].as_str().unwrap());
                        }
                        let first = state.range_to_bounds(&(0..0)).unwrap();
                        serde_json::json!({
                            "id":entry["id"],
                            "source":original,
                            "sourceUnchanged":true,
                            "canUndo":false,
                            "canRedo":false,
                            "contentWidth":width-f32::from(first.left())-SOURCE_CODE_INSET_PX,
                            "rowTexts":row_texts,
                            "matchesBrowserRows":serde_json::to_value(&row_texts).unwrap()==entry["rowTexts"],
                            "asciiRowsVerified":ascii_eligible,
                            "boundaries":boundaries
                        })
                    })
                    .unwrap();
                if width == 160.
                    && matches!(
                        entry["id"].as_str().unwrap(),
                        "ascii-hyphen" | "marker-ordinary" | "minus-digit"
                    )
                    && let Some(directory) = &directory
                {
                    app.capture_screenshot(handle.into())
                        .unwrap()
                        .save(
                            directory.join(format!("native-{}.png", entry["id"].as_str().unwrap())),
                        )
                        .unwrap();
                }
                results.push(record);
            }
            cases.push(serde_json::json!({"width":width,"results":results}));
        }
        if let Some(directory) = &directory {
            std::fs::write(
                directory.join("native-hyphen-wrap.json"),
                serde_json::to_string_pretty(&serde_json::json!({
                    "renderer":"Actual GPUI WGPU headless with real Linux text system and Source-only original Mono",
                    "boundary":"Printable-ASCII Source rows verified against original CodeMirror. Non-ASCII remains upstream and can differ; no general Source wrapping or raster parity claim.",
                    "cases":cases
                }))
                .unwrap(),
            )
            .unwrap();
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires an explicit local GPU/software Vulkan renderer"]
    fn actual_native_gpu_source_fixture_retains_canonical_bytes_and_geometry() {
        let reference: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/source_view/web-reference.json"))
                .unwrap();
        let mut app = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(assets::TwyneAssets),
            gpui_kit::platform::current_headless_renderer,
        );
        app.update(|cx| {
            gpui_kit::init(cx);
            theme::apply(cx).unwrap();
        });
        let directory = std::env::var_os("TWYNE_SOURCE_CAPTURE_DIR").map(std::path::PathBuf::from);
        if let Some(directory) = &directory {
            std::fs::create_dir_all(directory).unwrap();
        }
        let mut measurements = Vec::new();
        for case in reference["cases"].as_array().unwrap() {
            let id = case["id"].as_str().unwrap();
            let width = case["width"].as_u64().unwrap() as f32;
            let original = case["result"]["source"].as_str().unwrap();
            let preference = theme::normalize_preference(&serde_json::json!({
                "preset":case["preset"].as_str().unwrap_or("editorial")
            }));
            app.update(|cx| theme::apply_preference(&preference, cx).unwrap());
            let handle = app
                .open_window(size(px(width), px(606.)), |window, cx| {
                    cx.new(|cx| SourceProbe::new(window, cx))
                })
                .unwrap();
            let record = app
                .update_window(handle.into(), |root, window, cx| {
                    let probe = root.downcast::<SourceProbe>().unwrap();
                    probe.update(cx, |probe, cx| {
                        probe.readonly = case["readonly"].as_bool().unwrap_or(false);
                        probe.source.update(cx, |state, cx| {
                            source_editor::set_source(state, original, window, cx);
                            state.set_soft_wrap(case["wrap"].as_bool().unwrap_or(true), window, cx);
                        });
                        cx.notify();
                    });
                    window.render_frame(cx);
                    let source = probe.read(cx).source.clone();
                    if id == "scrolled" {
                        source.update(cx, |state, cx| {
                            state.set_scroll_offset(
                                point(
                                    px(0.),
                                    px(-case["result"]["scroll"]["y"].as_f64().unwrap() as f32),
                                ),
                                cx,
                            );
                        });
                        window.render_frame(cx);
                    }
                    let state = source.read(cx);
                    assert_eq!(state.text().to_string(), original, "{id}: canonical source");
                    assert!(
                        !state.can_undo(),
                        "{id}: presentation must not enter history"
                    );
                    assert!(!state.can_redo());
                    assert_eq!(state.line_height(), Some(px(SOURCE_ROW_HEIGHT_PX)));
                    let first = state.range_to_bounds(&(0..0));
                    let helper = window
                        .try_find("source-document-helpers")
                        .map(|target| target.bounds());
                    let helper_fragments = state.fold_placeholder_bounds().map(|fragments| {
                        let last = fragments.len() - 1;
                        fragments
                            .iter()
                            .enumerate()
                            .map(|(i, raw)| {
                                let mut bounds = *raw;
                                if i == 0 {
                                    bounds.origin.x += px(1.);
                                    bounds.size.width -= px(1.);
                                }
                                if i == last {
                                    bounds.size.width -= px(1.);
                                }
                                bounds.origin.y += px(1.);
                                bounds.size.height = px(20.);
                                bounds
                            })
                            .collect::<Vec<_>>()
                    });
                    if id == "scrolled" {
                        assert!(first.is_none(), "offscreen source has no visible bounds");
                        assert!(helper.is_none());
                    } else {
                        let first = first.unwrap();
                        let web_x = case["result"]["firstText"]["x"].as_f64().unwrap() as f32;
                        assert!(
                            (f32::from(first.origin.x) - web_x).abs() < 0.25,
                            "{id}: first source x differs from executed browser: {first:?}"
                        );
                        assert_eq!(first.origin.y, px(16.));
                    }
                    if case["lines"].is_number() {
                        assert!(
                            helper.is_none(),
                            "ordinary source has no helpers disclosure"
                        );
                    }
                    if let Some(fragments) = &helper_fragments {
                        let web = &case["result"]["placeholder"]["fragments"];
                        let mut native = fragments.clone();
                        // A single browser inline box is sliced internally
                        // into our two adjacent words without a visual seam.
                        if web.as_array().unwrap().len() == 1 {
                            native = vec![fragments[0].union(&fragments[1])];
                        }
                        assert_eq!(native.len(), web.as_array().unwrap().len());
                        for (bounds, expected) in native.iter().zip(web.as_array().unwrap()) {
                            assert!(
                                (f32::from(bounds.left()) - expected["x"].as_f64().unwrap() as f32)
                                    .abs()
                                    < 0.08,
                                "{id}: actual Source helper fragment x"
                            );
                            assert!(
                                (f32::from(bounds.size.width)
                                    - expected["width"].as_f64().unwrap() as f32)
                                    .abs()
                                    < 0.08,
                                "{id}: original opsz11 helper advances"
                            );
                            assert_eq!(bounds.top(), px(expected["y"].as_f64().unwrap() as f32));
                            assert_eq!(bounds.size.height, px(20.));
                        }
                        let next = state.text().line_start_offset(115);
                        let authored = state.range_to_bounds(&(next..next)).unwrap();
                        assert_eq!(
                            authored.top(),
                            px(16.
                                + case["result"]["line"]["bounds"]["height"].as_f64().unwrap()
                                    as f32),
                            "{id}: actual following source row clears wrapped helper height"
                        );
                    }
                    let visible_rows: Vec<_> = case["result"]["visibleRows"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|web| {
                            let line = web["sourceLine"].as_u64().unwrap() as usize;
                            let text = state.text().slice_line(line - 1).to_string();
                            let start = state.text().line_start_offset(line - 1);
                            let mut rows: std::collections::BTreeMap<i64, String> =
                                std::collections::BTreeMap::new();
                            for (local, scalar) in text.char_indices() {
                                // The range API's leading affinity belongs to
                                // the glyph beginning at a soft-wrap boundary.
                                let offset = start + local;
                                if let Some(bounds) = state.range_to_bounds(&(offset..offset)) {
                                    rows.entry((f32::from(bounds.top()) * 64.).round() as i64)
                                        .or_default()
                                        .push(scalar);
                                }
                            }
                            let row_texts: Vec<_> = rows.into_values().collect();
                            if (id == "split" && line == 118)
                                || (line == 1 && helper_fragments.is_some())
                            {
                                assert_eq!(
                                    serde_json::to_value(&row_texts).unwrap(),
                                    web["rowTexts"],
                                    "gated Source row wraps must match the executed browser"
                                );
                            }
                            serde_json::json!({"sourceLine":line,"rowTexts":row_texts})
                        })
                        .collect();
                    serde_json::json!({
                        "id":id,
                        "width":width,
                        "height":606,
                        "deviceScaleFactor":window.scale_factor(),
                        "lineHeight":f32::from(state.line_height().unwrap()),
                        "firstSource":first,
                        "helper":helper,
                        "helperFragments":helper_fragments,
                        "visibleRows":visible_rows,
                        "scrollOffset":state.scroll_offset(),
                        "sourceBytes":original.len(),
                        "sourceUnchanged":true,
                        "canUndo":state.can_undo(),
                        "canRedo":state.can_redo(),
                        "wrappedHelperRowsVerified":helper_fragments.is_some()
                    })
                })
                .unwrap();
            let pixels = app.capture_screenshot(handle.into()).unwrap();
            let palette = theme::resolve_palette(&preference, false);
            let background = [
                (palette.page >> 16) as u8,
                (palette.page >> 8) as u8,
                palette.page as u8,
                255,
            ];
            assert_eq!(
                pixels.get_pixel(pixels.width() - 4, 200).0,
                background,
                "{id}: actual native source background"
            );
            if let Some(directory) = &directory {
                pixels
                    .save(directory.join(format!("native-{id}.png")))
                    .unwrap();
            }
            measurements.push(record);
        }
        if let Some(directory) = &directory {
            std::fs::write(
                directory.join("native-reference.json"),
                serde_json::to_string_pretty(&serde_json::json!({
                    "renderer":"GPUI WGPU HeadlessRenderer with real Linux text system",
                    "reference":"executed original CodeMirror and source CSS",
                    "wrappedHelperRows":"actual native presentation rows verified at1280/640/320/160px; exact marker and sliced helper boxes",
                    "boundary":"ordinary/unfolded Source hyphen wrapping remains upstream; quarter-shear and antialias raster differences remain separate from measured geometry",
                    "cases":measurements
                }))
                .unwrap(),
            )
            .unwrap();
        }
    }
}
