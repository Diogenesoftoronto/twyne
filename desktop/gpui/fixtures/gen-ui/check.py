#!/usr/bin/env python3
"""Root-owned focused checks; leave the running immutable user preview alone."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("phase", choices=["core", "ui", "desktop", "lint"])
args = parser.parse_args()
base = Path(__file__).resolve().parents[4]
verification = base / "desktop/gpui/target/verification"
job = verification / ("genui-" + args.phase + "-" + uuid.uuid4().hex[:12])
job.mkdir()
inputs = [
    "src/components/in-flow/catalog.ts", "src/utils/in-flow-tools.ts",
    "src/utils/struggle-signals.ts", "src/components/in-flow/tool-renderer.tsx",
    "src/utils/system-one-budget.ts", "src/utils/system-one.ts",
    "src/global.css", "desktop/gpui/Cargo.toml", "desktop/gpui/Cargo.lock",
    "src/utils/saved-tools.ts", "src/utils/writing-tools-storage.ts",
    "src/components/editor/extensions/struggle-tracker.ts",
    "src/components/in-flow/margin-rail.tsx",
    "src/components/ui/numeric-stepper.tsx",
    "node_modules/prosemirror-transform/src/map.ts",
    "node_modules/prosemirror-transform/dist/index.js",
    "node_modules/prosemirror-transform/package.json",
    *[str(p.relative_to(base)) for p in (base / "desktop/gpui/src").rglob("*.rs")],
    *[str(p.relative_to(base)) for p in Path(__file__).parent.glob("*oracle.*")],
]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
hashes = {p: sha(base / p) for p in inputs}
command = ["rtk", "proxy", "devenv", "shell", "--", "rtk", "proxy", "cargo"]
command += {
    "core": ["test", "--no-default-features", "--lib", "gen_ui"],
    "ui": ["test", "--features", "ui-tests,native-audio", "gen_ui"],
    "desktop": ["check", "--features", "ui-tests,native-audio", "--all-targets"],
    "lint": ["clippy", "--features", "ui-tests,native-audio", "--all-targets"],
}[args.phase]
command += ["--locked", "--offline", "--manifest-path", "desktop/gpui/Cargo.toml"]
if args.phase == "lint":
    command += ["--", "-D", "warnings"]
receipt = {"status": "running", "phase": args.phase, "command": command,
    "inputs": hashes, "startedUnix": time.time(),
    "proofLimit": "Native contracts, compilation, and headless interactions only; real rendered pixel parity and live AI, knowledge, account and sync behavior require separate evidence"}
(job / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
(verification / ("genui-" + args.phase + "-pointer.json")).write_text(json.dumps({"path": str(job)}, indent=2) + "\n")
print(json.dumps({"job": str(job), "status": "running"}), flush=True)
with (job / "cargo.log").open("wb") as output:
    result = subprocess.run(command, cwd=base, stdout=output, stderr=subprocess.STDOUT)
drift = [p for p, digest in hashes.items() if sha(base / p) != digest]
receipt.update(status="passed" if result.returncode == 0 and not drift else "failed",
    exitCode=result.returncode, changedDuringCheck=drift, endedUnix=time.time())
(job / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print((job / "cargo.log").read_text(errors="replace")[-6500:])
print(json.dumps({"job": str(job), "status": receipt["status"], "exitCode": result.returncode}))
raise SystemExit(0 if receipt["status"] == "passed" else result.returncode or 1)
