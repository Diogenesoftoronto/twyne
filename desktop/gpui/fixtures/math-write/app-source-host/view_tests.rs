//! Actual application coordinator + original local canonical converter.
//! Mounted tests do not prove operating-system input, a renderer or pixel parity.

use super::*;
use gpui_kit::test::TestWindowExt;
use gpui_kit::{AnyWindowHandle, TestAppContext};
use twyne_desktop::editor::{Command, math_source_editor::MathSourceEditorView};

const HTML: &str = "<div data-type=\"block-math\" data-latex=\" x \" data-future=\"keep\"> x </div><p data-future=\"prose\">Untouched 🦊 é prose.</p>";

fn math_room(
    cx: &mut TestAppContext,
) -> (
    AnyWindowHandle,
    Entity<WritingRoom>,
    Arc<Store>,
    tempfile::TempDir,
) {
    math_room_html(cx, HTML)
}

fn math_room_html(
    cx: &mut TestAppContext,
    html: &str,
) -> (
    AnyWindowHandle,
    Entity<WritingRoom>,
    Arc<Store>,
    tempfile::TempDir,
) {
    let (window, room, store, directory) = crate::app::tests::room(cx);
    let path = directory.path().join("Equation.html");
    std::fs::write(&path, html).unwrap();
    let document = import_file(&path).unwrap();
    cx.update_window(window, |_, window, cx| {
        room.update(cx, |room, cx| {
            assert!(room.add_document(document, window, cx));
            room.set_write(window, cx);
        });
        window.render_frame(cx);
    })
    .unwrap();
    cx.run_until_parked();
    (window, room, store, directory)
}

fn open(
    cx: &mut TestAppContext,
    window: AnyWindowHandle,
    room: &Entity<WritingRoom>,
) -> (Entity<RichEditorView>, Entity<MathSourceEditorView>) {
    open_at(cx, window, room, vec![0])
}

fn open_at(
    cx: &mut TestAppContext,
    window: AnyWindowHandle,
    room: &Entity<WritingRoom>,
    path: Vec<usize>,
) -> (Entity<RichEditorView>, Entity<MathSourceEditorView>) {
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let editor = room.read(cx).rich.clone().unwrap();
        editor.update(cx, |editor, cx| {
            assert!(editor.open_math_source_at(path, window, cx).unwrap());
        });
        window.render_frame(cx);
        window.simulate_next_frame(cx);
        window.render_frame(cx);
        let form = editor.read(cx).math_source_form().unwrap();
        assert_eq!(
            &*form.read(cx).target().owner.folio,
            room.read(cx).active.to_string()
        );
        (editor, form)
    })
    .unwrap()
}

#[gpui_kit::test]
fn actual_inline_child_submits_through_canonical_conversion_and_save(cx: &mut TestAppContext) {
    let html = "<p data-future=\"paragraph\">Before 🦊 é <span data-type=\"inline-math\" data-latex=\" x + y \" data-future=\"equation\"> x + y </span> after 東京.</p><p data-future=\"untouched\">Untouched paragraph.</p>";
    let (window, room, store, _directory) = math_room_html(cx, html);
    let (editor, form) = open_at(cx, window, &room, vec![0, 1]);
    let (before, id, provenance) = cx.update(|cx| {
        let document = room.read(cx).active_document();
        (
            editor.read(cx).snapshot(),
            document.id,
            document.workspace.as_deref().unwrap().provenance.clone(),
        )
    });
    let raw = " \\sqrt{a^2 + b^2} \n";
    cx.update_window(window, |_, window, cx| {
        let bounds = editor.read(cx).inline_math_form_bounds().unwrap();
        assert_eq!(
            window.find("twyne-math-source-editor").bounds(),
            window.pixel_snap_bounds(bounds)
        );
        assert!(form.read(cx).input().focus_handle(cx).is_focused(window));
        assert_eq!(editor.read(cx).document(), &before);
        form.read(cx).input().clone().update(cx, |input, cx| {
            input.set_value(raw, window, cx);
        });
        window.click("twyne-math-source-save", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        assert!(form.read(cx).is_retired());
        let after = editor.read(cx).snapshot();
        let equation = after.node(&[0, 1]).unwrap().as_element().unwrap();
        assert_eq!(equation.shell.attr("data-latex"), Some(raw));
        assert_eq!(equation.shell.attr("data-future"), Some("equation"));
        assert!(before.nodes()[1].shares_storage_with(&after.nodes()[1]));
        editor.update(cx, |editor, cx| {
            editor.execute(Command::Undo, window, cx).unwrap();
            assert_eq!(editor.document(), &before);
            editor.execute(Command::Redo, window, cx).unwrap();
            assert_eq!(editor.document(), &after);
        });
        room.update(cx, |room, cx| room.flush(cx).unwrap());
    })
    .unwrap();
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|d| d.id == id)
        .unwrap();
    let workspace = saved.workspace.as_deref().unwrap();
    assert_eq!(workspace.projection, ProjectionState::Verified);
    assert_eq!(workspace.provenance, provenance);
    let rich = RichDocument::from_html(&workspace.content.html).unwrap();
    let equation = rich.node(&[0, 1]).unwrap().as_element().unwrap();
    assert_eq!(equation.shell.attr("data-latex"), Some(raw));
    assert_eq!(equation.shell.attr("data-future"), Some("equation"));
    assert_eq!(
        rich.nodes()[1].as_element().unwrap().children,
        before.nodes()[1].as_element().unwrap().children
    );
}

