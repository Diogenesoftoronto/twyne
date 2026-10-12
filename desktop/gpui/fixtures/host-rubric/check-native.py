#!/usr/bin/env python3
"""Drive local Rubric routes and durable criteria on a newly allocated X11 display."""

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
parser.add_argument("--rubric", required=True)
parser.add_argument("--rubric-folio", required=True)
parser.add_argument("--output", default="/tmp/twyne-rubric-host-native")
args = parser.parse_args()
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
checks = []

with tempfile.TemporaryDirectory(prefix="twyne-rubric-host-") as temporary:
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
             "--capture-rubric", str(Path(args.rubric).resolve()), "--capture-rubric-folio", args.rubric_folio,
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
            raise TimeoutError("Native Rubric did not reach the expected rendered state")

        def wait_file(predicate):
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                try:
                    record = json.loads(rubric_path.read_text())
                    if predicate(record):
                        return record
                except (FileNotFoundError, json.JSONDecodeError):
                    pass
                time.sleep(0.025)
            raise TimeoutError("Rubric did not reach the expected durable state")

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
                elif character == ".":
                    press("period")
                elif character.isdigit():
                    press(character)
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
            if 'Name("rubric-scroll")' in target["path"]:
                scroll = node(state, "rubric-scroll")["rect"]
                top = max(top, scroll["y"])
                bottom = min(bottom, scroll["y"] + scroll["height"])
            return top <= rect["y"] and rect["y"] + rect["height"] <= bottom

        def reveal(identifier):
            for _ in range(30):
                state = wait(lambda value: node(value, "rubric-scroll") is not None)
                target = node(state, identifier)
                if fully_visible(state, target):
                    return
                rect = node(state, "rubric-scroll")["rect"]
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

        def input_text_is(state, identifier, text, focused=False):
            return any(
                f'Name("{identifier}")' in item["path"]
                and item.get("role") in ("TextInput", "MultilineTextInput", "SpinButton")
                and item.get("value") == text
                and (not focused or item.get("focused"))
                for item in state["elements"]
            )

        def enter_input(identifier, text):
            # A durable file precedes the foreground acknowledgement. Controls
            # remain disabled while that exact candidate is still pending.
            wait(lambda value: node(value, "rubric-saving") is None and node(value, "rubric-save-error") is None)
            reveal(identifier)
            click(identifier)
            wait(lambda value: any(item.get("focused") and f'Name("{identifier}")' in item["path"] and item.get("role") in ("TextInput", "MultilineTextInput", "SpinButton") for item in value["elements"]))
            press("a", control=True)
            type_ascii(text)
            state = wait(lambda value: input_text_is(value, identifier, text, focused=True))
            (output / (identifier + "-focused.json")).write_text(json.dumps(state, indent=2) + "\n")
            return state

        def criteria(record):
            row = record["folios"][scope]
            return row.get("localCriteria", row["criteria"])

        def weight(record, identifier):
            return next(row["weight"] for row in criteria(record) if row["id"] == identifier)

        def unchanged_artifacts(record):
            row, original = record["folios"][scope], initial_rubric["folios"][scope]
            for field in ("result", "history", "liveReview", "futureArtifact"):
                assert row[field] == original[field], field
            assert record["folios"]["unmounted/foreign"] == initial_rubric["folios"]["unmounted/foreign"]
            assert record["legacy"] == initial_rubric["legacy"]
            assert documents[0].read_bytes() == canonical

        rubric_path = root / "library/rubric.json"
        initial_rubric = json.loads(rubric_path.read_text())
        scope = next(identifier for identifier in initial_rubric["folios"] if identifier != "unmounted/foreign")
        documents = list((root / "library/manuscripts").glob("*.json"))
        assert len(documents) == 1
        canonical = documents[0].read_bytes()
        (output / "original-manuscript.json").write_bytes(canonical)
        (output / "original-rubric.json").write_bytes(rubric_path.read_bytes())

        click("toggle-notebook")
        wait(lambda value: node(value, "board-tab-Rubric") is not None)
        click("board-tab-Rubric")
        state = wait(lambda value: node(value, "rubric-root") is not None and node(value, "rubric-grade-again") is not None)
        assert node(state, "rubric-grade-again")["disabled"] is True
        assert node(state, "rubric-tab-passages") is not None
        checks.append("Actual Rubric Board opens retained data with provider grading disabled")
        screenshot("rubric-board.png")
        (output / "rubric-board-geometry.json").write_text(json.dumps(state, indent=2) + "\n")

        click("rubric-tab-criteria")
        reveal("rubric-change-graded")
        click("rubric-change-graded")
        wait(lambda value: node(value, "rubric-weight-thesis") is not None)
        enter_input("rubric-weight-thesis", "2.25")
        reveal("rubric-full-report")
        click("rubric-full-report")
        state = wait(lambda value: node(value, "rubric-galley-back") is not None)
        saved = wait_file(lambda record: weight(record, "thesis") == 2.25)
        unchanged_artifacts(saved)
        checks.append("Final typed weight is durable before Galley opens; saved grades/history/passages and canonical bytes stay exact")
        screenshot("galley.png")
        (output / "galley-geometry.json").write_text(json.dumps(state, indent=2) + "\n")
        click("rubric-galley-back")
        wait(lambda value: node(value, "rubric-change-graded") is not None)
        checks.append("Actual Galley Back returns to the same scoped Rubric Board")

        state = wait(lambda value: node(value, "rubric-root") is not None)
        if node(state, "rubric-weight-thesis") is None:
            reveal("rubric-change-graded")
            click("rubric-change-graded")
        reveal("rubric-enable-voice")
        backup = rubric_path.with_suffix(".json.bak")
        prior_backup = backup.read_bytes() if backup.exists() else None
        if backup.exists():
            backup.unlink()
        backup.mkdir()
        accepted_bytes = rubric_path.read_bytes()
        old_voice = next(row["enabled"] for row in criteria(json.loads(accepted_bytes)) if row["id"] == "voice")
        click("rubric-enable-voice")
        state = wait(lambda value: node(value, "rubric-save-error") is not None)
        assert rubric_path.read_bytes() == accepted_bytes
        assert documents[0].read_bytes() == canonical
        reveal("rubric-full-report")
        click("rubric-full-report")
        state = wait(lambda value: node(value, "rubric-save-error") is not None)
        assert node(state, "rubric-galley-back") is None
        assert rubric_path.read_bytes() == accepted_bytes
        checks.append("Actual backup-write obstruction retains accepted bytes and blocks departure with the held criteria candidate")
        screenshot("failed-write.png")
        backup.rmdir()
        if prior_backup is not None:
            backup.write_bytes(prior_backup)
        reveal("rubric-save-retry")
        click("rubric-save-retry")
        saved = wait_file(lambda record: next(row["enabled"] for row in criteria(record) if row["id"] == "voice") != old_voice)
        wait(lambda value: node(value, "rubric-save-error") is None and node(value, "rubric-saving") is None)
        unchanged_artifacts(saved)
        checks.append("Actual Retry files the exact held toggle without replacing cached editorial artifacts")

        enter_input("rubric-custom-name", "native rule")
        enter_input("rubric-custom-description", "keep exact scope")
        reveal("rubric-custom-add")
        click("rubric-custom-add")
        saved = wait_file(lambda record: any(row["label"] == "native rule" for row in criteria(record)))
        wait(lambda value: node(value, "rubric-saving") is None)
        custom = next(row for row in criteria(saved) if row["label"] == "native rule")
        assert custom["description"] == "keep exact scope" and custom["source"] == "custom"
        unchanged_artifacts(saved)
        checks.append("Explicit custom Add files one local rule while preserving original spine and saved judgment")
        reveal("rubric-remove-" + custom["id"])
        click("rubric-remove-" + custom["id"])
        saved = wait_file(lambda record: all(row["id"] != custom["id"] for row in criteria(record)))
        wait(lambda value: node(value, "rubric-saving") is None)
        unchanged_artifacts(saved)
        checks.append("Actual custom Remove removes only its local rule")

        enter_input("rubric-custom-name", "held custom form")
        enter_input("rubric-custom-description", "unsubmitted data")
        accepted_count = len(criteria(saved))
        reveal("rubric-full-report")
        click("rubric-full-report")
        wait(lambda value: node(value, "rubric-galley-back") is not None)
        assert len(criteria(json.loads(rubric_path.read_text()))) == accepted_count
        assert all(row["label"] != "held custom form" for row in criteria(json.loads(rubric_path.read_text())))
        click("rubric-galley-back")
        wait(lambda value: node(value, "rubric-change-graded") is not None)
        state = wait(lambda value: node(value, "rubric-root") is not None)
        if node(state, "rubric-weight-thesis") is None:
            reveal("rubric-change-graded")
            click("rubric-change-graded")
        checks.append("Route capture preserves unsubmitted custom fields without filing a criterion")
        screenshot("held-form-before-quit.png")
        enter_input("rubric-weight-thesis", "3")
        assert weight(json.loads(rubric_path.read_text()), "thesis") != 3, "Final weight already idled to disk; this run cannot prove the close boundary"
        press("q", control=True)
        app.wait(timeout=12)
        assert app.returncode == 0, log_path.read_text()
        final = json.loads(rubric_path.read_text())
        assert weight(final, "thesis") == 3
        assert all(row["label"] != "held custom form" for row in criteria(final))
        assert len(criteria(final)) == accepted_count
        unchanged_artifacts(final)
        checks.append("Actual Ctrl-Q captures the final unblurred weight, leaves custom form unfiled and exits cleanly with exact manuscript/artifacts")
        (output / "final-rubric.json").write_text(json.dumps(final, ensure_ascii=False, indent=2) + "\n")
        (output / "final-manuscript.json").write_bytes(documents[0].read_bytes())
        acceptance = {"display": "new isolated Xvfb, terminated", "backend": "X11", "input": "separate-process XTEST", "fixture": "explicit retained test metadata; no provider activity", "checks": checks}
        (output / "acceptance.json").write_text(json.dumps(acceptance, indent=2) + "\n")
        print(json.dumps({"output": str(output), "checks": checks}))
    finally:
        if geometry_path.exists():
            (output / "last-geometry.json").write_bytes(geometry_path.read_bytes())
        retained_path = root / "library/rubric.json"
        if retained_path.is_file():
            (output / "last-rubric.json").write_bytes(retained_path.read_bytes())
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
