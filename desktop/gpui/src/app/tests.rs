use super::*;
use gpui_kit::test::TestWindowExt;
use gpui_kit::{AnyWindowHandle, Bounds, Point, TestAppContext, WindowBounds, WindowOptions, size};
use tempfile::{TempDir, tempdir};

pub(super) fn room(
    cx: &mut TestAppContext,
) -> (AnyWindowHandle, Entity<WritingRoom>, Arc<Store>, TempDir) {
    let directory = tempdir().unwrap();
    let store = Arc::new(Store::open(directory.path().into()).unwrap());
    let document = Manuscript::new("");
    store.save(&document).unwrap();
    let library = store.load().unwrap();
    let local_store = store.clone();
    let (window, room) = cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::apply(cx).unwrap();
        bind_keys(cx);
        twyne_desktop::dossier_view::init(cx);
        twyne_desktop::compositor::init(cx);
        twyne_desktop::marginalia_view::init(cx);
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(1280.), px(860.)),
                })),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| WritingRoom::new(local_store, library, window, cx)),
        )
        .unwrap()
    });
    (window, room, store, directory)
}

pub(super) fn expanded_room(
    cx: &mut TestAppContext,
) -> (AnyWindowHandle, Entity<WritingRoom>, Arc<Store>, TempDir) {
    let result = room(cx);
    cx.update_window(result.0, |_, window, cx| {
        window.render_frame(cx);
        window.click("toggle-compositor", cx);
        window.click("toggle-library", cx);
    })
    .unwrap();
    result
}

#[gpui_kit::test]
fn account_menu_keyboard_and_outside_dismiss_preserve_the_local_manuscript(
    cx: &mut TestAppContext,
) {
    let (handle, view, _store, _directory) = room(cx);
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.desk.set_zen(false, false);
            room.body.update(cx, |body, cx| {
                body.set_value("A local paragraph.", window, cx);
            });
            window.focus(&room.account_focus, cx);
        });
        window.render_frame(cx);
        let active = view.read(cx).active;
        window.press("space", cx);
        window.render_frame(cx);
        assert!(view.read(cx).account_open);
        assert_eq!(window.find("account-panel").bounds().size.width, px(288.));
        let sign_in_height = f32::from(window.find("account-sign-in").bounds().size.height);
        assert!(
            sign_in_height > 50. && sign_in_height <= 55.,
            "Source label must wrap onto two centered lines"
        );
        window.press("escape", cx);
        window.render_frame(cx);
        assert!(!view.read(cx).account_open);
        assert!(view.read(cx).account_focus.is_focused(window));
        window.click("account-menu", cx);
        window.render_frame(cx);
        assert!(view.read(cx).account_open);
        window.click("toggle-library", cx);
        window.render_frame(cx);
        assert!(!view.read(cx).account_open);
        assert_eq!(view.read(cx).active, active);
        assert_eq!(
            view.read(cx).body.read(cx).value().to_string(),
            "A local paragraph."
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn account_preferences_return_to_the_same_local_writing_room(cx: &mut TestAppContext) {
    let (handle, view, _store, _directory) = room(cx);
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, _| room.desk.set_zen(false, false));
        window.render_frame(cx);
        let active = view.read(cx).active;
        window.click("account-menu", cx);
        window.render_frame(cx);
        window.click("account-preferences", cx);
        window.render_frame(cx);
        assert!(view.read(cx).settings_route);
        assert!(!view.read(cx).account_open);
        window.click("settings-back", cx);
        window.render_frame(cx);
        assert!(!view.read(cx).settings_route);
        assert_eq!(view.read(cx).active, active);
        window.click("account-menu", cx);
        window.render_frame(cx);
        window.click("account-sign-in", cx);
        window.render_frame(cx);
        assert!(view.read(cx).account_open);
        assert_eq!(
            view.read(cx).account_error,
            Some(account_coordinator::SIGN_IN_UNAVAILABLE)
        );
        assert_eq!(window.find("account-error").role(), Some(Role::Alert));
        assert_eq!(view.read(cx).active, active);
    })
    .unwrap();
}

#[gpui_kit::test]
fn wrapped_compositor_tabs_keep_native_keyboard_focus_and_the_manuscript(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Tab focus.html");
    let html = "<h1>A heading</h1><p>The selected passage stays.</p>";
    std::fs::write(&path, html).unwrap();
    let document =
        twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            assert!(room.add_document(document, window, cx));
            room.desk.set_zen(false, false);
            room.desk.preferences.compositor_open = true;
        });
        window.render_frame(cx);
        window.click("toggle-library", cx);
        window.click("toggle-notebook", cx);
        window.render_frame(cx);
        assert!(
            window.find("compositor-tab-Home").bounds().top()
                > window.find("write-mode").bounds().top()
        );
        let (source, selection, revision) = view.update(cx, |room, cx| {
            let editor = room.rich.as_ref().unwrap().read(cx);
            (
                editor.document().to_html(),
                editor.selection(),
                editor.revision(),
            )
        });
        window.click("compositor-tab-Home", cx);
        window.press("left", cx);
        window.render_frame(cx);
        assert_eq!(
            view.read(cx).desk.compositor_tab,
            twyne_desktop::view_state::CompositorTab::View
        );
        assert!(view.read(cx).compositor_tab_focus[3].is_focused(window));
        assert_eq!(window.find("compositor-tab-View").focused(), Some(true));
        window.press("right", cx);
        window.press("right", cx);
        window.render_frame(cx);
        assert_eq!(
            view.read(cx).desk.compositor_tab,
            twyne_desktop::view_state::CompositorTab::Insert
        );
        assert!(view.read(cx).compositor_tab_focus[1].is_focused(window));
        assert_eq!(window.find("compositor-tab-Insert").focused(), Some(true));
        view.update(cx, |room, cx| {
            let editor = room.rich.as_ref().unwrap().read(cx);
            assert_eq!(editor.document().to_html(), source);
            assert_eq!(editor.selection(), selection);
            assert_eq!(editor.revision(), revision);
            assert!(!editor.can_undo());
        });
        window.click("toggle-library", cx);
        window.render_frame(cx);
        assert_eq!(
            window.find("compositor-tab-Home").bounds().top(),
            window.find("write-mode").bounds().top()
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn compositor_history_uses_native_undo_redo_and_respects_read_only(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Native history.html");
    let html = "<p>The manuscript stays here.</p>";
    std::fs::write(&path, html).unwrap();
    let document =
        twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            assert!(room.add_document(document, window, cx));
            room.desk.set_zen(false, false);
            room.desk.preferences.compositor_open = true;
            let editor = room.rich.as_ref().unwrap();
            window.focus(&editor.read(cx).focus_handle(cx), cx);
        });
        window.render_frame(cx);
        let editor = view.read(cx).rich.as_ref().unwrap().clone();
        let original = editor.read(cx).document().to_html();
        window.click("compositor-undo", cx);
        assert_eq!(editor.read(cx).document().to_html(), original);
        window.focus(&editor.read(cx).focus_handle(cx), cx);
        window.input("New ", cx);
        window.render_frame(cx);
        let typed = editor.read(cx).document().to_html();
        assert_ne!(typed, original);
        assert!(editor.read(cx).can_undo());
        window.click("compositor-undo", cx);
        window.render_frame(cx);
        assert_eq!(editor.read(cx).document().to_html(), original);
        assert!(!editor.read(cx).can_undo());
        assert!(editor.read(cx).can_redo());
        assert!(editor.read(cx).focus_handle(cx).is_focused(window));
        window.click("compositor-redo", cx);
        window.render_frame(cx);
        assert_eq!(editor.read(cx).document().to_html(), typed);
        assert!(editor.read(cx).can_undo());
        assert!(!editor.read(cx).can_redo());
        editor.update(cx, |editor, cx| editor.set_read_only(true, cx));
        window.render_frame(cx);
        window.click("compositor-undo", cx);
        assert_eq!(editor.read(cx).document().to_html(), typed);
        assert!(!editor.read(cx).can_undo());
        editor.update(cx, |editor, cx| editor.set_read_only(false, cx));
        assert!(editor.read(cx).can_undo());
    })
    .unwrap();
}

