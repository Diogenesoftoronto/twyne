use super::*;
use std::time::Instant;

/// The footer has a fixed English option vocabulary. Keep its typed search
/// independent of manuscript input and of the menu's own keyboard handling.
#[derive(Default)]
pub(super) struct PageSelectorTypeahead {
    focus: Option<FocusHandle>,
    last_typed: Option<Instant>,
    prefix: String,
    repeating: Option<char>,
    overflow: bool,
}

impl PageSelectorTypeahead {
    fn observe_focus(&mut self, active: Option<&FocusHandle>) {
        if self
            .focus
            .as_ref()
            .is_some_and(|focus| Some(focus) != active)
        {
            self.focus = None;
            self.last_typed = None;
            self.prefix.clear();
            self.overflow = false;
        }
    }

    fn active(&self, now: Instant) -> bool {
        self.last_typed
            .is_some_and(|last| now.saturating_duration_since(last) <= Duration::from_secs(1))
    }

    fn select(
        &mut self,
        character: char,
        now: Instant,
        count: usize,
        current: usize,
    ) -> Option<usize> {
        if count == 0 {
            return None;
        }
        if !self.active(now) {
            self.prefix.clear();
            self.overflow = false;
        }
        self.last_typed = Some(now);
        // No footer label can reach this size. Retain a failed-prefix state
        // without allowing held keys to grow its buffer indefinitely.
        if self.prefix.len() + character.len_utf8() <= 64 {
            self.prefix.push(character);
        } else {
            self.overflow = true;
        }
        let (prefix, offset) = if self.repeating == Some(character) {
            (character.to_string(), 1)
        } else if self.prefix.chars().count() > 1 || self.overflow {
            self.repeating = None;
            if self.overflow {
                return None;
            }
            (self.prefix.clone(), 0)
        } else {
            self.repeating = Some(character);
            (self.prefix.clone(), 1)
        };
        let prefix = prefix.to_ascii_lowercase();
        let options = count + 1;
        let start = (current.min(count) + offset) % options;
        (0..options)
            .map(|step| (start + step) % options)
            .find(|page| {
                let label = if *page == 0 {
                    page_count_label(count)
                } else {
                    format!("Page {page} of {count}")
                };
                label.to_ascii_lowercase().starts_with(&prefix)
            })
    }
}

