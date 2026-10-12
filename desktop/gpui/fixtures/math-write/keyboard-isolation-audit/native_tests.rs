//! Authored, uncompiled mounted regressions. Include as a child of the actual
//! view_math_source::tests module; its real room/open helpers are reused.
//! Explicit rich-action dispatch tests a defensive action boundary, not an
//! additional observed stock-chord leak. No OS/browser acceptance is claimed.
use super::*;
use crate::editor::view as rich;
use gpui_kit::{Action, ClipboardItem};
use std::ops::Range;

struct ManuscriptState {
    document: RichDocument,
    selection: Selection,
    revision: u64,
    marks: Vec<Mark>,
    can_undo: bool,
    can_redo: bool,
    typing: bool,
    marked: Option<Range<usize>>,
}

impl ManuscriptState {
    fn capture(view: &Entity<RichEditorView>, cx: &App) -> Self {
        let view = view.read(cx);
        Self {
            document: view.snapshot(),
            selection: view.selection(),
            revision: view.revision(),
            marks: view.active_marks(),
            can_undo: view.can_undo(),
            can_redo: view.can_redo(),
            typing: view.typing_group.is_some(),
            marked: view.marked_range.clone(),
        }
    }

    fn verify(&self, view: &Entity<RichEditorView>, cx: &App, action: &str) {
        let view = view.read(cx);
        assert_eq!(view.document(), &self.document, "document: {action}");
        assert_eq!(view.selection(), self.selection, "selection: {action}");
        assert_eq!(view.revision(), self.revision, "revision: {action}");
        assert_eq!(view.active_marks(), self.marks, "marks: {action}");
        assert_eq!(
            view.can_undo(),
            self.can_undo,
            "Undo availability: {action}"
        );
        assert_eq!(
            view.can_redo(),
            self.can_redo,
            "Redo availability: {action}"
        );
        assert_eq!(
            view.typing_group.is_some(),
            self.typing,
            "typing group: {action}"
        );
        assert_eq!(view.marked_range, self.marked, "composition: {action}");
    }
}

fn seed_redo(cx: &mut TestAppContext, window: AnyWindowHandle, view: &Entity<RichEditorView>) {
    cx.update_window(window, |_, window, cx| {
        view.update(cx, |view, cx| {
            let expected = view.document().node(&[0]).unwrap().clone();
            view.execute(
                Command::UpdateMathSource {
                    path: vec![0],
                    expected,
                    source: "earlier accepted source".into(),
                },
                window,
                cx,
            )
            .unwrap();
            view.execute(Command::Undo, window, cx).unwrap();
            assert!(view.can_redo());
        });
    })
    .unwrap();
}

fn rich_actions() -> Vec<(&'static str, Box<dyn Action>)> {
    macro_rules! actions {
        ($($action:ident),* $(,)?) => {
            vec![$((stringify!($action), Box::new(rich::$action) as Box<dyn Action>)),*]
        };
    }
    actions![
        Backspace,
        Delete,
        Left,
        Right,
        Up,
        Down,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        WordLeft,
        WordRight,
        SelectWordLeft,
        SelectWordRight,
        DeleteWordBackward,
        DeleteWordForward,
        Home,
        End,
        SelectHome,
        SelectEnd,
        DocumentStart,
        DocumentEnd,
        SelectAll,
        Enter,
        HardBreak,
        Copy,
        Cut,
        Paste,
        Undo,
        Redo,
        Bold,
        Italic,
        Underline,
        Indent,
        Outdent,
    ]
}

#[gpui_kit::test]
fn source_field_stock_keys_keep_movement_selection_and_clipboard_inside_the_field(
    cx: &mut TestAppContext,
) {
    let (window, view, calls) = room(cx, true);
    seed_redo(cx, window, &view);
    let form = open(cx, window, &view);
    let before = cx.update(|cx| ManuscriptState::capture(&view, cx));
    let modifier = if cfg!(target_os = "macos") {
        "cmd"
    } else {
        "ctrl"
    };
    cx.update_window(window, |_, window, cx| {
        assert!(form.focus_handle(cx).is_focused(window));
        window.input("前🦊 é", cx);
        let raw = form.read(cx).raw_source(cx);
        for key in [
            "left",
            "right",
            "shift-left",
            "shift-right",
            "up",
            "down",
            "shift-up",
            "shift-down",
            "home",
            "end",
            "shift-home",
            "shift-end",
        ] {
            window.press(key, cx);
            before.verify(&view, cx, key);
            assert_eq!(form.read(cx).raw_source(cx), raw, "field raw: {key}");
            assert_eq!(view.read(cx).math_source_form().as_ref(), Some(&form));
        }
        for key in ["b", "i", "u"] {
            window.press(&format!("{modifier}-{key}"), cx);
            before.verify(&view, cx, key);
            assert_eq!(form.read(cx).raw_source(cx), raw);
        }
        window.press(&format!("{modifier}-a"), cx);
        let input = form.read(cx).input().clone();
        assert_eq!(input.read(cx).selected_range(), 0..raw.len());
        window.press(&format!("{modifier}-c"), cx);
        assert_eq!(
            cx.read_from_clipboard().unwrap().text().as_deref(),
            Some(raw.as_ref())
        );
        window.press(&format!("{modifier}-x"), cx);
        assert_eq!(&*form.read(cx).raw_source(cx), "");
        window.press(&format!("{modifier}-v"), cx);
        assert_eq!(form.read(cx).raw_source(cx), raw);
        before.verify(&view, cx, "field Copy/Cut/Paste");
        assert!(form.focus_handle(cx).is_focused(window));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    })
    .unwrap();
}

