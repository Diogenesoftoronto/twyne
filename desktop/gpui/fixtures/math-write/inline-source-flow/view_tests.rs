//! Authored mounted tests, unrun by this worker. The real retained form and
//! rich input/layout paths are exercised; unavailable preview/preflight stays
//! unavailable. These checks do not certify browser or KaTeX geometry.

use super::*;
use gpui_kit::test::TestWindowExt;
use gpui_kit::{AnyWindowHandle, AppContext, TestAppContext, WindowBounds, WindowOptions};

const HTML: &str = "<p data-future=\"paragraph\">Before 🦊 é <span data-type=\"inline-math\" data-latex=\" x + y \" data-future=\"equation\"> x + y </span> after 東京, punctuation, and a following phrase.</p><p data-future=\"untouched\">This paragraph keeps its cached layout.</p>";
const PATH: &[usize] = &[0, 1];

struct FlowRoom(Entity<RichEditorView>);
impl Render for FlowRoom {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().p(px(24.)).child(self.0.clone())
    }
}

fn room(
    cx: &mut TestAppContext,
    html: &str,
    width: f32,
) -> (AnyWindowHandle, Entity<RichEditorView>) {
    let document = RichDocument::from_html(html).unwrap();
    cx.update(|cx| {
        gpui_kit::init(cx);
        theme::apply(cx).unwrap();
        let (window, paper) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    Point::default(),
                    size(px(width), px(800.)),
                ))),
                ..Default::default()
            },
            cx,
            |_, cx| {
                cx.new(|cx| {
                    FlowRoom(cx.new(|cx| {
                        let mut view = RichEditorView::new(document, cx);
                        view.set_opening_initial(
                            OpeningInitial {
                                mode: InitialMode::Off,
                                ..Default::default()
                            },
                            cx,
                        );
                        let mut context = MathSourceHostContext::new("inline-flow-folio", 23);
                        // This fixture applies the actual new child/layout patch.
                        // There is deliberately no renderer or canonical callback.
                        context.inline_form_in_flow = true;
                        view.set_math_source_context(Some(context), cx);
                        view
                    }))
                })
            },
        )
        .unwrap();
        (window, paper.read(cx).0.clone())
    })
}

fn frames(cx: &mut TestAppContext, window: AnyWindowHandle) {
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        for _ in 0..3 {
            window.simulate_next_frame(cx);
            window.render_frame(cx);
        }
    })
    .unwrap();
    cx.run_until_parked();
}

fn open(
    cx: &mut TestAppContext,
    window: AnyWindowHandle,
    view: &Entity<RichEditorView>,
) -> Entity<MathSourceEditorView> {
    cx.update_window(window, |_, window, cx| {
        view.update(cx, |view, cx| {
            assert!(view.open_math_source_at(PATH.to_vec(), window, cx).unwrap());
        });
    })
    .unwrap();
    frames(cx, window);
    view.read_with(cx, |view, _| view.math_source_form().unwrap())
}

fn cached<C: AppContext>(
    view: &Entity<RichEditorView>,
    path: &[usize],
    cx: &C,
) -> Arc<ParagraphLayout> {
    view.read_with(cx, |view, _| {
        view.placed.borrow().get(path).unwrap().layout.clone()
    })
}

fn close(actual: Pixels, expected: Pixels) {
    assert!(
        (actual - expected).abs() < px(0.01),
        "{actual} != {expected}"
    );
}

#[gpui_kit::test]
fn inline_form_is_a_real_measured_child_and_one_source_scalar(cx: &mut TestAppContext) {
    let (window, view) = room(cx, HTML, 720.);
    frames(cx, window);
    let original = view.read_with(cx, |view, _| view.snapshot());
    let revision = view.read_with(cx, |view, _| view.revision());
    let untouched = cached(&view, &[1], cx);
    let closed = cached(&view, &[0], cx);
    let form = open(cx, window, &view);
    cx.update_window(window, |_, window, cx| {
        let editor = view.read(cx);
        let target = form.read(cx).target();
        assert!(
            target
                .expected
                .shares_storage_with(original.node(PATH).unwrap())
        );
        assert_eq!(editor.document().to_html(), original.to_html());
        assert_eq!(editor.revision(), revision);
        assert_eq!(
            editor.selection().range(),
            target.position..target.position + 1
        );
        let layout = cached(&view, &[0], cx);
        let piece = layout
            .pieces
            .iter()
            .find(|piece| piece.math_form.is_some())
            .unwrap();
        let slot = piece.math_form.as_ref().unwrap();
        let measured = editor.inline_math_form_bounds().unwrap();
        let actual_child = window.find("twyne-math-source-editor").bounds();
        assert_eq!(actual_child, window.pixel_snap_bounds(measured));
        let placed = editor.placed.borrow();
        let block = &placed[&vec![0]];
        assert_eq!(piece.range.end - piece.range.start, 1);
        assert!(!piece.whitespace);
        assert!(piece.image.is_none());
        close(piece.width(), measured.size.width);
        close(measured.size.height, slot.measured.size.height);
        close(measured.left(), block.bounds.left() + piece.origin.x);
        close(measured.top(), block.bounds.top() + piece.origin.y);
        assert!(layout.size.height > closed.size.height);
        assert!(measured.bottom() <= block.bounds.bottom() + px(0.01));
        assert!(form.read(cx).input().focus_handle(cx).is_focused(window));
        assert!(Arc::ptr_eq(&untouched, &cached(&view, &[1], cx)));
    })
    .unwrap();
}

