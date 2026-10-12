#!/usr/bin/env python3
"""Capture immutable native writing-tool builds in fresh isolated displays."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("build", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[4]
base = root / "desktop/gpui/target/verification"
build = args.build.resolve()
manifest = json.loads((build / "build.json").read_text())
binary = build / "twyne-desktop"
helper = build / "twyne-document"
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert sha(binary) == manifest["sha256"]
assert sha(helper) == manifest["helperSha256"]
runtime_path = base / "multiply-native-runtime-env.json"
runtime = json.loads(runtime_path.read_text())
assert set(runtime) == {"PATH", "LD_LIBRARY_PATH", "VK_DRIVER_FILES"}
environment = os.environ.copy()
environment.update(runtime)
job = base / ("genui-native-cards-" + uuid.uuid4().hex[:12])
job.mkdir()
cases = []
receipt = {
    "status": "running", "binary": str(binary), "binarySha256": sha(binary),
    "helperSha256": sha(helper), "buildManifestSha256": sha(build / "build.json"),
    "captureScriptSha256": sha(Path(__file__)),
    "nativeCaptureHelperSha256": sha(root / "desktop/gpui/tools/capture-native.py"),
    "fixtureSha256": sha(root / "desktop/gpui/fixtures/gen-ui/manuscript.html"),
    "viewport": {"width": 1280, "height": 860}, "deviceScaleFactor": 1,
    "startedUnix": time.time(), "cases": cases,
    "scope": "Actual native GPU frames; fresh Xvfb and temporary library per case. User desktop preview untouched. No live AI/account proof.",
}
receipt_path = job / "receipt.json"
receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
(base / "genui-native-cards-pointer.json").write_text(json.dumps({"path": str(job)}, indent=2) + "\n")
print(json.dumps({"job": str(job), "status": "running"}), flush=True)
try:
    for kind in ["sentence-lab", "rhythm-strip", "claim-check", "reader-questions"]:
        geometry = job / (kind + "-geometry.json")
        output = job / (kind + "-full.png")
        command = ["rtk", "proxy", "python3", str(root / "desktop/gpui/tools/capture-native.py"),
                   "--binary", str(binary), "--output", str(output), "--geometry", str(geometry),
                   "--state", kind, "--fixture", str(root / "desktop/gpui/fixtures/gen-ui/manuscript.html")]
        result = subprocess.run(command, env=environment, capture_output=True, timeout=90)
        (job / (kind + ".log")).write_bytes(result.stdout + result.stderr)
        assert result.returncode == 0, kind + ": native capture failed"
        observed = json.loads(geometry.read_text())
        cards = [element for element in observed["elements"] if element.get("path", [])[-1:] == ['Name("in-flow-card")']]
        assert observed["captureReady"] and len(cards) == 1
        card = cards[0]
        assert card["visible"] and card["rect"]["width"] == 296
        cases.append({"kind": kind, "card": card, "pngSha256": sha(output), "geometrySha256": sha(geometry)})
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps({"kind": kind, "visible": True, "rect": card["rect"]}), flush=True)
    receipt["status"] = "captured"
except Exception as error:
    receipt["status"] = "failed"
    receipt["error"] = str(error)
    raise
finally:
    receipt["endedUnix"] = time.time()
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"job": str(job), "status": receipt["status"]}))