impl WritingRoom {
    pub(super) fn status_bar(
        &self,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        let colors = *palette(cx);
        self.page_selector_typeahead
            .borrow_mut()
            .observe_focus(window.focused(cx).as_ref());
        let count = self.proof_images.len();
        let narrow = window.viewport_size().width < px(640.);
        let gap = if narrow { 6.4 } else { 12. };
        let count_label = page_count_label(count);
        let selected_page = self.selected_proof_page;
        let page_label = if selected_page > 0 && selected_page <= count {
            format!("Page {selected_page} of {count}")
        } else {
            count_label.clone()
        };
        let page_selector_width = self
            .page_selector_width(count, &count_label, window, colors.ink_light)
            .min(if narrow { 96. } else { 128. });
        let room = cx.weak_entity();
        let mut bar = div()
            .id("manuscript-status")
            .test_support()
            .role(Role::Group)
            .aria_label("Manuscript status")
            .flex()
            .items_center()
            .gap(px(gap))
            .px(px(if narrow { 8. } else { 12. }))
            .h(px(if narrow { 37. } else { 33. }))
            .flex_shrink_0()
            .border_t_1()
            .border_color(rgb(colors.rule))
            .bg(rgb(colors.paper))
            .font_family(FOOTER_FONT)
            .text_size(px(11.))
            .line_height(px(16.5))
            .text_color(rgb(colors.ink_light))
            .child(
                div()
                    .id("manuscript-word-count")
                    .test_support()
                    .flex_shrink_0()
                    .whitespace_nowrap()
                    .child(format!("{} words", self.statistics.words)),
            )
            .child(
                Button::new("go-to-page")
                    .ghost()
                    .small()
                    .h(px(28.))
                    .w(px(page_selector_width))
                    .px_0()
                    .rounded_none()
                    .role(Role::ComboBox)
                    .accessibility_label("Go to page")
                    .disabled(count == 0)
                    .focus_ring(false)
                    .key_context("TwynePageSelector")
                    .on_action(cx.listener(|room, _: &PageSelectorSpace, window, cx| {
                        let now = Instant::now();
                        if room.page_selector_typeahead.borrow().active(now) {
                            let selected = room.page_selector_typeahead.borrow_mut().select(
                                ' ',
                                now,
                                room.proof_images.len(),
                                room.selected_proof_page,
                            );
                            if let Some(page) = selected {
                                room.select_proof_page_from_keyboard(page, window, cx);
                            }
                        } else {
                            // An idle Space still uses Kit's actual popup
                            // activation and focus lifecycle.
                            window.dispatch_action(
                                Box::new(gpui_kit::base::actions::Confirm { secondary: false }),
                                cx,
                            );
                        }
                        cx.stop_propagation();
                    }))
                    .capture_key_down(cx.listener(
                        |room, event: &gpui_kit::KeyDownEvent, window, cx| {
                            let modifiers = event.keystroke.modifiers;
                            if modifiers.control || modifiers.alt || modifiers.platform {
                                return;
                            }
                            let now = Instant::now();
                            let active = room.page_selector_typeahead.borrow().active(now);
                            let text = event.keystroke.key_char.as_deref().unwrap_or(
                                if event.keystroke.key == "space" {
                                    " "
                                } else {
                                    event.keystroke.key.as_str()
                                },
                            );
                            let mut characters = text.chars();
                            let Some(character) = characters.next() else {
                                return;
                            };
                            if characters.next().is_some()
                                || character.is_control()
                                || (character == ' ' && !active)
                            {
                                return;
                            }
                            let selected = {
                                let mut search = room.page_selector_typeahead.borrow_mut();
                                search.focus = window.focused(cx);
                                search.select(
                                    character,
                                    now,
                                    room.proof_images.len(),
                                    room.selected_proof_page,
                                )
                            };
                            if let Some(page) = selected {
                                room.select_proof_page_from_keyboard(page, window, cx);
                            }
                            window.prevent_default();
                            cx.stop_propagation();
                        },
                    ))
                    .on_action(cx.listener(|room, _: &NextProofPage, window, cx| {
                        let page = (room.selected_proof_page + 1).min(room.proof_images.len());
                        room.select_proof_page_from_keyboard(page, window, cx);
                    }))
                    .on_action(cx.listener(|room, _: &PreviousProofPage, window, cx| {
                        room.select_proof_page_from_keyboard(
                            room.selected_proof_page.saturating_sub(1),
                            window,
                            cx,
                        );
                    }))
                    .on_action(cx.listener(|room, _: &FirstProofPage, window, cx| {
                        room.select_proof_page_from_keyboard(0, window, cx);
                    }))
                    .on_action(cx.listener(|room, _: &LastProofPage, window, cx| {
                        room.select_proof_page_from_keyboard(room.proof_images.len(), window, cx);
                    }))
                    .on_action(cx.listener(|room, _: &ForwardProofPages, window, cx| {
                        let page = room
                            .selected_proof_page
                            .saturating_add(3)
                            .min(room.proof_images.len());
                        room.select_proof_page_from_keyboard(page, window, cx);
                    }))
                    .on_action(cx.listener(|room, _: &BackwardProofPages, window, cx| {
                        room.select_proof_page_from_keyboard(
                            room.selected_proof_page.saturating_sub(3),
                            window,
                            cx,
                        );
                    }))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .w_full()
                            .h_full()
                            .font_family(FOOTER_FONT)
                            .text_size(px(11.))
                            .line_height(px(16.5))
                            .text_color(rgb(colors.ink_light))
                            .child(
                                div()
                                    .id("page-selection-label")
                                    .test_support()
                                    .role(Role::Label)
                                    .aria_label(page_label.clone())
                                    .flex_1()
                                    .min_w_0()
                                    .overflow_hidden()
                                    .whitespace_nowrap()
                                    .child(page_label.clone()),
                            )
                            .child(page_selector_arrow(colors.ink_light)),
                    )
                    .map(|button| crate::chrome::PageSelectorTrigger::new(button, page_label))
                    .dropdown_menu(move |mut menu, _, _| {
                        let default_room = room.clone();
                        menu = menu.item(
                            PopupMenuItem::new(count_label.clone())
                                .checked(selected_page == 0 || selected_page > count)
                                .on_click(move |_, window, cx| {
                                    let _ = default_room.update(cx, |room, cx| {
                                        room.select_proof_page(0, window, cx);
                                    });
                                }),
                        );
                        for index in 0..count {
                            let room = room.clone();
                            menu = menu.item(
                                PopupMenuItem::new(format!("Page {} of {count}", index + 1))
                                    .checked(selected_page == index + 1)
                                    .on_click(move |_, window, cx| {
                                        let _ = room.update(cx, |room, cx| {
                                            room.select_proof_page(index + 1, window, cx);
                                        });
                                    }),
                            );
                        }
                        menu
                    })
                    .map(|selector| focus_outline(selector, -2., 0., colors.vermilion)),
            )
            .when(!narrow, |bar| {
                bar.child(self.flow.ribbon.clone()).child(
                    div()
                        .id("save-status")
                        .role(Role::Status)
                        .test_support()
                        .aria_label(if self.error.is_some() {
                            "Save needs attention"
                        } else if self.dirty {
                            "Unsaved changes"
                        } else {
                            "Saved locally"
                        })
                        .text_color(rgb(if self.error.is_some() {
                            colors.vermilion
                        } else {
                            colors.ink_light
                        }))
                        .child(if self.error.is_some() {
                            "Save needs attention"
                        } else if self.dirty {
                            "Unsaved changes"
                        } else {
                            "Saved locally"
                        }),
                )
            })
            .child(
                div()
                    .id("local-sync-status")
                    .test_support()
                    .role(Role::Status)
                    .aria_label("Local only — account sync is not connected")
                    .size(px(8.))
                    .flex_shrink_0()
                    .rounded_full()
                    .bg(rgb(colors.ink_muted)),
            )
            .child(
                zen_button(self.desk.zen, cx)
                    .h(px(if narrow { 32. } else { 28. }))
                    .on_click(cx.listener(|room, _, _, cx| {
                        room.toggle_focus(cx);
                    }))
                    .map(|button| {
                        focus_outline(button.focus_ring(false), -2., 2., colors.vermilion)
                    }),
            );
        if self.source_mode && !narrow {
            let source = self.source.read(cx);
            let point = source.text().offset_to_point(source.cursor());
            let column = source
                .text()
                .slice_line(point.row)
                .byte_to_utf16_idx(point.column);
            bar = bar.child(
                div()
                    .id("source-position")
                    .test_support()
                    .flex_shrink_0()
                    .font(source_font())
                    .text_size(px(10.))
                    .child(format!("Ln {}, Col {}", point.row + 1, column + 1)),
            );
        }
        bar.into_any_element()
    }

    fn select_proof_page(&mut self, page: usize, window: &mut Window, cx: &mut Context<Self>) {
        if self.standalone_route()
            || self.dossier.is_some()
            || page > self.proof_images.len()
            || page == self.selected_proof_page
        {
            return;
        }
        self.selected_proof_page = page;
        if page > 0 {
            self.show_proof(window, cx);
        }
        cx.notify();
    }

    fn select_proof_page_from_keyboard(
        &mut self,
        page: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let focus = window.focused(cx);
        self.select_proof_page(page, window, cx);
        if let Some(focus) = focus {
            window.focus(&focus, cx);
        }
    }

    pub(super) fn show_proof(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.retire_math_source_visit(cx);
        self.proof_mode = true;
        self.split_view = false;
        window.focus(&self.focus, cx);
        self.request_proof(false, window, cx);
        self.queue_selected_proof_page();
    }

    pub(super) fn queue_selected_proof_page(&self) {
        if self.proof_mode
            && self.selected_proof_page > 0
            && self.selected_proof_page <= self.proof_images.len()
        {
            self.proof_scroll
                .scroll_to_top_of_item(self.selected_proof_page - 1);
        }
    }

    fn page_selector_width(&self, count: usize, label: &str, window: &Window, color: u32) -> f32 {
        if let Some((cached_count, width)) = self.page_selector_metrics.get()
            && count == cached_count
        {
            return width;
        }
        let measure = |text: &str| {
            f32::from(
                window
                    .text_system()
                    .shape_line(
                        text.to_owned().into(),
                        px(11.),
                        &[TextRun {
                            len: text.len(),
                            font: font(FOOTER_FONT),
                            color: rgb(color).into(),
                            ..Default::default()
                        }],
                        None,
                    )
                    .width,
            )
        };
        let mut width = measure(label);
        for page in 1..=count {
            width = width.max(measure(&format!("Page {page} of {count}")));
        }
        // Original Chrome's intrinsic select width uses the longest option,
        // rounds up, and reserves20px for its native arrow. Cache at the proof
        // count boundary so typing never rescans the available page options.
        let width = width.ceil() + 20.;
        self.page_selector_metrics.set(Some((count, width)));
        width
    }
}

