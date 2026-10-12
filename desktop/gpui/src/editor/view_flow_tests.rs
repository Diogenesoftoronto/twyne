use super::*;
use gpui_kit::test::TestWindowExt;
use gpui_kit::{AnyWindowHandle, ScrollHandle, TestAppContext, WindowBounds, WindowOptions};

struct FlowRoom {
    editor: Entity<RichEditorView>,
    scroll: ScrollHandle,
}
impl Render for FlowRoom {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("fractional-flow-scroll")
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .child(div().w_full().p(px(40.)).child(self.editor.clone()))
    }
}

fn room(
    cx: &mut TestAppContext,
    html: &str,
    width: f32,
) -> (AnyWindowHandle, Entity<RichEditorView>, ScrollHandle) {
    let document = RichDocument::from_html(html).unwrap();
    cx.update(|cx| {
        gpui_kit::init(cx);
        theme::apply(cx).unwrap();
        let scroll = ScrollHandle::new();
        let (handle, room) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    Point::default(),
                    size(px(width + 80.), px(400.)),
                ))),
                ..Default::default()
            },
            cx,
            |_, cx| {
                cx.new(|cx| FlowRoom {
                    editor: cx.new(|cx| {
                        let mut view = RichEditorView::new(document, cx);
                        view.set_opening_initial(
                            OpeningInitial {
                                mode: InitialMode::Off,
                                ..Default::default()
                            },
                            cx,
                        );
                        view
                    }),
                    scroll: scroll.clone(),
                })
            },
        )
        .unwrap();
        (handle, room.read(cx).editor.clone(), scroll)
    })
}

fn close(actual: Pixels, expected: f32) {
    assert!(
        (f32::from(actual) - expected).abs() < 0.01,
        "{actual} != {expected}"
    );
}

#[gpui_kit::test]
fn fractional_width_wrap_threshold_uses_the_same_first_frame_scroll_extent(
    cx: &mut TestAppContext,
) {
    let (handle, view, scroll) = room(cx, "<p>Probe</p>", 704.);
    let (text, width) = cx
        .update_window(handle, |_, window, cx| {
            (2..64)
                .find_map(|length| {
                    let text = "x".repeat(length);
                    let document = RichDocument::from_html(&format!("<p>{text}</p>")).unwrap();
                    let block = document.block(&[0]).unwrap();
                    let layout = view
                        .read(cx)
                        .layout_block(&block, px(10_000.), false, window, cx);
                    let natural = layout
                        .pieces
                        .iter()
                        .map(|piece| piece.origin.x + piece.width())
                        .max_by(|left, right| left.partial_cmp(right).unwrap())
                        .unwrap();
                    let width = natural - px(0.01);
                    (window.pixel_snap(width) > natural + px(0.01)).then_some((text, width))
                })
                .expect("Need a real shaped word that crosses a native width snap")
        })
        .unwrap();
    view.update(cx, |view, cx| {
        view.set_document(
            RichDocument::from_html(&format!("<p>{text}</p>").repeat(20)).unwrap(),
            false,
            cx,
        );
    });
    cx.simulate_window_resize(handle, size(width + px(80.), px(400.)));
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let current = view.read(cx);
        let placed = current.placed.borrow();
        // The original fractional available width is below the shaped word's
        // threshold. Native wrapper snapping must not change these two rows
        // after the enclosing flow height has already been allocated.
        assert_eq!(placed[&vec![0]].layout.lines.len(), 2);
        close(placed[&vec![0]].bounds.size.width, f32::from(width));
        let natural = (0..20).fold(0., |extent, index| {
            extent + f32::from(placed[&vec![index]].bounds.size.height) + 8.1
        });
        let scale = window.scale_factor();
        close(
            scroll.max_offset().y,
            (natural * scale).ceil() / scale + 80. - 400.,
        );
        assert!(!current.can_undo());
    })
    .unwrap();
}

