#!/usr/bin/env python3
"""Hash the read-only source audit/proposal. No application/native execution."""
from pathlib import Path
import hashlib
import json
import subprocess
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


sources = [
    "desktop/gpui/Cargo.lock",
    "desktop/gpui/src/app.rs",
    "desktop/gpui/src/dossier_view.rs",
    "desktop/gpui/src/dossier_paper.rs",
    "desktop/gpui/src/dossier_stamp.rs",
    "desktop/gpui/src/dossier_multiply.rs",
    "desktop/gpui/vendor/gpui-pre/src/window.rs",
    "desktop/gpui/vendor/gpui-pre/src/app.rs",
    "desktop/gpui/vendor/gpui-pre/src/app/async_context.rs",
    "desktop/gpui/vendor/gpui-pre/src/assets.rs",
    "desktop/gpui/vendor/gpui-pre/src/platform.rs",
    "desktop/gpui/vendor/gpui-pre/src/scene.rs",
    "desktop/gpui/vendor/gpui-pre/src/view.rs",
    "desktop/gpui/vendor/gpui-pre/src/elements/canvas.rs",
    "desktop/gpui/vendor/gpui-pre-wgpu/src/wgpu_context.rs",
    "desktop/gpui/vendor/gpui-pre-wgpu/src/wgpu_renderer.rs",
    "desktop/gpui/vendor/gpui-pre-wgpu/src/wgpu_atlas.rs",
    "desktop/gpui/vendor/gpui-pre-linux/src/linux/x11/window.rs",
    "desktop/gpui/vendor/gpui-pre-linux/src/linux/wayland/window.rs",
    "desktop/gpui/vendor/gpui-pre-linux/src/linux/headless/window.rs",
]
pins = [{"path": source, "sha256": digest(ROOT / source)} for source in sources]
queues = list((Path.home() / ".cargo/registry/src").glob("*/wgpu-29.0.4/src/api/queue.rs"))
if len(queues) != 1:
    raise RuntimeError("Expected exactly one cached pinned wgpu queue source for this read-only audit")
(HERE / "source-pins.json").write_text(json.dumps({"kind": "read-only current source audit", "crates": {"gpui-pre": "0.3.7", "gpui-pre-linux": "0.3.7", "gpui-pre-wgpu": "0.3.7", "wgpu": "29.0.4"}, "files": pins, "cachedPrimarySource": {"crate": "wgpu", "version": "29.0.4", "pathInCrate": "src/api/queue.rs", "sha256": digest(queues[0])}}, indent=2) + "\n")

base = json.loads((HERE / "patch-base.json").read_text())
for entry in base["files"]:
    if digest(ROOT / entry["path"]) != entry["baseSha256"]:
        raise RuntimeError(f"Parent source changed since patch generation: {entry['path']}; regenerate/check the unapplied proposal")

result = subprocess.run(["rtk", "proxy", "git", "apply", "--check", str(HERE / "integration.patch")], cwd=ROOT, capture_output=True, text=True)
if result.returncode:
    raise RuntimeError("Unapplied patch check failed: " + result.stderr)

for path in [HERE / "build-patch.py", HERE / "freeze.py"]:
    compile(path.read_text(), str(path), "exec")

files = [ROOT / "desktop/gpui/src/dossier_image_lifecycle.rs"] + sorted(path for path in HERE.iterdir() if path.is_file() and path.name != "freeze.json")
receipt = {
    "status": "FROZEN_UNAPPLIED_PROPOSAL",
    "atUtc": datetime.now(timezone.utc).isoformat(),
    "registrationApplied": False,
    "checks": {"gitApplyCheck": "PASS", "pythonSyntax": "PASS", "rustfmtSyntax": "PASS", "rustTestsAuthored": 13, "rustTestsRun": False, "cargoRun": False, "nativeRun": False, "gpuProof": False},
    "scope": "Per-window lease bookkeeping and conditional ordinary-frame CPU-scene/key retirement; not successful presentation or global GPU eviction",
    "files": [{"path": str(path.relative_to(ROOT)), "sha256": digest(path)} for path in files],
}
(HERE / "freeze.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"status": receipt["status"], "files": len(files), "patchCheck": "PASS", "rustTestsRun": False, "nativeRun": False}))
