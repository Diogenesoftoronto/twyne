//! Collected Notes/Footnotes use the rich view's immutable note catalog. The
//! view validates a jump against the current persistent atom before this host
//! centers its measured marker in the real writing scroller.

use super::*;
use twyne_desktop::editor::{NoteKind, view::NoteReference};

impl WritingRoom {
    pub(super) fn sync_note_surface(&self, window: &mut Window, cx: &mut Context<Self>) {
        if (self.standalone_route()
            || self.source_mode
            || (self.proof_mode && !self.split_view)
            || self.dossier.is_some())
            && let Some(editor) = &self.rich
        {
            editor.update(cx, |editor, cx| editor.hide_note_popup(window, cx));
        }
    }

    pub(super) fn collected_notes(
        &self,
        editor: &Entity<RichEditorView>,
        cx: &mut Context<Self>,
    ) -> Option<gpui_kit::AnyElement> {
        let references = editor.read(cx).note_references();
        if references.is_empty() {
            return None;
        }
        let p = *palette(cx);
        let mut notes = div()
            .id("manuscript-notes")
            .test_support()
            .mt(px(40.))
            .pt(px(24.))
            .border_t_1()
            .border_color(rgb(p.rule))
            .font_family(SERIF_FONT)
            .text_color(rgb(p.ink_light));
        let mut first = true;
        for kind in [NoteKind::Endnote, NoteKind::Footnote] {
            let items = references.iter().filter(|reference| reference.kind == kind);
            if !references.iter().any(|reference| reference.kind == kind) {
                continue;
            }
            let label = if kind == NoteKind::Endnote {
                "Notes"
            } else {
                "Footnotes"
            };
            let kind_name = if kind == NoteKind::Endnote {
                "endnote"
            } else {
                "footnote"
            };
            let color = if kind == NoteKind::Endnote {
                p.vermilion
            } else {
                p.cobalt
            };
            let mut group = div()
                .id(SharedString::from(format!("manuscript-notes-{kind_name}")))
                .test_support()
                .when(!first, |this| this.mt(px(28.)))
                .child(
                    div()
                        .id(SharedString::from(format!(
                            "manuscript-notes-{kind_name}-heading"
                        )))
                        .mb(px(8.))
                        .role(Role::Heading)
                        .child(tracked_typewriter(
                            &label.to_uppercase(),
                            11.2,
                            1.568,
                            p.ink_muted,
                        )),
                );
            let mut list = div()
                .id(SharedString::from(format!(
                    "manuscript-notes-{kind_name}-list"
                )))
                .role(Role::List)
                .text_size(px(14.72))
                .line_height(px(23.552));
            for reference in items {
                let accessible = format!("Jump to {kind_name} {} in the text", reference.number);
                let marker = if kind == NoteKind::Footnote {
                    format!("†{}", reference.number)
                } else {
                    reference.number.to_string()
                };
                let note = reference.clone();
                let target = editor.clone();
                let marker = gpui_kit::base::Button::new(SharedString::from(format!(
                    "manuscript-note-jump-{kind_name}-{}",
                    reference.number
                )))
                .accessibility_label(accessible)
                .h_auto()
                .min_w(px(16.07424))
                .p_0()
                .rounded_none()
                .flex_shrink_0()
                .font_family(TYPEWRITER_FONT)
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(11.4816))
                .line_height(px(18.37056))
                .text_color(rgb(color))
                .hover(|this| this.opacity(0.7).underline())
                .child(div().w_full().text_align(TextAlign::Right).child(marker))
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.jump_collected_note(&target, &note, window, cx);
                }));
                list = list.child(
                    div()
                        .id(SharedString::from(format!(
                            "manuscript-note-{kind_name}-{}",
                            reference.number
                        )))
                        .role(Role::ListItem)
                        .flex()
                        .gap(px(8.832))
                        .py(px(2.944))
                        .child(focus_outline(marker, 2., 0., p.vermilion))
                        .child(div().flex_1().min_w_0().child(reference.text.to_string())),
                );
            }
            group = group.child(list);
            notes = notes.child(group);
            first = false;
        }
        Some(self.measure_collected_notes(editor, notes.into_any_element(), cx))
    }

    fn jump_collected_note(
        &mut self,
        editor: &Entity<RichEditorView>,
        reference: &NoteReference,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.rich.as_ref() != Some(editor)
            || self.standalone_route()
            || self.source_mode
            || (self.proof_mode && !self.split_view)
            || self.dossier.is_some()
        {
            return;
        }
        match editor.update(cx, |view, cx| view.jump_note(reference, window, cx)) {
            Ok(true) => {}
            Ok(false) => return,
            Err(error) => {
                self.notice = Some(format!("This note could not be opened: {error}"));
                cx.notify();
                return;
            }
        }
        let reference = reference.clone();
        let target = editor.entity_id();
        let revision = editor.read(cx).revision();
        let folio = self.active;
        let visit = self.revision_generation;
        let room = cx.weak_entity();
        // SelectionChanged schedules the ordinary caret reveal. Center on the
        // following frame, using the marker's updated measured coordinates.
        window.on_next_frame(move |window, _| {
            window.on_next_frame(move |_, cx| {
                let _ = room.update(cx, |this, cx| {
                    if this.active != folio
                        || this.revision_generation != visit
                        || this.source_mode
                        || (this.proof_mode && !this.split_view)
                        || this.standalone_route()
                        || this.dossier.is_some()
                    {
                        return;
                    }
                    let Some(view) = this.rich.as_ref().filter(|view| view.entity_id() == target)
                    else {
                        return;
                    };
                    if view.read(cx).revision() != revision {
                        return;
                    }
                    let Some(marker) = view.read(cx).note_bounds(&reference) else {
                        return;
                    };
                    let viewport = this.writing_scroll.bounds();
                    if viewport.size.height <= px(0.) {
                        return;
                    }
                    let mut offset = this.writing_scroll.offset();
                    offset.y += viewport.top() + viewport.size.height / 2.
                        - marker.top()
                        - marker.size.height / 2.;
                    offset.y = offset
                        .y
                        .clamp(-this.writing_scroll.max_offset().y.max(px(0.)), px(0.));
                    this.writing_scroll.set_offset(offset);
                    cx.notify();
                });
            });
        });
    }
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::{AnyWindowHandle, TestAppContext, test::TestWindowExt};
    use tempfile::TempDir;
    use twyne_desktop::editor::Command;

    fn note_room(
        cx: &mut TestAppContext,
    ) -> (AnyWindowHandle, Entity<WritingRoom>, Arc<Store>, TempDir) {
        let (handle, room, store, directory) = super::super::tests::room(cx);
        let mut html = String::new();
        for index in 0..70 {
            html.push_str(&format!(
                "<p>Paragraph {index}: this prose surrounds the independently numbered notes."
            ));
            if index == 34 {
                html.push_str(
                    "<sup data-type=\"footnote\" data-endnote-text=\"The middle source.\"></sup>",
                );
            }
            if index == 44 {
                html.push_str(
                    "<sup data-type=\"endnote\" data-endnote-text=\"A retained endnote.\"></sup>",
                );
            }
            html.push_str("</p>");
        }
        let path = store.root().join("Collected notes.html");
        std::fs::write(&path, &html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), &html).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.set_write(window, cx);
                room.desk.set_zen(true, false);
            });
        })
        .unwrap();
        cx.run_until_parked();
        (handle, room, store, directory)
    }

    #[gpui_kit::test]
    fn actual_collected_note_click_selects_and_centers_the_atom_without_history(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, _store, _directory) = note_room(cx);
        let (editor, reference, before) = cx
            .update_window(handle, |_, window, cx| {
                window.render_frame(cx);
                assert!(
                    window.find("manuscript-notes-endnote").bounds().top()
                        < window.find("manuscript-notes-footnote").bounds().top()
                );
                let result = room.update(cx, |room, cx| {
                    let editor = room.rich.clone().unwrap();
                    let reference = editor
                        .read(cx)
                        .note_references()
                        .iter()
                        .find(|note| note.kind == NoteKind::Footnote)
                        .unwrap()
                        .clone();
                    let before = editor.read(cx).snapshot();
                    let max = room.writing_scroll.max_offset().y;
                    let mut offset = room.writing_scroll.offset();
                    offset.y = -max;
                    room.writing_scroll.set_offset(offset);
                    (editor, reference, before)
                });
                window.render_frame(cx);
                window.click("manuscript-note-jump-footnote-1", cx);
                result
            })
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            for _ in 0..3 {
                window.simulate_next_frame(cx);
                window.render_frame(cx);
            }
            assert_eq!(
                editor.read(cx).selection(),
                Selection::new(reference.position, reference.position + 1)
            );
            assert_eq!(editor.read(cx).document(), &before);
            assert!(!editor.read(cx).can_undo());
            let marker = editor.read(cx).note_bounds(&reference).unwrap();
            let viewport = room.read(cx).writing_scroll.bounds();
            let difference =
                marker.top() + marker.size.height / 2. - viewport.top() - viewport.size.height / 2.;
            assert!(
                f32::from(difference).abs() < 1.,
                "The actual note marker must be centered: {difference:?}"
            );
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn changed_note_position_and_switched_editor_refuse_the_old_list_jump(cx: &mut TestAppContext) {
        let (handle, room, _store, _directory) = note_room(cx);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let editor = room.rich.clone().unwrap();
                let reference = editor.read(cx).note_references()[0].clone();
                editor.update(cx, |view, cx| {
                    view.set_selection(Selection::caret(0), cx).unwrap();
                    view.execute(Command::InsertText("A prefix. ".into()), window, cx)
                        .unwrap();
                });
                let selection = editor.read(cx).selection();
                let before = editor.read(cx).snapshot();
                let offset = room.writing_scroll.offset();
                room.jump_collected_note(&editor, &reference, window, cx);
                assert_eq!(editor.read(cx).selection(), selection);
                assert_eq!(editor.read(cx).document(), &before);
                assert_eq!(room.writing_scroll.offset(), offset);
                let next_path = room.store.root().join("Another manuscript.html");
                std::fs::write(&next_path, "<p>A different manuscript.</p>").unwrap();
                let next = import_file(&next_path).unwrap();
                assert!(room.add_document(next, window, cx));
                let current = room.rich.clone().unwrap();
                let current_selection = current.read(cx).selection();
                room.jump_collected_note(&editor, &reference, window, cx);
                assert_eq!(current.read(cx).selection(), current_selection);
                assert_eq!(editor.read(cx).document(), &before);
            });
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn saved_unblurred_note_stays_clean_after_queued_changes_but_new_edits_are_dirty(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory) = super::super::tests::room(cx);
        let path = store.root().join("The saved note.html");
        std::fs::write(
            &path,
            "<p>A passage. <sup data-type=\"endnote\" data-endnote-text=\"Original note\"></sup></p>",
        )
        .unwrap();
        let document = import_file(&path).unwrap();
        let id = document.id;
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.set_write(window, cx);
            });
            window.render_frame(cx);
            window.click("twyne-note-reference-0-1", cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
        })
        .unwrap();
        cx.run_until_parked();
        let (saved_revision, saved_bytes) = cx
            .update_window(handle, |_, window, cx| {
                window.press("ctrl-a", cx);
                window.input("Saved note 東京 🦊", cx);
                // Capture the field before its queued Rich Changed reaches
                // the host, just as an immediate native Save does.
                room.update(cx, |room, cx| room.flush(cx)).unwrap();
                (
                    room.read(cx).active_document().revision,
                    std::fs::read(store.document_path(id)).unwrap(),
                )
            })
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(!room.read(cx).dirty, "An accepted note must stay saved");
            assert!(room.read(cx).debounce.is_none());
            assert_eq!(room.read(cx).active_document().revision, saved_revision);
            assert_eq!(std::fs::read(store.document_path(id)).unwrap(), saved_bytes);
            assert_eq!(window.find("save-status").label(), Some("Saved locally"));
            let note_input = gpui_kit::base::test_support::snapshots(window)
                .into_iter()
                .find(|element| element.label() == Some("Note text"))
                .expect("The retained native note input is present");
            assert_eq!(note_input.focused(), Some(true));
            let editor = room.read(cx).rich.clone().unwrap();
            editor.update(cx, |editor, cx| {
                editor.set_selection(Selection::caret(0), cx).unwrap();
                editor
                    .execute(Command::InsertText("A later edit. ".into()), window, cx)
                    .unwrap();
            });
        })
        .unwrap();
        cx.update_window(handle, |_, _, cx| {
            assert!(
                room.read(cx).dirty,
                "A newer rich edit must still be captured"
            );
            assert!(room.read(cx).debounce.is_some());
            assert!(room.read(cx).active_document().revision > saved_revision);
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn unblurred_note_survives_explicit_save_and_a_refused_settings_departure(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory) = super::super::tests::room(cx);
        let path = store.root().join("A note to retain.html");
        let html = "<p>A passage. <sup data-type=\"endnote\" data-endnote-text=\"The original note.\" data-retained=\"original\"></sup></p>";
        std::fs::write(&path, html).unwrap();
        let document = import_file(&path).unwrap();
        let id = document.id;
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.set_write(window, cx);
                room.desk.set_zen(true, false);
            });
            window.render_frame(cx);
            window.click("twyne-note-reference-0-1", cx);
            window.render_frame(cx);
            window.simulate_next_frame(cx);
            window.render_frame(cx);
        })
        .unwrap();
        cx.run_until_parked();
        let obstruction = store.document_path(id).with_extension("json.bak");
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.press("ctrl-a", cx);
            window.input("Final note 東京 🦊 é", cx);
            // Do not settle subscriptions: Save must read the native field.
            room.update(cx, |room, cx| room.flush(cx)).unwrap();
            let saved = store
                .load()
                .unwrap()
                .documents
                .into_iter()
                .find(|document| document.id == id)
                .unwrap();
            let saved_html = &saved.workspace.as_deref().unwrap().content.html;
            assert!(saved_html.contains("data-endnote-text=\"Final note 東京 🦊 é\""));
            assert!(saved_html.contains("data-retained=\"original\""));
            window.input("!", cx);
            if obstruction.exists() {
                std::fs::remove_file(&obstruction).unwrap();
            }
            std::fs::create_dir(&obstruction).unwrap();
            room.update(cx, |room, cx| room.open_settings(window, cx));
            window.render_frame(cx);
            assert!(!room.read(cx).settings_route);
            assert!(room.read(cx).error.is_some());
            assert_eq!(
                &*room
                    .read(cx)
                    .rich
                    .as_ref()
                    .unwrap()
                    .read(cx)
                    .note_references()[0]
                    .text,
                "Final note 東京 🦊 é!"
            );
            assert!(window.find("twyne-note-text").visible());
            std::fs::remove_dir(&obstruction).unwrap();
            room.update(cx, |room, cx| room.open_settings(window, cx));
            window.render_frame(cx);
            assert!(room.read(cx).settings_route);
        })
        .unwrap();
        cx.run_until_parked();
        let saved = store
            .load()
            .unwrap()
            .documents
            .into_iter()
            .find(|document| document.id == id)
            .unwrap();
        assert!(
            saved
                .workspace
                .as_deref()
                .unwrap()
                .content
                .html
                .contains("data-endnote-text=\"Final note 東京 🦊 é!\"")
        );
    }
}
