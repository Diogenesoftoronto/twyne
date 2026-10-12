use super::*;
use crate::app::tests::expanded_room;
use gpui_kit::test::TestWindowExt;
use gpui_kit::{TestAppContext, size};

#[gpui_kit::test]
fn manuscript_title_centers_each_wrapped_row_and_keeps_caret_with_its_glyphs(
    cx: &mut TestAppContext,
) {
    let (handle, view, _store, _directory) = expanded_room(cx);
    cx.simulate_window_resize(handle, size(px(768.), px(640.)));
    cx.run_until_parked();
    let text = "A long manuscript heading that wraps over multiple visual rows to exercise independent row alignment\nÀgyp";
    let short_start = text.rfind('\n').unwrap() + 1;
    cx.update_window(handle, |_, window, cx| {
        view.read(cx).title.clone().update(cx, |title, cx| {
            title.set_value(text, window, cx);
            title.set_selected_range(short_start..short_start, cx);
            title.focus(window, cx);
        });
        window.render_frame(cx);
        window.render_frame(cx);
        let title = view.read(cx).title.read(cx);
        let glyphs = title.range_to_bounds(&(short_start..text.len())).unwrap();
        let caret = title.cursor_layout().unwrap().0;
        assert!(title.input_bounds().size.height >= px(132.));
        assert!(
            (glyphs.center().x - title.input_bounds().center().x).abs() < px(3.),
            "{glyphs:?}, input {:?}",
            title.input_bounds()
        );
        assert!(
            (caret.left() - glyphs.left()).abs() < px(3.),
            "{caret:?}, glyphs {glyphs:?}"
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn manuscript_title_wraps_and_keyboard_navigation_preserves_the_draft(cx: &mut TestAppContext) {
    let (handle, view, store, _directory) = expanded_room(cx);
    let first_line = "  Àgyp — L'été à 東京 🦊 with a title long enough to wrap across the manuscript instead of disappearing into a single-line field  ";
    let title = format!("{first_line}\nSecond title line");
    let body = "# First page\n\nA manuscript with café and 🦀.\nExact whitespace  stays.";
    cx.simulate_window_resize(handle, size(px(768.), px(640.)));
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(
            window.find("manuscript-title").visible(),
            "title {:?}, page {:?}, window {:?}, offset {:?}",
            window.find("manuscript-title").bounds(),
            window.find("manuscript-page").bounds(),
            window.viewport_size(),
            view.read(cx).writing_scroll.offset()
        );
        window.click("manuscript-title", cx);
        window.input(first_line, cx);
        // Auto-grow follows the shaped line count, including soft wraps.
        window.render_frame(cx);
        window.render_frame(cx);
        let title_bounds = window.find("manuscript-title").bounds();
        assert!(title_bounds.size.height >= px(88.), "{title_bounds:?}");
        assert!(window.find("body-field").bounds().top() > title_bounds.bottom());
        window.press("shift-enter", cx);
        assert!(
            view.read(cx)
                .title
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
        window.input("Second title line", cx);
        window.press("enter", cx);
        assert_eq!(view.read(cx).title.read(cx).value().as_ref(), title);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        assert!(
            view.read(cx)
                .body
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
        assert_eq!(view.read(cx).title.read(cx).value().as_ref(), title);
        window.input(body, cx);
        // Selection and edits remain native input operations; Up only
        // crosses the page boundary when the body caret is at its start.
        view.read(cx)
            .body
            .clone()
            .update(cx, |body, cx| body.set_selected_range(0..0, cx));
        window.press("up", cx);
        assert!(
            view.read(cx)
                .title
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
        assert_eq!(
            view.read(cx).title.read(cx).selected_range(),
            title.len()..title.len()
        );
        window.press("enter", cx);
        window.press("ctrl-s", cx);
        assert_eq!(window.find("save-status").label(), Some("Saved locally"));
    })
    .unwrap();
    let saved = store.load().unwrap().documents.remove(0);
    assert_eq!(saved.title, title);
    assert_eq!(saved.body, body);
    assert!(saved.workspace.is_none());
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| room.install_active_document(window, cx));
        window.render_frame(cx);
        assert_eq!(view.read(cx).active, saved.id);
        assert_eq!(view.read(cx).title.read(cx).value().as_ref(), title);
        assert_eq!(view.read(cx).body.read(cx).value().as_ref(), body);
    })
    .unwrap();
}

#[gpui_kit::test]
fn manuscript_title_and_body_share_one_scroll_and_reveal_the_focused_caret(
    cx: &mut TestAppContext,
) {
    let (handle, view, _store, _directory) = expanded_room(cx);
    cx.simulate_window_resize(handle, size(px(768.), px(640.)));
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |room, cx| {
            room.title
                .update(cx, |title, cx| title.set_value("Àgyp", window, cx));
            room.body.update(cx, |body, cx| {
                body.set_value("A full line of writing.\n".repeat(40), window, cx)
            });
        });
        window.render_frame(cx);
        window.render_frame(cx);
        let before = window.find("manuscript-title").bounds();
        assert_eq!(before.size.height, px(44.));
        view.read(cx)
            .writing_scroll
            .set_offset(gpui_kit::point(px(0.), px(-60.)));
        window.render_frame(cx);
        let after = window.find("manuscript-title").bounds();
        assert!((before.top() - after.top() - px(60.)).abs() < px(1.));
        view.update(cx, |room, cx| {
            room.title.update(cx, |title, cx| {
                title.set_selected_range(0..0, cx);
                title.focus(window, cx);
            });
            room.reveal_caret_next_frame(window, cx);
        });
        for _ in 0..3 {
            window.simulate_next_frame(cx);
            window.render_frame(cx);
        }
        let room = view.read(cx);
        let caret = room.title.read(cx).cursor_layout().unwrap().0;
        let viewport = room.writing_scroll.bounds();
        assert!(
            caret.top() >= viewport.top(),
            "caret {caret:?}, viewport {viewport:?}, offset {:?}",
            room.writing_scroll.offset()
        );
        assert!(
            caret.bottom() <= viewport.bottom(),
            "caret {caret:?}, viewport {viewport:?}"
        );
        assert_eq!(room.title.read(cx).cursor_layout().unwrap().1, px(44.));
        let title = room.title.read(cx);
        let glyphs = title.range_to_bounds(&(0..title.text().len())).unwrap();
        assert!(
            (glyphs.center().x - title.input_bounds().center().x).abs() < px(3.),
            "glyphs {glyphs:?}, input {:?}",
            title.input_bounds()
        );
        assert!(room.body.read(cx).input_bounds().size.height > viewport.size.height);
    })
    .unwrap();
}
