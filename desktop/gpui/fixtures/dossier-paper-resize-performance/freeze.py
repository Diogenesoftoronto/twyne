#!/usr/bin/env python3
"""Pin a source-only proposal; never run a runtime or write shared files."""

from pathlib import Path
import ast
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


for name in ("build-patch.py", "freeze.py"):
    ast.parse((HERE / name).read_text(), filename=name)

inputs = [
    "desktop/gpui/src/dossier_paper.rs",
    "desktop/gpui/src/dossier_multiply.rs",
    "desktop/gpui/src/dossier_view.rs",
    "desktop/gpui/src/dossier_stamp.rs",
    "desktop/gpui/src/dossier_image_lifecycle.rs",
    "desktop/gpui/src/capture_geometry.rs",
    "desktop/gpui/vendor/gpui-pre/src/window.rs",
    "desktop/gpui/vendor/gpui-pre/src/app/context.rs",
    "desktop/gpui/vendor/gpui-pre/src/svg_renderer.rs",
    "desktop/gpui/vendor/gpui-pre/src/color.rs",
    "desktop/gpui/fixtures/dossier-layout-correction/mounted_tests.rs",
    "desktop/gpui/fixtures/dossier-paper/raster/receipt.json",
    "desktop/gpui/fixtures/dossier-multiply/parent-native-pixel-gates.json",
    "src/global.css",
    "src/components/onboarding/dossier-folio.tsx",
]
(HERE / "source-pins.json").write_text(json.dumps({
    "schemaVersion": 1,
    "status": "read_only_inspection_not_execution",
    "inputs": [{"path": name, "sha256": digest(ROOT / name)} for name in inputs],
}, indent=2) + "\n")

names = ["README.md", "diagnostics.rs", "build-patch.py", "freeze.py", "instrumentation.patch", "patch-base.json", "source-pins.json"]
artifacts = [{"path": str((HERE / name).relative_to(ROOT)), "sha256": digest(HERE / name)} for name in names]
(HERE / "freeze.json").write_text(json.dumps({
    "schemaVersion": 1,
    "status": "frozen_unapplied_uncompiled_unexecuted",
    "scope": "desktop/gpui/fixtures/dossier-paper-resize-performance/** only",
    "checks": {
        "pythonAst": "pass",
        "runtimeProfile": "not_run",
        "cargoDevenv": "not_run",
        "nativeBrowser": "not_run",
    },
    "artifacts": artifacts,
}, indent=2) + "\n")
artifacts.append({"path": str((HERE / "freeze.json").relative_to(ROOT)), "sha256": digest(HERE / "freeze.json")})
(HERE / "SHA256SUMS").write_text("".join(f'{entry["sha256"]}  {entry["path"]}\n' for entry in artifacts))
print(json.dumps({"status": "frozen_source_only", "artifacts": len(artifacts), "patchSha256": digest(HERE / "instrumentation.patch"), "freezeSha256": digest(HERE / "freeze.json")}, indent=2))
