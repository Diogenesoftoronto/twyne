#!/usr/bin/env python3
"""Drive local Cast routes and durable replies on a newly allocated X11 display."""

import argparse
import ctypes as C
import glob
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument("--binary", required=True)
parser.add_argument("--fixture", required=True)
parser.add_argument("--cast", required=True)
parser.add_argument("--cast-folio", required=True)
parser.add_argument("--output", default="/tmp/twyne-cast-host-native")
args = parser.parse_args()
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
checks = []

with tempfile.TemporaryDirectory(prefix="twyne-cast-host-") as temporary:
    root = Path(temporary)
    geometry_path = root / "geometry.json"
    log_path = output / "app.log"
    read_fd, write_fd = os.pipe()
    server = subprocess.Popen(
        ["Xvfb", "-displayfd", str(write_fd), "-screen", "0", "1284x864x24", "-nolisten", "tcp"],
        pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    os.close(write_fd)
    app = None
    connection = None
    log = None
    try:
        with os.fdopen(read_fd) as reader:
            number = reader.readline().strip()
        assert number, "Owned Xvfb did not start"
        display = ":" + number
        env = {**os.environ, "DISPLAY": display, "XDG_RUNTIME_DIR": str(root), "GPUI_X11_SCALE_FACTOR": "1"}
        env.pop("WAYLAND_DISPLAY", None)
        env.pop("GPUI_HEADLESS", None)
        if env.get("TWYNE_GPUI_RENDER_ICD"):
            env["VK_DRIVER_FILES"] = env["TWYNE_GPUI_RENDER_ICD"]
        log = log_path.open("w")
        app = subprocess.Popen(
            [str(Path(args.binary).resolve()), "--data-dir", str(root / "library"),
             "--capture-state", "writing", "--capture-size", "1280x860",
             "--capture-geometry", str(geometry_path), "--capture-geometry-watch",
             "--capture-cast", str(Path(args.cast).resolve()), "--capture-cast-folio", args.cast_folio,
             str(Path(args.fixture).resolve())],
            env=env, stdout=log, stderr=log,
        )

        def node(state, identifier):
            matches = [item for item in state["elements"] if item["path"][-1] == f'Name("{identifier}")']
            assert len(matches) <= 1, identifier
            return matches[0] if matches else None

        def wait(predicate):
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                if app.poll() is not None:
                    raise RuntimeError(log_path.read_text())
                try:
                    state = json.loads(geometry_path.read_text())
                    if predicate(state):
                        return state
                except (FileNotFoundError, json.JSONDecodeError):
                    pass
                time.sleep(0.025)
            raise TimeoutError("Native Cast did not reach the expected rendered state")

        def wait_file(predicate):
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                try:
                    record = json.loads(cast_path.read_text())
                    if predicate(record):
                        return record
                except (FileNotFoundError, json.JSONDecodeError):
                    pass
                time.sleep(0.025)
            raise TimeoutError("Cast did not reach the expected durable state")

        state = wait(lambda value: node(value, "toggle-notebook") is not None)
        origin = (state["windowOrigin"]["x"], state["windowOrigin"]["y"])
        x11 = glob.glob("/nix/store/*-lib[Xx]11-*/lib/libX11.so.6*")
        xtest = glob.glob("/nix/store/*-lib[Xx]tst-*/lib/libXtst.so.6*")
        libx = C.CDLL(os.environ.get("TWYNE_X11_LIBRARY") or (x11[0] if x11 else "libX11.so.6"))
        libt = C.CDLL(os.environ.get("TWYNE_XTEST_LIBRARY") or (xtest[0] if xtest else "libXtst.so.6"))
        libx.XOpenDisplay.argtypes, libx.XOpenDisplay.restype = [C.c_char_p], C.c_void_p
        libx.XCloseDisplay.argtypes = [C.c_void_p]
        libx.XFlush.argtypes = [C.c_void_p]
        libx.XStringToKeysym.argtypes, libx.XStringToKeysym.restype = [C.c_char_p], C.c_ulong
        libx.XKeysymToKeycode.argtypes, libx.XKeysymToKeycode.restype = [C.c_void_p, C.c_ulong], C.c_uint
        libx.XDefaultRootWindow.argtypes, libx.XDefaultRootWindow.restype = [C.c_void_p], C.c_ulong
        libx.XQueryTree.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ulong)), C.POINTER(C.c_uint)]
        libx.XFetchName.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(C.c_void_p)]
        libx.XFree.argtypes = [C.c_void_p]
        libx.XSetInputFocus.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_ulong]
        libt.XTestFakeMotionEvent.argtypes = [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong]
        libt.XTestFakeButtonEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
        libt.XTestFakeKeyEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
        connection = libx.XOpenDisplay(display.encode())
        assert connection
        # Xvfb has no window manager to activate the client. Keyboard action
        # handlers can still receive events via PointerRoot, but the native
        # text-input handler requires actual platform activation.
        tree_root, tree_parent, count = C.c_ulong(), C.c_ulong(), C.c_uint()
        children = C.POINTER(C.c_ulong)()
        assert libx.XQueryTree(connection, libx.XDefaultRootWindow(connection), C.byref(tree_root), C.byref(tree_parent), C.byref(children), C.byref(count))
        owned_window = None
        try:
            for index in range(count.value):
                name = C.c_void_p()
                if libx.XFetchName(connection, children[index], C.byref(name)) and name.value:
                    try:
                        if C.string_at(name.value) == b"Twyne":
                            owned_window = children[index]
                    finally:
                        libx.XFree(name)
        finally:
            libx.XFree(children)
        assert owned_window is not None, "The observed owned Twyne window is missing"
        libx.XSetInputFocus(connection, owned_window, 1, 0)
        libx.XFlush(connection)
        wait(lambda value: value["windowActive"])
        checks.append("Owned X11 window is actually activated before text input")

        def key(name, down):
            code = libx.XKeysymToKeycode(connection, libx.XStringToKeysym(name.encode()))
            assert code and libt.XTestFakeKeyEvent(connection, code, int(down), 0)
            libx.XFlush(connection)
            time.sleep(0.025)

        def press(name, shift=False, control=False):
            if control:
                key("Control_L", True)
            if shift:
                key("Shift_L", True)
            key(name, True)
            key(name, False)
            if shift:
                key("Shift_L", False)
            if control:
                key("Control_L", False)

        def type_ascii(text):
            for character in text:
                if character == " ":
                    press("space")
                elif character == "!":
                    press("1", shift=True)
                else:
                    assert character.isascii() and character.islower()
                    press(character)

        def click_item(item):
            rect = item["rect"]
            assert libt.XTestFakeMotionEvent(connection, 0, round(origin[0] + rect["x"] + rect["width"] / 2), round(origin[1] + rect["y"] + rect["height"] / 2), 0)
            assert libt.XTestFakeButtonEvent(connection, 1, 1, 0)
            assert libt.XTestFakeButtonEvent(connection, 1, 0, 0)
            libx.XFlush(connection)
            time.sleep(0.075)

        def click(identifier):
            state = wait(lambda value: fully_visible(value, node(value, identifier)))
            click_item(node(state, identifier))

        def fully_visible(state, target):
            if target is None or not target["visible"]:
                return False
            rect = target["rect"]
            top, bottom = 0, state["viewport"]["height"]
            if 'Name("cast-scroll")' in target["path"]:
                scroll = node(state, "cast-scroll")["rect"]
                top = max(top, scroll["y"])
                bottom = min(bottom, scroll["y"] + scroll["height"])
            return top <= rect["y"] and rect["y"] + rect["height"] <= bottom

        def reveal(identifier):
            for _ in range(30):
                state = wait(lambda value: node(value, "cast-scroll") is not None)
                target = node(state, identifier)
                if fully_visible(state, target):
                    return
                rect = node(state, "cast-scroll")["rect"]
                direction = 4 if target is not None and target["rect"]["y"] < rect["y"] else 5
                libt.XTestFakeMotionEvent(connection, 0, round(origin[0] + rect["x"] + rect["width"] / 2), round(origin[1] + rect["y"] + rect["height"] / 2), 0)
                for _ in range(3):
                    libt.XTestFakeButtonEvent(connection, direction, 1, 0)
                    libt.XTestFakeButtonEvent(connection, direction, 0, 0)
                libx.XFlush(connection)
                # Geometry observation is sampled independently of XTEST.
                # Let the rendered wheel response settle before selecting
                # a target; a partially clipped button is not a click point.
                time.sleep(0.3)
            raise AssertionError(f"{identifier} must be reachable")

        def screenshot(name):
            xwd = root / "frame.xwd"
            subprocess.run(["xwd", "-display", display, "-name", "Twyne", "-silent", "-out", str(xwd)], env=env, check=True, capture_output=True)
            subprocess.run(["magick", str(xwd), str(output / name)], check=True, capture_output=True)

        def focus_reply():
            reveal("cast-reply-input-0")
            click("cast-reply-input-0")
            state = wait(lambda value: any(item["focused"] and 'Name("cast-reply-input-0")' in item["path"] for item in value["elements"]))
            (output / "reply-focused-geometry.json").write_text(json.dumps(state, indent=2) + "\n")

        def reply_text_is(state, text):
            return any(
                'Name("cast-reply-input-0")' in item["path"]
                and item.get("role") == "MultilineTextInput"
                and item.get("value") == text
                for item in state["elements"]
            )

        click("toggle-notebook")
        state = wait(lambda value: node(value, "cast-root") is not None)
        assert node(state, "cast-get-notes")["disabled"] is True
        assert node(state, "cast-propose-edits")["disabled"] is True
        checks.append("Actual Board opening mounts local Cast; provider controls are disabled")
        cast_path = root / "library/cast.json"
        initial_cast = json.loads(cast_path.read_text())
        scope = next(identifier for identifier in initial_cast["folios"] if identifier != "unimported/foreign")
        note = "pn-source:one"
        documents = list((root / "library/manuscripts").glob("*.json"))
        assert len(documents) == 1
        canonical = documents[0].read_bytes()
        (output / "original-manuscript.json").write_bytes(canonical)
        screenshot("cast-retained.png")
        (output / "cast-retained-geometry.json").write_text(json.dumps(state, indent=2) + "\n")
        reveal("cast-reply-open-0")
        click("cast-reply-open-0")
        focus_reply()
        text = "cast keeps the final character!"
        type_ascii(text)
        state = wait(lambda value: value["keyboardInput"] and reply_text_is(value, text))
        (output / "reply-typed-geometry.json").write_text(json.dumps(state, indent=2) + "\n")
        screenshot("reply-typed.png")
        click("cast-edit-roster")
        state = wait(lambda value: node(value, "cast-new-editor") is not None)
        (output / "manager-geometry.json").write_text(json.dumps(state, indent=2) + "\n")
        # AccessKit omits disabled for enabled controls; true is the only
        # disabled value. Prove activation with actual New/Cancel below.
        assert node(state, "cast-new-editor")["disabled"] is not True
        saved = wait_file(lambda record: record.get("replyDrafts", {}).get(scope, {}).get(note) == text)
        checks.append("Actual final keystroke is durable before Manager opens; local New editor is enabled")
        screenshot("manager.png")
        click("cast-new-editor")
        wait(lambda value: node(value, "cast-editor-form") is not None)
        reveal("cast-editor-cancel")
        click("cast-editor-cancel")
        wait(lambda value: node(value, "cast-editor-form") is None)
        checks.append("Actual New editor opens its local form and Cancel returns without changing the roster")
        reveal("cast-back-to-desk")
        click("cast-back-to-desk")
        wait(lambda value: node(value, "cast-edit-roster") is not None)
        focus_reply()
        type_ascii("z")
        wait(lambda value: reply_text_is(value, text + "z"))
        backup = cast_path.with_suffix(".json.bak")
        prior_backup = backup.read_bytes()
        backup.unlink()
        backup.mkdir()
        accepted_bytes = cast_path.read_bytes()
        click("cast-edit-roster")
        state = wait(lambda value: node(value, "cast-save-error") is not None)
        assert node(state, "cast-new-editor") is None
        assert cast_path.read_bytes() == accepted_bytes
        assert documents[0].read_bytes() == canonical
        checks.append("A real failed metadata write keeps Cast open and preserves accepted disk bytes and manuscript")
        screenshot("failed-write.png")
        backup.rmdir()
        backup.write_bytes(prior_backup)
        click("cast-save-retry")
        saved = wait_file(lambda record: record.get("replyDrafts", {}).get(scope, {}).get(note) == text + "z")
        wait(lambda value: node(value, "cast-save-error") is None and node(value, "cast-saving") is None)
        checks.append("Actual Retry files the held request including its final character")
        click("cast-edit-roster")
        wait(lambda value: node(value, "cast-new-editor") is not None)
        click("cast-back-to-desk")
        wait(lambda value: node(value, "cast-analysis") is not None)
        click("cast-analysis")
        wait(lambda value: node(value, "cast-analysis-download") is not None)
        screenshot("analysis.png")
        click("cast-analysis-back")
        wait(lambda value: node(value, "cast-edit-roster") is not None)
        checks.append("Actual Manager and retained Full Analysis return to the same Cast Board")
        reveal("cast-file-reply-0")
        click("cast-file-reply-0")
        expected_replies = len(initial_cast["folios"][scope]["replies"]) + 1
        saved = wait_file(lambda record: len(record["folios"][scope]["replies"]) == expected_replies)
        assert saved["folios"][scope]["replies"][-1]["text"] == text + "z"
        assert note not in saved.get("replyDrafts", {}).get(scope, {})
        assert saved["folios"][scope]["notes"] == initial_cast["folios"][scope]["notes"]
        assert saved["folios"]["unimported/foreign"] == initial_cast["folios"]["unimported/foreign"]
        checks.append("File only adds one real writer reply; note IDs, raw fields and foreign data remain exact")
        reveal("cast-reply-open-0")
        click("cast-reply-open-0")
        focus_reply()
        final_draft = "held on quit!"
        type_ascii(final_draft)
        wait(lambda value: reply_text_is(value, final_draft))
        press("q", control=True)
        app.wait(timeout=12)
        assert app.returncode == 0, log_path.read_text()
        final = json.loads(cast_path.read_text())
        assert final["replyDrafts"][scope][note] == final_draft
        assert len(final["folios"][scope]["replies"]) == expected_replies
        assert final["folios"]["unimported/foreign"] == initial_cast["folios"]["unimported/foreign"]
        assert documents[0].read_bytes() == canonical
        checks.append("Actual Ctrl-Q captures the unblurred reply draft and preserves the exact canonical manuscript")
        (output / "final-cast.json").write_text(json.dumps(final, ensure_ascii=False, indent=2) + "\n")
        (output / "final-manuscript.json").write_bytes(documents[0].read_bytes())
        acceptance = {"display": "new isolated Xvfb, terminated", "backend": "X11", "input": "separate-process XTEST", "fixture": "explicit retained test metadata; no provider activity", "checks": checks}
        (output / "acceptance.json").write_text(json.dumps(acceptance, indent=2) + "\n")
        print(json.dumps({"output": str(output), "checks": checks}))
    finally:
        if geometry_path.exists():
            (output / "last-geometry.json").write_bytes(geometry_path.read_bytes())
        retained_path = root / "library/cast.json"
        if retained_path.is_file():
            (output / "last-cast.json").write_bytes(retained_path.read_bytes())
        if connection is not None:
            libx.XCloseDisplay(connection)
        if app is not None and app.poll() is None:
            app.terminate()
            try:
                app.wait(timeout=5)
            except subprocess.TimeoutExpired:
                app.kill()
                app.wait()
        if log is not None:
            log.close()
        server.terminate()
        server.wait(timeout=5)