#[gpui_kit::test]
fn house_navigation_files_actual_inputs_and_library_keeps_source_only_folios(
    cx: &mut TestAppContext,
) {
    let (handle, view, store, _directory) = room(cx);
    let html_path = store.root().join("A saved folio.html");
    let html = "<h1>A</h1><p>B&amp;C<br>D E F</p>";
    std::fs::write(&html_path, html).unwrap();
    let writing =
        twyne_desktop::document_edit::apply_html(import_file(&html_path).unwrap(), html).unwrap();
    let writing_id = writing.id;
    let canonical = writing
        .workspace
        .as_deref()
        .unwrap()
        .canonical_source()
        .unwrap()
        .to_owned();
    let source_path = store.root().join("Source only.typ");
    let source_bytes = b"// Preserve this authored source\r\n#let exact = [Source only]\r\n";
    std::fs::write(&source_path, source_bytes).unwrap();
    let source = import_file(&source_path).unwrap();
    let source_id = source.id;
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            assert!(room.add_document(source, window, cx));
            assert!(room.add_document(writing, window, cx));
            room.open_house(window, cx);
        });
        window.render_frame(cx);
        assert!(window.find("house-page").visible());
        assert!(window.try_find("masthead").is_none());
        assert!(window.try_find("drawer").is_none());
        assert!(window.try_find("body-field").is_none());
        window.click("house-name", cx);
        window.press("secondary-a", cx);
        window.input("The threaded press 🧵", cx);
        assert!(view.read(cx).house_record.state.house.name.is_empty());
        window.click("house-library", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let filed = HouseStore::open(store.root())
        .unwrap()
        .load()
        .unwrap()
        .record;
    assert_eq!(filed.state.house.name, "The threaded press 🧵");
    assert_eq!(filed.generation, 1);
    assert_eq!(filed.state.ledger.len(), 1);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).library_route);
        assert!(!view.read(cx).library_loading);
        assert!(window.find("library-page").visible());
        let library = view.read(cx).library_view.clone().unwrap();
        assert_eq!(library.read(cx).saved_record(), &filed);
        assert!(library.read(cx).visible_folio_ids(cx).contains(&source_id));
        window.click("library-sort", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let library = view.read(cx).library_view.clone().unwrap();
        assert_eq!(
            library.read(cx).visible_folio_ids(cx).last(),
            Some(&source_id)
        );
        window.click(SharedString::from(format!("library-card-{writing_id}")), cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(!view.read(cx).library_route && !view.read(cx).house_route);
        assert_eq!(view.read(cx).active, writing_id);
        assert!(window.find("body-field").visible());
    })
    .unwrap();
    let reloaded = store.load().unwrap();
    let saved_writing = reloaded
        .documents
        .iter()
        .find(|document| document.id == writing_id)
        .unwrap();
    let saved_source = reloaded
        .documents
        .iter()
        .find(|document| document.id == source_id)
        .unwrap();
    assert_eq!(
        saved_writing
            .workspace
            .as_deref()
            .unwrap()
            .canonical_source(),
        Some(canonical.as_str())
    );
    assert_eq!(
        saved_source
            .workspace
            .as_deref()
            .unwrap()
            .canonical_source()
            .unwrap()
            .as_bytes(),
        source_bytes
    );
    let prepared = house_coordinator::prepare_library_for_test(&reloaded.documents);
    let card = prepared
        .iter()
        .find(|folio| folio.native_id == writing_id)
        .unwrap();
    assert_eq!(card.words, Some(3));
    assert_eq!(card.preview.as_deref(), Some("AB&CD E F"));
    let source_card = prepared
        .iter()
        .find(|folio| folio.native_id == source_id)
        .unwrap();
    assert!(source_card.source_only);
    assert!(source_card.words.is_none() && source_card.preview.is_none());
}

#[gpui_kit::test]
fn house_shutdown_captures_unblurred_input_and_does_not_file_it_twice(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.open_house(window, cx));
        window.render_frame(cx);
        window.click("house-name", cx);
        window.input("The last character é", cx);
        // This is the same boundary used by both app quit and window close.
        // The field still has focus, so there has been no Blur save.
        view.update(cx, |room, cx| room.flush_on_shutdown(cx).unwrap());
    })
    .unwrap();
    let saved = HouseStore::open(store.root())
        .unwrap()
        .load()
        .unwrap()
        .record;
    assert_eq!(saved.state.house.name, "The last character é");
    assert_eq!(saved.generation, 1);
    assert_eq!(saved.state.ledger.len(), 1);
    cx.run_until_parked();
    let after_queued_writer = HouseStore::open(store.root())
        .unwrap()
        .load()
        .unwrap()
        .record;
    assert_eq!(saved, after_queued_writer);
    cx.update(|cx| {
        let room = view.read(cx);
        assert!(room.house_pending.is_none());
        assert_eq!(
            room.house_view.as_ref().unwrap().read(cx).saved_record(),
            &saved
        );
    });
}

#[gpui_kit::test]
fn house_failed_write_keeps_the_candidate_blocks_close_and_retries(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.open_house(window, cx));
        window.render_frame(cx);
        window.click("house-name", cx);
        window.input("Keep this failed change", cx);
        std::fs::create_dir(store.root().join("house.json")).unwrap();
        window.press("ctrl-s", cx);
        view.update(cx, |room, cx| {
            assert!(room.flush_on_shutdown(cx).is_err());
            room.open_settings(window, cx);
            assert!(room.house_route && !room.settings_route);
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        let room = view.read(cx);
        assert_eq!(room.house_record.generation, 0);
        assert!(room.house_record.state.house.name.is_empty());
        let request = room
            .house_view
            .as_ref()
            .unwrap()
            .read(cx)
            .pending_request()
            .unwrap();
        assert_eq!(
            request.candidate.state.house.name,
            "Keep this failed change"
        );
    });
    std::fs::remove_dir(store.root().join("house.json")).unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.scroll(
            "house-page",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-2400.))),
            cx,
        );
        window.render_frame(cx);
        window.click("house-retry", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let saved = HouseStore::open(store.root())
        .unwrap()
        .load()
        .unwrap()
        .record;
    assert_eq!(saved.state.house.name, "Keep this failed change");
    assert_eq!(saved.generation, 1);
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.open_settings(window, cx);
            assert!(room.settings_route && !room.house_route);
            room.flush_on_shutdown(cx).unwrap();
        });
    })
    .unwrap();
    assert_eq!(
        saved,
        HouseStore::open(store.root())
            .unwrap()
            .load()
            .unwrap()
            .record
    );
}

#[gpui_kit::test]
fn quiet_default_and_compositor_zen_lifecycle_preserve_writing(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).desk.zen);
        assert!(window.try_find("masthead").is_none());
        assert!(window.try_find("drawer").is_none());
        assert!(window.try_find("editorial-board").is_none());
        assert!(window.try_find("compositor-panel").is_none());
        window.click("body-field", cx);
        window.input("A quiet desk keeps the writing here.", cx);
        window.click("toggle-compositor", cx);
        assert!(window.find("masthead").visible());
        assert!(window.find("compositor-panel").visible());
        window.click("toggle-library", cx);
        window.click("toggle-notebook", cx);
        assert!(window.find("drawer").visible());
        assert!(window.find("editorial-board").visible());
        window.click("focus", cx);
        assert!(window.try_find("drawer").is_none());
        assert!(window.try_find("editorial-board").is_none());
        assert!(window.try_find("masthead").is_none());
        assert!(window.try_find("compositor-panel").is_none());
        assert_eq!(
            view.read(cx).body.read(cx).value(),
            "A quiet desk keeps the writing here."
        );
        window.click("focus", cx);
        assert!(window.find("drawer").visible());
        assert!(window.find("editorial-board").visible());
        assert!(window.find("compositor-panel").visible());
        window.press("escape", cx);
        assert!(window.try_find("compositor-panel").is_none());
    })
    .unwrap();
    let reloaded = store.load().unwrap().editor_view;
    assert!(!reloaded.zen_mode && !reloaded.compositor_open);
}

#[gpui_kit::test]
fn source_edits_recover_separately_and_discard_does_not_change_canonical(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let source_path = store.root().join("authored.typ");
    let original = "// An authored preamble\r\n#let custom = [Keep me]\r\n\r\n= A title\r\n";
    std::fs::write(&source_path, original).unwrap();
    let document = import_file(&source_path).unwrap();
    let id = document.id;
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.add_document(document, window, cx));
        window.render_frame(cx);
        assert!(window.find("source-field").visible());
        assert!(window.try_find("manuscript-title").is_none());
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input("#let incomplete = (", cx);
        view.update(cx, |room, cx| room.flush(cx).unwrap());
    })
    .unwrap();
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    assert_eq!(
        saved.workspace.as_deref().unwrap().canonical_source(),
        Some(original)
    );
    assert_eq!(
        store.load_source_draft(id).unwrap().draft.unwrap().source,
        "#let incomplete = ("
    );
    cx.update_window(handle, |_, window, cx| {
        window.click("discard-source", cx);
        assert_eq!(view.read(cx).source.read(cx).value(), original);
    })
    .unwrap();
    assert!(store.load_source_draft(id).unwrap().draft.is_none());
    let output = store.root().join("exported.typ");
    export_file(&saved, &output).unwrap();
    assert_eq!(std::fs::read(output).unwrap(), original.as_bytes());
}

