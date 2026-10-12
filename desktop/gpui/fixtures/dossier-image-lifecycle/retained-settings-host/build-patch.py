#!/usr/bin/env python3
"""Write only a small unapplied test-child inclusion and its exact base pin."""

import difflib
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
RELATIVE = "desktop/gpui/src/app.rs"


def main():
    original = (ROOT / RELATIVE).read_text(encoding="utf8")
    before = '''#[cfg(all(test, feature = "ui-tests"))]
mod dossier_filing_tests;
'''
    after = before + '''#[cfg(all(test, feature = "ui-tests", any(target_os = "linux", target_os = "freebsd")))]
#[path = "../fixtures/dossier-image-lifecycle/retained-settings-host/host_tests.rs"]
mod dossier_retained_settings_host;
'''
    assert original.count(before) == 1, "Root test inclusion seam changed; re-review it"
    candidate = original.replace(before, after, 1)
    patch = f"diff --git a/{RELATIVE} b/{RELATIVE}\n" + "".join(difflib.unified_diff(
        original.splitlines(keepends=True), candidate.splitlines(keepends=True),
        fromfile=f"a/{RELATIVE}", tofile=f"b/{RELATIVE}", n=3))
    (HERE / "integration.patch").write_text(patch, encoding="utf8")
    (HERE / "patch-base.json").write_text(json.dumps({"schema": 1, "sourceSha256": {
        RELATIVE: hashlib.sha256(original.encode()).hexdigest(),
    }}, indent=2) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
