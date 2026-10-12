#!/usr/bin/env python3
"""Pin authored artifacts/provenance only; never executes native/Cargo gates."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    sources = [
        "desktop/gpui/src/dossier_image_lifecycle.rs",
        "desktop/gpui/src/dossier_view.rs",
        "desktop/gpui/src/dossier_paper.rs",
        "desktop/gpui/src/dossier_stamp.rs",
        "desktop/gpui/src/dossier.rs",
        "desktop/gpui/src/app.rs",
        "desktop/gpui/src/app/settings_coordinator.rs",
        "desktop/gpui/src/app/house_coordinator.rs",
        "desktop/gpui/src/capture_geometry.rs",
        "desktop/gpui/src/main.rs",
        "desktop/gpui/src/settings_view.rs",
        "desktop/gpui/src/chrome.rs",
        "desktop/gpui/src/house_view.rs",
        "desktop/gpui/src/theme.rs",
        "desktop/gpui/Cargo.toml",
        "desktop/gpui/vendor/gpui-pre/src/window.rs",
        "desktop/gpui/vendor/gpui-pre-wgpu/src/wgpu_atlas.rs",
        "desktop/gpui/fixtures/dossier-native/check-native.py",
        "desktop/gpui/fixtures/dossier-native/retained.typ",
        "desktop/gpui/fixtures/dossier-image-lifecycle/parent-gates.json",
        "desktop/gpui/fixtures/dossier-image-lifecycle/lifecycle_tests.rs",
    ]
    for path in HERE.glob("*.py"):
        ast.parse(path.read_text(encoding="utf8"), filename=str(path))
    (HERE / "source-pins.json").write_text(json.dumps({
        "schema": 1,
        "purpose": "Read-only source/API provenance and isolated helper pin, not a compiled-binary receipt",
        "sourceSha256": {relative: sha(ROOT / relative) for relative in sources},
    }, indent=2) + "\n", encoding="utf8")
    artifacts = [path for path in sorted(HERE.iterdir()) if path.is_file()
        and path.name not in {"freeze.json", "SHA256SUMS"}]
    freeze = {
        "schema": 1,
        "status": "frozen-authored-unapplied-uncompiled-unexecuted",
        "ownership": "NEW fixtures/dossier-image-lifecycle/native-proof/** only",
        "artifactSha256": {str(path.relative_to(ROOT)): sha(path) for path in artifacts},
        "workerChecks": {
            "pythonAstSyntax": True,
            "ownedRustSyntaxFormattingOnly": True,
            "unappliedPatchApplyCheck": True,
            "rustTypecheck": False,
            "cargoDevenv": False,
            "nativeDriverExecuted": False,
        },
        "parentModelReceipt": "desktop/gpui/fixtures/dossier-image-lifecycle/parent-gates.json",
        "parentModelProofIsIndependent": True,
        "pending": ["Parent patch review/application/typecheck", "actual isolated native driver", "retained-Dossier Settings mounted gate"],
    }
    (HERE / "freeze.json").write_text(json.dumps(freeze, indent=2) + "\n", encoding="utf8")
    artifacts.append(HERE / "freeze.json")
    (HERE / "SHA256SUMS").write_text("".join(f"{sha(path)}  {path.relative_to(ROOT)}\n" for path in artifacts), encoding="utf8")
    print(json.dumps({"artifacts": len(artifacts), "patchSha256": sha(HERE / "integration.patch"),
                      "driverSha256": sha(HERE / "check-native.py"), "freezeSha256": sha(HERE / "freeze.json")}))


if __name__ == "__main__":
    main()
