#!/usr/bin/env python3
"""Check the vendored archive and reproduce its one declared X11 patch offline."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import tarfile

vendor = Path(__file__).resolve().parent
proof = json.loads((vendor / "upstream-sha256.json").read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--archive", type=Path)
args = parser.parse_args()
archive = args.archive
if archive is None:
    candidates = list((Path.home() / ".cargo/registry/cache").glob("*/gpui-pre-linux-0.3.7.crate"))
    if len(candidates) != 1:
        raise SystemExit("Supply the original cached gpui-pre-linux0.3.7 archive via --archive")
    archive = candidates[0]
if sha256(archive.read_bytes()).hexdigest() != proof["archiveSha256"]:
    raise SystemExit("Original gpui-pre-linux archive checksum changed")
patched = "src/linux/x11/window.rs"
originals = {}
with tarfile.open(archive) as tar:
    for member in tar.getmembers():
        if not member.isfile():
            continue
        name = str(Path(member.name).relative_to("gpui-pre-linux-0.3.7"))
        data = tar.extractfile(member).read()
        if sha256(data).hexdigest() != proof["files"].get(name):
            raise SystemExit(f"Original archive member changed: {name}")
        originals[name] = data
if set(originals) != set(proof["files"]):
    raise SystemExit("Vendored provenance does not cover every original archive member")
changed = [name for name in originals if sha256((vendor / name).read_bytes()).hexdigest() != proof["files"][name]]
if changed != [patched]:
    raise SystemExit(f"Unexpected upstream file changes: {changed}")
lines = originals[patched].decode().splitlines(keepends=True)
diff = (vendor / "twyne-input-handler-drop.patch").read_text().splitlines(keepends=True)
assert diff[:2] == [f"--- a/{patched}\n", f"+++ b/{patched}\n"]
result, cursor, index = [], 0, 2
while index < len(diff):
    header = re.fullmatch(r"@@ -(\d+),(\d+) \+(\d+),(\d+) @@\n", diff[index])
    assert header, "Expected a bounded unified-diff hunk"
    start, removed_count, new_start, added_count = map(int, header.groups())
    assert start - 1 >= cursor
    result.extend(lines[cursor:start - 1])
    cursor = start - 1
    assert len(result) == new_start - 1
    removed, added = 0, 0
    index += 1
    while index < len(diff) and not diff[index].startswith("@@ "):
        operation, text = diff[index][0], diff[index][1:]
        if operation in {" ", "-"}:
            assert lines[cursor] == text, "Patch does not match original archive context"
            cursor += 1
            removed += 1
        if operation in {" ", "+"}:
            result.append(text)
            added += 1
        assert operation in {" ", "-", "+"}
        index += 1
    assert removed == removed_count and added == added_count
result.extend(lines[cursor:])
if "".join(result).encode() != (vendor / patched).read_bytes():
    raise SystemExit("Declared X11 patch does not reproduce the vendored runtime file")
print(f"Verified {len(originals)} original files, pinned archive, and only the declared X11 input-handler Drop patch")
