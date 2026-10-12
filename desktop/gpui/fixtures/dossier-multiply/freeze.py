"""Record this new lane only. No shared mutation, browser, Rust compiler or GPU."""
from pathlib import Path
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
patch = json.loads((HERE / "patch-receipt.json").read_text())
checked = json.loads((HERE / "apply-check.json").read_text())
assert patch["patchSha256"] == checked["patchSha256"] == digest(HERE / "integration.patch")
vectors = json.loads((HERE / "source-vectors.json").read_text())
assert len(vectors["vectors"]) == 252
max_error = 0.
for vector in vectors["vectors"]:
    a, b = vector["originalEquation"], vector["proposedFixedBlend"]
    max_error = max(max_error, abs(a["a"] - b["a"]), *(abs(x-y) for x, y in zip(a["p"], b["p"])))
assert max_error < 1e-13
assert vectors["source"]["ruleSha256"] == "43538cf7cf54783547f0b07e1520bc64e04975d93ceb09864024998795f54d8c"
for item in patch["files"]:
    assert digest(Path(item["readFrom"])) == item["beforeSha256"], "Pinned shared source changed before freeze"
module = ROOT / "desktop/gpui/src/dossier_multiply.rs"
files = [module, *(path for path in HERE.rglob("*") if path.is_file() and path.name != "freeze.json")]
record = {
    "status": "frozen-unregistered-unapplied-proposal",
    "moduleSha256": digest(module), "patchSha256": patch["patchSha256"],
    "gpui": "gpui-pre 0.3.7", "wgpu": "29.0.4",
    "ownedFiles": {str(path.relative_to(ROOT)): digest(path) for path in sorted(files)},
    "executed": {"BunTests": 11, "BunAssertions": 63, "SourceScalarPairs": 252,
                 "maxOpaqueScalarEquationError": max_error, "groupSVGs": 12,
                 "isolatedGitApplyCheck": "PASS-all5-unapplied", "rustfmt": "PASS-syntax-and-format-only"},
    "authoredNotRun": {"newModuleRustTests": 5, "patchedCoreSceneTests": 3},
    "limits": ["No registered/mounted multiply", "No Rust type/Clippy/shader compilation",
               "No native GPU/OS/browser/device pixel proof", "No Source CSS or background edits",
               "Opaque backdrop + unfaded ancestor + non-sRGB byte-channel target/atlas only",
               "Integral device extent/origin/content mask only", "Chromium vs resvg raster remains unverified",
               "Parent owns vendor override/export/mount and GPU atlas retirement"],
}
(HERE / "freeze.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({"moduleSha256": record["moduleSha256"], "patchSha256": record["patchSha256"],
                  "maxScalarError": max_error, "ownedFiles": len(files), "status": record["status"]}))