fn page_count_label(count: usize) -> String {
    if count == 0 {
        "Pages".to_owned()
    } else {
        format!("{count} {}", if count == 1 { "page" } else { "pages" })
    }
}

#[cfg(test)]
mod typeahead_tests {
    use super::*;

    fn browser_reference() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../../fixtures/chrome/browser-page-selector.json"
        ))
        .unwrap()
    }

    #[test]
    fn typed_prefix_repeated_letters_and_failed_search_match_original_select() {
        let reference = browser_reference();
        let evidence = &reference["evidence"]["closedTypeahead"];
        assert_eq!(evidence["sourceRestored"], true);
        let count = evidence["options"].as_u64().unwrap() as usize - 1;
        let mut search = PageSelectorTypeahead::default();
        let mut now = Instant::now();
        let mut group = "";
        let mut selected = 0;
        for row in evidence["cases"].as_array().unwrap() {
            let (next_group, typed) = row["name"].as_str().unwrap().split_once(':').unwrap();
            if group != next_group {
                // The original fixture uses Home and a new timed session.
                group = next_group;
                selected = 0;
                now += Duration::from_millis(1200);
            }
            let character = typed.chars().next().unwrap();
            selected = search
                .select(character, now, count, selected)
                .unwrap_or(selected);
            assert_eq!(
                selected,
                row["value"].as_str().unwrap().parse::<usize>().unwrap(),
                "{}",
                row["name"]
            );
            now += Duration::from_millis(20);
        }
    }

    #[test]
    fn original_typed_session_timeout_distinguishes_prefix_and_count_label() {
        let reference = browser_reference();
        let evidence = &reference["evidence"]["closedTypeahead"]["timeout"];
        let count = evidence["options"].as_u64().unwrap() as usize - 1;
        for row in evidence["cases"].as_array().unwrap() {
            let mut search = PageSelectorTypeahead::default();
            let mut now = Instant::now();
            let mut selected = 0;
            for character in "page 1".chars() {
                selected = search
                    .select(character, now, count, selected)
                    .unwrap_or(selected);
                now += Duration::from_millis(20);
            }
            // `now` is the next input slot; use the last event's timestamp.
            now += Duration::from_millis(row["delay"].as_u64().unwrap() - 20);
            selected = search.select('1', now, count, selected).unwrap_or(selected);
            assert_eq!(
                selected,
                row["value"].as_str().unwrap().parse::<usize>().unwrap(),
                "{} ms",
                row["delay"]
            );
        }
    }
}