#[gpui_kit::test]
fn source_apply_requires_a_valid_current_proof_and_keeps_failed_edits_recoverable(
    cx: &mut TestAppContext,
) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Notebook.html");
    std::fs::write(
        &path,
        "<h1>The notebook</h1><p>The original paragraph stays.</p>",
    )
    .unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.add_document(document, window, cx));
        window.render_frame(cx);
        window.click("proof-mode", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let (canonical, valid_proof) = cx.update(|cx| {
        let room = view.read(cx);
        let proof = room
            .proof
            .clone()
            .unwrap_or_else(|| panic!("{:?}", room.error));
        assert!(proof.pdf.starts_with(b"%PDF-"));
        assert!(!proof.pages.is_empty());
        (room.active_document().body.clone(), proof)
    });
    cx.update_window(handle, |_, window, cx| {
        window.click("source-mode", cx);
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input("#let incomplete = (", cx);
        view.update(cx, |room, cx| room.flush(cx).unwrap());
        window.click("apply-source", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        let room = view.read(cx);
        assert!(!room.applying_source);
        assert_eq!(room.active_document().body, canonical);
        assert!(room.source_session.as_ref().unwrap().pending);
        assert!(room.proof_error.is_some());
        assert!(Arc::ptr_eq(room.proof.as_ref().unwrap(), &valid_proof));
        assert!(room.rich.as_ref().unwrap().read(cx).is_read_only());
    });
    assert_eq!(
        store.load_source_draft(id).unwrap().draft.unwrap().source,
        "#let incomplete = ("
    );
    let corrected = "= Corrected\n\nA paragraph with $x^2$.";
    cx.update_window(handle, |_, window, cx| {
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input(corrected, cx);
        view.update(cx, |room, cx| room.flush(cx).unwrap());
        window.click("apply-source", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        let room = view.read(cx);
        assert!(!room.applying_source);
        assert!(room.error.is_none(), "{:?}", room.error);
        assert_eq!(room.active_document().body, corrected);
        assert!(!room.source_session.as_ref().unwrap().pending);
        assert_eq!(room.proof.as_ref().unwrap().source.as_ref(), corrected);
        assert!(!room.rich.as_ref().unwrap().read(cx).is_read_only());
    });
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    let workspace = saved.workspace.as_deref().unwrap();
    assert_eq!(workspace.canonical_source(), Some(corrected));
    assert_eq!(workspace.projection, ProjectionState::Verified);
    assert!(workspace.content.html.contains("Corrected"));
    assert!(store.load_source_draft(id).unwrap().draft.is_none());
}

#[gpui_kit::test]
fn source_compiles_after_the_original_quiet_period_and_retains_the_last_valid_proof(
    cx: &mut TestAppContext,
) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Source rhythm.html");
    std::fs::write(&path, "<p>The saved manuscript remains.</p>").unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.add_document(document, window, cx));
        window.click("source-mode", cx);
        // Leaving Source cancels the scheduled background compile.
        window.click("write-mode", cx);
    })
    .unwrap();
    cx.executor().advance_clock(Duration::from_millis(450));
    cx.run_until_parked();
    cx.update(|cx| assert!(view.read(cx).proof.is_none()));
    cx.update_window(handle, |_, window, cx| window.click("source-mode", cx))
        .unwrap();
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(449));
    cx.run_until_parked();
    cx.update(|cx| assert!(view.read(cx).proof.is_none()));
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    let (canonical, valid_proof) = cx.update(|cx| {
        let room = view.read(cx);
        let proof = room
            .proof
            .clone()
            .unwrap_or_else(|| panic!("Source did not compile: {:?}", room.proof_error));
        assert!(proof.pdf.starts_with(b"%PDF-"));
        assert_eq!(proof.source.as_ref(), room.active_document().body);
        (room.active_document().body.clone(), proof)
    });
    cx.update_window(handle, |_, window, cx| {
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input("#let incomplete = (", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(449));
    cx.run_until_parked();
    cx.update(|cx| {
        let room = view.read(cx);
        assert!(room.proof_error.is_none());
        assert!(Arc::ptr_eq(room.proof.as_ref().unwrap(), &valid_proof));
    });
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    cx.update(|cx| {
        let room = view.read(cx);
        assert!(room.proof_error.is_some());
        assert_eq!(room.proof_status, "Showing last valid proof");
        assert!(Arc::ptr_eq(room.proof.as_ref().unwrap(), &valid_proof));
        assert_eq!(room.active_document().body, canonical);
        assert!(room.rich.as_ref().unwrap().read(cx).is_read_only());
    });
    assert_eq!(
        store.load_source_draft(id).unwrap().draft.unwrap().source,
        "#let incomplete = ("
    );
    let corrected = "= A corrected draft\n\nThe source remains a draft.";
    cx.update_window(handle, |_, window, cx| {
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input(corrected, cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(450));
    cx.run_until_parked();
    cx.update(|cx| {
        let room = view.read(cx);
        assert!(room.proof_error.is_none(), "{:?}", room.proof_error);
        assert_eq!(room.proof.as_ref().unwrap().source.as_ref(), corrected);
        assert_eq!(room.active_document().body, canonical);
        assert!(room.source_session.as_ref().unwrap().pending);
    });
    cx.update_window(handle, |_, window, cx| window.click("discard-source", cx))
        .unwrap();
    cx.executor().advance_clock(Duration::from_millis(450));
    cx.run_until_parked();
    cx.update(|cx| {
        let room = view.read(cx);
        assert_eq!(room.proof.as_ref().unwrap().source.as_ref(), canonical);
        assert!(room.proof_error.is_none());
        assert!(!room.source_session.as_ref().unwrap().pending);
    });
    assert!(store.load_source_draft(id).unwrap().draft.is_none());
}

#[gpui_kit::test]
fn rich_input_formatting_save_and_source_switch_preserve_authored_source(cx: &mut TestAppContext) {
    use twyne_desktop::workspace::*;
    let (handle, view, store, _directory) = room(cx);
    let source = "// Keep the author's preamble\n#let custom = [Untouched]\n\n= The notebook\n\nThe opening stays.\n\nA second paragraph.";
    let bridge = twyne_desktop::semantic_bridge::SemanticBridge::discover().unwrap();
    let html = bridge.project(source).unwrap().html;
    let mut document = Manuscript::new("The notebook");
    let id = document.id;
    document.body = source.into();
    document.workspace = Some(Arc::new(WorkspaceDocument {
        folio: Folio::draft(id.to_string(), document.title.clone(), document.created_at),
        content: FolioContentSnapshot {
            folio_id: id.to_string(),
            html,
            format: Some(ContentFormat::Typst),
            typst_source: Some(source.into()),
            updated_at: document.updated_at,
            extra: ExtraFields::new(),
        },
        brief: None,
        projection: ProjectionState::Verified,
        backup_template: None,
        provenance: None,
        extra: ExtraFields::new(),
    }));
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.add_document(document, window, cx));
        window.render_frame(cx);
        assert!(!view.read(cx).source_mode);
        assert!(window.try_find("manuscript-title").is_none());
        let rich = view.read(cx).rich.clone().unwrap();
        let end = rich.read(cx).document().text_len();
        rich.update(cx, |editor, cx| {
            editor.set_selection(Selection::caret(end), cx)
        })
        .unwrap();
        window.focus(&rich.read(cx).focus_handle(cx), cx);
        window.press("ctrl-b", cx);
        window.input(" Bold 東京.", cx);
        window.press("ctrl-b", cx);
        window.press("ctrl-s", cx);
        let saved = view.read(cx).active_document();
        assert!(
            saved
                .workspace
                .as_deref()
                .unwrap()
                .content
                .html
                .contains("<strong> Bold 東京.</strong>")
        );
        let canonical = saved
            .workspace
            .as_deref()
            .unwrap()
            .canonical_source()
            .unwrap();
        assert!(
            canonical.contains("// Keep the author's preamble\n#let custom = [Untouched]"),
            "{canonical}"
        );
        assert!(canonical.contains("The opening stays."));
        window.click("toggle-compositor", cx);
        window.click("source-mode", cx);
        assert_eq!(
            view.read(cx).source.read(cx).value(),
            view.read(cx).active_document().body
        );
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input("#let incomplete = (", cx);
        view.update(cx, |room, cx| room.flush(cx).unwrap());
        assert!(rich.read(cx).is_read_only());
        window.click("discard-source", cx);
        window.click("write-mode", cx);
        assert!(!rich.read(cx).is_read_only());
        window.press("ctrl-z", cx);
        window.press("ctrl-s", cx);
    })
    .unwrap();
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    let workspace = saved.workspace.as_deref().unwrap();
    let canonical = workspace.canonical_source().unwrap();
    assert!(canonical.contains("// Keep the author's preamble\n#let custom = [Untouched]"));
    assert!(!workspace.content.html.contains(" Bold 東京"));
    assert_eq!(
        RichDocument::from_html(&workspace.content.html)
            .unwrap()
            .to_html(),
        RichDocument::from_html(&bridge.project(source).unwrap().html)
            .unwrap()
            .to_html()
    );
    assert!(store.load_source_draft(id).unwrap().draft.is_none());
}

