use super::*;
use twyne_desktop::{
    apparatus::{ApparatusRecord, ApparatusRequest, ApparatusStore},
    apparatus_view::{
        ApparatusAddDetectedRequest, ApparatusCapabilities, ApparatusCiteRequest,
        ApparatusCopyRequest, ApparatusEvent, ApparatusScanRequest, ApparatusSurface,
        ApparatusView, ApparatusViewContext,
    },
    citation_anchor::{CitationPlacementRequest, CitationPreparation, PreparedCitation},
    semantic_bridge::{ApparatusScanSurface, SemanticBridge},
};

pub(super) struct ApparatusState {
    pub(super) store: Option<ApparatusStore>,
    pub(super) record: Arc<ApparatusRecord>,
    pub(super) pending: Option<ApparatusRequest>,
    pub(super) view: Option<Entity<ApparatusView>>,
    pub(super) subscription: Option<Subscription>,
    pub(super) scope: Option<String>,
    pub(super) route: bool,
    pub(super) boundary_error: Option<String>,
    context: Option<ApparatusViewContext>,
    context_generation: u64,
    context_task: Option<Task<()>>,
    citation: Option<CitationGuard>,
    citation_task: Option<Task<()>>,
    citation_metadata: Option<Uuid>,
}

#[cfg(all(test, feature = "ui-tests"))]
mod tests {
    use super::*;
    use gpui_kit::{AnyWindowHandle, TestAppContext, test::TestWindowExt};
    use tempfile::TempDir;
    use twyne_desktop::apparatus::{ApparatusEdit, CitationStyle, parse_apparatus_json};
    use twyne_desktop::editor::{Command, InlineObject, NoteKind};

    fn fixture() -> Arc<ApparatusRecord> {
        Arc::new(
            parse_apparatus_json(include_bytes!(
                "../../fixtures/apparatus/retained-native.json"
            ))
            .unwrap(),
        )
    }

