#!/usr/bin/env python3
"""Only Python AST, exact patch reconstruction and unapplied context checks."""
from pathlib import Path
import ast
import hashlib
import importlib.util
import json
import subprocess
import sys


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("owned_rebase_syntax", HERE / "check_rebase.py")
    syntax = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(syntax)
    pins = json.loads((HERE / "native-adaptation-pins.json").read_text())
    pairs = [
        ("desktop/gpui/src/app.rs", "native-observation.patch"),
        ("desktop/gpui/fixtures/dossier-image-lifecycle/native-proof/check-native.py", "native-driver-adaptation.patch"),
    ]
    checks = []
    for target, patch_name in pairs:
        original = (ROOT / target).read_text()
        assert digest(original.encode()) == pins["baseSha256"][target], ("Parent input drifted", target)
        patch = HERE / patch_name
        proposed = syntax.reconstruct(original, patch.read_text())
        assert digest(proposed.encode()) == pins["proposedSha256"][target]
        if target.endswith(".py"):
            ast.parse(proposed, filename=target)
            assert 'active=9' not in proposed and 'active != 9' not in proposed
            assert 'for reviewed in range(8):' in proposed
            assert 'ui.prove_retired(old_viewport, sequence, old_viewport & initial_uploaded)' in proposed
            assert 'ui.prove_retired(new_viewport, sequence, new_viewport & resized_uploaded)' in proposed
            assert 'route_proof = ui.prove_retired(initial_ids, sequence, initial_uploaded)' in proposed
            assert '"native-house"' in proposed and '"dossier-error"' in proposed
        else:
            addition = proposed[proposed.index('        snapshot["foxing"]'):proposed.index('        Some(snapshot)', proposed.index('        snapshot["foxing"]'))]
            assert 'window.supports_destination_multiply()' in addition
            assert '.clone()' not in addition and 'drop_image' not in addition and 'prepare(' not in addition
        result = subprocess.run(["rtk", "proxy", "git", "apply", "--check", "--whitespace=error", str(patch)],
            cwd=ROOT, capture_output=True, text=True)
        assert result.returncode == 0, (patch_name, result.stdout, result.stderr)
        assert digest((ROOT / target).read_bytes()) == pins["baseSha256"][target]
        checks.append({"patch": patch_name, "target": target, "exitCode": result.returncode,
            "stdout": result.stdout, "stderr": result.stderr})
    for name in ["build_native_adaptation.py", "check_native_adaptation.py", "native_driver_helpers.py", "driver_contract_tests.py"]:
        ast.parse((HERE / name).read_text(), filename=name)
    helper = ROOT / "desktop/gpui/fixtures/dossier-native/check-native.py"
    old_pins = json.loads((ROOT / "desktop/gpui/fixtures/dossier-image-lifecycle/native-proof/source-pins.json").read_text())
    expected_helper = old_pins["sourceSha256"][str(helper.relative_to(ROOT))]
    actual_helper = digest(helper.read_bytes())
    receipt = {
        "status": "Pinned unapplied adaptation / Python AST / git-apply checks only",
        "checks": checks, "originalNativeHelperSha256": expected_helper,
        "currentNativeHelperSha256": actual_helper,
        "originalHelperPinStillCurrent": expected_helper == actual_helper,
        "syntheticPredicateTestsAuthored": 6, "syntheticTestsExecuted": False,
        "nativeDriverExecuted": False, "sharedFilesWritten": False,
        "realStampGateStillRequiresAllEight": True,
        "rootCargoNativeExecutionRequired": True,
    }
    (HERE / "native-adaptation-check-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