#[gpui_kit::test]
fn source_field_tab_and_shift_tab_leave_raw_source_and_manuscript_history_unchanged(
    cx: &mut TestAppContext,
) {
    let (window, view, calls) = room(cx, true);
    seed_redo(cx, window, &view);
    let form = open(cx, window, &view);
    cx.update_window(window, |_, window, cx| {
        window.input("\n    \\frac{🦊}{é}", cx);
        let raw = form.read(cx).raw_source(cx);
        let before = ManuscriptState::capture(&view, cx);
        window.press("tab", cx);
        window.render_frame(cx);
        assert_eq!(window.find("twyne-math-source-save").focused(), Some(true));
        assert_eq!(form.read(cx).raw_source(cx), raw);
        before.verify(&view, cx, "textarea Tab");
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        // Re-enter the actual field explicitly. Full Source's button Tab is a
        // separate global-catalogue exception; this gate does not re-golden it
        // as browser button-to-button traversal.
        let focus = form.focus_handle(cx);
        window.focus(&focus, cx);
        window.render_frame(cx);
        window.press("shift-tab", cx);
        window.render_frame(cx);
        assert!(!form.focus_handle(cx).is_focused(window));
        assert_eq!(form.read(cx).raw_source(cx), raw);
        before.verify(&view, cx, "textarea ShiftTab");
        assert_eq!(view.read(cx).math_source_form().as_ref(), Some(&form));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    })
    .unwrap();
}

#[gpui_kit::test]
fn source_field_explicit_rich_actions_refuse_before_selection_history_or_clipboard_side_effects(
    cx: &mut TestAppContext,
) {
    let (window, view, calls) = room(cx, true);
    seed_redo(cx, window, &view);
    let form = open(cx, window, &view);
    let (before, raw) = cx
        .update_window(window, |_, window, cx| {
            window.input(" unsaved 🦊 é", cx);
            cx.write_to_clipboard(ClipboardItem::new_string("clipboard sentinel".into()));
            (
                ManuscriptState::capture(&view, cx),
                form.read(cx).raw_source(cx),
            )
        })
        .unwrap();
    for (name, action) in rich_actions() {
        cx.update_window(window, |_, window, cx| {
            assert!(form.focus_handle(cx).is_focused(window), "before {name}");
            window.dispatch_action(action, cx);
        })
        .unwrap();
        // Window::dispatch_action is deferred. Checking before effect delivery
        // would make the direct-bypass test vacuous.
        cx.run_until_parked();
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            before.verify(&view, cx, name);
            assert_eq!(form.read(cx).raw_source(cx), raw, "field raw: {name}");
            assert_eq!(
                view.read(cx).math_source_form().as_ref(),
                Some(&form),
                "form: {name}"
            );
            assert_eq!(
                cx.read_from_clipboard().unwrap().text().as_deref(),
                Some("clipboard sentinel"),
                "clipboard: {name}"
            );
            assert!(form.focus_handle(cx).is_focused(window), "focus: {name}");
            assert_eq!(calls.load(Ordering::SeqCst), 0, "preflight: {name}");
        })
        .unwrap();
    }
    cx.update_window(window, |_, _, cx| {
        form.update(cx, |form, cx| {
            form.cancel(MathSourceCancelReason::CancelButton, cx)
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        assert!(view.read(cx).math_source_form().is_none());
        // Actually consume the retained manuscript redo/undo entries instead
        // of asserting availability flags alone.
        view.update(cx, |view, cx| {
            view.execute(Command::Redo, window, cx).unwrap();
            assert_eq!(
                view.document()
                    .node(&[0])
                    .unwrap()
                    .as_element()
                    .unwrap()
                    .shell
                    .attr("data-latex"),
                Some("earlier accepted source")
            );
            view.execute(Command::Undo, window, cx).unwrap();
            assert_eq!(view.document(), &before.document);
        });
    })
    .unwrap();
}