#[gpui_kit::test]
fn form_resize_reflows_prose_with_the_same_caret_hit_and_ime_plan(cx: &mut TestAppContext) {
    let (window, view) = room(cx, HTML, 720.);
    let form = open(cx, window, &view);
    let original = view.read_with(cx, |view, _| view.document().to_html());
    let wide = cached(&view, &[0], cx);
    let wide_box = view.read_with(cx, |view, _| view.inline_math_form_bounds().unwrap());
    cx.simulate_window_resize(window, size(px(380.), px(800.)));
    frames(cx, window);
    cx.update_window(window, |_, window, cx| {
        let expected_endpoints = {
            let editor = view.read(cx);
            let narrow = cached(&view, &[0], cx);
            let bounds = editor.inline_math_form_bounds().unwrap();
            assert!(bounds.size.width < wide_box.size.width);
            assert!(!Arc::ptr_eq(&wide, &narrow));
            assert_eq!(editor.document().to_html(), original);
            assert_eq!(
                form.read(cx).target().position,
                editor.selection().range().start
            );
            let placed = editor.placed.borrow();
            let block = &placed[&vec![0]];
            let piece = narrow
                .pieces
                .iter()
                .find(|piece| piece.math_form.is_some())
                .unwrap();
            let line = &narrow.lines[piece.line];
            assert!(line.height >= bounds.size.height);
            [piece.range.start, piece.range.end]
                .into_iter()
                .map(|relative| {
                    let position = narrow.position(relative).unwrap();
                    let height = narrow.line_height_at(relative);
                    assert!(height < bounds.size.height);
                    assert_eq!(narrow.index(position + point_for_hit(height)), relative);
                    let scalar = block_start(editor.document(), &[0]) + relative;
                    let utf16 = editor.document().scalar_to_utf16(scalar).unwrap();
                    (
                        utf16,
                        Bounds::new(block.bounds.origin + position, size(px(1.4), height)),
                    )
                })
                .collect::<Vec<_>>()
        };
        for (utf16, expected) in expected_endpoints {
            let actual = view.update(cx, |editor, cx| {
                editor
                    .bounds_for_range(utf16..utf16, Bounds::default(), window, cx)
                    .unwrap()
            });
            close(actual.top(), expected.top());
            close(actual.left(), expected.left());
            close(actual.size.height, expected.size.height);
        }
    })
    .unwrap();
}

fn point_for_hit(height: Pixels) -> Point<Pixels> {
    point(px(0.), height / 2.)
}

fn block_start(document: &RichDocument, path: &[usize]) -> usize {
    document.offset_of_node(path).unwrap()
}

#[gpui_kit::test]
fn field_input_and_error_height_keep_unchanged_paragraph_arcs(cx: &mut TestAppContext) {
    let (window, view) = room(cx, HTML, 720.);
    let form = open(cx, window, &view);
    let source = view.read_with(cx, |view, _| view.document().to_html());
    let untouched = cached(&view, &[1], cx);
    let before_input = cached(&view, &[0], cx);
    cx.update_window(window, |_, window, cx| window.input(" raw 🦊 é ", cx))
        .unwrap();
    frames(cx, window);
    assert_eq!(
        view.read_with(cx, |view, _| view.document().to_html()),
        source
    );
    assert!(Arc::ptr_eq(&before_input, &cached(&view, &[0], cx)));
    assert!(Arc::ptr_eq(&untouched, &cached(&view, &[1], cx)));
    let before_error = view.read_with(cx, |view, _| view.inline_math_form_bounds().unwrap());
    form.update(cx, |form, cx| {
        form.submit(cx).unwrap();
    });
    frames(cx, window);
    let error_box = view.read_with(cx, |view, _| view.inline_math_form_bounds().unwrap());
    assert!(error_box.size.height > before_error.size.height);
    assert_eq!(
        view.read_with(cx, |view, _| view.document().to_html()),
        source
    );
    assert!(view.read_with(cx, |view, _| view.math_source_form().is_some()));
    assert!(Arc::ptr_eq(&untouched, &cached(&view, &[1], cx)));
    let accepted_height = cached(&view, &[0], cx);
    for _ in 0..4 {
        frames(cx, window);
    }
    assert!(Arc::ptr_eq(&accepted_height, &cached(&view, &[0], cx)));
}