#[gpui_kit::test]
fn compositor_changes_save_current_header_and_feed_real_page_geometry(cx: &mut TestAppContext) {
    use twyne_desktop::workspace::{Orientation, PaperSize};
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Compositor.html");
    std::fs::write(&path, "<p>Original word.</p>").unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.add_document(document, window, cx);
        });
        window.render_frame(cx);
        let rich = view.read(cx).rich.clone().unwrap();
        rich.update(cx, |editor, cx| {
            editor.set_selection(Selection { anchor: 0, head: 8 }, cx)
        })
        .unwrap();
        window.click("toggle-compositor", cx);
        window.click("compositor-bold", cx);
        window.click("compositor-tab-View", cx);
        window.click("compositor-layout", cx);
        window.click("compositor-paper-a4", cx);
        window.click("compositor-landscape", cx);
        window.scroll(
            "compositor-popover",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-1200.))),
            cx,
        );
        window.click("compositor-running-header", cx);
        window.click("compositor-header", cx);
        window.press("secondary-a", cx);
        window.input("A saved header Café", cx);
        // Read the input at the boundary even if its final Change event
        // has not yet been delivered to the parent workspace.
        view.update(cx, |room, cx| room.flush(cx).unwrap());
        window.press("escape", cx);
        window.click("proof-mode", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update(|cx| {
        let room = view.read(cx);
        let page = &room
            .proof
            .as_ref()
            .unwrap_or_else(|| panic!("{:?} {:?}", room.error, room.proof_error))
            .pages[0];
        assert!((840.0..843.0).contains(&page.width_pt), "{}", page.width_pt);
        assert!(
            (594.0..597.0).contains(&page.height_pt),
            "{}",
            page.height_pt
        );
    });
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    let workspace = saved.workspace.as_deref().unwrap();
    assert!(workspace.content.html.contains("<strong>Original</strong>"));
    assert_eq!(
        workspace.folio.header.as_deref(),
        Some("A saved header Café")
    );
    let layout = workspace.folio.layout.as_ref().unwrap();
    assert_eq!(layout.paper, Some(PaperSize::A4));
    assert_eq!(layout.orientation, Some(Orientation::Landscape));
    assert!(layout.running_header);
}

#[gpui_kit::test]
fn page_selector_navigates_the_real_proof_and_retains_selection_across_modes(
    cx: &mut TestAppContext,
) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Proof navigation.html");
    let html = (0..120)
        .map(|index| format!("<p>Paragraph {index}. The words stay in their original order.</p>"))
        .collect::<String>();
    std::fs::write(&path, &html).unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            assert!(room.add_document(document, window, cx))
        });
        window.render_frame(cx);
        assert_eq!(window.find("go-to-page").disabled(), Some(true));
        assert_eq!(window.find("go-to-page").value(), Some("Pages"));
        assert_eq!(window.find("go-to-page").expanded(), Some(false));
        assert_eq!(window.find("page-selection-label").label(), Some("Pages"));
        window.click("go-to-page", cx);
        assert!(window.try_find("popup-menu").is_none());
        window.click("proof-mode", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let (count, canonical, rich_html, rich_revision) = cx.update(|cx| {
        let room = view.read(cx);
        let editor = room.rich.as_ref().unwrap().read(cx);
        assert!(room.proof_images.len() >= 3, "{:?}", room.proof_error);
        (
            room.proof_images.len(),
            room.active_document().body.clone(),
            editor.document().to_html(),
            editor.revision(),
        )
    });
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("go-to-page", cx);
        assert_eq!(window.find("go-to-page").expanded(), Some(true));
        assert_eq!(
            window.within("popup-menu").find(0usize).label(),
            Some(format!("{count} pages").as_str())
        );
        assert_eq!(
            window.within("popup-menu").find(2usize).label(),
            Some(format!("Page 2 of {count}").as_str())
        );
        window.within("popup-menu").click(2usize, cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).proof_mode);
        assert_eq!(window.find("go-to-page").expanded(), Some(false));
        assert_eq!(
            window.find("go-to-page").value(),
            Some(format!("Page 2 of {count}").as_str())
        );
        assert_eq!(
            window.find("page-selection-label").label(),
            Some(format!("Page 2 of {count}").as_str())
        );
        let viewport = window.find("typeset-pages").bounds();
        let selected = window.find(("proof-page", 1usize)).bounds();
        assert!(
            (selected.top() - viewport.top()).abs() <= px(1.),
            "selected page {selected:?}, viewport {viewport:?}"
        );
        window.click("write-mode", cx);
        assert!(!view.read(cx).proof_mode);
        assert_eq!(
            window.find("page-selection-label").label(),
            Some(format!("Page 2 of {count}").as_str())
        );
        window.click("go-to-page", cx);
        window.within("popup-menu").click(0usize, cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(!view.read(cx).proof_mode);
        assert_eq!(
            window.find("page-selection-label").label(),
            Some(format!("{count} pages").as_str())
        );
        assert_eq!(window.find("go-to-page").role(), Some(Role::ComboBox));
        assert_eq!(window.find("go-to-page").expanded(), Some(false));
        assert_eq!(
            window.find("go-to-page").value(),
            Some(format!("{count} pages").as_str())
        );
        view.update(cx, |room, cx| {
            room.desk.set_zen(false, false);
            room.desk.preferences.compositor_open = true;
            cx.notify();
        });
        window.render_frame(cx);
        window.click("compositor-tab-Home", cx);
        for _ in 0..48 {
            window.press("shift-tab", cx);
            if window.find("go-to-page").focused() == Some(true) {
                break;
            }
        }
        assert_eq!(window.find("go-to-page").focused(), Some(true));
        window.press("pagedown", cx);
        assert_eq!(
            window.find("go-to-page").value(),
            Some(format!("Page {} of {count}", count.min(3)).as_str())
        );
        assert!(view.read(cx).proof_mode);
        assert_eq!(window.find("go-to-page").focused(), Some(true));
        window.press("pageup", cx);
        assert_eq!(
            window.find("go-to-page").value(),
            Some(format!("{count} pages").as_str())
        );
        assert!(view.read(cx).proof_mode);
        assert_eq!(window.find("go-to-page").focused(), Some(true));
        window.press("p", cx);
        assert_eq!(
            window.find("go-to-page").value(),
            Some(format!("Page 1 of {count}").as_str())
        );
        window.press("p", cx);
        assert_eq!(
            window.find("go-to-page").value(),
            Some(format!("Page 2 of {count}").as_str())
        );
        window.press("home", cx);
        view.update(cx, |room, _| {
            *room.page_selector_typeahead.borrow_mut() = Default::default();
        });
        for key in ["p", "a", "g", "e", "space", "2"] {
            window.press(key, cx);
            assert!(
                window.try_find("popup-menu").is_none(),
                "Typed page prefix opened the popup on {key}"
            );
        }
        assert_eq!(
            window.find("go-to-page").value(),
            Some(format!("Page 2 of {count}").as_str())
        );
        assert_eq!(window.find("go-to-page").expanded(), Some(false));
        assert_eq!(window.find("go-to-page").focused(), Some(true));
        window.click("go-to-page", cx);
        window.within("popup-menu").click(2usize, cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).proof_mode);
        view.read(cx).proof_scroll.scroll_to_bottom();
        window.render_frame(cx);
        window.click("write-mode", cx);
        window.click("proof-mode", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let viewport = window.find("typeset-pages").bounds();
        assert!(
            (window.find(("proof-page", 1usize)).bounds().top() - viewport.top()).abs() <= px(1.)
        );
        window.click("source-mode", cx);
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input("#let incomplete = (", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(450));
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).proof_error.is_some());
        assert_eq!(
            window.find("page-selection-label").label(),
            Some(format!("Page 2 of {count}").as_str())
        );
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input("= A single page\n\nThe canonical manuscript remains.", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_millis(450));
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let room = view.read(cx);
        assert!(room.proof_error.is_none(), "{:?}", room.proof_error);
        assert_eq!(room.proof_images.len(), 1);
        assert_eq!(window.find("page-selection-label").label(), Some("1 page"));
        assert_eq!(room.active_document().body, canonical);
        let editor = room.rich.as_ref().unwrap().read(cx);
        assert_eq!(editor.document().to_html(), rich_html);
        assert_eq!(editor.revision(), rich_revision);
        assert!(room.source_session.as_ref().unwrap().pending);
    })
    .unwrap();
    assert_eq!(
        store
            .load()
            .unwrap()
            .documents
            .into_iter()
            .find(|doc| doc.id == id)
            .unwrap()
            .body,
        canonical
    );
}

