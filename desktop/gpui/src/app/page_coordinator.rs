use super::*;
use gpui_kit::{EntityId, WeakEntity};
use twyne_desktop::editor::view::{PaginationFallback, PaginationInfo};
use twyne_desktop::page_furniture::{PageChromeGeometry, PageChromeText, PageMarginsPx};
use twyne_desktop::workspace::PaginationMode;

#[derive(Clone, Copy, Debug, PartialEq)]
struct PageOwner {
    editor: EntityId,
    folio: Uuid,
    visit: u64,
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::{AnyWindowHandle, TestAppContext, size, test::TestWindowExt};
    use tempfile::TempDir;

    fn page_room(
        cx: &mut TestAppContext,
        layout: LayoutSettings,
    ) -> (AnyWindowHandle, Entity<WritingRoom>, Arc<Store>, TempDir) {
        let (handle, room, store, directory) = super::super::tests::room(cx);
        let html = concat!(
            "<p>Before the break<sup data-type=\"endnote\" data-endnote-text=\"A retained source.\"></sup></p>",
            "<div data-type=\"page-break\" data-future=\"retained\"></div>",
            "<p>After the deliberate break.</p>",
        );
        let path = store.root().join("Measured pages.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        let document = twyne_desktop::document_edit::apply_page_settings(
            document,
            layout,
            "A retained running head".into(),
            "A retained footer".into(),
        )
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.set_write(window, cx);
                room.desk.set_zen(false, false);
                room.desk.drawer_open = false;
                room.desk.board_open = false;
                cx.notify();
            });
        })
        .unwrap();
        pump(cx, handle);
        (handle, room, store, directory)
    }

    fn pump(cx: &mut TestAppContext, handle: AnyWindowHandle) {
        for _ in 0..5 {
            cx.update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                window.simulate_next_frame(cx);
            })
            .unwrap();
            cx.run_until_parked();
        }
    }

    #[gpui_kit::test]
    fn actual_host_measures_note_border_box_once_and_keeps_physical_pages_at_narrow_width(
        cx: &mut TestAppContext,
    ) {
        let layout = LayoutSettings {
            pagination: Some(PaginationMode::Paginated),
            running_header: true,
            ..LayoutSettings::default()
        };
        let (handle, room, _store, _directory) = page_room(cx, layout.clone());
        let (editor, source, snapshot) = cx
            .update_window(handle, |_, window, cx| {
                let room = room.read(cx);
                let editor = room.rich.clone().unwrap();
                let state = room.pagination.borrow();
                let info = state
                    .info
                    .as_ref()
                    .expect("Host must accept the measured editor frame");
                assert!(info.active);
                assert_eq!(info.page_count, 2);
                assert_eq!(
                    f32::from(window.find("manuscript-page-canvas").bounds().size.width),
                    816.
                );
                let notes_height = f32::from(window.find("manuscript-notes").bounds().size.height);
                assert_eq!(
                    state.tail_height, notes_height,
                    "Tail excludes outer 40px margin and includes its border"
                );
                assert_eq!(
                    window.find(("page-sheet", 1usize)).bounds().size.height,
                    px(1056.)
                );
                let snapshot = editor.read(cx).snapshot();
                (editor, room.active_document().body.clone(), snapshot)
            })
            .unwrap();
        cx.simulate_window_resize(handle, size(px(620.), px(860.)));
        pump(cx, handle);
        cx.update_window(handle, |_, window, cx| {
            let room = room.read(cx);
            let state = room.pagination.borrow();
            assert!(state.info.as_ref().unwrap().active);
            assert_eq!(state.info.as_ref().unwrap().page_count, 2);
            assert_eq!(
                window.find("manuscript-page-canvas").bounds().size.width,
                px(816.)
            );
            assert!(room.writing_scroll.max_offset().x >= px(196.));
            assert_eq!(
                state.tail_height,
                f32::from(window.find("manuscript-notes").bounds().size.height)
            );
            assert_eq!(editor.read(cx).document(), &snapshot);
            assert!(!editor.read(cx).can_undo());
            assert_eq!(room.active_document().body, source);
            assert_eq!(room.current_page_layout(cx), layout);
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn unsupported_columns_keep_requested_settings_and_restore_real_sheet_chrome(
        cx: &mut TestAppContext,
    ) {
        let layout = LayoutSettings {
            pagination: Some(PaginationMode::Paginated),
            columns: Some(2),
            ..LayoutSettings::default()
        };
        let (handle, room, _store, _directory) = page_room(cx, layout.clone());
        let (editor, snapshot) = cx
            .update_window(handle, |_, window, cx| {
                let editor = room.read(cx).rich.clone().unwrap();
                let snapshot = editor.read(cx).snapshot();
                room.update(cx, |room, cx| {
                    let state = room.pagination.borrow();
                    assert!(!state.info.as_ref().unwrap().active);
                    assert_eq!(
                        state.fallback(),
                        Some(PaginationFallback::UnsupportedColumns)
                    );
                    assert_eq!(room.current_page_layout(cx), layout);
                    assert!(window.find("pagination-status").bounds().size.height > px(0.));
                    drop(state);
                    let mut restored = layout.clone();
                    restored.columns = Some(1);
                    room.compositor
                        .as_ref()
                        .unwrap()
                        .update(cx, |view, cx| view.set_layout(restored, window, cx));
                    cx.notify();
                });
                (editor, snapshot)
            })
            .unwrap();
        pump(cx, handle);
        cx.update_window(handle, |_, window, cx| {
            let room = room.read(cx);
            assert!(room.pagination.borrow().info.as_ref().unwrap().active);
            assert_eq!(room.current_page_layout(cx).columns, Some(1));
            assert_eq!(
                window.find("manuscript-page-canvas").bounds().size.width,
                px(816.)
            );
            assert_eq!(editor.read(cx).document(), &snapshot);
            assert!(!editor.read(cx).can_undo());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn rejected_sheet_stays_latched_across_its_own_events_and_retries_after_genuine_input(
        cx: &mut TestAppContext,
    ) {
        let layout = LayoutSettings {
            pagination: Some(PaginationMode::Paginated),
            ..LayoutSettings::default()
        };
        let (handle, room, _store, _directory) = page_room(cx, layout);
        cx.update_window(handle, |_, _, cx| {
            let room = room.read(cx);
            let mut state = room.pagination.borrow_mut();
            let candidate = state.candidate.clone().unwrap();
            let mut info = state.info.clone().unwrap();
            // The library's native-shaper test covers generating this failure.
            // Here the synthetic receipt isolates the host's retry boundary.
            info.active = false;
            info.fallback = Some(PaginationFallback::UnstableFloatGeometry);
            assert!(state.accept(&candidate, info.clone()));
            state.begin(candidate.clone());
            assert!(state.rejected.is_some());
            info.generation += 1;
            info.fallback = Some(PaginationFallback::Continuous);
            assert!(state.accept(&candidate, info));
            assert_eq!(
                state.fallback(),
                Some(PaginationFallback::UnstableFloatGeometry)
            );
            let mut changed = candidate.clone();
            changed.revision += 1;
            state.begin(changed);
            assert!(state.rejected.is_none());
            assert!(
                state.info.is_none(),
                "An inactive old frame must not prevent the genuine retry"
            );
            assert!(
                !state.accept(
                    &candidate,
                    room.rich
                        .as_ref()
                        .unwrap()
                        .read(cx)
                        .pagination_info()
                        .unwrap()
                )
            );
        })
        .unwrap();
    }
}

#[derive(Clone, Debug, PartialEq)]
struct PageCandidate {
    owner: PageOwner,
    revision: u64,
    layout: LayoutSettings,
    content_width: u32,
    viewport_width: u32,
    continuous_width: u32,
    tail_height: u32,
    refresh: u64,
}

impl PageCandidate {
    fn same_view_configuration(&self, other: &Self, active: bool) -> bool {
        self.owner == other.owner
            && self.layout == other.layout
            && if active {
                self.content_width == other.content_width
            } else {
                self.continuous_width == other.continuous_width
            }
            && self.tail_height == other.tail_height
            && self.refresh == other.refresh
    }
}

/// A rejected sheet is retried only at a genuine content/presentation boundary.
/// The continuous frame's own notification must not toggle it back to sheets.
#[derive(Default)]
pub(super) struct PageHostState {
    candidate: Option<PageCandidate>,
    info: Option<PaginationInfo>,
    rejected: Option<(PageCandidate, PaginationFallback)>,
    tail_height: f32,
    tail_observed: Arc<std::sync::Mutex<Option<(PageCandidate, f32)>>>,
    refresh: u64,
}

impl PageHostState {
    fn begin(&mut self, candidate: PageCandidate) {
        if self.candidate.as_ref() == Some(&candidate) {
            return;
        }
        if self.rejected.is_some()
            || self.candidate.as_ref().is_none_or(|previous| {
                !previous.same_view_configuration(
                    &candidate,
                    self.info.as_ref().is_some_and(|info| info.active),
                )
            })
        {
            self.info = None;
        }
        self.rejected = None;
        self.candidate = Some(candidate);
    }

    fn accept(&mut self, candidate: &PageCandidate, info: PaginationInfo) -> bool {
        if self.candidate.as_ref() != Some(candidate) {
            return false;
        }
        if !info.active
            && let Some(reason) = info.fallback.filter(|reason| {
                matches!(
                    reason,
                    PaginationFallback::TooManyBlocks
                        | PaginationFallback::InvalidMeasurement
                        | PaginationFallback::UnstableFloatGeometry
                )
            })
        {
            self.rejected = Some((candidate.clone(), reason));
        }
        let changed = self.info.as_ref() != Some(&info);
        self.info = Some(info);
        changed
    }

    fn fallback(&self) -> Option<PaginationFallback> {
        self.rejected
            .as_ref()
            .map(|(_, reason)| *reason)
            .or_else(|| {
                self.info
                    .as_ref()
                    .filter(|info| !info.active)
                    .and_then(|info| info.fallback)
            })
    }
}

impl WritingRoom {
    pub(super) fn editorial_board_width(&self, window: &Window) -> f32 {
        let available = f32::from(window.viewport_size().width);
        if available <= 720. {
            return 448_f32.min(available);
        }
        let desired = if self.desk.board_context == BoardContext::Apparatus {
            496_f32
        } else {
            464_f32
        };
        desired.min((available - 48.).max(0.))
    }
    fn current_page_layout(&self, cx: &App) -> LayoutSettings {
        self.compositor
            .as_ref()
            .map(|view| view.read(cx).layout.clone())
            .or_else(|| {
                self.active_document()
                    .workspace
                    .as_deref()
                    .and_then(|workspace| workspace.folio.layout.clone())
            })
            .unwrap_or_default()
    }

    pub(super) fn page_geometry(
        &self,
        layout: &LayoutSettings,
        window: &Window,
    ) -> PageCanvasGeometry {
        let viewport_width = f32::from(window.viewport_size().width);
        let mut available = viewport_width;
        if self.desk.drawer_open && !self.desk.zen && !self.standalone_route() {
            available -= 288.;
        }
        if self.desk.board_open
            && !self.desk.zen
            && !self.standalone_route()
            && self.dossier.is_none()
        {
            available -= self.editorial_board_width(window);
        }
        if self.split_view {
            available *= 0.5;
        }
        PageCanvasGeometry::resolve_with_viewport(
            layout,
            available.max(0.),
            viewport_width,
            self.desk.zen,
        )
    }

    pub(super) fn install_page_ruler(&mut self, window: &Window, cx: &mut Context<Self>) {
        self.page_ruler_subscription = None;
        self.page_ruler = None;
        self.page_ruler_state = None;
        if self.rich.is_none() {
            return;
        }
        let layout = self.current_page_layout(cx);
        let geometry = self.page_geometry(&layout, window);
        let ruler = cx.new(|cx| PageRulerView::new(layout, geometry.ruler_width_rem, cx));
        self.page_ruler_subscription = Some(cx.subscribe_in(
            &ruler,
            window,
            |this, _, event, window, cx| {
                let PageFurnitureEvent::LayoutChanged(layout) = event;
                if this
                    .rich
                    .as_ref()
                    .is_none_or(|view| view.read(cx).is_read_only())
                {
                    return;
                }
                if let Some(compositor) = &this.compositor {
                    compositor.update(cx, |view, cx| view.set_layout(layout.clone(), window, cx));
                    this.changed(window, cx);
                    if this.proof_mode || this.split_view {
                        this.request_proof(false, window, cx);
                    }
                }
            },
        ));
        self.page_ruler = Some(ruler);
        self.sync_page_ruler(window, cx);
    }

    pub(super) fn sync_page_ruler(&mut self, window: &Window, cx: &mut Context<Self>) {
        let Some(ruler) = &self.page_ruler else {
            return;
        };
        let layout = self.current_page_layout(cx);
        let width = self.page_geometry(&layout, window).ruler_width_rem;
        let readonly = self
            .rich
            .as_ref()
            .is_none_or(|view| view.read(cx).is_read_only());
        let next = (layout.clone(), width, self.desk.zen, readonly);
        if self.page_ruler_state.as_ref() == Some(&next) {
            return;
        }
        ruler.update(cx, |ruler, cx| {
            ruler.set_layout(layout, width, cx);
            ruler.set_zen(self.desk.zen, cx);
            ruler.set_read_only(readonly, cx);
        });
        self.page_ruler_state = Some(next);
    }

    fn page_owner(&self, editor: &Entity<RichEditorView>) -> PageOwner {
        PageOwner {
            editor: editor.entity_id(),
            folio: self.active,
            visit: self.revision_generation,
        }
    }

    pub(super) fn accept_pagination(
        &mut self,
        editor: &Entity<RichEditorView>,
        generation: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(candidate) = self.pagination.borrow().candidate.clone() else {
            return;
        };
        if self.rich.as_ref() != Some(editor)
            || candidate.owner != self.page_owner(editor)
            || candidate.revision != editor.read(cx).revision()
            || candidate.layout != self.current_page_layout(cx)
            || candidate.viewport_width != f32::from(window.viewport_size().width).to_bits()
            || candidate.tail_height != self.pagination.borrow().tail_height.to_bits()
        {
            return;
        }
        let Some(info) = editor
            .read(cx)
            .pagination_info()
            .filter(|info| info.generation == generation)
        else {
            return;
        };
        if !self.pagination.borrow_mut().accept(&candidate, info) {
            return;
        }
        cx.notify();
        // This runs after the host has laid out the newly accepted chrome.
        // Weak captures also let a focused editor/window quit cleanly.
        let room: WeakEntity<Self> = cx.weak_entity();
        let view = editor.downgrade();
        window.on_next_frame(move |_, cx| {
            let _ = room.update(cx, |this, cx| {
                let Some(editor) = view.upgrade() else {
                    return;
                };
                if this.rich.as_ref() != Some(&editor)
                    || this.page_owner(&editor) != candidate.owner
                    || this.pagination.borrow().candidate.as_ref() != Some(&candidate)
                    || this
                        .pagination
                        .borrow()
                        .info
                        .as_ref()
                        .is_none_or(|info| info.generation != generation)
                {
                    return;
                }
                let view = editor.read(cx);
                let Some(anchor) = view.pagination_scroll_anchor(generation).filter(|anchor| {
                    anchor.revision == view.revision() && anchor.selection == view.selection()
                }) else {
                    return;
                };
                let mut offset = this.writing_scroll.offset();
                let maximum = this.writing_scroll.max_offset();
                offset.y = (offset.y - anchor.delta_y).clamp(-maximum.y, px(0.));
                if offset != this.writing_scroll.offset() {
                    this.writing_scroll.set_offset(offset);
                    cx.notify();
                }
            });
        });
    }

    pub(super) fn measure_collected_notes(
        &self,
        editor: &Entity<RichEditorView>,
        notes: gpui_kit::AnyElement,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        let state = self.pagination.borrow();
        let Some(candidate) = state.candidate.clone() else {
            return notes;
        };
        let measured = state.tail_observed.clone();
        let owner = self.page_owner(editor);
        let room = cx.weak_entity();
        // Child layout bounds are the actual note border box. An absolute
        // inset canvas would measure its padding box and omit the top border.
        div()
            .w_full()
            .on_children_prepainted(move |children, window, cx| {
                let Some(bounds) = children.first() else {
                    return;
                };
                let height = f32::from(bounds.size.height);
                if !height.is_finite() || height < 0. {
                    return;
                }
                let mut previous = measured.lock().unwrap();
                if previous.as_ref() == Some(&(candidate.clone(), height)) {
                    return;
                }
                *previous = Some((candidate.clone(), height));
                drop(previous);
                let room = room.clone();
                let candidate = candidate.clone();
                window.defer(cx, move |_, cx| {
                    let _ = room.update(cx, |this, cx| {
                        if this
                            .rich
                            .as_ref()
                            .is_none_or(|editor| this.page_owner(editor) != owner)
                        {
                            return;
                        }
                        let mut state = this.pagination.borrow_mut();
                        if state.candidate.as_ref() != Some(&candidate)
                            || state.tail_height == height
                        {
                            return;
                        }
                        state.tail_height = height;
                        drop(state);
                        cx.notify();
                    });
                });
            })
            .child(notes)
            .into_any_element()
    }

    fn page_bounds_observer(&self, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        let measured = self.margin.page_bounds.clone();
        let room = cx.weak_entity();
        gpui_kit::canvas(
            move |bounds, _, cx| {
                let mut cached = measured.lock().unwrap();
                if *cached != Some(bounds) {
                    *cached = Some(bounds);
                    drop(cached);
                    let _ = room.update(cx, |_, cx| cx.notify());
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .inset_0()
        .size_full()
        .into_any_element()
    }

    pub(super) fn rich_page(
        &self,
        editor: &Entity<RichEditorView>,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        let layout = self.current_page_layout(cx);
        let viewport_width = f32::from(window.viewport_size().width);
        let continuous_geometry = self.page_geometry(&layout, window);
        let sheet_geometry =
            PageCanvasGeometry::resolve_paginated(&layout, viewport_width, self.desk.zen);
        let has_notes = !editor.read(cx).note_references().is_empty();
        let (geometry, metrics, explanation, tail_height) = {
            let mut state = self.pagination.borrow_mut();
            if !has_notes {
                state.tail_height = 0.;
                *state.tail_observed.lock().unwrap() = None;
            }
            let candidate = PageCandidate {
                owner: self.page_owner(editor),
                revision: editor.read(cx).revision(),
                layout: layout.clone(),
                content_width: sheet_geometry.content_width_px().to_bits(),
                viewport_width: viewport_width.to_bits(),
                continuous_width: continuous_geometry.content_width_px().to_bits(),
                tail_height: state.tail_height.to_bits(),
                refresh: state.refresh,
            };
            state.begin(candidate);
            let requested = layout.resolve_page_setup().pagination == PaginationMode::Paginated;
            let sheet_mode = requested
                && layout.resolve_columns() == 1
                && state.rejected.is_none()
                && state.info.as_ref().is_none_or(|info| info.active);
            let metrics = sheet_mode.then(|| {
                state
                    .info
                    .as_ref()
                    .and_then(PaginationInfo::chrome_geometry)
                    .unwrap_or_else(|| {
                        let page = twyne_desktop::editor::pagination::PageGeometry::from_layout(
                            &layout,
                            f64::from(twyne_desktop::theme::REM_PX),
                            twyne_desktop::editor::pagination::PAGE_GAP_REM,
                        );
                        PageChromeGeometry {
                            page_count: 1,
                            page_height_px: page.page_h as f32,
                            gap_px: page.gap as f32,
                            margins: PageMarginsPx {
                                left: page.margin_left as f32,
                                right: page.margin_right as f32,
                                top: page.margin_top as f32,
                                bottom: page.margin_bottom as f32,
                            },
                        }
                    })
            });
            let explanation = if requested {
                match state.fallback() {
                    Some(PaginationFallback::UnsupportedColumns) => Some(
                        "This manuscript uses multiple columns. Writing remains continuous; Proof keeps its page layout.",
                    ),
                    Some(PaginationFallback::TooManyBlocks) => {
                        Some("Writing remains continuous for this document's size.")
                    }
                    Some(PaginationFallback::InvalidMeasurement) => {
                        Some("The page display could not be measured. Writing remains continuous.")
                    }
                    Some(PaginationFallback::UnstableFloatGeometry) => Some(
                        "Pages could not settle around the opening initial. Writing remains continuous.",
                    ),
                    _ if state
                        .info
                        .as_ref()
                        .is_some_and(|info| info.page_limit_reached) =>
                    {
                        Some(
                            "The page display reached its limit; content continues below the final sheet.",
                        )
                    }
                    _ => None,
                }
            } else {
                None
            };
            (
                if sheet_mode {
                    sheet_geometry
                } else {
                    continuous_geometry
                },
                metrics,
                explanation,
                state.tail_height,
            )
        };
        let mut presentation_layout = layout.clone();
        if self.pagination.borrow().rejected.is_some() {
            presentation_layout.pagination = Some(PaginationMode::Continuous);
        }
        editor.update(cx, |view, cx| {
            view.set_pagination_layout(
                Some(presentation_layout),
                geometry.content_width_px(),
                tail_height,
                cx,
            );
        });
        let text_measured = self.margin_rail.text_bounds.clone();
        let text_room = cx.weak_entity();
        let content = div()
            .relative()
            .when(metrics.is_none(), |this| {
                this.min_h(px(f32::from(window.viewport_size().height) * 0.6))
            })
            .child(editor.clone())
            .when_some(self.collected_notes(editor, cx), |this, notes| {
                this.child(notes)
            })
            .child(
                gpui_kit::canvas(
                    move |bounds, _, cx| {
                        let mut cached = text_measured.lock().unwrap();
                        if *cached != Some(bounds) {
                            *cached = Some(bounds);
                            drop(cached);
                            let _ = text_room.update(cx, |_, cx| cx.notify());
                        }
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .into_any_element();
        let page = if let Some(metrics) = metrics {
            let (header, footer) = self
                .compositor
                .as_ref()
                .map(|view| view.read(cx).chrome_text(cx))
                .unwrap_or_else(|| {
                    let folio = self
                        .active_document()
                        .workspace
                        .as_deref()
                        .map(|workspace| &workspace.folio);
                    (
                        folio
                            .and_then(|folio| folio.header.clone())
                            .unwrap_or_default(),
                        folio
                            .and_then(|folio| folio.footer.clone())
                            .unwrap_or_default(),
                    )
                });
            page_furniture::page_canvas_paginated(
                &layout,
                geometry,
                metrics,
                PageChromeText {
                    title: Some(&self.active_document().title),
                    header: Some(&header),
                    footer: Some(&footer),
                    ..PageChromeText::default()
                },
                content,
                cx,
            )
            .child(self.page_bounds_observer(cx))
            .into_any_element()
        } else {
            page_furniture::page_canvas(&layout, geometry, content, cx)
                .min_h_full()
                .child(self.page_bounds_observer(cx))
                .into_any_element()
        };
        let mut scroller = div()
            .id("body-field")
            .test_support()
            .flex_1()
            .min_h_0()
            .w_full()
            .overflow_y_scroll()
            .overflow_x_scroll()
            .track_scroll(&self.writing_scroll);
        if !self.desk.zen {
            scroller = scroller.when_some(self.page_ruler.clone(), |this, ruler| this.child(ruler));
        }
        scroller
            .when_some(explanation, |this, explanation| {
                this.child(
                    div()
                        .id("pagination-status")
                        .test_support()
                        .px(px(24.))
                        .py(px(8.))
                        .text_size(px(12.))
                        .text_color(rgb(palette(cx).ink_muted))
                        .child(explanation),
                )
            })
            .child(page)
            .into_any_element()
    }
}
