#!/usr/bin/env python3
"""Check or render the Seedance desk scene with this host's Chrome backend."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
project = root / "social-preview-video"
cli = ["rtk", "proxy", "npx", "--yes", "hyperframes@0.8.93"]
operation = sys.argv[1] if len(sys.argv) > 1 else "render"
if operation not in {"check", "render"}:
    raise SystemExit("Usage: render-social-video.py [check|render]")
if not (project / "assets/desk-seedance.mp4").is_file():
    raise SystemExit("Generate the Seedance 2.5 scene and run build-social-video.ts first.")

browser = subprocess.check_output(cli + ["browser", "path"], cwd=project, text=True).strip()
with tempfile.TemporaryDirectory(prefix="twyne-desk-browser-") as temporary:
    wrapper = Path(temporary) / "chrome-headless-shell"
    # The Intel Mesa backend on this workstation needs ANGLE gl. Preserve every
    # other renderer flag and the exact bundled browser selected by the CLI.
    wrapper.write_text(
        f"#!{sys.executable}\nimport os, sys\nbinary = {browser!r}\n"
        "args = ['--use-angle=gl' if arg == '--use-angle=gl-egl' else arg for arg in sys.argv[1:]]\n"
        "os.execv(binary, [binary, *args])\n"
    )
    wrapper.chmod(0o755)
    environment = dict(os.environ, HYPERFRAMES_BROWSER_PATH=str(wrapper))
    if operation == "check":
        result = subprocess.run(
            cli + ["check", "--json", "--snapshots", "--at", "0,1.5,3,4.5,5.9"],
            cwd=project, env=environment, text=True, capture_output=True,
        )
        (project / "seedance-check.json").write_text(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        try:
            report = json.loads(result.stdout)
            print(json.dumps({
                key: report.get(key)
                for key in ["ok", "lint", "runtime", "layout", "motion", "contrast", "snapshots"]
            }, indent=2))
        except json.JSONDecodeError:
            print(result.stdout)
        raise SystemExit(result.returncode)
    subprocess.run(
        cli + [
            "render", "--browser-gpu", "--workers", "2", "--fps", "30",
            "--quality", "delivery", "--strict", "--output",
            str(root / "public/assets/social/twyne-writers-desk-seedance-v1.mp4"),
        ],
        cwd=project, env=environment, check=True,
    )