#[gpui_kit::test]
fn rich_startup_find_and_proof_focus_only_the_visible_view(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Focus.html");
    std::fs::write(&path, "<p>Original text.</p>").unwrap();
    let document = import_file(&path).unwrap();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.add_document(document, window, cx);
        });
        window.render_frame(cx);
        let rich = view.read(cx).rich.clone().unwrap();
        assert!(rich.read(cx).focus_handle(cx).is_focused(window));
        window.input("Inserted ", cx);
        assert_eq!(
            rich.read(cx).document().plain_text(),
            "Inserted Original text."
        );
        window.press("ctrl-s", cx);
        window.click("toggle-compositor", cx);
        window.click("proof-mode", cx);
        let revision = rich.read(cx).revision();
        let canonical = view.read(cx).active_document().body.clone();
        window.input("Hidden input", cx);
        assert_eq!(rich.read(cx).revision(), revision);
        assert_eq!(view.read(cx).active_document().body, canonical);
        window.press("ctrl-f", cx);
        assert!(!view.read(cx).proof_mode);
        assert!(window.find("body-field").visible());
        window.input("Original", cx);
        window.press("enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let rich = view.read(cx).rich.clone().unwrap();
        assert!(rich.read(cx).focus_handle(cx).is_focused(window));
        window.input("Found", cx);
        assert_eq!(
            rich.read(cx).document().plain_text(),
            "Inserted Found text."
        );
        window.press("ctrl-s", cx);
    })
    .unwrap();
    cx.run_until_parked();
}

#[gpui_kit::test]
fn document_navigation_reveals_the_native_caret_in_long_manuscripts(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Long.html");
    let html = (0..80)
        .map(|index| format!("<p>Paragraph {index}: a measured line of writing.</p>"))
        .collect::<String>();
    std::fs::write(&path, html).unwrap();
    let document = import_file(&path).unwrap();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.add_document(document, window, cx);
        });
        window.render_frame(cx);
        window.press("ctrl-end", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let rich = view.read(cx).rich.clone().unwrap();
        for _ in 0..3 {
            window.simulate_next_frame(cx);
            window.render_frame(cx);
        }
        let room = view.read(cx);
        let viewport = room.writing_scroll.bounds();
        let caret = rich.read(cx).caret_bounds().unwrap();
        assert!(room.writing_scroll.offset().y < px(-100.));
        assert!(
            caret.top() >= viewport.top() && caret.bottom() <= viewport.bottom(),
            "caret {caret:?}, viewport {viewport:?}"
        );
        window.input(" Continued", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let rich = view.read(cx).rich.clone().unwrap();
        for _ in 0..3 {
            window.simulate_next_frame(cx);
            window.render_frame(cx);
        }
        let caret = rich.read(cx).caret_bounds().unwrap();
        let viewport = view.read(cx).writing_scroll.bounds();
        assert!(caret.top() >= viewport.top() && caret.bottom() <= viewport.bottom());
        window.press("ctrl-home", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let rich = view.read(cx).rich.clone().unwrap();
        for _ in 0..3 {
            window.simulate_next_frame(cx);
            window.render_frame(cx);
        }
        assert_eq!(view.read(cx).writing_scroll.offset().y, px(0.));
        assert_eq!(rich.read(cx).selection().head, 0);
    })
    .unwrap();
}

#[gpui_kit::test]
fn versions_restore_preserves_the_current_draft_and_saves_real_checkpoints(
    cx: &mut TestAppContext,
) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("History.html");
    std::fs::write(&path, "<p>The original ending.</p>").unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    let original = document.clone();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.add_document(document, window, cx);
        });
        window.render_frame(cx);
        window.press("ctrl-end", cx);
        window.input(" A later thought.", cx);
        window.press("ctrl-s", cx);
        window.click("toggle-compositor", cx);
        window.click("compositor-tab-Review", cx);
        window.click("compositor-history", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        assert!(window.find("revision-history-panel").visible());
        window.scroll(
            "revision-history-panel",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-360.))),
            cx,
        );
        assert!(
            window.find("revision-restore-checkpoint").visible(),
            "restore {:?}, panel {:?}",
            window.find("revision-restore-checkpoint"),
            window.find("revision-history-panel")
        );
        window.click("revision-restore-checkpoint", cx);
        for _ in 0..3 {
            window.simulate_next_frame(cx);
            window.render_frame(cx);
        }
        window.click("revision-confirm-restore", cx);
        assert!(
            view.read(cx)
                .active_document()
                .body
                .contains("later thought")
        );
    })
    .unwrap();
    cx.run_until_parked();
    let history = RevisionStore::open(store.root()).unwrap();
    let restored = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    assert_eq!(restored.body, original.body);
    assert_eq!(
        restored.workspace.as_ref().unwrap().content.html,
        original.workspace.as_ref().unwrap().content.html
    );
    let timeline = history.load(id).unwrap().timeline;
    assert!(timeline.revisions.iter().any(|snapshot| snapshot.label
        == "Before restoring an earlier version"
        && snapshot.manuscript.body.contains("later thought")));
    cx.update_window(handle, |_, window, cx| {
        window.scroll(
            "revision-history-panel",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(1200.))),
            cx,
        );
        let status = window.find("revision-saved-status");
        assert!(
            status
                .label()
                .is_some_and(|label| label.starts_with("Restored")),
            "{status:?}"
        );
        let rich = view.read(cx).rich.clone().unwrap();
        window.focus(&rich.read(cx).focus_handle(cx), cx);
        window.press("ctrl-end", cx);
        window.input(" A checkpointed thought.", cx);
        window.press("ctrl-s", cx);
        window.click("revision-save-checkpoint", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let timeline = history.load(id).unwrap().timeline;
    assert_eq!(timeline.revisions[0].label, "Manual checkpoint");
    assert!(
        timeline.revisions[0]
            .manuscript
            .body
            .contains("checkpointed thought")
    );
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(
            window.find("revision-saved-status").label(),
            Some("Checkpoint saved.")
        );
        let checkpoints = view.read(cx).revision_timeline.revisions.len();
        window.click("source-mode", cx);
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input("#let unfinished = (", cx);
        view.update(cx, |room, cx| room.flush(cx).unwrap());
        window.click("revision-save-checkpoint", cx);
        window.scroll(
            "revision-history-panel",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-360.))),
            cx,
        );
        window.click("revision-restore-checkpoint", cx);
        window.scroll(
            "revision-history-panel",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(1200.))),
            cx,
        );
        assert!(
            view.read(cx)
                .revision_view
                .as_ref()
                .unwrap()
                .read(cx)
                .pending_request_id()
                .is_none()
        );
        assert_eq!(view.read(cx).revision_timeline.revisions.len(), checkpoints);
        assert!(
            window
                .find("revision-capability-status")
                .label()
                .unwrap()
                .contains("Source")
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn page_ruler_saves_the_real_margin_and_read_mode_rejects_changes(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Margins.html");
    std::fs::write(
        &path,
        "<h1>A measured page</h1><p>The same manuscript stays under its ruler.</p>",
    )
    .unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    let before = document
        .workspace
        .as_ref()
        .unwrap()
        .folio
        .layout
        .clone()
        .unwrap_or_default()
        .resolve_margins()
        .left;
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.add_document(document, window, cx);
            room.set_write(window, cx);
        });
        window.render_frame(cx);
        if view.read(cx).desk.zen {
            window.click("focus", cx);
        }
        assert!(window.find("page-ruler").visible());
        window.click("page-ruler-left", cx);
        window.press("right", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.press("ctrl-s", cx);
        let layout = view
            .read(cx)
            .compositor
            .as_ref()
            .unwrap()
            .read(cx)
            .layout
            .clone();
        assert_eq!(layout.resolve_margins().left, before + 0.25);
        window.press("ctrl-2", cx);
        window.click("page-ruler-left", cx);
        window.press("right", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.press("ctrl-s", cx);
        assert_eq!(
            view.read(cx)
                .compositor
                .as_ref()
                .unwrap()
                .read(cx)
                .layout
                .resolve_margins()
                .left,
            before + 0.25
        );
        window.click("focus", cx);
        assert!(window.try_find("page-ruler").is_none());
    })
    .unwrap();
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    assert_eq!(
        saved
            .workspace
            .as_ref()
            .unwrap()
            .folio
            .layout
            .as_ref()
            .unwrap()
            .resolve_margins()
            .left,
        before + 0.25
    );
    assert!(
        saved
            .workspace
            .as_ref()
            .unwrap()
            .content
            .html
            .contains("same manuscript")
    );
}

#[gpui_kit::test]
fn local_image_file_rejects_the_original_source_limit_before_editing(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Retained source.html");
    std::fs::write(&path, "<p>The manuscript before a large plate.</p>").unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    let plate = store.root().join("large.png");
    let mut bytes = include_bytes!("../../fixtures/editor/offline-landscape.png").to_vec();
    bytes.resize(3_900_000, 0);
    std::fs::write(&plate, bytes).unwrap();
    // A real PNG that fits the upload limit can still exceed the original
    // converter's source limit after lossless base64 embedding.
    assert!(twyne_desktop::image_import::load_image_file(&plate).is_ok());
    let (before, selection, revision) = cx
        .update_window(handle, |_, window, cx| {
            view.update(cx, |room, cx| room.add_document(document, window, cx));
            window.render_frame(cx);
            window.press("ctrl-end", cx);
            let rich = view.read(cx).rich.as_ref().unwrap().read(cx);
            let captured = (rich.document().to_html(), rich.selection(), rich.revision());
            assert!(!rich.can_undo());
            window.click("toggle-compositor", cx);
            window.click("compositor-tab-Insert", cx);
            window.click("compositor-image", cx);
            window.click("compositor-image-file", cx);
            captured
        })
        .unwrap();
    cx.run_until_parked();
    let saved_before = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    cx.simulate_path_prompt_response(|_| Some(vec![plate]));
    cx.run_until_parked();
    cx.update_window(handle, |_, _, cx| {
        let room = view.read(cx);
        assert!(room.image_request.is_none());
        assert!(
            room.notice
                .as_deref()
                .unwrap()
                .contains("5 MB editing limit")
        );
        let rich = room.rich.as_ref().unwrap().read(cx);
        assert_eq!(rich.document().to_html(), before);
        assert_eq!(rich.selection(), selection);
        assert_eq!(rich.revision(), revision);
        assert!(!rich.can_undo());
        assert!(!room.dirty);
    })
    .unwrap();
    assert_eq!(
        store
            .load()
            .unwrap()
            .documents
            .into_iter()
            .find(|document| document.id == id)
            .unwrap(),
        saved_before
    );
}

