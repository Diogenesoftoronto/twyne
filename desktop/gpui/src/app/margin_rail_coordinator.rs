//! The host supplies saved note data and current measured mark geometry. The
//! original pacing policy comes from the existing Flow conductor.

use super::*;
use gpui_kit::{Bounds, EntityId, Pixels};
use std::{collections::HashSet, sync::Mutex};
use twyne_desktop::{
    flow::{FlowMode, ItemOutcome},
    margin_rail_view::{
        MarginRailAnchor, MarginRailCapabilities, MarginRailContext, MarginRailDecision,
        MarginRailEvent, MarginRailGeometry, MarginRailNote, MarginRailPresentation,
        MarginRailRect, MarginRailSnapshot, MarginRailView, select_writer_notes,
    },
    marginalia::{CommentRef, MarginaliaRecord},
};

#[derive(Clone, Copy, PartialEq)]
pub(super) struct DecisionKey {
    tick: u64,
    mode: FlowMode,
    enabled: bool,
    weight: f64,
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{AnyWindowHandle, TestAppContext};
    use tempfile::TempDir;
    use twyne_desktop::marginalia::MarginaliaStore;

    fn marked_room(
        cx: &mut TestAppContext,
    ) -> (
        AnyWindowHandle,
        Entity<WritingRoom>,
        Arc<Store>,
        TempDir,
        CommentRef,
    ) {
        let (handle, room, store, directory) = super::super::tests::room(cx);
        let html = "<h1>A notebook</h1><p><span data-comment-id=\"same-id\" data-comment-author=\"You\">The softened corners</span> belong in this passage.</p>";
        let path = store.root().join("Notebook with a real margin.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        let folio = document.workspace.as_deref().unwrap().folio.id.clone();
        let target = CommentRef {
            folio_id: folio.clone(),
            id: "same-id".into(),
        };
        let ledger = serde_json::json!([
            {"id":"same-id","folioId":folio,"text":"Keep the **handled** detail.","author":"You","anchor":"The softened corners","resolved":false,"createdAt":10,"updatedAt":10,"replies":[]},
            {"id":"same-id","folioId":"another-folio","text":"A foreign note","author":"You","anchor":"The softened corners","resolved":false,"createdAt":11,"updatedAt":11,"replies":[]}
        ]);
        let margins = MarginaliaStore::open(store.root()).unwrap();
        std::fs::write(margins.path(), serde_json::to_vec(&ledger).unwrap()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.marginalia = marginalia_coordinator::MarginaliaState::load(&store).0;
                room.desk.set_zen(false, false);
                room.ensure_marginalia(window, cx).unwrap();
            });
            for _ in 0..3 {
                window.render_frame(cx);
                window.simulate_next_frame(cx);
            }
            window.render_frame(cx);
            assert!(window.find("margin-rail-dock").visible());
        })
        .unwrap();
        (handle, room, store, directory, target)
    }

    #[gpui_kit::test]
    fn preview_set_aside_is_transient_and_open_recalls_the_exact_shared_thread(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, target) = marked_room(cx);
        let ledger_path = MarginaliaStore::open(store.root())
            .unwrap()
            .path()
            .to_owned();
        let saved = std::fs::read(&ledger_path).unwrap();
        let (source, revision, selection) = cx
            .update_window(handle, |_, window, cx| {
                let (source, revision, selection) = room.update(cx, |room, cx| {
                    let editor = room.rich.as_ref().unwrap().read(cx);
                    assert_eq!(room.margin_rail.notes.len(), 1);
                    assert_eq!(room.margin_rail.notes[0].target, target);
                    (
                        editor.document().to_html(),
                        editor.revision(),
                        editor.selection(),
                    )
                });
                let open_id = format!("margin-rail-open-{}-{}", target.folio_id, target.id);
                window.click(SharedString::from(open_id), cx);
                (source, revision, selection)
            })
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.find("inline-margin-card").visible());
            assert!(window.try_find("margin-rail-dock").is_none());
            window.click("inline-margin-input", cx);
            window.input("The shared reply is still here", cx);
            window.click("inline-margin-close", cx);
            window.render_frame(cx);
            let aside_id = format!("margin-rail-aside-{}-{}", target.folio_id, target.id);
            window.click(SharedString::from(aside_id), cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.try_find("margin-rail-dock").is_none());
            room.update(cx, |room, cx| {
                let editor = room.rich.as_ref().unwrap().read(cx);
                assert_eq!(editor.document().to_html(), source);
                assert_eq!(editor.revision(), revision);
                assert_eq!(editor.selection(), selection);
                assert!(!editor.can_undo());
                assert!(room.margin_rail.dismissed.contains(&target));
                let range = editor.document().first_comment_range(&target.id).unwrap();
                room.open_inline_margin(target.id.clone(), range, window, cx);
            });
            window.render_frame(cx);
            assert!(window.find("inline-margin-card").visible());
            room.update(cx, |room, cx| {
                assert!(!room.margin_rail.dismissed.contains(&target));
                let input = room
                    .marginalia
                    .view
                    .as_ref()
                    .unwrap()
                    .update(cx, |view, cx| view.reply_input(&target, window, cx))
                    .unwrap();
                assert_eq!(
                    input.read(cx).text().to_string(),
                    "The shared reply is still here"
                );
                assert!(
                    room.marginalia
                        .record
                        .comment(&target)
                        .unwrap()
                        .replies
                        .is_empty()
                );
            });
        })
        .unwrap();
        assert_eq!(std::fs::read(ledger_path).unwrap(), saved);
    }

    #[gpui_kit::test]
    fn preview_ignores_foreign_events_and_hides_with_zen_or_read_only(cx: &mut TestAppContext) {
        let (handle, room, _store, _directory, target) = marked_room(cx);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                room.margin_rail_event(
                    &MarginRailEvent::OpenThread {
                        target: CommentRef {
                            folio_id: "another-folio".into(),
                            id: target.id.clone(),
                        },
                        slot: None,
                    },
                    window,
                    cx,
                );
                assert!(!room.inline_margin_visible());
                room.desk.set_zen(true, false);
            });
            window.render_frame(cx);
            assert!(window.try_find("margin-rail-dock").is_none());
            room.update(cx, |room, cx| {
                room.desk.set_zen(false, false);
                room.rich
                    .as_ref()
                    .unwrap()
                    .update(cx, |editor, cx| editor.set_read_only(true, cx));
            });
            window.render_frame(cx);
            assert!(window.try_find("margin-rail-dock").is_none());
            room.update(cx, |room, cx| {
                room.rich
                    .as_ref()
                    .unwrap()
                    .update(cx, |editor, cx| editor.set_read_only(false, cx));
            });
            window.render_frame(cx);
            assert!(window.find("margin-rail-dock").visible());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn admitted_rail_thread_uses_measured_height_and_follows_dock_reflow_with_its_reply(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, _store, _directory, target) = marked_room(cx);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let compositor = room.compositor.clone().unwrap();
                let mut layout = compositor.read(cx).layout.clone();
                layout.width = twyne_desktop::workspace::DocWidth::Narrow;
                compositor.update(cx, |view, cx| view.set_layout(layout, window, cx));
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            for _ in 0..3 {
                window.render_frame(cx);
                window.simulate_next_frame(cx);
            }
            window.render_frame(cx);
            assert!(window.find("margin-rail-room").visible());
            window.click(
                SharedString::from(format!(
                    "margin-rail-open-{}-{}",
                    target.folio_id, target.id
                )),
                cx,
            );
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            for _ in 0..3 {
                window.render_frame(cx);
                window.simulate_next_frame(cx);
            }
            window.render_frame(cx);
            let bounds = window.find("inline-margin-card").bounds();
            let page_bounds = window.find("manuscript-page-canvas").bounds();
            let text_bounds = window.find("manuscript-page-content").bounds();
            let scale = window.scale_factor();
            room.update(cx, |room, cx| {
                let rail = room.margin_rail.view.as_ref().unwrap().read(cx);
                let geometry = rail.snapshot().geometry.as_ref().unwrap();
                assert_eq!(geometry.canvas, rail_rect(page_bounds));
                assert_eq!(geometry.text, rail_rect(text_bounds));
                assert_eq!(
                    rail.layout().room,
                    twyne_desktop::margin_rail_view::MarginRailRoom::Rail
                );
                let slot = rail.slot(&target).unwrap();
                assert_eq!(f32::from(bounds.left()), slot.left);
                // The retained slot is logical; GPUI snaps the actual child
                // layout to device pixels (the TestWindow scale is2).
                assert_eq!(f32::from(bounds.top()), (slot.top * scale).round() / scale);
                assert_eq!(f32::from(bounds.size.width), slot.width);
                assert_eq!(
                    room.margin_rail_open_thread(cx).unwrap().height,
                    Some(f32::from(bounds.size.height))
                );
            });
            window.click("inline-margin-input", cx);
            window.input("Keep this through the width change", cx);
            room.update(cx, |room, cx| {
                let compositor = room.compositor.clone().unwrap();
                let mut layout = compositor.read(cx).layout.clone();
                layout.width = twyne_desktop::workspace::DocWidth::Normal;
                compositor.update(cx, |view, cx| view.set_layout(layout, window, cx));
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            for _ in 0..3 {
                window.render_frame(cx);
                window.simulate_next_frame(cx);
            }
            window.render_frame(cx);
            let bounds = window.find("inline-margin-card").bounds();
            let scale = window.scale_factor();
            assert!(window.try_find("margin-rail-dock").is_none());
            room.update(cx, |room, cx| {
                let rail = room.margin_rail.view.as_ref().unwrap().read(cx);
                assert_eq!(
                    rail.layout().room,
                    twyne_desktop::margin_rail_view::MarginRailRoom::Dock
                );
                let slot = rail.slot(&target).unwrap();
                assert_eq!(f32::from(bounds.left()), slot.left);
                assert_eq!(f32::from(bounds.top()), (slot.top * scale).round() / scale);
                assert_eq!(f32::from(bounds.size.width), slot.width);
                let input = room
                    .marginalia
                    .view
                    .as_ref()
                    .unwrap()
                    .update(cx, |view, cx| view.reply_input(&target, window, cx))
                    .unwrap();
                assert_eq!(
                    input.read(cx).text().to_string(),
                    "Keep this through the width change"
                );
            });
        })
        .unwrap();
    }
}

