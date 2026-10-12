#!/usr/bin/env python3
"""Pin this authored test proposal only; no Cargo/native execution."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    for path in HERE.glob("*.py"):
        ast.parse(path.read_text(encoding="utf8"), filename=str(path))
    sources = [
        "desktop/gpui/src/app.rs",
        "desktop/gpui/src/app/settings_coordinator.rs",
        "desktop/gpui/src/dossier_view.rs",
        "desktop/gpui/src/dossier.rs",
        "desktop/gpui/src/dossier_image_lifecycle.rs",
        "desktop/gpui/vendor/gpui-pre/src/platform.rs",
        "desktop/gpui/vendor/gpui-pre/src/window.rs",
        "desktop/gpui/vendor/gpui-base/src/test_support.rs",
        "desktop/gpui/fixtures/dossier-image-lifecycle/native-proof/integration.patch",
        "desktop/gpui/fixtures/dossier-image-lifecycle/native-proof/diagnostic_hooks.rs",
        "desktop/gpui/fixtures/dossier-image-lifecycle/native-proof/freeze.json",
    ]
    (HERE / "source-pins.json").write_text(json.dumps({"schema": 1,
        "purpose": "Read-only host/API provenance, not a compiled test receipt",
        "sourceSha256": {relative: sha(ROOT / relative) for relative in sources},
    }, indent=2) + "\n", encoding="utf8")
    artifacts = [path for path in sorted(HERE.iterdir()) if path.is_file()
        and path.name not in {"freeze.json", "SHA256SUMS"}]
    (HERE / "freeze.json").write_text(json.dumps({"schema": 1,
        "status": "frozen-authored-unapplied-uncompiled-unexecuted",
        "ownership": "NEW fixtures/dossier-image-lifecycle/retained-settings-host/** only",
        "artifactSha256": {str(path.relative_to(ROOT)): sha(path) for path in artifacts},
        "workerChecks": {"pythonAstSyntax": True, "rustSyntaxFormattingOnly": True,
                         "unappliedPatchApplyCheck": True, "cargo": False, "native": False},
        "parentFilter": "dossier_retained_settings_host",
    }, indent=2) + "\n", encoding="utf8")
    artifacts.append(HERE / "freeze.json")
    (HERE / "SHA256SUMS").write_text("".join(f"{sha(path)}  {path.relative_to(ROOT)}\n" for path in artifacts), encoding="utf8")
    print(json.dumps({"artifacts": len(artifacts), "patchSha256": sha(HERE / "integration.patch"),
                      "testSha256": sha(HERE / "host_tests.rs"), "freezeSha256": sha(HERE / "freeze.json")}))


if __name__ == "__main__":
    main()