#[gpui_kit::test]
fn local_image_file_is_portable_and_one_native_undo_restores_the_prose(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Plate.html");
    std::fs::write(&path, "<p>A paragraph before the plate.</p>").unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    let plate = store.root().join("Landscape.PNG");
    std::fs::write(
        &plate,
        include_bytes!("../../fixtures/editor/offline-landscape.png"),
    )
    .unwrap();
    let before = cx
        .update_window(handle, |_, window, cx| {
            view.update(cx, |room, cx| {
                room.add_document(document, window, cx);
            });
            window.render_frame(cx);
            window.press("ctrl-end", cx);
            let before = view
                .read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html();
            window.click("toggle-compositor", cx);
            window.click("compositor-tab-Insert", cx);
            window.click("compositor-image", cx);
            assert!(!view.read(cx).source_mode);
            assert!(!view.read(cx).rich.as_ref().unwrap().read(cx).is_read_only());
            window.click("compositor-image-file", cx);
            before
        })
        .unwrap();
    cx.run_until_parked();
    assert!(cx.did_prompt_for_paths());
    cx.simulate_path_prompt_response(|options| {
        assert!(options.files && !options.directories && !options.multiple);
        Some(vec![plate])
    });
    cx.run_until_parked();
    let inserted = cx
        .update_window(handle, |_, window, cx| {
            assert!(view.read(cx).image_request.is_none());
            let rich = view.read(cx).rich.as_ref().unwrap();
            let inserted = rich.read(cx).document().to_html();
            assert!(inserted.contains("data:image/png;base64,"));
            assert!(inserted.contains("data-image-offline=\"true\""));
            assert!(inserted.contains("data-upload-status=\"ready\""));
            assert!(inserted.contains("data-upload-id="));
            assert!(inserted.contains("data-alt-text=\"Landscape\""));
            assert!(rich.read(cx).focus_handle(cx).is_focused(window));
            window.press("ctrl-s", cx);
            window.press("ctrl-z", cx);
            inserted
        })
        .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        assert_eq!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html(),
            before
        );
        window.press("ctrl-shift-z", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        assert_eq!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html(),
            inserted
        );
        window.press("ctrl-s", cx);
    })
    .unwrap();
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    let workspace = saved.workspace.as_ref().unwrap();
    assert_eq!(workspace.content.html, inserted);
    let source = workspace.canonical_source().unwrap();
    assert!(source.contains("data:image/png;base64,"));
    let backup = store.root().join("plate.twyne.json");
    export_file(&saved, &backup).unwrap();
    let imported = import_file(&backup).unwrap();
    assert_eq!(
        imported.workspace.as_ref().unwrap().canonical_source(),
        Some(source)
    );
    assert_eq!(imported.workspace.as_ref().unwrap().content.html, inserted);
    let typst = store.root().join("plate.typ");
    export_file(&saved, &typst).unwrap();
    assert_eq!(std::fs::read(typst).unwrap(), source.as_bytes());
}

#[gpui_kit::test]
fn local_image_file_cancellation_bad_data_and_late_typing_preserve_the_document(
    cx: &mut TestAppContext,
) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Retained.html");
    std::fs::write(&path, "<p>The retained paragraph.</p>").unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    let bad = store.root().join("broken.png");
    std::fs::write(&bad, "Unrelated text must never become an image.").unwrap();
    let plate = store.root().join("late.png");
    std::fs::write(
        &plate,
        include_bytes!("../../fixtures/editor/offline-landscape.png"),
    )
    .unwrap();
    let before = cx
        .update_window(handle, |_, window, cx| {
            view.update(cx, |room, cx| {
                room.add_document(document, window, cx);
            });
            window.render_frame(cx);
            window.press("ctrl-end", cx);
            let before = view
                .read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html();
            window.click("toggle-compositor", cx);
            window.click("compositor-tab-Insert", cx);
            window.click("compositor-image", cx);
            window.click("compositor-image-file", cx);
            before
        })
        .unwrap();
    cx.run_until_parked();
    assert!(
        cx.did_prompt_for_paths(),
        "The initial image file control must open its picker."
    );
    cx.simulate_path_prompt_response(|_| None);
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        assert!(view.read(cx).image_request.is_none());
        assert_eq!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html(),
            before
        );
        window.render_frame(cx);
        window.click("compositor-image-file", cx);
    })
    .unwrap();
    cx.run_until_parked();
    assert!(
        cx.did_prompt_for_paths(),
        "The retained file control must reopen its picker after cancellation."
    );
    cx.simulate_path_prompt_response(|_| Some(vec![bad]));
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        assert!(
            view.read(cx)
                .notice
                .as_ref()
                .unwrap()
                .starts_with("Could not insert this image:")
        );
        assert_eq!(
            view.read(cx)
                .rich
                .as_ref()
                .unwrap()
                .read(cx)
                .document()
                .to_html(),
            before
        );
        // The error notice changes native popup geometry. Observe its
        // completed frame before clicking the retained file control.
        window.render_frame(cx);
        window.click("compositor-image-file", cx);
    })
    .unwrap();
    cx.run_until_parked();
    assert!(
        cx.did_prompt_for_paths(),
        "The retained file control must reopen its picker after an image error."
    );
    cx.simulate_path_prompt_response(|_| Some(vec![plate]));
    cx.update_window(handle, |_, window, cx| {
        let rich = view.read(cx).rich.as_ref().unwrap();
        window.focus(&rich.read(cx).focus_handle(cx), cx);
        window.input(" New typing during image loading.", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        assert!(view.read(cx).image_request.is_none());
        assert!(
            view.read(cx)
                .notice
                .as_ref()
                .unwrap()
                .contains("insertion point changed")
        );
        let html = view
            .read(cx)
            .rich
            .as_ref()
            .unwrap()
            .read(cx)
            .document()
            .to_html();
        assert!(html.contains("New typing during image loading."));
        assert!(!html.contains("<figure"));
        window.press("ctrl-s", cx);
        window.press("ctrl-2", cx);
        window.click("compositor-image-file", cx);
    })
    .unwrap();
    assert!(!cx.did_prompt_for_paths());
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
            .as_ref()
            .unwrap()
            .content
            .html
            .contains("New typing during image loading.")
    );
    assert!(
        !saved
            .workspace
            .as_ref()
            .unwrap()
            .content
            .html
            .contains("<figure")
    );
}

#[gpui_kit::test]
fn appearance_saves_and_reloads_while_retaining_the_manuscript(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Appearance.html");
    std::fs::write(
        &path,
        "<p>A local paragraph with <strong>retained marks</strong>.</p>",
    )
    .unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.add_document(document, window, cx);
        });
        window.render_frame(cx);
        window.press("ctrl-end", cx);
        window.input(" More prose before opening preferences.", cx);
        window.click("toggle-compositor", cx);
        window.click("toggle-library", cx);
        window.scroll(
            "drawer-content",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-720.))),
            cx,
        );
        window.click("drawer-settings", cx);
        assert!(window.find("settings-page").visible());
        assert!(window.try_find("body-field").is_none());
        assert!(window.try_find("masthead").is_none());
        window.click("settings-preset-nightpress", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let record = AppearanceStore::open(store.root())
        .unwrap()
        .load()
        .unwrap()
        .record;
    assert_eq!(record.preference.preset, ThemePreset::Nightpress);
    assert_eq!(record.generation, 1);
    let before = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    assert!(
        before
            .workspace
            .as_ref()
            .unwrap()
            .content
            .html
            .contains("More prose before opening preferences.")
    );
    assert!(
        before
            .workspace
            .as_ref()
            .unwrap()
            .content
            .html
            .contains("<strong>retained marks</strong>")
    );
    cx.update_window(handle, |_, window, cx| {
        assert_eq!(view.read(cx).appearance_record, record);
        assert!(palette(cx).dark);
        assert!(window.find("settings-saved-status").visible());
        window.click("settings-back", cx);
        assert!(window.try_find("settings-page").is_none());
        assert!(window.find("body-field").visible());
        let rich = view.read(cx).rich.as_ref().unwrap();
        assert!(rich.read(cx).focus_handle(cx).is_focused(window));
        let reopened =
            cx.new(|cx| WritingRoom::new(store.clone(), store.load().unwrap(), window, cx));
        assert_eq!(reopened.read(cx).appearance_record, record);
        assert!(palette(cx).dark);
    })
    .unwrap();
    let after = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    assert_eq!(before.workspace, after.workspace);
}

