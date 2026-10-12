#!/usr/bin/env python3
"""Read-only static integrity/source-contract checks; never UI acceptance."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
VIEW = "desktop/gpui/src/dossier_view.rs"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def apply_memory(before: str, patch: str) -> str:
    """Require exact hunk positions and bytes; do not silently offset/fuzz."""
    lines = patch.splitlines(keepends=True)
    require(lines[:2] == [f"--- a/{VIEW}\n", f"+++ b/{VIEW}\n"], "Unexpected patch target")
    source = before.splitlines(keepends=True)
    result: list[str] = []
    cursor = 0
    i = 2
    while i < len(lines):
        header = re.fullmatch(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\n", lines[i])
        require(header is not None, f"Bad hunk header {lines[i]!r}")
        start = int(header.group(1)) - 1
        require(start >= cursor, "Overlapping hunks")
        result.extend(source[cursor:start])
        cursor = start
        i += 1
        old_count = new_count = 0
        while i < len(lines) and not lines[i].startswith("@@ "):
            line = lines[i]
            require(line[:1] in {" ", "+", "-"}, "Unsupported patch line")
            body = line[1:]
            if line[0] in {" ", "-"}:
                require(cursor < len(source) and source[cursor] == body, "Hunk does not match frozen input")
                cursor += 1
                old_count += 1
            if line[0] in {" ", "+"}:
                result.append(body)
                new_count += 1
            i += 1
        require(old_count == int(header.group(2) or 1), "Incorrect removed hunk count")
        require(new_count == int(header.group(4) or 1), "Incorrect added hunk count")
    result.extend(source[cursor:])
    return "".join(result)


def chunk(text: str, start: str, end: str) -> str:
    a = text.index(start)
    return text[a:text.index(end, a)]


def syntax(name: str, content: str) -> None:
    # Rustfmt parses source from stdin and emits stdout. No existing runtime
    # file is supplied/written, and skip_children prevents module traversal.
    completed = subprocess.run(
        ["rtk", "proxy", "rustfmt", "--edition", "2024", "--config", "skip_children=true", "--emit", "stdout"],
        input=content,
        text=True,
        capture_output=True,
        check=False,
    )
    require(completed.returncode == 0, f"Rust syntax failed for {name}: {completed.stderr}")


def main() -> None:
    bases = json.loads((HERE / "patch-base.json").read_text())
    for name, excerpt in bases.get("public_api_excerpts", {}).items():
        source = (ROOT / name).read_text()
        a = source.index(excerpt["start"])
        b = source.index(excerpt["end"], a)
        require(hashlib.sha256(source[a:b].encode()).hexdigest() == excerpt["sha256"], f"Public layout API excerpt drift: {name}")
    for name, expected in bases["inspected_inputs"].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            require(name in bases.get("public_api_excerpts", {}), f"Inspected input drift: {name}")
            print(f"NOTICE: {name} changed outside the used public layout excerpt; full-file behavior is not certified")
    base = (ROOT / VIEW).read_text()
    local = apply_memory(base, (HERE / "integration.patch").read_text())
    optional = apply_memory(local, (HERE / "optional-same-pass.patch").read_text())
    require(hashlib.sha256(local.encode()).hexdigest() == bases["proposed_view_hashes"]["local_presentation"], "Local proposal hash differs")
    require(hashlib.sha256(optional.encode()).hexdigest() == bases["proposed_view_hashes"]["local_plus_optional_same_pass"], "Optional proposal hash differs")

    # Protect real resource ownership and mutation paths, not a mock state.
    before_bar = chunk(base, "//!", "    fn top_bar(")
    require(chunk(local, "//!", "    fn top_bar(") == before_bar, "Local proposal changed constructor/model/filing/import/lifecycle code")
    optional_before_bar = before_bar.replace("    question_leaf_height: Pixels,\n    question_height: Option<(usize, Pixels)>,\n", "").replace("            question_leaf_height: px(0.),\n            question_height: None,\n", "")
    require(chunk(optional, "//!", "    fn top_bar(") == optional_before_bar, "Optional proposal changed anything beyond its two retired measurement fields")
    for proposed in (local, optional):
        require(chunk(proposed, "    fn particulars_preview(", "    fn footer(") == chunk(base, "    fn particulars_preview(", "    fn footer("), "Question/input/prior material/probe callbacks changed")
        require(chunk(proposed, "fn states_have_text(", "impl Render for DossierView") == chunk(base, "fn states_have_text(", "impl Render for DossierView"), "Font/button/input-outline helper changed")
        require(chunk(proposed, "            .on_action(cx.listener(|this, _: &DossierBack", "            .child(\n                // Source's 92rem") == chunk(base, "            .on_action(cx.listener(|this, _: &DossierBack", "            .child(frame)"), "Root actions or full-window paper placement changed")
        require(".when(!wide, |this| this.h(px(220.)).border_b_1())" in proposed, "Unmeasured stacked-row sizing was replaced")
        require(".bg(rgb(colors.paper))\n            .child(self.top_bar(small, cx))" in proposed, "Unreviewed frame/theme change")
        require("DossierImageLease" in proposed and "lease.replace(&self.prepared_images(), window, cx)?;" in proposed, "Image lease hooks lost")
    require("question_height" in local and "question_leaf_height" in local, "Easy proposal unexpectedly adopted centering")
    require("question_height" not in optional and "question_leaf_height" not in optional, "Optional candidate kept learned-height state")
    require(optional.count(".child(div().flex_1().min_h_0())") == 2, "Optional free space must have two equal owners")
    require("request_measured_layout" not in optional and "layout_as_root" not in optional, "Optional proposal introduced recursive/manual child layout")

    # Exact Source declarations justify the supported constants. Below1024
    # implicit grid rows remain outside this proposal.
    contracts = {
        "src/components/onboarding/dossier-folio.tsx": [
            "max-w-[92rem]", "px-3 py-3 sm:px-5 sm:py-4",
            "grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)]",
        ],
        "src/components/brief/dossier-preview.tsx": ["grid gap-1.5 sm:grid-cols-2"],
        "src/components/onboarding/dossier-top-bar.tsx": ["mr-1 hidden sm:inline"],
        "src/components/onboarding/anti-tabula-rasa.tsx": [
            "folio-column flex-1", "flex min-h-full flex-col justify-between px-5 py-4",
            'class="my-auto"', "justify-center gap-0.5 overflow-x-auto",
            'class="folio-rail-step shrink-0"', "btn-press shrink-0",
        ],
    }
    for name, markers in contracts.items():
        source = (ROOT / name).read_text()
        for marker in markers:
            require(marker in source, f"Missing Source declaration {name}: {marker}")

    for case in json.loads((HERE / "geometry-cases.json").read_text())["cases"]:
        width, height = case["viewport"]
        cap = min(width, 1472)
        x, y = (12, 12) if width < 640 else (20, 16)
        require(case["expected_frame"] == [(width - cap) / 2 + x, y, cap - 2 * x, height - 2 * y], "CSS box arithmetic inconsistent")
        require(case["preview_columns"] == (1 if width < 640 else 2), "Responsive preview arithmetic inconsistent")
        require(case["surface_caption"] == (width >= 640), "Responsive caption arithmetic inconsistent")

    syntax("local proposal", local)
    syntax("local + optional proposal", optional)
    syntax("authored mounted tests", (HERE / "mounted_tests.rs").read_text())
    syntax("authored optional tests", (HERE / "optional_tests.rs").read_text())
    print("PASS: exact unapplied stages, protected mutation/lifecycle code, Source declarations, CSS box arithmetic, Rust syntax")
    print("UNRUN: Rust type checking, six mounted regressions, browser/native pixels, actual IME and cross-platform acceptance")


if __name__ == "__main__":
    main()