#[gpui_kit::test]
fn first_frame_and_resize_keep_fractional_source_metrics_and_real_heading_controls(
    cx: &mut TestAppContext,
) {
    let html = "<h1>A title</h1><p>First<br>Second<br>Third</p><p>Following<br>Second</p><h2>Heading</h2><p>Last</p>";
    let (handle, view, scroll) = room(cx, html, 704.);
    let before = view.read_with(cx, |view, _| view.snapshot());
    for width in [704., 554., 704.] {
        cx.simulate_window_resize(handle, size(px(width + 80.), px(400.)));
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let current = view.read(cx);
            let placed = current.placed.borrow();
            let expected = [
                (88., 44.),
                (172.4, 97.2),
                (277.7, 64.8),
                (378.5, 30.),
                (418.1, 32.4),
            ];
            for (index, (top, height)) in expected.into_iter().enumerate() {
                let block = placed.get(&vec![index]).unwrap();
                close(block.bounds.top(), top);
                close(block.bounds.size.height, height);
                close(block.bounds.size.width, width);
                assert_eq!(block.bounds.size, block.layout.size);
            }
            close(current.block_bounds(&[0]).unwrap().size.height, 66.4);
            close(current.block_bounds(&[3]).unwrap().top(), 378.5);
            close(scroll.max_offset().y, 99.);
            assert_eq!(current.document(), &before);
            assert!(!current.can_undo());
            drop(placed);
            // The section control remains a real focused native element, rather
            // than painted text with a replacement action dispatch path.
            window.click("twyne-section-drag-0", cx);
            window.press("enter", cx);
            assert!(view.read(cx).is_dragging());
            window.press("escape", cx);
            assert!(!view.read(cx).is_dragging());
            assert_eq!(view.read(cx).document(), &before);
            assert!(!view.read(cx).can_undo());
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn long_fractional_flow_scrolls_to_the_real_last_block_and_ime_hit_copy_undo_share_bounds(
    cx: &mut TestAppContext,
) {
    let mut html = String::new();
    for index in 0..50 {
        html.push_str(&format!("<p data-space-after=\"1\">Entry {index}</p>"));
    }
    html.push_str("<p data-space-after=\"1\"><span data-comment-id=\"tail\" data-future=\"keep\">Last 🦊é東京 ending.</span></p>");
    let (handle, view, scroll) = room(cx, &html, 704.);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let (before, tail_start, last_top, first_cached) = {
            let current = view.read(cx);
            let placed = current.placed.borrow();
            let tail = placed.get(&vec![50]).unwrap();
            close(tail.bounds.top(), 40. + 50. * (32.4 + 4. / 3.));
            let natural: f32 = 51. * (32.4 + 4. / 3.);
            let scale = window.scale_factor();
            close(
                scroll.max_offset().y,
                (natural * scale).ceil() / scale + 80. - 400.,
            );
            let start = current.document().offset_of_node(&[50]).unwrap();
            (
                current.snapshot(),
                start,
                tail.bounds.top(),
                placed[&vec![0]].layout.clone(),
            )
        };
        scroll.scroll_to_bottom();
        window.render_frame(cx);
        let (point_at, expected) = {
            let current = view.read(cx);
            let placed = current.placed.borrow();
            let tail = placed.get(&vec![50]).unwrap();
            close(tail.bounds.top(), f32::from(last_top + scroll.offset().y));
            assert!(tail.bounds.bottom() <= scroll.bounds().bottom());
            assert!(tail.bounds.top() >= scroll.bounds().top());
            let offset = 5; // Immediately before the supplementary-plane fox.
            let position = tail.layout.position(offset).unwrap();
            (
                tail.bounds.origin + position + point(px(0.01), px(4.)),
                tail_start + offset,
            )
        };
        let root = window.find("twyne-rich-manuscript").bounds().origin;
        window.click_at("twyne-rich-manuscript", point_at - root, cx);
        assert_eq!(view.read(cx).selection(), Selection::caret(expected));
        view.update(cx, |view, cx| {
            let caret = view.caret_bounds().unwrap();
            let utf16 = view.document().scalar_to_utf16(expected).unwrap();
            let ime = view
                .bounds_for_range(utf16..utf16, Bounds::default(), window, cx)
                .unwrap();
            assert_eq!(ime.origin, caret.origin);
            assert_eq!(
                view.character_index_for_point(point_at, window, cx),
                Some(utf16)
            );
            view.replace_and_mark_text_in_range(Some(utf16..utf16), "に", Some(1..1), window, cx);
            view.replace_text_in_range(None, "日本🦊", window, cx);
        });
        window.render_frame(cx);
        let current = view.read(cx);
        assert!(Arc::ptr_eq(
            &first_cached,
            &current.placed.borrow()[&vec![0]].layout
        ));
        let source = current
            .document()
            .text_in_range(tail_start..current.selection().head)
            .unwrap();
        assert_eq!(source, "Last 日本🦊");
        window.press("ctrl-z", cx);
        window.render_frame(cx);
        assert_eq!(view.read(cx).document(), &before);
        assert_eq!(view.read(cx).selection(), Selection::caret(expected));
        assert!(!view.read(cx).can_undo());
        view.update(cx, |view, cx| {
            view.set_selection(Selection::new(tail_start, tail_start + 8), cx)
                .unwrap();
        });
        window.press("ctrl-c", cx);
        assert_eq!(
            cx.read_from_clipboard().unwrap().text().as_deref(),
            Some("Last 🦊é")
        );
        assert_eq!(view.read(cx).document(), &before);
        assert!(!view.read(cx).can_undo());
        assert_eq!(
            view.read(cx).comment_anchor_bounds("tail").unwrap().len(),
            1
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn opaque_quote_list_and_table_barriers_keep_native_controls_and_cell_input_mapping(
    cx: &mut TestAppContext,
) {
    let html = "<h1>Title</h1><p data-future=\"keep\">Before</p><blockquote><p>Quote<br>Second</p></blockquote><p>After</p><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p>Task</p></li></ul><table><tr><td><p>Cell 東京</p></td><td><p>Other</p></td></tr></table><p>Tail</p>";
    let (handle, view, scroll) = room(cx, html, 704.);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let before = view.read(cx).snapshot();
        let cell = before
            .blocks()
            .into_iter()
            .find(|block| block.editing_text() == "Cell 東京")
            .unwrap();
        {
            let current = view.read(cx);
            let placed = current.placed.borrow();
            let quote = placed.get(&vec![2, 0]).unwrap();
            // The opaque quote still uses its original native measured leaf.
            // It is not accidentally given another root text-flow placement.
            let scale = window.scale_factor();
            close(quote.layout.size.height, 69.75);
            close(quote.bounds.size.height, (69.75 * scale).ceil() / scale);
            close(placed[&vec![3]].bounds.size.height, 32.4);
            close(placed[&vec![6]].bounds.size.height, 32.4);
            assert!(placed[&vec![3]].bounds.top() > current.block_bounds(&[2]).unwrap().bottom());
            assert!(placed[&vec![6]].bounds.top() >= current.block_bounds(&[5]).unwrap().bottom());
        }
        scroll.scroll_to_bottom();
        window.render_frame(cx);
        window.click("twyne-task-4.0", cx);
        assert_eq!(
            view.read(cx)
                .document()
                .node(&[4, 0])
                .unwrap()
                .as_element()
                .unwrap()
                .shell
                .attr("data-checked"),
            Some("true")
        );
        let focus = view.read(cx).focus.clone();
        window.focus(&focus, cx);
        window.press("ctrl-z", cx);
        window.render_frame(cx);
        assert_eq!(view.read(cx).document(), &before);
        let offset = cell.range.start + 5;
        let position = {
            let current = view.read(cx);
            let placed = current.placed.borrow();
            let measured = placed.get(&cell.path).unwrap();
            measured.bounds.origin + measured.layout.position(5).unwrap() + point(px(0.01), px(4.))
        };
        let root = window.find("twyne-rich-manuscript").bounds().origin;
        window.click_at("twyne-rich-manuscript", position - root, cx);
        assert_eq!(view.read(cx).selection(), Selection::caret(offset));
        window.input("に", cx);
        assert_eq!(
            view.read(cx)
                .document()
                .block(&cell.path)
                .unwrap()
                .editing_text(),
            "Cell に東京"
        );
        window.press("ctrl-z", cx);
        window.render_frame(cx);
        assert_eq!(view.read(cx).document(), &before);
        assert!(!view.read(cx).can_undo());
    })
    .unwrap();
}