#[gpui_kit::test]
fn failed_appearance_save_keeps_the_preview_and_reports_no_saved_status(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.open_settings(window, cx));
    })
    .unwrap();
    let appearance = AppearanceStore::open(store.root()).unwrap();
    let future = br#"{"format":"twyne-gpui-appearance","version":99,"generation":10,"preference":{"preset":"broadsheet"}}"#;
    std::fs::write(appearance.path(), future).unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.click("settings-preset-nightpress", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        assert!(window.find("settings-error").visible());
        assert!(window.try_find("settings-saved-status").is_none());
        assert_eq!(
            view.read(cx).appearance_record.preference.preset,
            ThemePreset::Editorial
        );
        assert_eq!(
            view.read(cx).appearance_preview.preset,
            ThemePreset::Nightpress
        );
        assert!(view.read(cx).appearance_pending.is_none());
        assert!(palette(cx).dark);
    })
    .unwrap();
    assert_eq!(std::fs::read(appearance.path()).unwrap(), future);
    // Simulate recovery of the external file, then use the same native
    // preset click to retry the previously failed choice.
    std::fs::write(
        appearance.path(),
        serde_json::to_vec(&AppearanceRecord::default().to_value()).unwrap(),
    )
    .unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.click("settings-preset-nightpress", cx);
    })
    .unwrap();
    cx.run_until_parked();
    assert_eq!(
        appearance.load().unwrap().record.preference.preset,
        ThemePreset::Nightpress
    );
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("settings-error").is_none());
        assert!(window.find("settings-saved-status").visible());
    })
    .unwrap();
}

#[gpui_kit::test]
fn closing_finishes_a_pending_appearance_write(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.open_settings(window, cx));
        window.click("settings-preset-foolscap", cx);
        view.update(cx, |room, cx| room.flush_on_shutdown(cx).unwrap());
    })
    .unwrap();
    cx.run_until_parked();
    let record = AppearanceStore::open(store.root())
        .unwrap()
        .load()
        .unwrap()
        .record;
    assert_eq!(record.preference.preset, ThemePreset::Foolscap);
    assert_eq!(record.generation, 1);
}

#[gpui_kit::test]
fn source_helper_fold_hides_the_marker_and_navigation_reveals_it_without_an_edit(
    cx: &mut TestAppContext,
) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Generated helpers.html");
    let html = "<p>Café 東京, retained.</p>";
    std::fs::write(&path, html).unwrap();
    let document =
        twyne_desktop::document_edit::apply_html(import_file(&path).unwrap(), html).unwrap();
    let canonical = document
        .workspace
        .as_ref()
        .unwrap()
        .canonical_source()
        .unwrap()
        .to_owned();
    let marker_line = canonical
        .lines()
        .position(|line| line == "// twyne-document:body")
        .unwrap();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            assert!(room.add_document(document, window, cx));
            room.set_source(window, cx);
        });
        window.render_frame(cx);
        window.click("toggle-compositor", cx);
        assert!(window.find("source-ribbon").visible());
        let source = view.read(cx).source.clone();
        assert!(source.read(cx).is_folded_at(0));
        assert_eq!(
            source.read(cx).cursor_position().line as usize,
            marker_line + 1
        );
        assert_eq!(source.read(cx).value().as_ref(), canonical);
        assert!(!source.read(cx).can_undo());
        window.click("source-go-to-line", cx);
        window.click("source-line-number", cx);
        window.press("secondary-a", cx);
        window.input(&(marker_line + 1).to_string(), cx);
        window.press("enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let source = view.read(cx).source.clone();
        assert!(!source.read(cx).is_folded_at(0));
        assert_eq!(source.read(cx).cursor_position().line as usize, marker_line);
        assert_eq!(source.read(cx).value().as_ref(), canonical);
        assert!(!source.read(cx).can_undo());
        assert!(!source.read(cx).can_redo());
        window.click("write-mode", cx);
        window.click("source-mode", cx);
        assert!(!source.read(cx).is_folded_at(0));
        assert_eq!(view.read(cx).active_document().body, canonical);
    })
    .unwrap();
}

#[gpui_kit::test]
fn native_source_tools_edit_undo_search_and_navigate_without_replacing_canonical(
    cx: &mut TestAppContext,
) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Source tools.typ");
    std::fs::write(&path, "= A retained opening\n\nCafé 東京\nA final line\n").unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    let canonical = document
        .workspace
        .as_ref()
        .unwrap()
        .canonical_source()
        .unwrap()
        .to_owned();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.add_document(document, window, cx);
        });
        window.click("toggle-compositor", cx);
        assert!(window.find("source-ribbon").visible());
        let source = view.read(cx).source.clone();
        assert!(!source.read(cx).can_undo());
        assert!(!source.read(cx).can_redo());
        source.update(cx, |state, cx| {
            let start = state.text().line_start_offset(2);
            let end = state.text().line_end_offset(2);
            state.set_selected_range(start..end, cx);
            state.focus(window, cx);
        });
        window.render_frame(cx);
        window.click("source-insert-bold", cx);
        assert!(source.read(cx).can_undo());
        assert!(source.read(cx).value().contains("*Café 東京*"));
        assert_eq!(source.read(cx).selected_text().to_string(), "Café 東京");
        window.click("source-undo", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let source = view.read(cx).source.clone();
        assert_eq!(source.read(cx).value().as_ref(), canonical);
        assert!(!source.read(cx).can_undo());
        assert!(source.read(cx).can_redo());
        window.click("source-redo", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let source = view.read(cx).source.clone();
        assert!(source.read(cx).value().contains("*Café 東京*"));
        assert_eq!(source.read(cx).selected_text().to_string(), "Café 東京");
        window.click("source-go-to-line", cx);
        window.click("source-line-number", cx);
        window.press("secondary-a", cx);
        window.input("4", cx);
        window.press("enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let source = view.read(cx).source.clone();
        assert_eq!(source.read(cx).cursor_position().line, 3);
        window.click("source-comment", cx);
        assert!(source.read(cx).value().contains("// A final line"));
        assert!(source.read(cx).selected_range().is_empty());
        assert_eq!(source.read(cx).cursor_position().character, 3);
        window.render_frame(cx);
        window.click("source-undo", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let source = view.read(cx).source.clone();
        assert!(
            source.read(cx).value().contains("\nA final line\n"),
            "{}",
            source.read(cx).value()
        );
        assert!(source.read(cx).selected_range().is_empty());
        assert_eq!(source.read(cx).cursor_position().character, 0);
        window.render_frame(cx);
        if cfg!(target_os = "linux") {
            window.press("ctrl-shift-z", cx);
        } else {
            window.click("source-redo", cx);
        }
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        let source = view.read(cx).source.clone();
        assert!(source.read(cx).value().contains("// A final line"));
        assert!(source.read(cx).selected_range().is_empty());
        assert_eq!(source.read(cx).cursor_position().character, 3);
        window.render_frame(cx);
        window.click("source-comment", cx);
        assert!(source.read(cx).value().contains("\nA final line\n"));
        assert!(source.read(cx).selected_range().is_empty());
        window.input("Continued ", cx);
        assert!(
            source
                .read(cx)
                .value()
                .contains("\nContinued A final line\n")
        );
        window.click("source-wrap", cx);
        assert!(!view.read(cx).source_wrapping);
        window.click("source-find", cx);
        assert!(source.read(cx).search_session().open);
        assert!(source.read(cx).search_session().replace_mode);
        view.update(cx, |room, cx| room.flush(cx).unwrap());
    })
    .unwrap();
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    assert_eq!(
        saved
            .workspace
            .as_ref()
            .unwrap()
            .canonical_source()
            .unwrap(),
        canonical
    );
    let draft = store.load_source_draft(id).unwrap().draft.unwrap();
    assert!(draft.source.contains("*Café 東京*"));
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.archive(window, cx));
        window.render_frame(cx);
        let source = view.read(cx).source.clone();
        let retained = source.read(cx).value();
        window.click("source-insert-bold", cx);
        window.click("source-undo", cx);
        window.focus(&source.read(cx).focus_handle(cx), cx);
        window.input("An archived edit", cx);
        assert_eq!(source.read(cx).value(), retained);
    })
    .unwrap();
}

