#!/usr/bin/env python3
"""Author fixture patches in this directory only; never apply shared changes.

The reviewed old mount's non-layout hunks are replayed by exact, unique text.
The final overlay is rebased onto Parent's full-viewport, capped-wrapper root.
"""
from pathlib import Path
import difflib
import hashlib
import json
import re


HERE = Path(__file__).resolve().parent
OLD = HERE.parent
ROOT = HERE.parents[5]
TARGET = "desktop/gpui/src/dossier_view.rs"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def replace_once(text, old, new):
    assert text.count(old) == 1, ("Expected one exact reviewed context", old[:160], text.count(old))
    return text.replace(old, new, 1)


def diff(path, before, after):
    return "".join(difflib.unified_diff(
        before.splitlines(keepends=True), after.splitlines(keepends=True),
        fromfile=f"a/{path}", tofile=f"b/{path}", n=4,
    ))


def main():
    original = (ROOT / TARGET).read_text()
    reviewed_patch = (OLD / "integration.patch").read_text()
    sections = re.split(r"^@@ .*?@@.*?\n", reviewed_patch, flags=re.M)[1:]
    proposed = original
    for hunk in sections:
        if ".child(frame)" in hunk:
            # The old outer-root hunk is obsolete. Parent already owns the
            # overflow mask, responsive gutters and centered capped wrapper.
            continue
        lines = hunk.splitlines(keepends=True)
        before = "".join(line[1:] for line in lines if line[0] in " -")
        after = "".join(line[1:] for line in lines if line[0] in " +")
        proposed = replace_once(proposed, before, after)
    proposed = replace_once(proposed,
        "                    .child(frame),\n            )\n    }\n}\n\n#[cfg(all(test, feature = \"ui-tests\"))]",
        "                    .child(frame),\n            )\n            .when_some(self.foxing_overlay(), |root, overlay| root.child(overlay))\n    }\n}\n\n#[cfg(all(test, feature = \"ui-tests\"))]",
    )
    proposed = replace_once(proposed,
        "    FontWeight, ImageId, IntoElement, KeyBinding, MouseButton, PathPromptOptions, Pixels, Render, Role, SharedString,\n"
        "    Subscription, Task, TestSupportExt, Window, WindowId, canvas, div, font, linear_color_stop,\n",
        "    FontWeight, ImageId, IntoElement, KeyBinding, MouseButton, PathPromptOptions, Pixels, Render,\n"
        "    Role, SharedString, Subscription, Task, TestSupportExt, Window, WindowId, canvas, div, font,\n"
        "    linear_color_stop,\n",
    )
    proposed = replace_once(proposed,
        "use std::{cell::Cell, collections::BTreeMap, rc::Rc, sync::Arc, time::Duration};\n",
        "use std::{cell::Cell, collections::BTreeMap, rc::Rc, sync::Arc, time::Duration};\n",
    )
    proposed = replace_once(proposed,
        "        // Broadsheet has no group. All other prepared groups are tracked as\n"
        "        // the optional tenth image, even if this backend cannot upload them.\n",
        "        // Broadsheet has no group. Include a prepared group once after the\n"
        "        // available ordinary images (tenth only with all eight stamps),\n"
        "        // even if this backend cannot upload it.\n",
    )
    (HERE / "integration.patch").write_text(diff(TARGET, original, proposed))
    registration = (
        "\n#[cfg(all(\n"
        "    test,\n"
        "    feature = \"ui-tests\",\n"
        "    any(target_os = \"linux\", target_os = \"freebsd\")\n"
        "))]\n"
        "#[path = \"../fixtures/dossier-multiply/product-mount/parent-layout-adoption/product_mount_tests.rs\"]\n"
        "mod product_multiply_mount_tests;\n"
    )
    with_tests = proposed + registration
    (HERE / "tests.patch").write_text(diff(TARGET, proposed, with_tests))
    (HERE / "base-pins.json").write_text(json.dumps({
        "schema": 1,
        "scope": "Unapplied Parent responsive-layout rebase, not runtime proof",
        "target": TARGET,
        "baseSha256": digest(original.encode()),
        "proposedSha256": digest(proposed.encode()),
        "proposedWithTestsSha256": digest(with_tests.encode()),
        "frozenOriginalArtifacts": {
            str(path.relative_to(ROOT)): digest(path.read_bytes())
            for path in sorted(OLD.iterdir()) if path.is_file()
        },
        "sourceSha256": {
            name: digest((ROOT / name).read_bytes()) for name in [
                "src/global.css",
                "src/components/onboarding/dossier-folio.tsx",
                "desktop/gpui/src/dossier_multiply.rs",
                "desktop/gpui/src/dossier_image_lifecycle.rs",
                "desktop/gpui/src/dossier_paper.rs",
                "desktop/gpui/src/dossier_stamp.rs",
                "desktop/gpui/src/theme.rs",
                "desktop/gpui/vendor/gpui-pre/src/platform.rs",
                "desktop/gpui/vendor/gpui-pre/src/platform/test/platform.rs",
                "desktop/gpui/vendor/gpui-pre/src/app/test_context.rs",
                "desktop/gpui/vendor/gpui-pre/src/window.rs",
                "desktop/gpui/vendor/gpui-pre-wgpu/src/wgpu_atlas.rs",
                "desktop/gpui/fixtures/dossier-layout-correction/mounted_tests.rs",
            ]
        },
        "noSharedWrites": True,
        "noSourceOrVendorPatch": True,
        "productionPolicyChanged": False,
    }, indent=2) + "\n")
    print(json.dumps({
        "baseSha256": digest(original.encode()),
        "proposedSha256": digest(proposed.encode()),
        "onlyWrittenDirectory": str(HERE.relative_to(ROOT)),
        "sharedPatchApplied": False,
    }, indent=2))


if __name__ == "__main__":
    main()