#[gpui_kit::test]
fn cancel_preserves_raw_node_history_and_neighbor_unicode_edits(cx: &mut TestAppContext) {
    let (window, view) = room(cx, HTML, 720.);
    let original = view.read_with(cx, |view, _| view.snapshot());
    let form = open(cx, window, &view);
    let position = form.read_with(cx, |form, _| form.target().position);
    let selected = view.read_with(cx, |view, _| view.selection());
    let history = view.read_with(cx, |view, _| (view.can_undo(), view.can_redo()));
    cx.update_window(window, |_, window, cx| {
        window.input("invalid { 🦊 é", cx);
        window.press("escape", cx);
    })
    .unwrap();
    frames(cx, window);
    assert!(form.read_with(cx, |form, _| form.is_retired()));
    assert!(view.read_with(cx, |view, _| view.math_source_form().is_none()));
    assert!(view.read_with(cx, |view, _| view.inline_math_form_bounds().is_none()));
    assert_eq!(
        view.read_with(cx, |view, _| view.document().to_html()),
        original.to_html()
    );
    assert_eq!(view.read_with(cx, |view, _| view.selection()), selected);
    assert_eq!(
        view.read_with(cx, |view, _| (view.can_undo(), view.can_redo())),
        history
    );
    cx.update_window(window, |_, window, cx| {
        view.update(cx, |editor, cx| {
            editor
                .set_selection(Selection::caret(position + 1), cx)
                .unwrap();
            editor.replace_text_in_range(None, "🧪é", window, cx);
            assert!(
                editor
                    .document()
                    .node(PATH)
                    .unwrap()
                    .shares_storage_with(original.node(PATH).unwrap())
            );
            editor.execute(Command::Undo, window, cx).unwrap();
            assert_eq!(editor.document().to_html(), original.to_html());
            assert_eq!(editor.selection(), Selection::caret(position + 1));
        });
    })
    .unwrap();
}

#[gpui_kit::test]
fn replaced_owner_drops_the_form_without_filing_pending_raw(cx: &mut TestAppContext) {
    let (window, view) = room(cx, HTML, 720.);
    let form = open(cx, window, &view);
    let source = view.read_with(cx, |view, _| view.document().to_html());
    cx.update_window(window, |_, window, cx| {
        window.input("unsubmitted replacement", cx);
    })
    .unwrap();
    view.update(cx, |view, cx| {
        let context = MathSourceHostContext::new("different-folio", 24);
        view.set_math_source_context(Some(context), cx);
    });
    frames(cx, window);
    assert!(form.read_with(cx, |form, _| form.is_retired()));
    assert!(view.read_with(cx, |view, _| view.inline_math_form_bounds().is_none()));
    assert_eq!(
        view.read_with(cx, |view, _| view.document().to_html()),
        source
    );
    assert!(!view.read_with(cx, |view, _| view.can_undo()));
    assert!(form.update(cx, |form, cx| form.submit(cx)).is_none());
}

#[gpui_kit::test]
fn paginated_frame_tracks_measured_form_height_without_perpetual_reflow(cx: &mut TestAppContext) {
    use crate::workspace::{LayoutSettings, PaginationMode};
    let (window, view) = room(cx, HTML, 720.);
    let events = Rc::new(RefCell::new(Vec::new()));
    let received = events.clone();
    let _subscription = cx.update(|cx| {
        cx.subscribe(&view, move |_, event: &RichEditorEvent, _| {
            if let RichEditorEvent::PaginationChanged { generation } = event {
                received.borrow_mut().push(*generation);
            }
        })
    });
    view.update(cx, |view, cx| {
        view.set_pagination_layout(
            Some(LayoutSettings {
                pagination: Some(PaginationMode::Paginated),
                margin_top: Some(20.),
                margin_bottom: Some(20.),
                ..Default::default()
            }),
            672.,
            0.,
            cx,
        );
    });
    let form = open(cx, window, &view);
    let original = view.read_with(cx, |view, _| view.document().to_html());
    let untouched = cached(&view, &[1], cx);
    let before = view.read_with(cx, |view, _| {
        assert!(view.pagination_info().unwrap().active);
        view.pagination_placement().unwrap()
    });
    form.update(cx, |form, cx| {
        form.submit(cx).unwrap();
    });
    frames(cx, window);
    let after = view.read_with(cx, |view, _| view.pagination_placement().unwrap());
    assert!(!Arc::ptr_eq(&before, &after));
    assert!(after.rendered_tops[1] > before.rendered_tops[1]);
    assert!(Arc::ptr_eq(&untouched, &cached(&view, &[1], cx)));
    let settled_events = events.borrow().len();
    for _ in 0..4 {
        frames(cx, window);
    }
    let idle = view.read_with(cx, |view, _| view.pagination_placement().unwrap());
    assert!(Arc::ptr_eq(&after, &idle));
    assert_eq!(events.borrow().len(), settled_events);
    assert_eq!(
        view.read_with(cx, |view, _| view.document().to_html()),
        original
    );
}