#[derive(Default)]
pub(super) struct MarginRailState {
    pub(super) view: Option<Entity<MarginRailView>>,
    subscription: Option<Subscription>,
    owner: Option<(Uuid, EntityId)>,
    scope: Option<String>,
    record: Option<Arc<MarginaliaRecord>>,
    notes: Vec<MarginRailNote>,
    decision: MarginRailDecision,
    pub(super) decision_key: Option<DecisionKey>,
    shown: HashSet<CommentRef>,
    pub(super) dismissed: HashSet<CommentRef>,
    peek: Option<CommentRef>,
    pub(super) text_bounds: Arc<Mutex<Option<Bounds<Pixels>>>>,
}

fn rail_rect(bounds: Bounds<Pixels>) -> MarginRailRect {
    MarginRailRect {
        left: f32::from(bounds.left()),
        top: f32::from(bounds.top()),
        width: f32::from(bounds.size.width),
        height: f32::from(bounds.size.height),
    }
}

impl WritingRoom {
    fn margin_rail_writable(&self, cx: &App) -> bool {
        !self.standalone_route()
            && self.dossier.is_none()
            && !self.source_mode
            && (!self.proof_mode || self.split_view)
            && !self.reading
            && !self.active_document().archived
            && self.rich.as_ref().is_some_and(|editor| {
                !editor.read(cx).is_read_only() && !editor.read(cx).is_dragging()
            })
    }

