#!/usr/bin/env python3
"""Render the newsreel using the bundled Chrome with this Linux host's working GL backend.

HyperFrames 0.8.78 requests ANGLE gl-egl on Linux; this host exposes its Intel
GPU through ANGLE gl. Only that launch flag is translated; the composition,
canonical shader treatments and bundled browser remain unchanged.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

project = Path(__file__).resolve().parents[2] / "04-newsreel"
cli = ["rtk", "proxy", "npx", "--yes", "hyperframes@0.8.78"]
browser = subprocess.check_output(cli + ["browser", "path"], cwd=project, text=True).strip()
with tempfile.TemporaryDirectory(prefix="twyne-render-browser-") as temporary:
    wrapper = Path(temporary) / "chrome-headless-shell"
    wrapper.write_text(
        f"#!{sys.executable}\nimport os, sys\nbinary = {browser!r}\n"
        "args = ['--use-angle=gl' if arg == '--use-angle=gl-egl' else arg for arg in sys.argv[1:]]\n"
        "os.execv(binary, [binary, *args])\n"
    )
    wrapper.chmod(0o755)
    environment = dict(os.environ, HYPERFRAMES_BROWSER_PATH=str(wrapper))
    subprocess.run(cli + [
        "render", "--browser-gpu", "--workers", "2", "--quality", "delivery",
        "--output", "../renders/04-newsreel.mp4",
    ], cwd=project, env=environment, check=True)