#[gpui_kit::test]
fn versions_do_not_replace_new_native_typing_or_pending_source(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = room(cx);
    let path = store.root().join("Restore race.html");
    std::fs::write(&path, "<p>The retained opening.</p>").unwrap();
    let document = import_file(&path).unwrap();
    let id = document.id;
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.add_document(document, window, cx);
        });
        window.render_frame(cx);
        window.press("ctrl-end", cx);
        window.input(" Before preparation.", cx);
        window.press("ctrl-s", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let history = RevisionStore::open(store.root()).unwrap();
    let snapshot_id = history
        .load(id)
        .unwrap()
        .timeline
        .revisions
        .last()
        .unwrap()
        .id;
    let (current, source_generation) = cx.update(|cx| {
        let room = view.read(cx);
        (
            Arc::new(room.active_document().clone()),
            room.source_session
                .as_ref()
                .map(|session| session.generation),
        )
    });
    let plan = history
        .prepare_restore(Uuid::new_v4(), snapshot_id, current, timestamp())
        .unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.input(" New typing during preparation.", cx);
        let error = view
            .update(cx, |room, cx| {
                room.commit_revision_restore(plan, source_generation, window, cx)
            })
            .unwrap_err();
        assert!(error.to_string().contains("manuscript changed"));
        assert!(
            view.read(cx)
                .active_document()
                .body
                .contains("New typing during preparation")
        );
    })
    .unwrap();
    cx.run_until_parked();
    let (current, source_generation) = cx.update(|cx| {
        let room = view.read(cx);
        (
            Arc::new(room.active_document().clone()),
            room.source_session
                .as_ref()
                .map(|session| session.generation),
        )
    });
    let canonical = current.body.clone();
    let plan = history
        .prepare_restore(Uuid::new_v4(), snapshot_id, current, timestamp())
        .unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.click("toggle-compositor", cx);
        window.click("source-mode", cx);
        window.click("source-field", cx);
        window.press("secondary-a", cx);
        window.input("#let unfinished = (", cx);
        let error = view
            .update(cx, |room, cx| {
                room.commit_revision_restore(plan, source_generation, window, cx)
            })
            .unwrap_err();
        assert!(error.to_string().contains("Source"));
        assert_eq!(view.read(cx).active_document().body, canonical);
    })
    .unwrap();
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    assert_eq!(saved.body, canonical);
    assert_eq!(
        store.load_source_draft(id).unwrap().draft.unwrap().source,
        "#let unfinished = ("
    );
}

#[gpui_kit::test]
fn new_folio_files_the_real_dossier_and_opens_rich_writing(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.click("new-draft", cx);
        window.click("new-folio-name", cx);
        window.input("A local folio", cx);
        window.click("create-folio", cx);
        assert!(view.read(cx).dossier.is_some());
        window.click("dossier-answer-0", cx);
        window.press("secondary-a", cx);
        window.input("A local Dossier", cx);
        window.click(("dossier-section", 9_usize), cx);
        window.click("dossier-next", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let id = cx.update(|cx| {
        let room = view.read(cx);
        assert!(room.dossier.is_none(), "filing failed: {:?}", room.error);
        assert!(room.rich.is_some());
        assert!(!room.source_mode);
        room.active
    });
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|document| document.id == id)
        .unwrap();
    assert_eq!(saved.title, "A local Dossier");
    let workspace = saved.workspace.as_deref().unwrap();
    assert_eq!(
        workspace.brief.as_ref().unwrap().answers.working_title,
        "A local Dossier"
    );
    assert_eq!(
        workspace.projection,
        twyne_desktop::workspace::ProjectionState::Verified
    );
    assert!(workspace.content.html.contains("A local Dossier"));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("toggle-notebook", cx);
        window.render_frame(cx);
        assert!(window.find("cast-root").visible());
    })
    .unwrap();
}

#[gpui_kit::test]
fn writing_and_notebook_save_through_real_controls(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("manuscript-title", cx);
        window.input("L'été à 東京", cx);
        window.click("body-field", cx);
        window.input("# First page\n\nA manuscript with café and 🦀.", cx);
        window.click("toggle-notebook", cx);
        window.click("notebook-field", cx);
        window.input("Write for curious readers.", cx);
        window.click("save", cx);
        assert_eq!(window.find("save-status").label(), Some("Saved locally"));
    })
    .unwrap();
    let library = store.load().unwrap();
    assert_eq!(library.documents[0].title, "L'été à 東京");
    assert_eq!(
        library.documents[0].body,
        "# First page\n\nA manuscript with café and 🦀."
    );
    assert_eq!(library.documents[0].notes, "Write for curious readers.");
    cx.update_window(handle, |_, window, cx| {
        window.click("read-mode", cx);
        assert!(view.read(cx).reading);
        assert_eq!(view.read(cx).preview.as_ref(), library.documents[0].body);
        window.click("focus", cx);
        assert!(view.read(cx).desk.zen);
        window.click("focus", cx);
        assert!(!view.read(cx).desk.zen);
    })
    .unwrap();
}

#[gpui_kit::test]
fn switching_drafts_flushes_typing_before_the_autosave_delay(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = expanded_room(cx);
    let original = cx.update(|cx| view.read(cx).active);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("These words must survive an immediate switch.", cx);
        window.click("new-draft", cx);
        window.click("create-folio", cx);
        assert_ne!(view.read(cx).active, original);
        assert_eq!(view.read(cx).body.read(cx).text().len(), 0);
        assert!(view.read(cx).dossier.is_some());
        window.click("dossier-exit", cx);
    })
    .unwrap();
    // A new folio enters the real Dossier route. Process its actual Cancel
    // event before the library is visible and can switch back to the draft.
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(view.read(cx).dossier.is_none());
        window.click(SharedString::from(format!("manuscript-{original}")), cx);
        assert_eq!(
            view.read(cx).body.read(cx).value(),
            "These words must survive an immediate switch."
        );
        let focus_key = if cfg!(target_os = "macos") {
            "cmd-shift-f"
        } else {
            "ctrl-shift-f"
        };
        window.press(focus_key, cx);
        assert!(view.read(cx).desk.zen);
        window.press(focus_key, cx);
        assert!(!view.read(cx).desk.zen);
    })
    .unwrap();
    assert_eq!(
        store
            .load()
            .unwrap()
            .documents
            .iter()
            .find(|doc| doc.id == original)
            .unwrap()
            .body,
        "These words must survive an immediate switch."
    );
}

#[gpui_kit::test]
fn archive_is_reversible_and_read_only(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("Keep this draft.", cx);
        window.click("archive-draft", cx);
        assert!(view.read(cx).active_document().archived);
        window.click("body-field", cx);
        window.input("This edit must be rejected.", cx);
        assert_eq!(view.read(cx).body.read(cx).value(), "Keep this draft.");
        window.click("restore-draft", cx);
        assert!(!view.read(cx).active_document().archived);
    })
    .unwrap();
    let library = store.load().unwrap();
    assert_eq!(library.documents[0].body, "Keep this draft.");
    assert!(!library.documents[0].archived);
}

#[gpui_kit::test]
fn autosave_persists_native_typing_after_the_quiet_period(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("Saved without pressing Save.", cx);
    })
    .unwrap();
    while cx.executor().tick() {}
    assert!(store.load().unwrap().documents[0].body.is_empty());
    cx.executor().advance_clock(Duration::from_millis(701));
    while cx.executor().tick() {}
    assert_eq!(
        store.load().unwrap().documents[0].body,
        "Saved without pressing Save."
    );
    cx.update(|cx| assert!(!view.read(cx).dirty));
}

#[gpui_kit::test]
fn late_autosave_cannot_replace_typing_flushed_by_save(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = expanded_room(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("First line.", cx);
    })
    .unwrap();
    while cx.executor().tick() {}
    let older = cx.update(|cx| view.read(cx).snapshot(cx).materialize().unwrap());
    cx.update_window(handle, |_, window, cx| {
        window.input(" Still here.", cx);
        window.click("save", cx);
    })
    .unwrap();
    // Complete an older background write after the explicit Save.
    store.save(&older).unwrap();
    assert_eq!(
        store.load().unwrap().documents[0].body,
        "First line. Still here."
    );
}

#[gpui_kit::test]
fn failed_save_keeps_the_current_draft_and_can_be_retried(cx: &mut TestAppContext) {
    let (handle, view, store, directory) = expanded_room(cx);
    let original = cx.update(|cx| view.read(cx).active);
    let manuscripts = directory.path().join("manuscripts");
    let moved = directory.path().join("temporarily-unavailable");
    std::fs::rename(&manuscripts, &moved).unwrap();
    std::fs::write(&manuscripts, "not a directory").unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click("body-field", cx);
        window.input("Do not lose these words.", cx);
        window.click("new-draft", cx);
        window.click("create-folio", cx);
        assert_eq!(view.read(cx).active, original);
        assert!(view.read(cx).dirty);
        assert_eq!(
            window.find("save-status").label(),
            Some("Save needs attention")
        );
    })
    .unwrap();
    std::fs::remove_file(&manuscripts).unwrap();
    std::fs::rename(moved, manuscripts).unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.click("save", cx);
        assert_eq!(window.find("save-status").label(), Some("Saved locally"));
    })
    .unwrap();
    assert_eq!(
        store.load().unwrap().documents[0].body,
        "Do not lose these words."
    );
}