    fn apparatus_room(
        cx: &mut TestAppContext,
    ) -> (
        AnyWindowHandle,
        Entity<WritingRoom>,
        Arc<Store>,
        TempDir,
        String,
    ) {
        let (handle, room, store, directory) = super::super::tests::room(cx);
        let html = "<h1>The scoped notebook</h1><p>Verbatim supporting passage.</p><p>See https://example.org/report/?new=1 and doi:10.5555/detected.</p>";
        let path = store.root().join("The scoped notebook.html");
        std::fs::write(&path, html).unwrap();
        let document =
            twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
        let scope = document.workspace.as_deref().unwrap().folio.id.clone();
        let mut record = (*fixture()).clone();
        if let twyne_desktop::exchange::OptionalField::Value(serde_json::Value::Array(rows)) =
            &mut record.bibliography
        {
            for row in rows {
                if row.get("folioId").and_then(serde_json::Value::as_str)
                    == Some("original/path/folio:café")
                {
                    row.as_object_mut()
                        .unwrap()
                        .insert("folioId".into(), serde_json::Value::String(scope.clone()));
                }
            }
        }
        let metadata = ApparatusStore::open(store.root()).unwrap();
        std::fs::write(metadata.path(), serde_json::to_vec(&record).unwrap()).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.add_document(document, window, cx));
                room.apparatus = ApparatusState::load(&store).0;
                room.set_write(window, cx);
                room.open_apparatus(ApparatusSurface::Board, window, cx);
            });
        })
        .unwrap();
        cx.run_until_parked();
        (handle, room, store, directory, scope)
    }

    #[test]
    fn original_formatting_context_keeps_global_indices_and_copies_only_exact_scope() {
        let record = fixture();
        let before = serde_json::to_value(record.as_ref()).unwrap();
        let context = prepare_context(record.clone(), "original/path/folio:café".into()).unwrap();
        assert_eq!(
            context
                .formatted_rows
                .iter()
                .map(|row| row.index)
                .collect::<Vec<_>>(),
            [0, 1]
        );
        assert_eq!(
            context.formatted_rows[0].citation,
            "Cached original fixture citation."
        );
        assert_eq!(
            context.copy_all_text,
            context
                .formatted_rows
                .iter()
                .map(|row| row.citation.as_str())
                .collect::<Vec<_>>()
                .join("\n\n")
        );
        assert!(context.research.is_none());
        let alias = prepare_context(record.clone(), "folio:café".into()).unwrap();
        assert!(alias.formatted_rows.is_empty() && alias.copy_all_text.is_empty());
        assert_eq!(serde_json::to_value(record.as_ref()).unwrap(), before);
    }

    #[gpui_kit::test]
    fn apparatus_route_joins_exact_metadata_candidate_and_preserves_manuscript(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, scope) = apparatus_room(cx);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                room.flush(cx).unwrap();
                let manuscript = std::fs::read(store.document_path(room.active)).unwrap();
                let before = room.apparatus.record.clone();
                let view = room.apparatus.view.clone().unwrap();
                let request = view
                    .update(cx, |view, cx| {
                        view.request_edit(ApparatusEdit::SetCitationStyle(CitationStyle::Apa), cx)
                    })
                    .unwrap()
                    .unwrap();
                room.request_apparatus_save(request.clone(), window, cx);
                room.open_apparatus(ApparatusSurface::Page, window, cx);
                assert!(room.apparatus.route && room.standalone_route());
                assert_eq!(room.apparatus.record, request.candidate);
                assert!(view.read(cx).pending_request().is_none());
                assert_eq!(
                    room.apparatus.record.effective_bibliography(),
                    before.effective_bibliography()
                );
                assert_eq!(view.read(cx).active_folio_id(), Some(scope.as_str()));
                assert_eq!(
                    room.apparatus.view.as_ref().unwrap().entity_id(),
                    view.entity_id()
                );
                assert_eq!(
                    std::fs::read(store.document_path(room.active)).unwrap(),
                    manuscript
                );
            });
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(
            ApparatusStore::open(store.root())
                .unwrap()
                .load()
                .unwrap()
                .record
                .generation,
            1
        );
    }

    #[gpui_kit::test]
    fn failed_apparatus_write_holds_candidate_blocks_departure_and_retries_once(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, scope) = apparatus_room(cx);
        let metadata = ApparatusStore::open(store.root()).unwrap();
        let primary = std::fs::read(metadata.path()).unwrap();
        let obstruction = metadata.path().with_extension("json.bak");
        std::fs::create_dir(&obstruction).unwrap();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let before = room.apparatus.record.clone();
                let view = room.apparatus.view.clone().unwrap();
                let request = view
                    .update(cx, |view, cx| {
                        view.request_edit(
                            ApparatusEdit::Drop {
                                folio_id: scope.clone(),
                                id: "background-retained".into(),
                            },
                            cx,
                        )
                    })
                    .unwrap()
                    .unwrap();
                let active = room.active;
                let count = room.documents.len();
                assert!(!room.add_document(Manuscript::new("Held departure"), window, cx));
                room.open_cast(CastSurface::Manager, window, cx);
                assert!(room.cast.route.is_none());
                assert!(room.flush_apparatus_on_shutdown(cx).is_err());
                assert_eq!(room.apparatus.record, before);
                assert_eq!(view.read(cx).pending_request(), Some(&request));
                assert_eq!(std::fs::read(metadata.path()).unwrap(), primary);
                std::fs::remove_dir(&obstruction).unwrap();
                room.flush_apparatus(window, cx).unwrap();
                assert_eq!(room.apparatus.record, request.candidate);
                assert_eq!((room.active, room.documents.len()), (active, count));
                assert!(!room.ack_apparatus(
                    request.request_id,
                    request.candidate.clone(),
                    window,
                    cx
                ));
                room.request_apparatus_save(request, window, cx);
                assert!(room.apparatus.pending.is_none());
                assert!(room.apparatus.boundary_error.is_none());
            });
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(metadata.load().unwrap().record.generation, 1);
    }

    #[gpui_kit::test]
    fn removed_retry_restores_panel_focus_and_the_save_key_binding(cx: &mut TestAppContext) {
        let (handle, room, store, _directory, scope) = apparatus_room(cx);
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                room.open_apparatus(ApparatusSurface::Page, window, cx);
            });
        })
        .unwrap();
        cx.run_until_parked();
        let metadata = ApparatusStore::open(store.root()).unwrap();
        let obstruction = metadata.path().with_extension("json.bak");
        if obstruction.is_file() {
            std::fs::remove_file(&obstruction).unwrap();
        }
        std::fs::create_dir(&obstruction).unwrap();
        cx.update_window(handle, |_, _window, cx| {
            room.update(cx, |room, cx| {
                room.apparatus
                    .view
                    .as_ref()
                    .unwrap()
                    .update(cx, |view, cx| {
                        view.request_edit(
                            ApparatusEdit::Drop {
                                folio_id: scope,
                                id: "background-retained".into(),
                            },
                            cx,
                        )
                        .unwrap()
                        .unwrap();
                    });
            });
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                assert!(room.flush_apparatus(window, cx).is_err());
            });
            window.activate_window();
            window.render_frame(cx);
            assert!(window.find("apparatus-retry").visible());
            std::fs::remove_dir(&obstruction).unwrap();
            window.click("apparatus-retry", cx);
            let view = room.read(cx).apparatus.view.clone().unwrap();
            assert!(view.read(cx).focus_handle(cx).is_focused(window));
            // Retry is replaced by Saving immediately. Its surviving panel
            // keeps keyboard focus while the actual durable write is joined.
            room.update(cx, |room, cx| room.flush_apparatus(window, cx).unwrap());
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            for _ in 0..3 {
                window.simulate_next_frame(cx);
                window.render_frame(cx);
            }
            let view = room.read(cx).apparatus.view.clone().unwrap();
            assert!(view.read(cx).pending_request().is_none());
            assert!(view.read(cx).focus_handle(cx).is_focused(window));
            let path = store.document_path(room.read(cx).active);
            let before = std::fs::read(&path).unwrap();
            let original: serde_json::Value = serde_json::from_slice(&before).unwrap();
            room.read(cx).title.clone().update(cx, |title, cx| {
                title.set_value("Saved from the surviving Apparatus scope", window, cx);
            });
            assert_eq!(std::fs::read(&path).unwrap(), before);
            window.press("ctrl-s", cx);
            let saved: serde_json::Value =
                serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            assert_eq!(saved["title"], "Saved from the surviving Apparatus scope");
            assert_eq!(
                saved["workspace"]["content"],
                original["workspace"]["content"]
            );
        })
        .unwrap();
        assert_eq!(metadata.load().unwrap().record.generation, 1);
    }

    #[gpui_kit::test]
    fn actual_host_citation_confirms_after_editor_commit_and_keeps_exact_undo(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, scope) = apparatus_room(cx);
        let (before, selection, request) = cx
            .update_window(handle, |_, _window, cx| {
                room.update(cx, |room, cx| {
                    let editor = room.rich.clone().unwrap();
                    editor.update(cx, |editor, cx| {
                        editor.set_selection(Selection::new(12, 2), cx).unwrap()
                    });
                    let before = editor.read(cx).snapshot();
                    let selection = editor.read(cx).selection();
                    let view = room.apparatus.view.clone().unwrap();
                    let request = view
                        .update(cx, |view, cx| view.request_citation(1, cx))
                        .unwrap();
                    assert_eq!(request.folio_id, scope);
                    assert_eq!(editor.read(cx).document(), &before);
                    assert!(
                        raw_rows(&room.apparatus.record)[1]
                            .get("citationInsertedAt")
                            .is_none()
                    );
                    (before, selection, request)
                })
            })
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            room.update(cx, |room, cx| {
                let editor = room.rich.clone().unwrap();
                assert_ne!(editor.read(cx).document(), &before);
                assert!(
                    raw_rows(&room.apparatus.record)[1]
                        .get("citationInsertedAt")
                        .and_then(serde_json::Value::as_f64)
                        .is_some_and(|at| at > 0.)
                );
                let confirmed = editor.read(cx).snapshot();
                room.place_apparatus_citation(request, window, cx);
                assert_eq!(editor.read(cx).document(), &confirmed);
                editor
                    .update(cx, |editor, cx| editor.execute(Command::Undo, window, cx))
                    .unwrap();
                assert_eq!(editor.read(cx).document(), &before);
                assert_eq!(editor.read(cx).selection(), selection);
                editor
                    .update(cx, |editor, cx| editor.execute(Command::Redo, window, cx))
                    .unwrap();
                assert_eq!(editor.read(cx).document(), &confirmed);
            });
        })
        .unwrap();
        assert!(
            ApparatusStore::open(store.root())
                .unwrap()
                .load()
                .unwrap()
                .record
                .display(&scope)
                .unwrap()
                .bibliography
                .entries[1]
                .entry
                .citation_inserted_at
                .as_ref()
                .is_some_and(|at| *at > 0.)
        );
    }

    #[gpui_kit::test]
    fn stale_host_citation_preserves_draft_selection_and_unfiled_source(cx: &mut TestAppContext) {
        let (handle, room, _store, _directory, _) = apparatus_room(cx);
        let before = cx
            .update_window(handle, |_, window, cx| {
                room.update(cx, |room, cx| {
                    let view = room.apparatus.view.clone().unwrap();
                    let request = view
                        .update(cx, |view, cx| view.request_citation(1, cx))
                        .unwrap();
                    let guard = room.citation_guard(&request, cx).unwrap();
                    let editor = room.rich.clone().unwrap();
                    editor.update(cx, |editor, cx| {
                        editor.set_selection(Selection::new(8, 2), cx).unwrap()
                    });
                    let before = editor.read(cx).snapshot();
                    room.apparatus.citation = Some(guard.clone());
                    room.finish_citation(
                        request,
                        guard,
                        Err(anyhow::anyhow!("This stale preparation must not commit.")),
                        window,
                        cx,
                    );
                    assert_eq!(editor.read(cx).document(), &before);
                    assert_eq!(editor.read(cx).selection(), Selection::new(8, 2));
                    assert!(
                        raw_rows(&room.apparatus.record)[1]
                            .get("citationInsertedAt")
                            .is_none()
                    );
                    assert!(view.read(cx).pending_citation().is_none());
                    before
                })
            })
            .unwrap();
        cx.run_until_parked();
        cx.read(|cx| {
            assert_eq!(
                room.read(cx).rich.as_ref().unwrap().read(cx).document(),
                &before
            )
        });
    }

    #[gpui_kit::test]
    fn immediate_cite_captures_unblurred_note_and_keeps_its_undo_separate(cx: &mut TestAppContext) {
        let (handle, room, store, _directory, _) = apparatus_room(cx);
        let (editor, before) = cx
            .update_window(handle, |_, window, cx| {
                let editor = room.read(cx).rich.clone().unwrap();
                editor.update(cx, |editor, cx| {
                    editor.set_selection(Selection::caret(0), cx).unwrap();
                    editor
                        .execute(
                            Command::InsertInline(InlineObject::Note {
                                kind: NoteKind::Endnote,
                                text: "The original note.".into(),
                            }),
                            window,
                            cx,
                        )
                        .unwrap();
                });
                let before = editor.read(cx).snapshot();
                window.render_frame(cx);
                window.click("twyne-note-reference-0-0", cx);
                window.render_frame(cx);
                window.simulate_next_frame(cx);
                window.render_frame(cx);
                (editor, before)
            })
            .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.press("ctrl-a", cx);
            window.input("An unblurred note 東京 🦊 é", cx);
            // Submit through the mounted view without settling native Change.
            let view = room.read(cx).apparatus.view.clone().unwrap();
            assert!(
                view.update(cx, |view, cx| view.request_citation(1, cx))
                    .is_some()
            );
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| {
            let html = editor.read(cx).document().to_html();
            assert!(html.contains("data-endnote-text=\"An unblurred note 東京 🦊 é\""));
            assert_eq!(html.matches("data-type=\"footnote\"").count(), 1);
            assert!(
                raw_rows(&room.read(cx).apparatus.record)[1]
                    .get("citationInsertedAt")
                    .and_then(serde_json::Value::as_f64)
                    .is_some_and(|at| at > 0.)
            );
            let saved = store
                .load()
                .unwrap()
                .documents
                .into_iter()
                .find(|document| document.id == room.read(cx).active)
                .unwrap();
            assert_eq!(saved.workspace.as_deref().unwrap().content.html, html);
            editor.update(cx, |editor, cx| {
                editor.execute(Command::Undo, window, cx).unwrap();
                assert_eq!(editor.note_references().len(), 1);
                assert_eq!(
                    &*editor.note_references()[0].text,
                    "An unblurred note 東京 🦊 é"
                );
                editor.execute(Command::Undo, window, cx).unwrap();
                assert_eq!(editor.document(), &before);
            });
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn folio_switch_keeps_view_and_raw_metadata_but_discards_old_scan(cx: &mut TestAppContext) {
        let (handle, room, store, _directory, scope) = apparatus_room(cx);
        let metadata = ApparatusStore::open(store.root()).unwrap();
        let primary = std::fs::read(metadata.path()).unwrap();
        let (view_id, before, original) = cx
            .update_window(handle, |_, window, cx| {
                room.update(cx, |room, cx| {
                    let view = room.apparatus.view.clone().unwrap();
                    let original = room.active;
                    let before = room.apparatus.record.clone();
                    let scan = view.update(cx, |view, cx| view.request_scan(cx)).unwrap();
                    assert!(room.add_document(Manuscript::new("A separate folio"), window, cx));
                    let other_scope = room.marginalia_folio_id();
                    assert_ne!(other_scope, scope);
                    assert_eq!(
                        room.apparatus.view.as_ref().unwrap().entity_id(),
                        view.entity_id()
                    );
                    assert_eq!(view.read(cx).active_folio_id(), Some(other_scope.as_str()));
                    assert!(
                        view.read(cx)
                            .display()
                            .unwrap()
                            .bibliography
                            .entries
                            .is_empty()
                    );
                    assert!(view.read(cx).pending_scan().is_none());
                    assert!(!view.update(cx, |view, cx| {
                        view.accept_scan(scan.request_id, Vec::new(), cx)
                    }));
                    assert_eq!(room.apparatus.record, before);
                    room.select(original, window, cx);
                    assert_eq!(view.read(cx).active_folio_id(), Some(scope.as_str()));
                    (view.entity_id(), before, original)
                })
            })
            .unwrap();
        cx.run_until_parked();
        cx.read(|cx| {
            let room = room.read(cx);
            assert_eq!(room.active, original);
            assert_eq!(room.apparatus.view.as_ref().unwrap().entity_id(), view_id);
            assert_eq!(room.apparatus.record, before);
            assert_eq!(
                room.apparatus
                    .context
                    .as_ref()
                    .unwrap()
                    .formatted_rows
                    .len(),
                2
            );
        });
        assert_eq!(std::fs::read(metadata.path()).unwrap(), primary);
    }

    #[gpui_kit::test]
    fn public_copy_all_publishes_scoped_background_and_writer_sources(cx: &mut TestAppContext) {
        let (handle, room, _store, _directory, scope) = apparatus_room(cx);
        let request = cx
            .update_window(handle, |_, _window, cx| {
                room.update(cx, |room, cx| {
                    let expected = room.apparatus.context.as_ref().unwrap();
                    assert_eq!(expected.formatted_rows.len(), 2);
                    let expected_text = expected.copy_all_text.clone();
                    let view = room.apparatus.view.clone().unwrap();
                    let request = view
                        .update(cx, |view, cx| view.request_copy_all(cx))
                        .unwrap();
                    assert_eq!(request.folio_id, scope);
                    assert_eq!(request.text, expected_text);
                    assert!(request.source_index.is_none());
                    request
                })
            })
            .unwrap();
        cx.run_until_parked();
        cx.read(|cx| {
            assert_eq!(
                cx.read_from_clipboard().unwrap().text().as_deref(),
                Some(request.text.as_str())
            );
        });
        cx.update_window(handle, |_, _window, cx| {
            room.update(cx, |room, cx| {
                cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string("Kept clipboard".into()));
                let mut stale = request;
                stale.context_id = Uuid::new_v4();
                room.copy_apparatus(stale, cx);
                assert_eq!(
                    cx.read_from_clipboard().unwrap().text().as_deref(),
                    Some("Kept clipboard")
                );
                room.refresh_apparatus_context(cx);
                assert!(room.apparatus.context.is_none());
                let view = room.apparatus.view.clone().unwrap();
                assert!(
                    view.update(cx, |view, cx| view.request_copy_all(cx))
                        .is_none()
                );
                assert!(view.read(cx).pending_copy().is_none());
                assert_eq!(
                    cx.read_from_clipboard().unwrap().text().as_deref(),
                    Some("Kept clipboard")
                );
            });
        })
        .unwrap();
        cx.run_until_parked();
        let refreshed = cx
            .update_window(handle, |_, _window, cx| {
                room.update(cx, |room, cx| {
                    room.apparatus
                        .view
                        .as_ref()
                        .unwrap()
                        .update(cx, |view, cx| view.request_copy_all(cx))
                        .unwrap()
                })
            })
            .unwrap();
        cx.run_until_parked();
        cx.read(|cx| {
            assert_eq!(
                cx.read_from_clipboard().unwrap().text().as_deref(),
                Some(refreshed.text.as_str())
            );
        });
    }

    #[gpui_kit::test]
    fn actual_host_scan_builds_and_files_source_without_changing_manuscript(
        cx: &mut TestAppContext,
    ) {
        let (handle, room, store, _directory, scope) = apparatus_room(cx);
        let (before, manuscript) = cx
            .update_window(handle, |_, _window, cx| {
                room.update(cx, |room, cx| {
                    room.flush(cx).unwrap();
                    let manuscript = std::fs::read(store.document_path(room.active)).unwrap();
                    let before = room.apparatus.record.clone();
                    room.apparatus
                        .view
                        .as_ref()
                        .unwrap()
                        .update(cx, |view, cx| {
                            view.request_scan(cx).unwrap();
                        });
                    (before, manuscript)
                })
            })
            .unwrap();
        cx.run_until_parked();
        let source_url = cx
            .update_window(handle, |_, _window, cx| {
                room.update(cx, |room, cx| {
                    let view = room.apparatus.view.clone().unwrap();
                    assert!(view.read(cx).pending_scan().is_none());
                    let detection = view
                        .read(cx)
                        .detected_rows(ApparatusSurface::Board)
                        .iter()
                        .find(|row| row.kind == "doi" && row.text.contains("10.5555/detected"))
                        .unwrap()
                        .clone();
                    let source_url = detection.lookup_url.clone().unwrap();
                    assert_eq!(room.apparatus.record, before);
                    let request = view
                        .update(cx, |view, cx| view.request_add_detected(&detection.id, cx))
                        .unwrap();
                    assert_eq!(request.folio_id, scope);
                    assert_eq!(
                        view.read(cx).pending_add().unwrap().request_id,
                        request.request_id
                    );
                    assert_eq!(room.apparatus.record, before);
                    source_url
                })
            })
            .unwrap();
        cx.run_until_parked();
        cx.read(|cx| {
            let room = room.read(cx);
            let view = room.apparatus.view.as_ref().unwrap().read(cx);
            assert!(view.pending_add().is_none() && view.pending_request().is_none());
            let rows = raw_rows(&room.apparatus.record);
            let old_rows = raw_rows(&before);
            assert_eq!(rows.len(), old_rows.len() + 1);
            assert_eq!(&rows[..old_rows.len()], old_rows);
            let added = rows.last().unwrap();
            assert_eq!(
                added.get("folioId").and_then(serde_json::Value::as_str),
                Some(scope.as_str())
            );
            assert_eq!(
                added.get("url").and_then(serde_json::Value::as_str),
                Some(source_url.as_str())
            );
            assert_eq!(
                added.get("provenance").and_then(serde_json::Value::as_str),
                Some("writer")
            );
            assert!(added.get("citationInsertedAt").is_none());
            assert_eq!(
                std::fs::read(store.document_path(room.active)).unwrap(),
                manuscript
            );
        });
        assert_eq!(
            ApparatusStore::open(store.root())
                .unwrap()
                .load()
                .unwrap()
                .record
                .generation,
            1
        );
    }
}

