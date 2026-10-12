//! The rich view owns the move transaction. This host only exposes its actual
//! scroller and scrolls a live drag at that scroller's visible edges.

use super::*;
use gpui_kit::{EntityId, Pixels, Point};
use std::time::Instant;

#[derive(Clone, Copy)]
struct DragTarget {
    folio: Uuid,
    visit: u64,
    editor: EntityId,
}

#[derive(Default)]
pub(super) struct EditorDragState {
    target: Option<DragTarget>,
    frame_pending: bool,
    last_frame: Option<Instant>,
}

impl WritingRoom {
    fn drag_surface_visible(&self) -> bool {
        !self.standalone_route()
            && self.dossier.is_none()
            && !self.source_mode
            && (!self.proof_mode || self.split_view)
            && !self.active_document().archived
    }

    pub(super) fn stop_editor_drag_scroll(&mut self) {
        self.editor_drag.target = None;
        self.editor_drag.last_frame = None;
    }

    pub(super) fn sync_editor_drag_viewport(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let bounds = self.writing_scroll.bounds();
        let visible = self.drag_surface_visible() && bounds.size.height > px(0.);
        if !visible {
            self.stop_editor_drag_scroll();
        }
        if let Some(editor) = &self.rich {
            editor.update(cx, |editor, cx| {
                editor.set_drag_viewport(visible.then_some(bounds));
                if !visible {
                    editor.cancel_block_drag(window, cx);
                }
            });
        }
    }

    pub(super) fn request_editor_drag_scroll(
        &mut self,
        sender: &Entity<RichEditorView>,
        position: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.drag_surface_visible()
            || self.rich.as_ref() != Some(sender)
            || !sender.read(cx).is_dragging()
            || !self.writing_scroll.bounds().contains(&position)
        {
            return;
        }
        self.editor_drag.target = Some(DragTarget {
            folio: self.active,
            visit: self.revision_generation,
            editor: sender.entity_id(),
        });
        self.schedule_editor_drag_scroll(window, cx);
    }

    fn schedule_editor_drag_scroll(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.editor_drag.frame_pending {
            return;
        }
        self.editor_drag.frame_pending = true;
        let room = cx.weak_entity();
        window.on_next_frame(move |window, cx| {
            let _ = room.update(cx, |room, cx| {
                room.editor_drag.frame_pending = false;
                room.scroll_editor_drag_frame(window, cx);
            });
        });
    }

    fn scroll_editor_drag_frame(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(target) = self.editor_drag.target else {
            return;
        };
        if !window.is_visible()
            || !self.drag_surface_visible()
            || target.folio != self.active
            || target.visit != self.revision_generation
            || self.rich.as_ref().is_none_or(|editor| {
                editor.entity_id() != target.editor || !editor.read(cx).is_dragging()
            })
        {
            self.stop_editor_drag_scroll();
            return;
        }
        let bounds = self.writing_scroll.bounds();
        let pointer = window.mouse_position();
        if !bounds.contains(&pointer) || bounds.size.height <= px(0.) {
            self.stop_editor_drag_scroll();
            return;
        }
        let velocity = if pointer.y < bounds.top() + px(32.) {
            (f32::from(bounds.top() + px(32.) - pointer.y) / 32.).clamp(0., 1.) * 560.
        } else if pointer.y > bounds.bottom() - px(32.) {
            -(f32::from(pointer.y - (bounds.bottom() - px(32.))) / 32.).clamp(0., 1.) * 560.
        } else {
            self.stop_editor_drag_scroll();
            return;
        };
        let now = Instant::now();
        let elapsed = self
            .editor_drag
            .last_frame
            .replace(now)
            .map_or(1. / 60., |at| {
                now.duration_since(at).as_secs_f32().min(0.05)
            });
        let previous = self.writing_scroll.offset();
        let mut next = previous;
        next.y = (previous.y + px(velocity * elapsed))
            .clamp(-self.writing_scroll.max_offset().y.max(px(0.)), px(0.));
        if next == previous {
            self.stop_editor_drag_scroll();
            return;
        }
        self.writing_scroll.set_offset(next);
        cx.notify();
        self.schedule_editor_drag_scroll(window, cx);
    }
}
