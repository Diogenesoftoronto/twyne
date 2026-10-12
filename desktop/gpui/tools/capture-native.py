#!/usr/bin/env python3
"""Render Twyne in an isolated Xvfb display; never use the user's desktop."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument("--binary", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--geometry", help="Write observed interface bounds from the UI-test build")
parser.add_argument("--width", type=int, default=1280)
parser.add_argument("--height", type=int, default=860)
parser.add_argument("--state", choices=["quiet", "writing", "slash", "slash-filtered", "slash-form", "slash-endnote", "slash-footnote", "slash-mermaid", "slash-math-inline", "slash-math-block", "desk", "drawer", "board", "source", "proof", "split", "dossier", "settings", "account", "account-error", "versions", "house", "library", "flow", "tools", "marginalia", "margin-thread", "margin-composer", "cast", "editors", "analysis", "rubric", "galley", "apparatus", "apparatus-page", "sentence-lab", "rhythm-strip", "claim-check", "reader-questions"], default="quiet")
parser.add_argument("--fixture")
parser.add_argument("--comments")
parser.add_argument("--comments-folio")
parser.add_argument("--cast")
parser.add_argument("--cast-folio")
parser.add_argument("--rubric")
parser.add_argument("--rubric-folio")
parser.add_argument("--apparatus")
parser.add_argument("--apparatus-folio")
args = parser.parse_args()
if not 320 <= args.width <= 3840 or not 360 <= args.height <= 2160:
    parser.error("Capture size must be 320–3840 by 360–2160 pixels.")
if bool(args.comments) != bool(args.comments_folio):
    parser.error("--comments and --comments-folio must be provided together")
if bool(args.cast) != bool(args.cast_folio):
    parser.error("--cast and --cast-folio must be provided together")
if bool(args.rubric) != bool(args.rubric_folio):
    parser.error("--rubric and --rubric-folio must be provided together")
if bool(args.apparatus) != bool(args.apparatus_folio):
    parser.error("--apparatus and --apparatus-folio must be provided together")
for executable in ("Xvfb", "xwd", "magick"):
    if not shutil.which(executable):
        parser.error(f"{executable} is required; run inside the project's Devenv shell.")

with tempfile.TemporaryDirectory(prefix="twyne-native-render-") as temporary:
    root = Path(temporary)
    # Let Xvfb allocate an unused display, with no TCP listener.
    read_fd, write_fd = os.pipe()
    # GPUI's X11 backend offsets a new window by two pixels. Leave room for
    # the full client and capture that window, so root-screen position never
    # shifts the comparison or clips the application's right edge.
    screen = f"{args.width + 4}x{args.height + 4}x24"
    server = subprocess.Popen(["Xvfb", "-displayfd", str(write_fd), "-screen", "0", screen, "-nolisten", "tcp"], pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    os.close(write_fd)
    app = None
    try:
        with os.fdopen(read_fd) as display_file:
            number = display_file.readline().strip()
        if not number:
            raise RuntimeError("The isolated display did not start.")
        environment = os.environ.copy()
        environment.pop("WAYLAND_DISPLAY", None)
        environment["DISPLAY"] = f":{number}"
        environment["GPUI_X11_SCALE_FACTOR"] = "1"
        environment["XDG_RUNTIME_DIR"] = str(root)
        if environment.get("TWYNE_GPUI_RENDER_ICD"):
            environment["VK_DRIVER_FILES"] = environment["TWYNE_GPUI_RENDER_ICD"]
        command = [str(Path(args.binary).resolve()), "--data-dir", str(root / "library"), "--capture-state", args.state, "--capture-size", f"{args.width}x{args.height}"]
        if args.fixture:
            command.append(str(Path(args.fixture).resolve()))
        if args.comments:
            command.extend(["--capture-comments", str(Path(args.comments).resolve()), "--capture-comments-folio", args.comments_folio])
        if args.cast:
            command.extend(["--capture-cast", str(Path(args.cast).resolve()), "--capture-cast-folio", args.cast_folio])
        if args.rubric:
            command.extend(["--capture-rubric", str(Path(args.rubric).resolve()), "--capture-rubric-folio", args.rubric_folio])
        if args.apparatus:
            command.extend(["--capture-apparatus", str(Path(args.apparatus).resolve()), "--capture-apparatus-folio", args.apparatus_folio])
        if args.geometry:
            command.extend(["--capture-geometry", str(Path(args.geometry).resolve()), "--capture-geometry-watch"])
        with (root / "app.log").open("w") as log:
            app = subprocess.Popen(command, env=environment, stdout=log, stderr=log)
            # Wait for the application to render, bounded and isolated. The
            # saved image is native pixels, independent of GPUI's test fonts.
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if app.poll() is not None:
                    raise RuntimeError((root / "app.log").read_text())
                if args.geometry:
                    status = (root / "app.log").read_text()
                    if "TWYNE_CAPTURE_GEOMETRY_ERROR" in status:
                        raise RuntimeError(status)
                    if "TWYNE_CAPTURE_GEOMETRY_READY" not in status:
                        time.sleep(0.1)
                        continue
                    try:
                        if not json.loads(Path(args.geometry).read_text()).get("captureReady", False):
                            time.sleep(0.1)
                            continue
                    except (FileNotFoundError, json.JSONDecodeError):
                        time.sleep(0.1)
                        continue
                if args.state in ("source", "proof", "split"):
                    status = (root / "app.log").read_text()
                    if "TWYNE_CAPTURE_PROOF_ERROR" in status:
                        raise RuntimeError(status)
                    if "TWYNE_CAPTURE_PROOF_READY" not in status:
                        time.sleep(0.25)
                        continue
                if args.state == "library" and "TWYNE_CAPTURE_LIBRARY_READY" not in (root / "app.log").read_text():
                    time.sleep(0.25)
                    continue
                if args.state == "flow":
                    status = (root / "app.log").read_text()
                    if "TWYNE_CAPTURE_FLOW_ERROR" in status:
                        raise RuntimeError(status)
                    if "TWYNE_CAPTURE_FLOW_READY" not in status:
                        time.sleep(0.25)
                        continue
                    # Original chrome fade lasts 1.2 seconds after the mode
                    # transition. Record its settled native pixels.
                    time.sleep(1.25)
                time.sleep(0.25)
                capture = subprocess.run(["xwd", "-name", "Twyne", "-silent", "-out", str(root / "frame.xwd")], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                # Asset preparation can finish after the first poll. An absent
                # window is not a frame, so wait within the same deadline.
                if capture.returncode:
                    time.sleep(0.1)
                    continue
                subprocess.run(["magick", str(root / "frame.xwd"), str(root / "frame.png")], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                # GPUI clears the client surface to the paper palette. Until
                # its first rendered frame, that surface remains black.
                sample_position = f"%[pixel:p{{{args.width // 2},{args.height // 2}}}]"
                sample = subprocess.check_output(["magick", str(root / "frame.png"), "-format", sample_position, "info:"]).decode()
                if sample not in ("srgb(0,0,0)", "gray(0)"):
                    time.sleep(0.4)
                    subprocess.run(["xwd", "-name", "Twyne", "-silent", "-out", str(root / "frame.xwd")], env=environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    dimensions = subprocess.check_output(["magick", str(root / "frame.xwd"), "-format", "%wx%h", "info:"]).decode()
                    if dimensions != f"{args.width}x{args.height}":
                        raise RuntimeError(f"Unexpected native client size: {dimensions}")
                    subprocess.run(["magick", str(root / "frame.xwd"), str(Path(args.output).resolve())], check=True)
                    print(f"Native {args.state} render: {Path(args.output).resolve()}")
                    break
            else:
                raise RuntimeError("No native frame was rendered.\n" + (root / "app.log").read_text())
    finally:
        if app is not None and app.poll() is None:
            app.terminate()
            try:
                app.wait(timeout=5)
            except subprocess.TimeoutExpired:
                app.kill()
                app.wait()
        server.terminate()
        server.wait(timeout=5)
