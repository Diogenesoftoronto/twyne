#!/usr/bin/env python3
"""Freeze a checked native build for rendered comparisons without replacing previews."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--helper", required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[4]
base = root / "desktop/gpui"
verification = base / "target/verification"
helper = args.helper.resolve()
assert helper.is_file(), "The explicit document helper must exist"

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

inputs = [base / "Cargo.toml", base / "Cargo.lock"]
inputs += sorted((base / "src").rglob("*.rs"))
inputs += sorted((base / "vendor").rglob("*.rs"))
inputs += sorted((base / "vendor").rglob("Cargo.toml"))
hashes = {str(path.relative_to(root)): sha(path) for path in inputs}
helper_hash = sha(helper)
job = verification / ("genui-build-" + uuid.uuid4().hex[:12])
job.mkdir()
command = ["rtk", "proxy", "devenv", "shell", "--", "rtk", "proxy", "cargo", "build",
           "--features", "ui-tests,native-audio", "--bin", "twyne-desktop", "--locked", "--offline",
           "--manifest-path", "desktop/gpui/Cargo.toml"]
receipt = {"status": "running", "command": command, "sourceInputs": hashes,
           "helperOrigin": str(helper), "helperSha256": helper_hash,
           "startedUnix": time.time(), "userPreviewReplaced": False}
(job / "build.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"job": str(job), "status": "running"}), flush=True)
with (job / "cargo.log").open("wb") as output:
    result = subprocess.run(command, cwd=root, stdout=output, stderr=subprocess.STDOUT)
drift = [path for path, digest in hashes.items() if sha(root / path) != digest]
if sha(helper) != helper_hash:
    drift.append(str(helper))
receipt.update(exitCode=result.returncode, changedDuringBuild=drift, endedUnix=time.time())
if result.returncode == 0 and not drift:
    source_binary = base / "target/debug/twyne-desktop"
    binary = job / "twyne-desktop"
    shutil.copy2(source_binary, binary)
    shutil.copy2(helper, job / "twyne-document")
    receipt.update(status="built", binary=str(binary), sha256=sha(binary),
                   proofLimit="Immutable native build, not rendered parity or live-provider proof. Document helper reused from the explicit recorded origin.")
    (verification / "genui-mounted-build-pointer.json").write_text(json.dumps({"path": str(job)}, indent=2) + "\n")
else:
    receipt["status"] = "failed"
(job / "build.json").write_text(json.dumps(receipt, indent=2) + "\n")
print((job / "cargo.log").read_text(errors="replace")[-3000:])
print(json.dumps({"job": str(job), "status": receipt["status"]}))
raise SystemExit(0 if receipt["status"] == "built" else result.returncode or 1)