#[gpui_kit::test]
fn canonical_submit_and_real_save_preserve_exact_math_and_import_provenance(
    cx: &mut TestAppContext,
) {
    let (window, room, store, _directory) = math_room(cx);
    let (editor, form) = open(cx, window, &room);
    let (before, provenance, id) = cx.update(|cx| {
        let document = room.read(cx).active_document();
        (
            editor.read(cx).snapshot(),
            document.workspace.as_deref().unwrap().provenance.clone(),
            document.id,
        )
    });
    let raw = " \\frac{1}{2} + \\alpha \n";
    cx.update_window(window, |_, window, cx| {
        let input = form.read(cx).input().clone();
        input.update(cx, |input, cx| input.set_value(raw, window, cx));
        assert_eq!(&*form.read(cx).raw_source(cx), raw);
        // The real form reads its live rope before queued Change delivery.
        window.click("twyne-math-source-save", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        assert!(
            form.read(cx).is_retired(),
            "Canonical preparation must succeed"
        );
        let after = editor.read(cx).snapshot();
        let math = after.node(&[0]).unwrap().as_element().unwrap();
        assert_eq!(math.shell.attr("data-latex"), Some(raw));
        assert_eq!(math.shell.attr("data-future"), Some("keep"));
        assert!(before.nodes()[1].shares_storage_with(&after.nodes()[1]));
        editor.update(cx, |editor, cx| {
            editor.execute(Command::Undo, window, cx).unwrap();
            assert_eq!(editor.document(), &before);
            editor.execute(Command::Redo, window, cx).unwrap();
            assert_eq!(editor.document(), &after);
        });
        room.update(cx, |room, cx| room.flush(cx).unwrap());
    })
    .unwrap();
    let saved = store
        .load()
        .unwrap()
        .documents
        .into_iter()
        .find(|d| d.id == id)
        .unwrap();
    let workspace = saved.workspace.as_deref().unwrap();
    assert_eq!(workspace.projection, ProjectionState::Verified);
    assert_eq!(workspace.provenance, provenance);
    assert!(workspace.canonical_source().is_some());
    let saved_rich = RichDocument::from_html(&workspace.content.html).unwrap();
    assert_eq!(
        saved_rich
            .node(&[0])
            .unwrap()
            .as_element()
            .unwrap()
            .shell
            .attr("data-latex"),
        Some(raw)
    );
    assert_eq!(
        saved_rich.nodes()[1].as_element().unwrap().children,
        before.nodes()[1].as_element().unwrap().children
    );
}

#[gpui_kit::test]
fn actual_source_and_dossier_routes_retire_forms_and_return_with_fresh_visits(
    cx: &mut TestAppContext,
) {
    let (window, room, _store, _directory) = math_room(cx);
    let (editor, form) = open(cx, window, &room);
    let before = editor.read_with(cx, |editor, _| editor.snapshot());
    let visit = form.read_with(cx, |form, _| form.target().owner.generation);
    cx.update_window(window, |_, window, cx| {
        form.read(cx).input().clone().update(cx, |input, cx| {
            input.set_value("unsubmitted final!", window, cx)
        });
        room.update(cx, |room, cx| room.set_source(window, cx));
        assert!(room.read(cx).source_mode);
        assert!(form.read(cx).is_retired());
        assert!(editor.read(cx).math_source_form().is_none());
        assert_eq!(editor.read(cx).document(), &before);
        assert!(room.read(cx).math_source.owner.is_none());
        room.update(cx, |room, cx| room.set_write(window, cx));
        window.render_frame(cx);
    })
    .unwrap();
    let (same_editor, second) = open(cx, window, &room);
    assert_eq!(same_editor, editor);
    assert!(second.read_with(cx, |form, _| form.target().owner.generation) > visit);
    cx.update_window(window, |_, window, cx| {
        room.update(cx, |room, cx| room.open_dossier(window, cx));
        assert!(room.read(cx).dossier.is_some());
        assert!(second.read(cx).is_retired());
        assert_eq!(editor.read(cx).document(), &before);
        assert!(room.read(cx).math_source.owner.is_none());
    })
    .unwrap();
}