impl ApparatusState {
    pub(super) fn load(library: &Store) -> (Self, Vec<String>) {
        let (store, record, warnings) =
            match ApparatusStore::open(library.root()).and_then(|store| {
                let loaded = store.load()?;
                Ok((store, loaded))
            }) {
                Ok((store, loaded)) => (Some(store), loaded.record, loaded.warnings),
                Err(error) => (
                    None,
                    Arc::new(ApparatusRecord::default()),
                    vec![format!("The Apparatus could not be opened: {error:#}")],
                ),
            };
        (
            Self {
                store,
                record,
                pending: None,
                view: None,
                subscription: None,
                scope: None,
                route: false,
                boundary_error: None,
                context: None,
                context_generation: 0,
                context_task: None,
                citation: None,
                citation_task: None,
                citation_metadata: None,
            },
            warnings,
        )
    }
}

#[derive(Clone, Debug, PartialEq)]
struct CitationGuard {
    request_id: Uuid,
    folio: Uuid,
    scope: String,
    visit: u64,
    folio_revision: u64,
    view: gpui_kit::EntityId,
    editor: gpui_kit::EntityId,
    rich_revision: u64,
    selection: Selection,
    base: Arc<ApparatusRecord>,
    context_id: Uuid,
    source_index: usize,
    raw_entry: serde_json::Value,
}