    pub(super) fn clear_margin_rail_peek(&mut self, cx: &mut Context<Self>) {
        self.margin_rail.peek = None;
        if let Some(rail) = &self.margin_rail.view {
            rail.update(cx, |rail, cx| rail.set_peek(None, cx));
        }
    }

    pub(super) fn set_margin_rail_peek(&mut self, id: Option<&str>, cx: &mut Context<Self>) {
        let target = id
            .map(|id| CommentRef {
                folio_id: self.marginalia_folio_id(),
                id: id.to_owned(),
            })
            .filter(|target| {
                self.margin_rail
                    .notes
                    .iter()
                    .any(|note| note.target == *target)
                    && self.rich.as_ref().is_some_and(|editor| {
                        !editor.read(cx).is_read_only()
                            && !editor.read(cx).is_dragging()
                            && editor.read(cx).comment_bounds(&target.id).is_some()
                    })
            });
        if self.margin_rail.peek != target {
            self.margin_rail.peek = target;
            cx.notify();
        }
    }

    pub(super) fn sync_margin_rail(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let scope = self.marginalia_folio_id();
        let owner = self
            .rich
            .as_ref()
            .map(|editor| (self.active, editor.entity_id()));
        if self.margin_rail.owner != owner || self.margin_rail.scope.as_deref() != Some(&scope) {
            self.margin_rail.owner = owner;
            self.margin_rail.scope = Some(scope.clone());
            self.margin_rail.record = None;
            self.margin_rail.decision_key = None;
            self.margin_rail.shown.clear();
            self.margin_rail.dismissed.clear();
            self.margin_rail.peek = None;
            *self.margin_rail.text_bounds.lock().unwrap() = None;
            // Reset view-local dismissal/focus state for a new editor visit.
            self.margin_rail.subscription = None;
            self.margin_rail.view = None;
        }
        let notes_changed = self
            .margin_rail
            .record
            .as_ref()
            .is_none_or(|record| !Arc::ptr_eq(record, &self.marginalia.record));
        if notes_changed {
            self.margin_rail.notes = self
                .marginalia
                .record
                .comments
                .iter()
                .filter(|comment| comment.folio_id == scope)
                .filter_map(MarginRailNote::from_comment)
                .collect();
            self.margin_rail.record = Some(self.marginalia.record.clone());
            self.margin_rail.decision_key = None;
        }
        let (enabled, mode, weight, now) = self.margin_flow_context(cx);
        let key = DecisionKey {
            tick: now / twyne_desktop::flow::FLOW_TICK_MS,
            mode,
            enabled,
            weight,
        };
        if self.margin_rail.decision_key != Some(key) {
            let cursor_text = self
                .rich
                .as_ref()
                .and_then(|editor| editor.read(cx).current_block_text_content())
                .unwrap_or_default();
            self.margin_rail.decision = if enabled {
                select_writer_notes(
                    &self.margin_rail.notes,
                    &MarginRailContext {
                        mode,
                        cursor_text,
                        shown: self.margin_rail.shown.clone(),
                        dismissed: self.margin_rail.dismissed.clone(),
                        weight,
                        now,
                        ..MarginRailContext::default()
                    },
                )
            } else {
                MarginRailDecision::default()
            };
            let newly_shown = self
                .margin_rail
                .decision
                .visible
                .iter()
                .filter(|target| !self.margin_rail.shown.contains(*target))
                .cloned()
                .collect::<Vec<_>>();
            for target in newly_shown {
                self.margin_rail.shown.insert(target);
                self.record_margin_flow_outcome(ItemOutcome::Shown);
            }
            self.margin_rail.decision_key = Some(key);
        }
        let editor = self.rich.as_ref().map(|editor| editor.read(cx));
        let read_only = !self.margin_rail_writable(cx);
        let geometry = (*self.margin.page_bounds.lock().unwrap())
            .zip(*self.margin_rail.text_bounds.lock().unwrap())
            .map(|(canvas, text)| MarginRailGeometry {
                viewport_width: f32::from(window.viewport_size().width),
                viewport_height: f32::from(window.viewport_size().height),
                canvas: rail_rect(canvas),
                text: rail_rect(text),
                scroller: rail_rect(self.writing_scroll.bounds()),
                cursor_top: editor
                    .and_then(|editor| editor.caret_bounds())
                    .map(|bounds| f32::from(bounds.top())),
                obstacles: Vec::new(),
            });
        let open_thread = self.margin_rail_open_thread(cx);
        let anchors = editor.map(|editor| {
            let mut targets = self
                .margin_rail
                .notes
                .iter()
                .map(|note| note.target.clone())
                .collect::<Vec<_>>();
            if let Some(thread) = &open_thread
                && !targets.contains(&thread.target)
            {
                targets.push(thread.target.clone());
            }
            targets
                .into_iter()
                .filter_map(|target| {
                    editor
                        .comment_anchor_bounds(&target.id)
                        .map(|groups| MarginRailAnchor {
                            target,
                            groups: groups
                                .into_iter()
                                .map(|group| group.into_iter().map(rail_rect).collect())
                                .collect(),
                        })
                })
                .collect()
        });
        let presentation = MarginRailPresentation {
            visible: self.margin_rail.decision.visible.clone(),
            held: self.margin_rail.decision.held,
            enabled,
            mode,
            zen: self.desk.zen,
            read_only,
            foreground_open: self.inline_margin_visible() || self.new_folio_form,
            geometry,
            anchors,
            peek: self.margin_rail.peek.clone(),
            open_thread,
        };
        let capabilities = MarginRailCapabilities {
            open_threads: !read_only,
            dismiss: !read_only,
        };
        let snapshot =
            (notes_changed || self.margin_rail.view.is_none()).then(|| MarginRailSnapshot {
                folio_id: Some(scope),
                notes: self.margin_rail.notes.clone(),
                visible: presentation.visible.clone(),
                held: presentation.held,
                enabled: presentation.enabled,
                mode: presentation.mode,
                zen: presentation.zen,
                read_only: presentation.read_only,
                foreground_open: presentation.foreground_open,
                geometry: presentation.geometry.clone(),
                anchors: presentation.anchors.clone(),
                peek: presentation.peek.clone(),
                open_thread: presentation.open_thread.clone(),
            });
        if let Some(rail) = &self.margin_rail.view {
            rail.update(cx, |rail, cx| {
                rail.set_capabilities(capabilities, cx);
                if let Some(snapshot) = snapshot {
                    rail.set_snapshot(snapshot, cx);
                } else {
                    rail.set_presentation(presentation, cx);
                }
            });
        } else {
            let view = cx.new(|cx| MarginRailView::new(snapshot.unwrap(), capabilities, cx));
            self.margin_rail.subscription =
                Some(
                    cx.subscribe_in(&view, window, |room, sender, event, window, cx| {
                        if room.margin_rail.view.as_ref() != Some(sender) {
                            return;
                        }
                        room.margin_rail_event(event, window, cx);
                    }),
                );
            self.margin_rail.view = Some(view);
        }
    }

