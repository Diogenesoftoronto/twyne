#!/usr/bin/env python3
"""Build two unapplied, hash-qualified Dossier presentation proposals.

Writes only this new fixture directory. It never applies a patch, invokes a
compiler, runs a native application, or updates the previous layout audit.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
VIEW = "desktop/gpui/src/dossier_view.rs"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check_inputs(bases: dict) -> list[str]:
    """Strict patch/Source bases; exact used Window API during Parent edits."""
    notices: list[str] = []
    for name, expected in bases["inspected_inputs"].items():
        data = (ROOT / name).read_bytes()
        if sha(data) == expected:
            continue
        excerpt = bases.get("public_api_excerpts", {}).get(name)
        if excerpt:
            text = data.decode()
            a = text.index(excerpt["start"])
            b = text.index(excerpt["end"], a)
            if sha(text[a:b].encode()) == excerpt["sha256"]:
                notices.append(f"NOTICE: {name} changed outside the used public layout excerpt; full-file behavior is not certified")
                continue
        raise SystemExit(f"Frozen input changed: {name}: expected {expected}, got {sha(data)}. Do not rewrite the prior checkpoint.")
    return notices


def once(text: str, before: str, after: str) -> str:
    if text.count(before) != 1:
        raise ValueError(f"Expected one exact anchor, got {text.count(before)}: {before[:90]!r}")
    return text.replace(before, after, 1)


def within(text: str, start: str, end: str, before: str, after: str) -> str:
    a = text.index(start)
    b = text.index(end, a)
    return text[:a] + once(text[a:b], before, after) + text[b:]


def local_presentation(base: str) -> str:
    text = once(base, "fn top_bar(&self, cx: &mut Context<Self>)", "fn top_bar(&self, small: bool, cx: &mut Context<Self>)")
    text = within(
        text,
        "fn top_bar(",
        "fn preview(",
        '''                    .child(
                        div()
                            .mr(px(4.))
                            .text_color(rgb(colors.ink_muted))
                            .child(tracked_typewriter("SURFACE:", 9.6, 1.728, colors.ink_muted)),
                    )''',
        '''                    .when(!small, |this| {
                        this.child(
                            div()
                                .id("dossier-surface-caption")
                                .test_support()
                                .mr(px(4.))
                                .text_color(rgb(colors.ink_muted))
                                .child(tracked_typewriter("SURFACE:", 9.6, 1.728, colors.ink_muted)),
                        )
                    })''',
    )
    text = once(text, "fn preview(&self, cx: &mut Context<Self>)", "fn preview(&self, small: bool, cx: &mut Context<Self>)")
    text = within(
        text,
        "fn preview(",
        "fn particulars_preview(",
        '''                div()
                    .mt(px(12.))
                    .grid()
                    .grid_cols(2)''',
        '''                div()
                    .id("dossier-preview-grid")
                    .test_support()
                    .mt(px(12.))
                    .grid()
                    .grid_cols(if small { 1 } else { 2 })''',
    )
    text = within(
        text,
        "fn footer(",
        "fn states_have_text(",
        '''                paper_button("dossier-back", "← Back", cx)
                    .disabled''',
        '''                paper_button("dossier-back", "← Back", cx)
                    .flex_shrink_0()
                    .disabled''',
    )
    text = within(
        text,
        "fn footer(",
        "fn states_have_text(",
        '''                div()
                    .flex()
                    .items_center()
                    .justify_center()
                    .gap(px(2.))
                    .min_w_0()''',
        '''                div()
                    .id("dossier-section-rail")
                    .test_support()
                    .role(Role::Navigation)
                    .aria_label("Folio sections")
                    .flex()
                    .items_center()
                    .justify_center()
                    .gap(px(2.))
                    .min_w_0()
                    // The stable keyed Div retains its own scroll offset.
                    // No new view/owner/atlas lease is captured by the rail.
                    .overflow_x_scroll()
                    .restrict_scroll_to_axis()''',
    )
    text = within(
        text,
        "fn footer(",
        "fn states_have_text(",
        '''                        Button::new(("dossier-section", step_index))
                            .ghost()''',
        '''                        Button::new(("dossier-section", step_index))
                            .flex_shrink_0()
                            .ghost()''',
    )
    text = within(
        text,
        "fn footer(",
        "fn states_have_text(",
        '''                Button::new("dossier-next")
                    .ghost()''',
        '''                Button::new("dossier-next")
                    .flex_shrink_0()
                    .ghost()''',
    )
    text = within(
        text,
        "impl Render for DossierView",
        '#[cfg(all(test, feature = "ui-tests"))]',
        '''        let colors = *theme::palette(cx);
        let index''',
        '''        let colors = *theme::palette(cx);
        // Tailwind's unmodified `sm` breakpoint is inclusive at 640px.
        let small = window.viewport_size().width < px(640.);
        let index''',
    )
    text = within(
        text,
        "impl Render for DossierView",
        '#[cfg(all(test, feature = "ui-tests"))]',
        '''                .min_h_0()
                .bg(rgb(colors.paper))''',
        '''                .min_h_0()
                .overflow_hidden()
                .bg(rgb(colors.paper))''',
    )
    text = once(
        text,
        '''                                .child(department(step.department, cx))
                                .child(department(format!("Folio {} of 10", index + 1), cx)),''',
        '''                                // Match the Source shrink/clip boundary.
                                // The tracked child does not implement CSS ellipsis.
                                .child(department(step.department, cx).min_w_0().overflow_hidden())
                                .child(
                                    department(format!("Folio {} of 10", index + 1), cx)
                                        .flex_shrink_0(),
                                ),''',
    )
    text = once(text, '''.child(div().mt(px(6.)).h(px(3.)).bg(rgb(colors.sidebar)).child(''', '''.child(div().mt(px(6.)).h(px(3.)).overflow_hidden().bg(rgb(colors.sidebar)).child(''')
    text = once(
        text,
        '''        let mut frame = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()''',
        '''        let mut frame = div()
            .id("dossier-frame")
            .test_support()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()''',
    )
    text = once(text, ".child(self.top_bar(cx));", ".child(self.top_bar(small, cx));")
    text = once(
        text,
        '''        frame = frame.child(
            div()
                .flex()
                .when(!wide, |this| this.flex_col())
                .flex_1()
                .min_h_0()''',
        '''        frame = frame.child(
            div()
                .id("dossier-leaf-body")
                .test_support()
                .flex()
                .when(!wide, |this| this.flex_col())
                .flex_1()
                .min_w_0()
                .min_h_0()
                .overflow_hidden()''',
    )
    text = once(text, ".child(self.preview(cx)),", ".child(self.preview(small, cx)),")
    text = once(
        text,
        '''            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(colors.paper))
            .px(px(20.))
            .py(px(16.))''',
        '''            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .bg(rgb(colors.paper))''',
    )
    text = once(
        text,
        '''                root.child(paper.background())
            })
            .child(frame)''',
        '''                root.child(paper.background())
            })
            .child(
                // Source's 92rem cap includes this wrapper's own gutters.
                // Keep full-viewport paper/leases on the outer positioned root.
                div()
                    .id("dossier-folio-wrapper")
                    .test_support()
                    .w_full()
                    .max_w(px(1472.))
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .px(px(if small { 12. } else { 20. }))
                    .py(px(if small { 12. } else { 16. }))
                    .child(frame),
            )''',
    )
    # Inside the existing UI test module, so its actual form/session helper is
    # inherited without changing visibility or adding a second test-only form.
    assert text.endswith("    }\n}\n")
    text = text[:-2] + '''
    mod layout_correction {
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/dossier-layout-correction/mounted_tests.rs"
        ));
    }
}
'''
    return text


def same_pass_candidate(presentation: str) -> str:
    """A separate opt-in proposal using actual children in one flex layout.

    No child layout is invoked in a measured callback. Child sizes and equal
    spacer allocation are solved by the real native layout tree, not a cached
    question estimate. Parent must establish min-height resolution and scroll
    extent with the authored first-frame/tall-input gates before adoption.
    """
    text = once(presentation, "    question_leaf_height: Pixels,\n    question_height: Option<(usize, Pixels)>,\n", "")
    text = once(text, "            question_leaf_height: px(0.),\n            question_height: None,\n", "")
    a = text.index("        let question_measure_view = cx.entity().downgrade();")
    b = text.index("        let question = div()", a)
    text = text[:a] + text[b:]
    text = once(text, "            .child(question_measure)\n", "")
    a = text.index("        let measure_view = cx.entity().downgrade();", text.index("impl Render for DossierView"))
    b = text.index("        let leaf =", a)
    text = text[:a] + text[b:]
    text = once(text, "                        .child(question_leaf_measure)\n", "")
    text = once(
        text,
        '''                                .id("dossier-question-scroll")
                                .overflow_y_scroll()''',
        '''                                .id("dossier-question-scroll")
                                .test_support()
                                .overflow_y_scroll()''',
    )
    text = once(
        text,
        '''                                        // Share the sheet's remaining space
                                        // equally around the natural question.
                                        // GPUI currently assigns the entire
                                        // remainder to each auto margin, so
                                        // resolve both spacers explicitly.
                                        // Long sheets still grow and scroll.
                                        .h(sheet_height)
                                        .flex()
                                        .flex_col()''',
        '''                                        // Retain this actual question child for
                                        // native layout/prepaint/paint. Two equal
                                        // flex spacers express Source's split
                                        // auto margins without learned heights.
                                        // min-height, rather than fixed height,
                                        // lets natural tall content grow/scroll.
                                        .min_h_full()
                                        .flex()
                                        .flex_col()''',
    )
    text = text.replace(".child(div().h(question_spacer_height).flex_shrink_0())", ".child(div().flex_1().min_h_0())")
    text = once(
        text,
        '''            "/fixtures/dossier-layout-correction/mounted_tests.rs"
        ));''',
        '''            "/fixtures/dossier-layout-correction/mounted_tests.rs"
        ));
        include!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/dossier-layout-correction/optional_tests.rs"
        ));''',
    )
    assert "question_spacer_height" not in text and "question_leaf_height" not in text
    return text


def diff(before: str, after: str) -> str:
    return "".join(difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True), fromfile=f"a/{VIEW}", tofile=f"b/{VIEW}"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate frozen bases/proposals without writing")
    args = parser.parse_args()
    bases_path = HERE / "patch-base.json"
    base_bytes = (ROOT / VIEW).read_bytes()
    if bases_path.exists():
        bases = json.loads(bases_path.read_text())
        for notice in check_inputs(bases):
            print(notice)
    elif args.check:
        raise SystemExit("Missing frozen patch-base.json")
    else:
        inputs = [VIEW, "src/components/onboarding/dossier-folio.tsx", "src/components/onboarding/dossier-top-bar.tsx", "src/components/onboarding/anti-tabula-rasa.tsx", "src/components/brief/dossier-preview.tsx", "src/global.css", "desktop/gpui/vendor/gpui-pre/src/elements/div.rs", "desktop/gpui/vendor/gpui-pre/src/styled.rs", "desktop/gpui/vendor/gpui-pre/src/window.rs", "desktop/gpui/vendor/gpui-pre/src/element.rs"]
        bases = {"schema": 1, "status": "unapplied", "patch_target": VIEW, "inspected_inputs": {name: sha((ROOT / name).read_bytes()) for name in inputs}}
        bases_path.write_text(json.dumps(bases, indent=2) + "\n")
    base = base_bytes.decode()
    presentation = local_presentation(base)
    optional = same_pass_candidate(presentation)
    outputs = {"integration.patch": diff(base, presentation), "optional-same-pass.patch": diff(presentation, optional)}
    for name, data in outputs.items():
        path = HERE / name
        if args.check:
            if path.read_text() != data:
                raise SystemExit(f"Frozen proposal differs: {name}")
        else:
            path.write_text(data)
    if not args.check:
        bases["proposed_view_hashes"] = {"local_presentation": sha(presentation.encode()), "local_plus_optional_same_pass": sha(optional.encode())}
        bases_path.write_text(json.dumps(bases, indent=2) + "\n")
    print("PASS: frozen source/base hashes and deterministic unapplied proposals" if args.check else "Wrote scoped unapplied proposals; native compilation/rendering remains pending")


if __name__ == "__main__":
    main()
