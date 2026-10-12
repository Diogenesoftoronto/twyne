#!/usr/bin/env python3
"""Actual OS pointer/key input on a new owned Xvfb display; never user DISPLAY."""
import base64
import ctypes as C
import glob
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

output = Path(os.environ.get("TWYNE_BLOCK_DRAG_OUTPUT", "/tmp/twyne-block-drag-native"))
output.mkdir(parents=True, exist_ok=True)
probe = Path(__file__).resolve().parents[2] / "target/debug/examples/twyne-clipboard-probe"
landscape = Path(__file__).with_name("offline-landscape.png")
src = "data:image/png;base64," + base64.b64encode(landscape.read_bytes()).decode()
html = ('<h1>One</h1><p><span data-comment-id="kept" data-comment-author="You"><strong data-future="keep">東京🦊</strong></span> body.</p>'
        '<h2>Child</h2><p><span data-type="raw-typst-inline" data-typst-source="#authored[原稿]">Source</span> child.</p>'
        f'<figure data-type="image" src="{src}" data-image-width="20" data-future-image="exact"><figcaption>Kept caption</figcaption></figure>'
        '<h1>Two</h1><p>Second<sup data-type="endnote" data-endnote-text="Unchanged note"></sup>.</p>'
        '<div data-type="block-math" data-latex="x+1" data-future="equation">x+1</div><h1>Three</h1><p>Third.</p>')
config, ready, state, control, release = [output / name for name in ("config.json", "ready.json", "state.json", "control", "release")]
for path in (ready, state, control, release):
    path.unlink(missing_ok=True)
