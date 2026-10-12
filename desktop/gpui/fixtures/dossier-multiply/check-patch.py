"""Read-only shared-file applicability/hash receipt; checks in OWNED staging only."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
receipt = json.loads((HERE / "patch-receipt.json").read_text())
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert digest(HERE / "integration.patch") == receipt["patchSha256"]
stage = Path(tempfile.mkdtemp(prefix="patch-check-", dir=HERE))
try:
    for item in receipt["files"]:
        original = Path(item["readFrom"])
        assert digest(original) == item["beforeSha256"], f"Pinned source drifted: {original}"
        target = stage / item["target"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
    directory = str(stage.relative_to(ROOT))
    command = ["rtk", "proxy", "git", "apply", "--check", "--verbose", f"--directory={directory}",
               str(HERE / "integration.patch")]
    check = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=True)
    output = check.stdout + check.stderr
    assert output.count("Checking patch") == len(receipt["files"]), output
    assert "Skipped" not in output, output
    # --check NEVER applies: both shared sources and owned staged copies remain exact.
    for item in receipt["files"]:
        assert digest(Path(item["readFrom"])) == item["beforeSha256"]
        assert digest(stage / item["target"]) == item["beforeSha256"]
    protected = ["src/global.css", "desktop/gpui/src/dossier_paper.rs", "desktop/gpui/src/dossier_view.rs",
                 "desktop/gpui/src/lib.rs", "desktop/gpui/Cargo.toml", "desktop/gpui/Cargo.lock"]
    (HERE / "apply-check.json").write_text(json.dumps({
        "status": "PASS-unapplied-isolated-check-only", "exitCode": check.returncode,
        "command": [part.replace(str(stage), "<OWNED_STAGE>").replace(directory, "<OWNED_STAGE>") for part in command],
        "output": output.replace(str(stage), "<OWNED_STAGE>").replace(directory, "<OWNED_STAGE>"),
        "patchSha256": receipt["patchSha256"], "pinnedBaselines": receipt["files"],
        "parentOwnedCurrentReadOnlyHashes": {path: digest(ROOT / path) for path in protected},
        "limits": ["No application", "No Cargo/rustc/WGPU/GPUI execution", "Parent module and app registration still absent"],
    }, indent=2) + "\n")
    print(f"PASS: git apply --check inspected all {len(receipt['files'])} patches; originals and staged copies unchanged")
finally:
    # Only our unique own staging directory is removed; no shared /tmp roots.
    shutil.rmtree(stage)
