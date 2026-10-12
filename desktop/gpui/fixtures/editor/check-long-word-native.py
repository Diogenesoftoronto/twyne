#!/usr/bin/env python3
"""Render the original browser fixture on a newly owned native Xvfb display."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

output = Path(os.environ.get("TWYNE_LONG_WORD_NATIVE_OUTPUT", "/tmp/twyne-long-word-native"))
output.mkdir(parents=True, exist_ok=True)
reference_path = Path(os.environ.get("TWYNE_LONG_WORD_REFERENCE", "/tmp/twyne-long-word-web/reference.json"))
reference = json.loads(reference_path.read_text())
height = int(os.environ.get("TWYNE_RICH_FIXTURE_HEIGHT", "1900"))
assert 700 <= height <= 4096, "Bounded fixture height is required"
probe = Path(__file__).resolve().parents[2] / "target/debug/examples/twyne-clipboard-probe"
xvfb_bin = shutil.which("Xvfb")
if not xvfb_bin or not probe.exists():
    raise SystemExit("Use devenv shell and build --example twyne-clipboard-probe first.")
with (output / "xvfb.log").open("wb") as log:
    xvfb = subprocess.Popen([xvfb_bin, "-displayfd", "1", "-screen", "0", f"680x{height}x24", "-nolisten", "tcp"], stdout=subprocess.PIPE, stderr=log)
    process = None
    try:
        display = ":" + xvfb.stdout.readline().decode().strip()
        assert display != ":", "Owned Xvfb did not allocate a display"
        env = {**os.environ, "DISPLAY": display, "XDG_RUNTIME_DIR": str(output), "GPUI_X11_SCALE_FACTOR": "1"}
        env.pop("WAYLAND_DISPLAY", None)
        env.pop("GPUI_HEADLESS", None)
        if env.get("TWYNE_GPUI_RENDER_ICD"):
            env["VK_DRIVER_FILES"] = env["TWYNE_GPUI_RENDER_ICD"]
        config = output / "config.json"
        result = output / "native.json"
        ready = output / "ready"
        release = output / "release"
        ready.unlink(missing_ok=True)
        release.unlink(missing_ok=True)
        config.write_text(json.dumps({"html": reference["html"], "output": str(result), "height":height, "comments_quiet":os.environ.get("TWYNE_NATIVE_COMMENTS_QUIET") == "1"}))
        process = subprocess.Popen([str(probe), "wrap", display, str(config), str(ready), str(release)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        until = time.monotonic() + 15
        while not ready.exists():
            if process.poll() is not None:
                raise RuntimeError(process.stderr.read().decode())
            if time.monotonic() > until:
                raise RuntimeError("Native wrap fixture did not prepaint")
            time.sleep(0.02)
        subprocess.run([shutil.which("import"), "-display", display, "-window", "root", str(output / "native.png")], env=env, capture_output=True, check=True, timeout=8)
        release.write_text("release")
        stdout, stderr = process.communicate(timeout=10)
        assert process.returncode == 0, stderr.decode()
        native = json.loads(result.read_text())
        exact = []
        for index, (web, measured) in enumerate(zip(reference["paragraphs"], native["paragraphs"], strict=True)):
            assert measured["source"] == web["source"]
            assert len(measured["lines"]) >= 1
            if len(web["lines"]) > 1:
                assert len(measured["lines"]) > 1
            assert max(line["right"] for line in measured["lines"]) <= measured["right"] + 0.5, (index, measured)
            exact.append(measured["lineTexts"] == web["lineTexts"])
        comparison = {"display": "new isolated Xvfb (terminated)", "browser": reference["browser"], "blockedNetworkRequests":reference["blockedNetworkRequests"], "native":native["backend"], "source_preserved":True, "all_line_bounds_within_page":True, "exact_line_texts_by_case": exact}
        (output / "comparison.json").write_text(json.dumps(comparison, indent=2) + "\n")
        print(json.dumps({"output":str(output), **comparison}))
    finally:
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=3)
        xvfb.terminate()
        xvfb.wait(timeout=3)