config.write_text(json.dumps({"html":html, "output":str(state), "control":str(control), "target":5, "atom":7}))
xvfb = subprocess.Popen([shutil.which("Xvfb"), "-displayfd", "1", "-screen", "0", "720x1000x24", "-nolisten", "tcp"], stdout=subprocess.PIPE, stderr=(output / "xvfb.log").open("wb"))
process = None
display_connection = None
checks = []
try:
    display = ":" + xvfb.stdout.readline().decode().strip()
    assert display != ":"
    env = {**os.environ, "DISPLAY":display, "XDG_RUNTIME_DIR":str(output), "GPUI_X11_SCALE_FACTOR":"1"}
    env.pop("WAYLAND_DISPLAY", None)
    env.pop("GPUI_HEADLESS", None)
    if env.get("TWYNE_GPUI_RENDER_ICD"):
        env["VK_DRIVER_FILES"] = env["TWYNE_GPUI_RENDER_ICD"]
    process = subprocess.Popen([str(probe), "drag", display, str(config), str(ready), str(release)], env=env, stdout=(output / "stdout.log").open("wb"), stderr=(output / "stderr.log").open("wb"))
    def wait(predicate):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError((output / "stderr.log").read_text())
            try:
                value = json.loads(state.read_text()) if state.exists() else None
                if predicate(value):
                    return value
            except (json.JSONDecodeError, FileNotFoundError):
                pass
            time.sleep(0.015)
        raise TimeoutError("Native state did not reach the expected boundary")
    wait(lambda _:ready.exists())
    geometry = json.loads(ready.read_text())
    initial = geometry["original"]
    x11_candidates = ([os.environ["TWYNE_X11_LIBRARY"]] if os.environ.get("TWYNE_X11_LIBRARY") else glob.glob("/nix/store/*-lib[Xx]11-*/lib/libX11.so.6*"))
    libx = C.CDLL(x11_candidates[0] if x11_candidates else "libX11.so.6")
    candidates = ([os.environ["TWYNE_XTEST_LIBRARY"]] if os.environ.get("TWYNE_XTEST_LIBRARY") else glob.glob("/nix/store/*-lib[Xx]tst-*/lib/libXtst.so.6*"))
    assert candidates, "An actual XTEST runtime is required"
    libt = C.CDLL(candidates[0])
    libx.XOpenDisplay.argtypes, libx.XOpenDisplay.restype = [C.c_char_p], C.c_void_p
    libx.XFlush.argtypes = [C.c_void_p]
    libx.XCloseDisplay.argtypes = [C.c_void_p]
    libx.XKeysymToKeycode.argtypes, libx.XKeysymToKeycode.restype = [C.c_void_p, C.c_ulong], C.c_uint
    libx.XStringToKeysym.argtypes, libx.XStringToKeysym.restype = [C.c_char_p], C.c_ulong
    libt.XTestFakeMotionEvent.argtypes = [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong]
    libt.XTestFakeButtonEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
    libt.XTestFakeKeyEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
    display_connection = libx.XOpenDisplay(display.encode())
    assert display_connection
    def move(point):
        x,y = point
        ox,oy = geometry["windowOrigin"]
        assert libt.XTestFakeMotionEvent(display_connection, 0, round(x+ox), round(y+oy), 0)
        libx.XFlush(display_connection)
        time.sleep(0.045)
    def button(down):
        assert libt.XTestFakeButtonEvent(display_connection, 1, int(down), 0)
        libx.XFlush(display_connection)
        time.sleep(0.045)
    def key(name, down=True):
        code = libx.XKeysymToKeycode(display_connection, libx.XStringToKeysym(name.encode()))
        assert code and libt.XTestFakeKeyEvent(display_connection, code, int(down), 0)
        libx.XFlush(display_connection)
        time.sleep(0.025)
    def press(name):
        key(name); key(name, False)
    def pickup(point):
        move(point); button(True); move([point[0]+12,point[1]])
        return wait(lambda value:value and value["dragging"])
    def screenshot(name):
        subprocess.run([shutil.which("import"), "-display", display, "-window", "root", str(output / name)], env=env, capture_output=True, check=True, timeout=8)
    screenshot("before.png")
    begun = pickup(geometry["handle"])
    assert begun["html"] == initial and begun["selection"] == [1,3] and not begun["undo"]
    move(geometry["target"])
    screenshot("preview.png")
    assert json.loads(state.read_text())["html"] == initial
    button(False)
    moved = wait(lambda value:value and not value["dragging"] and value["undo"])
    assert moved["html"].index("<h1>Two</h1>") < moved["html"].index("<h1>One</h1>") < moved["html"].index("<h1>Three</h1>")
    for exact in ('data-typst-source="#authored[原稿]"','data-future-image="exact"','data-endnote-text="Unchanged note"','data-comment-id="kept"', src):
        assert exact in moved["html"]
    assert "input" not in moved["events"]
    screenshot("moved.png")
    checks.append("OS pointer: closed section, object bytes and metadata preserved; neutral preview")
    key("Control_L"); press("z"); key("Control_L",False)
    undone = wait(lambda value:value and value["html"] == initial and not value["undo"])
    assert undone["selection"] == [1,3]
    checks.append("OS Ctrl-Z: exact original tree and selection, one undo")
    pickup(geometry["image"]); move(geometry["target"]); button(False)
    moved_image = wait(lambda value:value and not value["dragging"] and value["undo"])
    assert moved_image["html"].index("<h1>Two</h1>") < moved_image["html"].index('data-future-image="exact"') < moved_image["html"].index("Second")
    assert src in moved_image["html"] and 'Kept caption' in moved_image["html"]
    assert moved_image["selection"][0] < moved_image["selection"][1]
    key("Control_L"); press("z"); key("Control_L",False)
    undone = wait(lambda value:value and value["html"] == initial and not value["undo"])
    assert undone["selection"] == [1,3]
    checks.append("OS image drag: exact image bytes/caption/attributes, atomic selection and undo")
    preview_image = pickup(geometry["image"])
    assert preview_image["html"] == initial and preview_image["selection"] == [1,3] and not preview_image["undo"]
    press("Escape"); button(False)
    cancelled = wait(lambda value:value and not value["dragging"])
    assert cancelled["html"] == initial and cancelled["selection"] == [1,3] and not cancelled["undo"]
    checks.append("OS image pointer/Escape: preview and cancellation preserve source, selection and history")
    pickup(geometry["atom"]); move(geometry["lastTarget"]); button(False)
    moved_math = wait(lambda value:value and not value["dragging"] and value["undo"])
    assert moved_math["html"].index("<h1>Three</h1>") < moved_math["html"].index('data-future="equation"') < moved_math["html"].index("Third.")
    assert 'data-latex="x+1"' in moved_math["html"]
    key("Control_L"); press("z"); key("Control_L",False)
    undone = wait(lambda value:value and value["html"] == initial and not value["undo"])
    assert undone["selection"] == [1,3]
    checks.append("OS equation drag: authored math metadata and one-step undo preserved")
    pickup(geometry["handle"]); move(geometry["selfTarget"]); button(False)
    cancelled = wait(lambda value:value and not value["dragging"])
    assert cancelled["html"] == initial and cancelled["selection"] == [1,3] and not cancelled["undo"]
    checks.append("OS self-drop: source, selection and history unchanged")
    move(geometry["handle"]); button(True); button(False); press("Return")
    wait(lambda value:value and value["dragging"])
    press("Down"); press("Escape")
    cancelled = wait(lambda value:value and not value["dragging"])
    assert cancelled["html"] == initial and cancelled["selection"] == [1,3] and not cancelled["undo"]
    checks.append("OS keyboard: pickup/preview/Escape are neutral")
    pickup(geometry["handle"]); move(geometry["target"])
    control.write_text("edit")
    edited = wait(lambda value:value and "Background edit" in value["html"] and not value["dragging"])
    button(False)
    time.sleep(0.1)
    after_stale = json.loads(state.read_text())
    assert after_stale["html"] == edited["html"] and after_stale["revision"] == edited["revision"]
    key("Control_L"); press("z"); key("Control_L",False)
    undone = wait(lambda value:value and value["html"] == initial and not value["undo"])
    assert undone["selection"] == [1,3]
    checks.append("Late OS drop after a legitimate edit: refused; only the edit is undoable")
    pickup(geometry["handle"]); move(geometry["target"])
    control.write_text("readonly")
    wait(lambda value:value and value["readOnly"] and not value["dragging"])
    button(False)
    time.sleep(0.1)
    assert json.loads(state.read_text())["html"] == initial
    checks.append("Late OS drop after read-only: refused without mutation")
    release.write_text("done")
    process.wait(timeout=8)
    assert process.returncode == 0, (output / "stderr.log").read_text()
    (output / "acceptance.json").write_text(json.dumps({"display":"new isolated Xvfb, terminated", "input":"separate-process XTEST", "backend":"X11", "checks":checks},indent=2)+"\n")
    print(json.dumps({"output":str(output),"checks":checks}))
finally:
    if display_connection:
        libx.XCloseDisplay(display_connection)
    if process and process.poll() is None:
        process.terminate(); process.wait(timeout=3)
    xvfb.terminate(); xvfb.wait(timeout=3)
