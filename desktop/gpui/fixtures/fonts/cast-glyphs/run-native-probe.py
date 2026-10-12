#!/usr/bin/env python3
"""Build a read-only standalone audit against already-built native libraries.
No manifest/runtime edits or dependency resolution. Run a normal ui-tests
library build first if artifacts are absent; Root owns that integration gate.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=Path(__file__).with_name("native-fonts.json"))
parser.add_argument("--embedded-only", action="store_true", help="Use a fresh Cosmic font database with no system fonts")
parser.add_argument("--source-rust", type=Path, default=Path(__file__).with_name("native-probe.rs"))
args = parser.parse_args()
fixture = Path(__file__).resolve().parent
project = fixture.parents[2]
deps = project / "target/debug/deps"
fingerprints = project / "target/debug/.fingerprint"
records = {}
for path in fingerprints.glob("*/lib-*.json"):
    fingerprint = path.with_suffix("")
    if not fingerprint.exists():
        continue
    crate = path.stem.removeprefix("lib-")
    suffix = path.parent.name.rsplit("-", 1)[1]
    library = deps / f"lib{crate}-{suffix}.rlib"
    if not library.exists():
        continue
    key = int.from_bytes(bytes.fromhex(fingerprint.read_text().strip()), "little")
    records[(crate, key)] = (library, json.loads(path.read_text()))
candidates = [record for (crate, _), record in records.items()
              if crate == "twyne_desktop" and "ui-tests" in json.loads(record[1]["features"])]
if not candidates:
    raise SystemExit("Build the native ui-tests library before this probe")
root_record = max(candidates, key=lambda record: record[0].stat().st_mtime)
build_compiler = root_record[1]["rustc"]
externs = {"twyne_desktop": root_record[0]}
pending = list(root_record[1]["deps"])
visited = set()
while pending:
    _, crate, _, key = pending.pop()
    if (crate, key) in visited:
        continue
    visited.add((crate, key))
    record = records.get((crate, key))
    if record is None or record[1]["rustc"] != build_compiler:
        continue
    if crate in {"gpui_kit", "gpui_wgpu", "serde_json"}:
        externs[crate] = record[0]
    pending.extend(record[1]["deps"])
for crate in ["gpui_kit", "gpui_wgpu", "serde_json"]:
    if crate not in externs:
        raise SystemExit(f"Build the native ui-tests library before this probe: missing dependency {crate}")
with tempfile.TemporaryDirectory(prefix="twyne-cast-native-") as temporary:
    binary = Path(temporary) / "native-probe"
    command = ["rtk", "proxy", "rustc", "--edition=2024", str(args.source_rust.resolve()),
        "-L", f"dependency={deps}", "-C", "linker=cc", "-o", str(binary)]
    for crate, library in externs.items():
        command += ["--extern", f"{crate}={library}"]
    for output in (project / "target/debug/build").glob("*/out"):
        if any(path.suffix in {".a", ".so"} for path in output.iterdir()):
            command += ["-L", f"native={output}"]
    environment = os.environ.copy()
    compiled = subprocess.run(command, env=environment)
    if compiled.returncode:
        raise SystemExit(compiled.returncode)
    invocation = ["rtk", "proxy", str(binary), str(args.output.resolve())]
    if args.embedded_only:
        invocation.append("--embedded-only")
    subprocess.run(invocation, check=True, env=environment,
        stdout=subprocess.DEVNULL)
print(json.dumps({"output": str(args.output.resolve()), "linkedExistingLibraries":{name:str(path) for name,path in externs.items()}}))
