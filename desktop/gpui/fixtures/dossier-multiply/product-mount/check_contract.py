#!/usr/bin/env python3
"""Filesystem-only patch/source checks. Does not execute the proposed renderer."""
from pathlib import Path
import hashlib
import json
import re


def digest(data):
    return hashlib.sha256(data).hexdigest()


def apply_in_memory(original, patch):
    source = original.splitlines(keepends=True)
    lines = patch.splitlines(keepends=True)
    assert lines[0].startswith("--- a/")
    assert lines[1].startswith("+++ b/")
    output, cursor, index = [], 0, 2
    while index < len(lines):
        hunk = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", lines[index])
        assert hunk, lines[index]
        start = int(hunk[1]) - 1
        output.extend(source[cursor:start])
        cursor, index = start, index + 1
        while index < len(lines) and not lines[index].startswith("@@ "):
            entry = lines[index]
            kind, text = entry[0], entry[1:]
            if kind in " -":
                assert source[cursor] == text, (cursor, source[cursor], text)
                if kind == " ":
                    output.append(text)
                cursor += 1
            elif kind == "+":
                output.append(text)
            else:
                raise AssertionError(entry)
            index += 1
    output.extend(source[cursor:])
    return "".join(output)


def main():
    fixture = Path(__file__).resolve().parent
    repository = fixture.parents[4]
    pins = json.loads((fixture / "source-pins.json").read_text())
    css = (repository / "src/global.css").read_bytes()
    assert digest(css) == pins["initialInputFiles"]["src/global.css"]
    layers = (fixture / "source-layers.css").read_text()
    contract = json.loads((fixture / "source-contract.json").read_text())
    assert contract["layer"]["groupOpacity"] == 0.7
    assert len(contract["layer"]["spots"]) == 5
    assert layers.count("opacity: 0.7;") == 1
    assert layers.count("mix-blend-mode: multiply;") == 1
    main_source = (repository / "src/components/onboarding/dossier-folio.tsx").read_text()
    assert digest(main_source.encode()) == pins["initialInputFiles"][
        "src/components/onboarding/dossier-folio.tsx"
    ]
    assert contract["dom"]["classes"] in main_source
    target = repository / pins["productPatch"]["target"]
    original = target.read_text()
    assert digest(original.encode()) == pins["productPatch"]["stableResumeInputSha256"], (
        "Parent changed/applied the target; retain this historical receipt and rebase deliberately"
    )
    patch = (fixture / "integration.patch").read_text()
    assert patch.count("--- a/") == 1
    proposed = apply_in_memory(original, patch)
    assert digest(proposed.encode()) == pins["productPatch"]["proposedSha256"]
    with_tests = apply_in_memory(proposed, (fixture / "tests.patch").read_text())
    assert digest(with_tests.encode()) == pins["testsPatch"]["proposedWithTestRegistrationSha256"]
    assert proposed.count("self.foxing = previous_foxing;") == 2
    assert proposed.count("self.foxing_paint.set(previous_foxing_paint);") == 2
    assert proposed.index("root.child(paper.background())") < proposed.index(
        ".child(frame)\n            .when_some(self.foxing_overlay()"
    )
    helper = (fixture / "mount_helpers.rs").read_text()
    painter = helper[helper.index("    fn foxing_overlay("):]
    assert "DossierMultiply::prepare" not in painter
    assert "paint_image(" not in painter and "drop_image(" not in painter
    assert painter.index("current.active_image != Some(image_id)") < painter.index(
        "foxing.paint_on_opaque_backdrop"
    )
    assert painter.index("!window.supports_destination_multiply()") < painter.index(
        "foxing.paint_on_opaque_backdrop"
    )
    source_multiply = (repository / "desktop/gpui/src/dossier_multiply.rs").read_text()
    assert digest(source_multiply.encode()) == pins["initialInputFiles"][
        "desktop/gpui/src/dossier_multiply.rs"
    ]
    assert source_multiply.count("window.paint_multiply_image(") == 1
    assert "FOXING_GROUP_OPACITY as f32" in source_multiply
    assert "<g opacity=" not in source_multiply[:source_multiply.index("#[cfg(test)]")]
    tests = (fixture / "product_mount_tests.rs").read_text()
    assert tests.count("#[gpui_kit::test]") == 5
    print(json.dumps({
        "kind": "filesystem-only source/patch contract",
        "sourceCssStillPinned": True,
        "sourceAfterLayers": 5,
        "productionTargets": 1,
        "rollbackPaths": 2,
        "authoredMountedTests": 5,
        "rendererCompiledOrExecuted": False,
    }, indent=2))


if __name__ == "__main__":
    main()
