// Additional authored cases ONLY included by optional-same-pass.patch.
// The geometry derives from current actual child bounds, never golden font or
// question heights. These are unexecuted until Parent applies the proposal.

fn same_pass_formula(window: &Window, index: usize) {
    let leaf = window.find("dossier-question-leaf").bounds();
    let sheet = window.find("dossier-question-sheet").bounds();
    let question = window.find("dossier-active-question").bounds();
    let up = if index == 0 {
        20.
    } else {
        f32::from(window.find("dossier-ghost-above").bounds().size.height) + 24.
    };
    let down = if index == 9 {
        20.
    } else {
        f32::from(window.find("dossier-ghost-below").bounds().size.height) + 24.
    };
    let natural = f32::from(question.size.height) + up + down + 32.;
    let height = f32::from(leaf.size.height).max(natural);
    close(sheet.size.height, height, "natural-or-minimum sheet height");
    let spacer = (height - natural).max(0.) / 2.;
    close(
        question.origin.y,
        f32::from(sheet.origin.y) + 16. + up + spacer,
        "first-frame equal free space",
    );
}

#[gpui_kit::test]
fn optional_question_centers_in_the_first_draw_after_step_and_bounds_changes(
    cx: &mut TestAppContext,
) {
    let (handle, view, _directory) = form(cx, DossierOptions::default());
    for (width, height, index) in [
        (1280., 860., 0),
        (1280., 860., 2),
        (1024., 500., 1),
        (620., 860., 2),
        (1600., 860., 6),
        (1280., 860., 2),
    ] {
        resize(cx, handle, width, height);
        cx.update_window(handle, |_, window, cx| {
            view.update(cx, |view, cx| view.go_to(index, window, cx));
            // One actual draw: no settling loop or second-frame re-golden.
            window.render_frame(cx);
            same_pass_formula(window, index);
            let first = window.find("dossier-active-question").bounds();
            window.render_frame(cx);
            assert_eq!(
                window.find("dossier-active-question").bounds(),
                first,
                "centering cannot need a paint-time measurement notification"
            );
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn optional_tall_sheet_uses_native_scroll_and_retained_unblurred_input(cx: &mut TestAppContext) {
    let (handle, view, _directory) = form(cx, DossierOptions::default());
    resize(cx, handle, 1280., 360.);
    cx.update_window(handle, |_, window, cx| {
        view.update(cx, |view, cx| view.go_to(8, window, cx));
        window.render_frame(cx);
        same_pass_formula(window, 8);
        let leaf = window.find("dossier-question-leaf").bounds();
        let sheet = window.find("dossier-question-sheet").bounds();
        assert!(
            sheet.size.height > leaf.size.height + px(30.),
            "fixture must really require scrolling"
        );
        let question_before = window.find("dossier-active-question").bounds();
        window.scroll(
            "dossier-question-scroll",
            ScrollDelta::Pixels(point(px(0.), px(-80.))),
            cx,
        );
        let question_after = window.find("dossier-active-question").bounds();
        assert!(
            question_after.origin.y < question_before.origin.y,
            "actual leaf wheel translates the retained child"
        );
        let input = window.find("dossier-prior-material").bounds();
        let overlap = input.intersect(&leaf);
        assert!(overlap.size.width > px(1.) && overlap.size.height > px(1.));
        let click = overlap.center() - input.origin;
        window.click_at("dossier-prior-material", click, cx);
        window.press("secondary-a", cx);
        window.input("Retained unblurred material café 東京!", cx);
        assert_eq!(
            view.read(cx).prior_material.read(cx).text().to_string(),
            "Retained unblurred material café 東京!"
        );
        view.update(cx, |view, cx| view.go_to(9, window, cx));
        assert_eq!(
            view.read(cx).session.draft.prior_material.text,
            "Retained unblurred material café 東京!"
        );
    })
    .unwrap();
}