fn raw_rows(record: &ApparatusRecord) -> &[serde_json::Value] {
    record
        .effective_bibliography()
        .as_ref()
        .and_then(serde_json::Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn prepare_context(
    record: Arc<ApparatusRecord>,
    scope: String,
) -> anyhow::Result<ApparatusViewContext> {
    let display = record.display(&scope)?;
    let formatted = SemanticBridge::discover()?
        .apparatus_format(raw_rows(&record), display.settings.citation_style.as_str())?;
    let retained = display
        .bibliography
        .entries
        .iter()
        .map(|entry| (entry.index, entry))
        .collect::<std::collections::BTreeMap<_, _>>();
    let formatted_rows = formatted
        .rows
        .into_iter()
        .filter(|row| {
            retained.get(&row.index).is_some_and(|entry| {
                entry.entry.id == row.id && entry.entry.folio_id == row.folio_id
            })
        })
        .collect::<Vec<_>>();
    let copy_all_text = formatted_rows
        .iter()
        .map(|row| row.citation.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(ApparatusViewContext {
        folio_id: scope,
        metadata_generation: record.generation,
        context_id: Uuid::new_v4(),
        formatted_rows,
        copy_all_text,
        research: None,
    })
}

impl WritingRoom {
    #[cfg(feature = "ui-tests")]
    pub fn capture_apparatus_ready(&self, cx: &App) -> bool {
        !self.apparatus_visible()
            || (self.apparatus.context.is_some()
                && self.apparatus.context_task.is_none()
                && self.apparatus.pending.is_none()
                && self.apparatus.view.as_ref().is_some_and(|view| {
                    let view = view.read(cx);
                    view.pending_scan().is_none() && view.pending_request().is_none()
                }))
    }

    fn apparatus_capabilities(&self, cx: &App) -> ApparatusCapabilities {
        ApparatusCapabilities {
            persist: self.apparatus.store.is_some(),
            scan: true,
            copy: true,
            cite: self.apparatus.store.is_some() && self.citation_editor_available(cx),
            ..ApparatusCapabilities::default()
        }
    }

    fn citation_editor_available(&self, cx: &App) -> bool {
        !self.source_mode
            && !(self.proof_mode && !self.split_view)
            && !self.active_document().archived
            && !self.applying_source
            && self.dossier.is_none()
            && self
                .source_session
                .as_ref()
                .is_none_or(|session| !session.pending)
            && self
                .rich
                .as_ref()
                .is_some_and(|view| !view.read(cx).is_read_only())
    }

    pub(super) fn sync_apparatus_surface(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let surface = if self.apparatus.route {
            ApparatusSurface::Page
        } else {
            ApparatusSurface::Board
        };
        let caps = self.apparatus_capabilities(cx);
        if let Some(view) = &self.apparatus.view {
            view.update(cx, |view, cx| {
                if view.surface() != surface {
                    view.set_surface(surface, window, cx);
                }
                view.set_capabilities(caps, cx);
            });
        }
    }

    pub(super) fn ensure_apparatus(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let scope = Some(self.marginalia_folio_id());
        let changed_scope = self.apparatus.scope != scope;
        let caps = self.apparatus_capabilities(cx);
        if let Some(view) = &self.apparatus.view {
            anyhow::ensure!(
                view.update(cx, |view, cx| view.set_scope(scope.clone(), window, cx)),
                "File the held Apparatus change before opening another folio."
            );
            view.update(cx, |view, cx| view.set_capabilities(caps, cx));
        } else {
            let record = self.apparatus.record.clone();
            let view = cx.new(|cx| ApparatusView::new(record, scope.clone(), caps, window, cx));
            self.apparatus.subscription = Some(cx.subscribe_in(
                &view,
                window,
                |this, _, event, window, cx| this.apparatus_event(event.clone(), window, cx),
            ));
            self.apparatus.view = Some(view);
        }
        self.apparatus.scope = scope;
        if changed_scope {
            self.apparatus.citation = None;
            self.apparatus.citation_task = None;
        }
        self.refresh_apparatus_context(cx);
        Ok(())
    }

    fn refresh_apparatus_context(&mut self, cx: &mut Context<Self>) {
        let (Some(scope), Some(view_id)) = (
            self.apparatus.scope.clone(),
            self.apparatus.view.as_ref().map(Entity::entity_id),
        ) else {
            return;
        };
        self.apparatus.context_generation = self.apparatus.context_generation.saturating_add(1);
        let generation = self.apparatus.context_generation;
        let record = self.apparatus.record.clone();
        self.apparatus.context = None;
        if let Some(view) = &self.apparatus.view {
            view.update(cx, |view, cx| view.clear_context(cx));
        }
        self.apparatus.context_task = Some(cx.spawn(async move |this, cx| {
            let prepared_record = record.clone();
            let prepared_scope = scope.clone();
            let result = cx.background_executor().spawn(async move {
                prepare_context(prepared_record, prepared_scope)
            }).await;
            let _ = this.update(cx, |this, cx| {
                if this.apparatus.context_generation != generation || this.apparatus.record != record
                    || this.apparatus.scope.as_ref() != Some(&scope)
                    || this.apparatus.view.as_ref().map(Entity::entity_id) != Some(view_id) { return; }
                this.apparatus.context_task = None;
                match result {
                    Ok(context) => {
                        this.apparatus.context = Some(context.clone());
                        if let Some(view) = &this.apparatus.view {
                            view.update(cx, |view, cx| { view.set_context(context, cx); });
                        }
                    }
                    Err(error) => this.notice = Some(format!(
                        "Your bibliography is kept, but its citations could not be formatted: {error:#}"
                    )),
                }
                cx.notify();
            });
        }));
    }

    pub(super) fn open_apparatus(
        &mut self,
        surface: ApparatusSurface,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.flush_apparatus(window, cx).is_err()
            || self.flush_rubric(window, cx).is_err()
            || self.flush_cast(window, cx).is_err()
            || self.flush_marginalia(window, cx).is_err()
            || self.flush_house(window, cx).is_err()
            || self.flush(cx).is_err()
        {
            return;
        }
        if let Err(error) = self.ensure_apparatus(window, cx) {
            self.error = Some(format!("Could not open the Apparatus: {error:#}"));
            cx.notify();
            return;
        }
        let Some(view) = self.apparatus.view.clone() else {
            return;
        };
        view.update(cx, |view, cx| view.set_surface(surface, window, cx));
        self.apparatus.route = surface == ApparatusSurface::Page;
        if surface == ApparatusSurface::Page {
            self.retire_math_source_visit(cx);
        }
        self.rubric.route = false;
        self.cast.route = None;
        self.house_route = false;
        self.library_route = false;
        self.settings_route = false;
        self.dossier = None;
        self.dossier_subscription = None;
        self.find_visible = false;
        self.new_folio_form = false;
        self.source_go_to_line = false;
        if surface == ApparatusSurface::Board {
            self.desk.open_linked_panel(BoardContext::Apparatus);
        } else {
            window.focus(&view.read(cx).focus_handle(cx), cx);
        }
        cx.notify();
    }

    fn apparatus_visible(&self) -> bool {
        self.apparatus.route
            || (!self.standalone_route()
                && self.desk.board_open
                && self.desk.board_context == BoardContext::Apparatus)
    }

    fn apparatus_event(
        &mut self,
        event: ApparatusEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let ApparatusEvent::SaveRequested(request) = event {
            self.request_apparatus_save(request, window, cx);
            return;
        }
        if matches!(event, ApparatusEvent::Filed { .. }) || !self.apparatus_visible() {
            return;
        }
        match event {
            ApparatusEvent::SurfaceRequested(surface) => self.open_apparatus(surface, window, cx),
            ApparatusEvent::BackToDesk
                if self.flush_apparatus(window, cx).is_ok() && self.flush(cx).is_ok() =>
            {
                self.apparatus.route = false;
                self.focus_writing(window, cx);
                cx.notify();
            }
            ApparatusEvent::AddDetectedRequested(request) => {
                self.add_detected_source(request, window, cx)
            }
            ApparatusEvent::ScanRequested(request) => self.scan_apparatus(request, window, cx),
            ApparatusEvent::CiteRequested(request) => {
                self.place_apparatus_citation(request, window, cx)
            }
            ApparatusEvent::CopyRequested(request) => self.copy_apparatus(request, cx),
            // Preview/research/account adapters remain gated by their actual
            // capabilities. An offline text match never verifies a source.
            _ => {}
        }
    }

    pub(super) fn apparatus_page(&self, cx: &Context<Self>) -> gpui_kit::AnyElement {
        div()
            .id("native-apparatus")
            .test_support()
            .size_full()
            .min_h_0()
            .bg(rgb(palette(cx).paper_soft))
            .when_some(self.apparatus.view.clone(), |page, view| page.child(view))
            .into_any_element()
    }

    fn add_detected_source(
        &mut self,
        request: ApparatusAddDetectedRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(view_id) = self.apparatus.view.as_ref().map(Entity::entity_id) else {
            return;
        };
        if self.apparatus.record != request.base
            || self.apparatus.scope.as_deref() != Some(&request.folio_id)
            || self.marginalia_folio_id() != request.folio_id
        {
            if let Some(view) = &self.apparatus.view {
                view.update(cx, |view, cx| {
                    view.report_add_error(
                        request.request_id,
                        "The bibliography changed. Try adding this source again.",
                        cx,
                    );
                });
            }
            return;
        }
        let lock = self.store.clone();
        cx.spawn_in(window, async move |this, cx| {
            let input = request.clone();
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _lock = lock;
                    SemanticBridge::discover()?.apparatus_build_detected(
                        &input.detected,
                        &input.folio_id,
                        chrono::Utc::now().timestamp_millis() as f64,
                        raw_rows(&input.base),
                    )
                })
                .await;
            let _ = this.update_in(cx, |this, _, cx| {
                if this.apparatus.record != request.base
                    || this.apparatus.scope.as_deref() != Some(&request.folio_id)
                    || this.marginalia_folio_id() != request.folio_id
                    || this.apparatus.view.as_ref().map(Entity::entity_id) != Some(view_id)
                {
                    return;
                }
                if let Some(view) = &this.apparatus.view {
                    view.update(cx, |view, cx| match result {
                        Ok(built) => {
                            if let Err(error) =
                                view.accept_add_detected(request.request_id, built, cx)
                            {
                                view.report_add_error(
                                    request.request_id,
                                    format!("The source candidate was kept: {error:#}"),
                                    cx,
                                );
                            }
                        }
                        Err(error) => {
                            view.report_add_error(
                                request.request_id,
                                format!("Could not prepare this source: {error:#}"),
                                cx,
                            );
                        }
                    });
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn scan_apparatus(
        &mut self,
        request: ApparatusScanRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(view_id) = self.apparatus.view.as_ref().map(Entity::entity_id) else {
            return;
        };
        if self.apparatus.record != request.base
            || self.apparatus.scope.as_deref() != Some(&request.folio_id)
            || self.marginalia_folio_id() != request.folio_id
        {
            if let Some(view) = &self.apparatus.view {
                view.update(cx, |view, cx| {
                    view.report_scan_error(
                        request.request_id,
                        "The bibliography changed. Re-scan the current folio.",
                        cx,
                    );
                });
            }
            return;
        }
        let native_id = self.active;
        let visit = self.revision_generation;
        let revision = self.active_document().revision;
        let rich_revision = self
            .rich
            .as_ref()
            .map(|view| (view.entity_id(), view.read(cx).revision()));
        let mut snapshot = self.snapshot(cx);
        snapshot.rich = self.rich.as_ref().map(|view| view.read(cx).snapshot());
        cx.spawn_in(window, async move |this, cx| {
            let surface = match request.surface {
                ApparatusSurface::Board => ApparatusScanSurface::Board,
                ApparatusSurface::Page => ApparatusScanSurface::Page,
            };
            let result = cx
                .background_executor()
                .spawn(async move {
                    let document = snapshot.materialize()?;
                    let bridge = SemanticBridge::discover()?;
                    let html = document
                        .workspace
                        .as_deref()
                        .map(|workspace| workspace.content.html.clone())
                        .map_or_else(
                            || {
                                bridge
                                    .from_markdown(&document.body)
                                    .map(|result| result.html)
                            },
                            Ok,
                        )?;
                    bridge.apparatus_scan_html(&html, surface)
                })
                .await;
            let _ =
                this.update_in(cx, |this, _, cx| {
                    if this.apparatus.view.as_ref().map(Entity::entity_id) != Some(view_id)
                        || this.apparatus.scope.as_deref() != Some(&request.folio_id)
                    {
                        return;
                    }
                    if this.active != native_id
                        || this.revision_generation != visit
                        || this.active_document().revision != revision
                        || this
                            .rich
                            .as_ref()
                            .map(|view| (view.entity_id(), view.read(cx).revision()))
                            != rich_revision
                        || this.apparatus.record != request.base
                        || this.apparatus.scope.as_deref() != Some(&request.folio_id)
                        || this.apparatus.view.as_ref().map(Entity::entity_id) != Some(view_id)
                    {
                        if let Some(view) = &this.apparatus.view {
                            view.update(cx, |view, cx| {
                                view.report_scan_error(request.request_id,
                            "The draft changed during the scan. Re-scan its current wording.", cx);
                            });
                        }
                        return;
                    }
                    if let Some(view) = &this.apparatus.view {
                        view.update(cx, |view, cx| match result {
                            Ok(scan) => {
                                view.accept_scan(request.request_id, scan.citations, cx);
                            }
                            Err(error) => {
                                view.report_scan_error(
                                    request.request_id,
                                    format!("Could not scan the manuscript: {error:#}"),
                                    cx,
                                );
                            }
                        });
                    }
                    cx.notify();
                });
        })
        .detach();
    }

    fn copy_apparatus(&mut self, request: ApparatusCopyRequest, cx: &mut Context<Self>) {
        let valid = self.apparatus.record == request.base
            && self.apparatus.scope.as_deref() == Some(&request.folio_id)
            && self.apparatus.context.as_ref().is_some_and(|context| {
                context.context_id == request.context_id
                    && if let Some(index) = request.source_index {
                        context
                            .formatted_rows
                            .iter()
                            .any(|row| row.index == index && row.citation == request.text)
                    } else {
                        context.copy_all_text == request.text
                    }
            });
        if let Some(view) = &self.apparatus.view {
            let result = if valid {
                cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string(request.text));
                Ok(())
            } else {
                Err("The bibliography changed before it could be copied. Try again.".into())
            };
            view.update(cx, |view, cx| {
                view.ack_copy(request.request_id, result, cx);
            });
        }
    }

    fn citation_guard(&self, request: &ApparatusCiteRequest, cx: &App) -> Option<CitationGuard> {
        if !self.apparatus.view.as_ref().is_some_and(|view| {
            view.read(cx).pending_citation().is_some_and(|held| {
                held.request_id == request.request_id
                    && held.folio_id == request.folio_id
                    && held.base == request.base
                    && held.context_id == request.context_id
                    && held.source_index == request.source_index
                    && held.raw_entry == request.raw_entry
                    && held.source_id == request.source_id
                    && held.footnote == request.footnote
            })
        }) {
            return None;
        }
        if !self.citation_editor_available(cx)
            || self.apparatus.route
            || self.apparatus.record != request.base
            || self.apparatus.scope.as_deref() != Some(&request.folio_id)
            || self.marginalia_folio_id() != request.folio_id
            || raw_rows(&self.apparatus.record).get(request.source_index)
                != Some(&request.raw_entry)
            || request
                .raw_entry
                .get("id")
                .and_then(serde_json::Value::as_str)
                != Some(&request.source_id)
            || request
                .raw_entry
                .get("folioId")
                .and_then(serde_json::Value::as_str)
                != Some(&request.folio_id)
            || !self.apparatus.context.as_ref().is_some_and(|context| {
                context.context_id == request.context_id
                    && context.formatted_rows.iter().any(|row| {
                        row.index == request.source_index
                            && row.id == request.source_id
                            && row.footnote == request.footnote
                    })
            })
        {
            return None;
        }
        let editor = self.rich.as_ref()?;
        let view = self.apparatus.view.as_ref()?;
        Some(CitationGuard {
            request_id: request.request_id,
            folio: self.active,
            scope: request.folio_id.clone(),
            visit: self.revision_generation,
            folio_revision: self.active_document().revision,
            view: view.entity_id(),
            editor: editor.entity_id(),
            rich_revision: editor.read(cx).revision(),
            selection: editor.read(cx).selection(),
            base: request.base.clone(),
            context_id: request.context_id,
            source_index: request.source_index,
            raw_entry: request.raw_entry.clone(),
        })
    }

    fn place_apparatus_citation(
        &mut self,
        request: ApparatusCiteRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.apparatus.citation.is_some() {
            return;
        }
        if self.citation_guard(&request, cx).is_none() {
            self.ack_citation(
                request.request_id,
                Err("Open the current editable passage, then cite again.".into()),
                cx,
            );
            return;
        }
        // The popover can still hold the latest native text while its Change
        // subscription is queued. Validate the request before applying that
        // field, then capture the citation candidate from the current tree.
        if let Err(error) = self
            .rich
            .as_ref()
            .unwrap()
            .update(cx, |editor, cx| editor.flush_note_input(cx))
        {
            self.ack_citation(
                request.request_id,
                Err(format!(
                    "Your note is still in its field: {error}. Finish editing it, then cite again."
                )),
                cx,
            );
            return;
        }
        // A native Change may already have updated the note and queued its
        // host event. Process those effects before capturing the folio guard.
        cx.defer_in(window, move |this, window, cx| {
            this.prepare_apparatus_citation(request, window, cx);
        });
    }

    fn prepare_apparatus_citation(
        &mut self,
        request: ApparatusCiteRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.apparatus.citation.is_some() {
            return;
        }
        let Some(guard) = self.citation_guard(&request, cx) else {
            self.ack_citation(
                request.request_id,
                Err("Open the current editable passage, then cite again.".into()),
                cx,
            );
            return;
        };
        let placement = CitationPlacementRequest {
            source_id: request.source_id.clone(),
            text: request.footnote.clone(),
            anchor: request
                .raw_entry
                .get("target")
                .and_then(|target| target.get("anchor"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
            source_url: request
                .raw_entry
                .get("url")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
            allow_selection_fallback: true,
        };
        let mut snapshot = self.snapshot(cx);
        let document = self.rich.as_ref().unwrap().read(cx).snapshot();
        let selection = guard.selection;
        self.apparatus.citation = Some(guard.clone());
        self.apparatus.citation_task = Some(cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let bridge = SemanticBridge::discover()?;
                    let preparation = twyne_desktop::citation_anchor::prepare_citation(
                        &document, selection, &placement, &bridge,
                    )?;
                    if let CitationPreparation::Prepared(prepared) = &preparation {
                        snapshot.rich = Some(prepared.candidate.clone());
                        snapshot.materialize()?;
                    }
                    anyhow::Ok(preparation)
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.finish_citation(request, guard, result, window, cx)
            });
        }));
    }

    fn finish_citation(
        &mut self,
        request: ApparatusCiteRequest,
        guard: CitationGuard,
        result: anyhow::Result<CitationPreparation>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.apparatus.citation.as_ref() != Some(&guard) {
            return;
        }
        self.apparatus.citation = None;
        self.apparatus.citation_task = None;
        let current = self.citation_guard(&request, cx);
        if current.as_ref() != Some(&guard) {
            self.ack_citation(
                request.request_id,
                Err(
                    "The draft or selection changed. Select the current passage, then cite again."
                        .into(),
                ),
                cx,
            );
            return;
        }
        let result = result
            .and_then(|preparation| match preparation {
                CitationPreparation::Prepared(prepared) => {
                    self.commit_citation(*prepared, &guard, window, cx)
                }
                CitationPreparation::Missing(missing) => anyhow::bail!(match missing.reason {
                    twyne_desktop::citation_anchor::CitationMissingReason::AnchorNotFound =>
                        "The claim has changed. Select its current wording, then cite again.",
                    twyne_desktop::citation_anchor::CitationMissingReason::SelectPassage =>
                        "Select the passage this source supports, then cite again.",
                }),
            })
            .map_err(|error| format!("{error:#}"));
        self.ack_citation(request.request_id, result, cx);
        cx.notify();
    }

    fn commit_citation(
        &mut self,
        prepared: PreparedCitation,
        guard: &CitationGuard,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<f64> {
        let editor = self
            .rich
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The writing editor is unavailable."))?;
        editor.update(cx, |editor, cx| {
            editor.commit_prepared_citation(&prepared, guard.rich_revision, window, cx)
        })?;
        Ok(chrono::Utc::now().timestamp_millis() as f64)
    }

    fn ack_citation(&mut self, id: Uuid, result: Result<f64, String>, cx: &mut Context<Self>) {
        if let Some(view) = &self.apparatus.view {
            match view.update(cx, |view, cx| view.ack_citation(id, result, cx)) {
                Ok(Some(request)) => self.apparatus.citation_metadata = Some(request.request_id),
                Ok(None) => {}
                Err(error) => {
                    self.error = Some(format!("The citation result could not be filed: {error:#}"))
                }
            }
        }
    }

    fn request_apparatus_save(
        &mut self,
        request: ApparatusRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(view_id) = self.apparatus.view.as_ref().map(Entity::entity_id) else {
            return;
        };
        if self.apparatus.pending.is_some()
            || self
                .apparatus
                .view
                .as_ref()
                .and_then(|view| view.read(cx).pending_request())
                != Some(&request)
        {
            return;
        }
        if self.apparatus.citation_metadata == Some(request.request_id) && self.flush(cx).is_err() {
            self.apparatus_save_error(&request, "The footnote is kept in this window. Save the draft before filing its bibliography confirmation.".into(), cx);
            return;
        }
        let Some(store) = self.apparatus.store.clone() else {
            self.apparatus_save_error(
                &request,
                "The Apparatus is unavailable on this device.".into(),
                cx,
            );
            return;
        };
        self.apparatus.pending = Some(request.clone());
        let lock = self.store.clone();
        cx.spawn_in(window, async move |this, cx| {
            let input = request.clone();
            let result = cx
                .background_executor()
                .spawn(async move {
                    let _lock = lock;
                    store.save_request(&input)
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.apparatus.pending.as_ref() != Some(&request)
                    || this.apparatus.view.as_ref().map(Entity::entity_id) != Some(view_id)
                {
                    return;
                }
                this.apparatus.pending = None;
                match result {
                    Ok(record) => {
                        this.ack_apparatus(request.request_id, record, window, cx);
                    }
                    Err(error) => this.apparatus_save_error(
                        &request,
                        format!("Could not file this change: {error:#}"),
                        cx,
                    ),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn apparatus_save_error(
        &mut self,
        request: &ApparatusRequest,
        message: String,
        cx: &mut Context<Self>,
    ) {
        self.apparatus.boundary_error = Some(message.clone());
        if let Some(view) = &self.apparatus.view {
            view.update(cx, |view, cx| {
                view.report_error(request.request_id, message, cx);
            });
        }
        cx.notify();
    }

    fn ack_apparatus(
        &mut self,
        id: Uuid,
        record: Arc<ApparatusRecord>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let accepted = self.apparatus.view.as_ref().is_some_and(|view| {
            view.update(cx, |view, cx| {
                view.ack_saved(id, record.clone(), window, cx)
            })
        });
        if accepted {
            self.apparatus.record = record;
            self.apparatus.boundary_error = None;
            if self.apparatus.citation_metadata == Some(id) {
                self.apparatus.citation_metadata = None;
            }
            self.refresh_apparatus_context(cx);
        }
        accepted
    }

    pub(super) fn flush_apparatus(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let Some(view) = self.apparatus.view.clone() else {
            return Ok(());
        };
        let Some(request) = view.update(cx, |view, cx| view.prepare_pending_edits(cx))? else {
            return Ok(());
        };
        if self.apparatus.citation_metadata == Some(request.request_id) {
            self.flush(cx)?;
        }
        let result = self
            .apparatus
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The Apparatus is unavailable on this device."))
            .and_then(|store| store.save_request(&request));
        self.apparatus.pending = None;
        match result {
            Ok(record) => {
                anyhow::ensure!(
                    self.ack_apparatus(request.request_id, record, window, cx),
                    "The held Apparatus change could not be acknowledged."
                );
                Ok(())
            }
            Err(error) => {
                self.apparatus_save_error(
                    &request,
                    format!("Could not file before leaving: {error:#}"),
                    cx,
                );
                Err(error)
            }
        }
    }

    pub(super) fn flush_apparatus_on_shutdown(
        &mut self,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let Some(view) = self.apparatus.view.clone() else {
            return Ok(());
        };
        let Some(request) = view.update(cx, |view, cx| view.prepare_pending_edits(cx))? else {
            return Ok(());
        };
        if self.apparatus.citation_metadata == Some(request.request_id) {
            self.flush(cx)?;
        }
        let result = self
            .apparatus
            .store
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("The Apparatus is unavailable on this device."))
            .and_then(|store| store.save_request(&request));
        self.apparatus.pending = None;
        match result {
            Ok(record) => {
                self.apparatus.record = record;
                Ok(())
            }
            Err(error) => {
                self.apparatus_save_error(
                    &request,
                    format!("Could not file before closing: {error:#}"),
                    cx,
                );
                Err(error)
            }
        }
    }
}
