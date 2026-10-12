//! Title and body controls for exact-text prototype drafts.
//! Rich/Typst workspaces keep their existing single native document editor.
use super::*;

pub(super) fn title_state(
    window: &mut Window,
    cx: &mut Context<WritingRoom>,
) -> Entity<TextareaState> {
    cx.new(|cx| {
        TextareaState::new(window, cx)
            .auto_grow(1, twyne_desktop::manuscript::MAX_DOCUMENT_BYTES)
            .submit_on_enter(true)
            .placeholder("Untitled manuscript")
    })
}

impl WritingRoom {
    pub(super) fn prototype_title_event(
        &mut self,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            InputEvent::Change => {
                self.changed(window, cx);
                self.reveal_caret_next_frame(window, cx);
            }
            InputEvent::PressEnter { shift: false, .. } => {
                if self.rich.is_none() {
                    self.body.update(cx, |body, cx| {
                        body.set_selected_range(0..0, cx);
                        body.focus(window, cx);
                    });
                }
                self.reveal_caret_next_frame(window, cx);
            }
            _ => {}
        }
    }

    pub(super) fn prototype_caret_line_bounds(
        &self,
        window: &Window,
        cx: &App,
    ) -> Option<gpui_kit::Bounds<gpui_kit::Pixels>> {
        if self.rich.is_some() || self.reading {
            return None;
        }
        [&self.title, &self.body].into_iter().find_map(|state| {
            let state = state.read(cx);
            if !state.focus_handle(cx).is_focused(window) {
                return None;
            }
            let (bounds, line_height) = state.cursor_layout()?;
            // GPUI's caret occupies 85% of the line. Reveal the complete line,
            // including its leading, so title accents/descenders stay visible.
            Some(gpui_kit::Bounds::new(
                gpui_kit::point(bounds.left(), bounds.center().y - line_height / 2.),
                gpui_kit::size(bounds.size.width, line_height),
            ))
        })
    }

    pub(super) fn prototype_manuscript_page(
        &self,
        readonly: bool,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        div()
            .id("manuscript-page")
            .test_support()
            .flex_1()
            .min_h_0()
            .w_full()
            .overflow_y_scroll()
            .track_scroll(&self.writing_scroll)
            .capture_action(
                cx.listener(|this, _: &gpui_kit::base::input::MoveUp, window, cx| {
                    if this.body.read(cx).focus_handle(cx).is_focused(window)
                        && this.body.read(cx).selected_range() == (0..0)
                    {
                        this.title.update(cx, |title, cx| {
                            let end = title.text().len();
                            title.set_selected_range(end..end, cx);
                            title.focus(window, cx);
                        });
                        this.reveal_caret_next_frame(window, cx);
                        cx.stop_propagation();
                    } else {
                        cx.propagate();
                    }
                }),
            )
            .capture_key_down(cx.listener(|this, _, window, cx| {
                this.reveal_caret_next_frame(window, cx);
            }))
            .on_mouse_up(
                gpui_kit::MouseButton::Left,
                cx.listener(|this, _, window, cx| {
                    this.reveal_caret_next_frame(window, cx);
                }),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_h_full()
                    .pt(px(if self.desk.zen { 20. } else { 16. }))
                    .pb(px(if self.desk.zen { 48. } else { 16. }))
                    .child(
                        div()
                            .id("manuscript-title")
                            .test_support()
                            .flex_shrink_0()
                            .min_h(px(44.))
                            .child(
                                Textarea::new(&self.title)
                                    .xsmall()
                                    .appearance(false)
                                    .bordered(false)
                                    .font_family(DISPLAY_FONT)
                                    .text_size(px(40.))
                                    .line_height(px(44.))
                                    .font_weight(FontWeight::BOLD)
                                    .text_center()
                                    .readonly(readonly)
                                    .aria_label("Manuscript title"),
                            ),
                    )
                    .child(
                        div()
                            .flex_shrink_0()
                            .text_size(px(16.))
                            .line_height(px(17.6))
                            .text_center()
                            .text_color(rgb(palette(cx).vermilion))
                            .mt(px(4.8))
                            .mb(px(18.))
                            .child("✦"),
                    )
                    .child(
                        div()
                            .id("body-field")
                            .test_support()
                            .flex_shrink_0()
                            .min_h(px(32.4))
                            .when(!self.reading, |this| {
                                this.child(
                                    Textarea::new(&self.body)
                                        .xsmall()
                                        .appearance(false)
                                        .bordered(false)
                                        .font_family(SERIF_FONT)
                                        .text_size(px(18.))
                                        .line_height(px(32.4))
                                        .readonly(readonly)
                                        .aria_label("Manuscript body"),
                                )
                            })
                            .when(self.reading, |this| {
                                this.child(
                                    div()
                                        .id("reading-view")
                                        .font_family(SERIF_FONT)
                                        .text_size(px(18.))
                                        .line_height(relative(1.8))
                                        .when(self.active_document().workspace.is_none(), |this| {
                                            this.child(TextView::markdown(
                                                "manuscript-preview",
                                                self.preview.clone(),
                                            ))
                                        })
                                        .when(self.active_document().workspace.is_some(), |this| {
                                            this.child(TextView::html(
                                                "manuscript-preview",
                                                self.preview.clone(),
                                            ))
                                        }),
                                )
                            }),
                    ),
            )
            .into_any_element()
    }
}

#[cfg(all(test, feature = "ui-tests"))]
#[path = "manuscript_tests.rs"]
mod tests;