    fn margin_rail_event(
        &mut self,
        event: &MarginRailEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let target = match event {
            MarginRailEvent::OpenThread { target, .. }
            | MarginRailEvent::SetAside(target)
            | MarginRailEvent::SlotChanged { target, .. } => target,
        };
        if target.folio_id != self.marginalia_folio_id()
            || self.margin_rail.owner
                != self
                    .rich
                    .as_ref()
                    .map(|editor| (self.active, editor.entity_id()))
            || !self.margin_rail_writable(cx)
            || self.desk.zen
        {
            return;
        }
        match event {
            MarginRailEvent::OpenThread { target, .. } => {
                if !self
                    .margin_rail
                    .notes
                    .iter()
                    .any(|note| &note.target == target)
                {
                    return;
                }
                let range = self
                    .rich
                    .as_ref()
                    .and_then(|editor| editor.read(cx).document().first_comment_range(&target.id));
                if let Some(range) = range {
                    self.record_margin_flow_outcome(ItemOutcome::Engaged);
                    self.margin_rail.dismissed.remove(target);
                    self.margin_rail.decision_key = None;
                    self.open_inline_margin(target.id.clone(), range, window, cx);
                }
            }
            MarginRailEvent::SetAside(target) => {
                if self
                    .margin_rail
                    .notes
                    .iter()
                    .any(|note| &note.target == target)
                    && self.margin_rail.dismissed.insert(target.clone())
                {
                    self.record_margin_flow_outcome(ItemOutcome::Dismissed);
                    self.margin_rail.decision_key = None;
                    cx.notify();
                }
            }
            MarginRailEvent::SlotChanged { target, .. } => {
                if self
                    .margin_rail_open_thread(cx)
                    .is_some_and(|thread| thread.target == *target)
                {
                    cx.notify();
                }
            }
        }
    }
}
