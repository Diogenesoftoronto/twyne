#!/usr/bin/env python3
"""Pinned filesystem and git-apply checks only; no renderer/test execution."""
from pathlib import Path
import ast
import hashlib
import json
import os
import re
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def reconstruct(original, patch):
    source = original.splitlines(keepends=True)
    lines = patch.splitlines(keepends=True)
    assert len(lines) >= 3 and lines[0].startswith("--- a/") and lines[1].startswith("+++ b/")
    output, cursor, index = [], 0, 2
    while index < len(lines):
        match = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", lines[index])
        assert match, lines[index]
        start = int(match[1]) - 1
        assert start >= cursor
        output.extend(source[cursor:start])
        cursor, index = start, index + 1
        removed = added = 0
        while index < len(lines) and not lines[index].startswith("@@ "):
            entry = lines[index]
            kind, value = entry[0], entry[1:]
            if kind in " -":
                assert source[cursor] == value, (cursor, source[cursor], value)
                if kind == " ":
                    output.append(value)
                    added += 1
                removed += 1
                cursor += 1
            elif kind == "+":
                output.append(value)
                added += 1
            else:
                raise AssertionError(entry)
            index += 1
        assert removed == int(match[2] or 1)
        assert added == int(match[4] or 1)
    output.extend(source[cursor:])
    return "".join(output)


def checked_apply(patch, cwd, **kwargs):
    result = subprocess.run(
        ["rtk", "proxy", "git", "apply", "--check", "--whitespace=error", str(patch)],
        cwd=cwd, capture_output=True, text=True, **kwargs,
    )
    assert result.returncode == 0, (result.returncode, result.stdout, result.stderr)
    return {"exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr}


def main():
    pins = json.loads((HERE / "base-pins.json").read_text())
    target = ROOT / pins["target"]
    original = target.read_text()
    assert digest(original.encode()) == pins["baseSha256"], "Parent checkpoint changed: retain historical receipts and rebase explicitly"
    for name, expected in pins["frozenOriginalArtifacts"].items():
        assert digest((ROOT / name).read_bytes()) == expected, ("Frozen old artifact changed", name)
    for name, expected in pins["sourceSha256"].items():
        assert digest((ROOT / name).read_bytes()) == expected, ("Reviewed source input changed", name)
    proposed = reconstruct(original, (HERE / "integration.patch").read_text())
    assert digest(proposed.encode()) == pins["proposedSha256"]
    registered = reconstruct(proposed, (HERE / "tests.patch").read_text())
    assert digest(registered.encode()) == pins["proposedWithTestsSha256"]
    overlay = "            .when_some(self.foxing_overlay(), |root, overlay| root.child(overlay))\n"
    assert proposed.count(overlay) == 1
    render_marker = "impl Render for DossierView {"
    original_render = original[original.index(render_marker):original.index("\n#[cfg(all(test, feature = \"ui-tests\"))]", original.index(render_marker))]
    proposed_render = proposed[proposed.index(render_marker):proposed.index("\n#[cfg(all(test, feature = \"ui-tests\"))]", proposed.index(render_marker))]
    assert proposed_render.replace(overlay, "") == original_render, "Responsive renderer must be byte-identical except the final overlay"
    assert proposed.count("self.foxing = previous_foxing;") == 2
    assert proposed.count("self.foxing_paint.set(previous_foxing_paint);") == 2
    assert proposed.index('root.child(paper.background())') < proposed.index('.id("dossier-folio-wrapper")') < proposed.index(overlay)
    assert proposed.count(".max_w(px(1472.))") == original.count(".max_w(px(1472.))")
    assert proposed.count(".overflow_hidden()") == original.count(".overflow_hidden()")
    assert proposed[proposed.index("    mod layout_correction {"):] == original[original.index("    mod layout_correction {"):]
    assert "#[path = \"../fixtures/dossier-multiply/product-mount/parent-layout-adoption/product_mount_tests.rs\"]" in registered
    painter = proposed[proposed.index("    fn foxing_overlay("):proposed.index("    pub fn prepare_paper(")]
    assert "DossierMultiply::prepare(" not in painter and "paint_image(" not in painter and "drop_image(" not in painter
    assert painter.index("!window.supports_destination_multiply()") < painter.index("foxing.paint_on_opaque_backdrop")
    assert painter.index("current.active_image != Some(image_id)") < painter.index("foxing.paint_on_opaque_backdrop")
    tests = (HERE / "product_mount_tests.rs").read_text()
    assert tests.count("#[gpui_kit::test]") == 6
    assert "prepared_images().len(), 9" not in tests and "prepared_images().len(), 10" not in tests
    assert "assert!(matches!(expected.len(), 1 | 9)" in tests
    assert "window.supports_destination_multiply());" in tests
    python_files = sorted(HERE.glob("*.py"))
    for file in python_files:
        ast.parse(file.read_text(), filename=str(file))
    production_check = checked_apply(HERE / "integration.patch", ROOT)
    # No shared file application: the first patch is reconstructed only in a
    # disposable owned tree; git checks the second patch there without applying.
    with tempfile.TemporaryDirectory(prefix=".syntax-tree-", dir=HERE) as temporary:
        mirror = Path(temporary)
        mirrored = mirror / pins["target"]
        mirrored.parent.mkdir(parents=True)
        mirrored.write_text(proposed)
        env = dict(os.environ, GIT_CEILING_DIRECTORIES=str(HERE))
        tests_check = checked_apply(HERE / "tests.patch", mirror, env=env)
    assert digest(target.read_bytes()) == pins["baseSha256"]
    receipt = {
        "kind": "Pinned source reconstruction / Python AST / unapplied git checks only",
        "baseSha256": pins["baseSha256"],
        "proposedSha256": pins["proposedSha256"],
        "productionGitApplyCheck": production_check,
        "testsGitApplyCheckOnOwnedProposedTree": tests_check,
        "preservedResponsiveRendererExceptFinalOverlay": True,
        "rootLayoutCorrectionChildPreserved": True,
        "rollbackPaths": 2,
        "authoredMountedTests": 6,
        "pythonAstFiles": [file.name for file in python_files],
        "sharedFilesWrittenOrPatchApplied": False,
        "rustParsedCompiledOrMountedTestsExecuted": False,
        "gpuNativeBrowserCargoDevenvExecuted": False,
        "nativeStampProofUnchanged": "Separate real native gate must still require all eight real stamp variants",
    }
    (HERE / "rebase-check-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
