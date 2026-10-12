#!/usr/bin/env python3
"""Exercise Twyne's real focus paint on a newly allocated, isolated X11 display."""

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
parser.add_argument("--output", default="/tmp/twyne-chrome-focus-native")
parser.add_argument("--page-selector", action="store_true", help="Also exercise real proof page selection")
args = parser.parse_args()
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
checks = []

with tempfile.TemporaryDirectory(prefix="twyne-focus-native-") as temporary:
    root = Path(temporary)
    geometry_path = root / "geometry.json"
    log_path = output / "app.log"
    read_fd, write_fd = os.pipe()
    server = subprocess.Popen(
        ["Xvfb", "-displayfd", str(write_fd), "-screen", "0", "624x864x24", "-nolisten", "tcp"],
        pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    os.close(write_fd)
    app = None
    connection = None
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
             "--capture-state", "writing", "--capture-size", "620x860",
             "--capture-geometry", str(geometry_path), "--capture-geometry-watch",
             str(Path(args.fixture).resolve())],
            env=env, stdout=log, stderr=log,
        )

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
            raise TimeoutError("Native geometry/focus did not reach the expected state")

        def node(state, identifier):
            matches = [item for item in state["elements"] if item["path"][-1] == f'Name("{identifier}")']
            assert len(matches) <= 1, identifier
            return matches[0] if matches else None

        state = wait(lambda value: node(value, "go-to-page") is not None)
        original_geometry = {key: node(state, key)["rect"] for key in ("write-mode", "source-mode", "go-to-page", "focus")}
        documents = list((root / "library/manuscripts").glob("*.json"))
        assert len(documents) == 1
        original_document = documents[0].read_bytes()
        (output / "original-manuscript.json").write_bytes(original_document)
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
        libt.XTestFakeMotionEvent.argtypes = [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong]
        libt.XTestFakeButtonEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
        libt.XTestFakeKeyEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
        connection = libx.XOpenDisplay(display.encode())
        assert connection

        def key(name, down):
            code = libx.XKeysymToKeycode(connection, libx.XStringToKeysym(name.encode()))
            assert code and libt.XTestFakeKeyEvent(connection, code, int(down), 0)
            libx.XFlush(connection)
            time.sleep(0.025)

        def press(name, shift=False):
            if shift:
                key("Shift_L", True)
            key(name, True)
            key(name, False)
            if shift:
                key("Shift_L", False)
            time.sleep(0.075)

        def click_item(item):
            rect = item["rect"]
            assert libt.XTestFakeMotionEvent(connection, 0, round(origin[0] + rect["x"] + rect["width"] / 2), round(origin[1] + rect["y"] + rect["height"] / 2), 0)
            assert libt.XTestFakeButtonEvent(connection, 1, 1, 0)
            assert libt.XTestFakeButtonEvent(connection, 1, 0, 0)
            libx.XFlush(connection)
            time.sleep(0.1)

        def click(identifier):
            click_item(node(wait(lambda value: node(value, identifier) is not None), identifier))

        def click_menu_label(label):
            state = wait(lambda value: any(item["label"] == label for item in value["elements"]))
            matches = [item for item in state["elements"] if item["label"] == label]
            assert len(matches) == 1, (label, matches)
            click_item(matches[0])

        def screenshot(name):
            xwd = root / "frame.xwd"
            subprocess.run(["xwd", "-display", display, "-name", "Twyne", "-silent", "-out", str(xwd)], env=env, check=True, capture_output=True)
            path = output / name
            subprocess.run(["magick", str(xwd), str(path)], check=True, capture_output=True)
            return path

        def top_pixels(path, rect):
            x, y = round(rect["x"] + rect["width"] / 2), round(rect["y"])
            data = subprocess.check_output(["magick", str(path), "-crop", f"1x2+{x}+{y}", "+repage", "-depth", "8", "RGB:-"])
            return [list(data[index:index + 3]) for index in range(0, len(data), 3)]

        accent = [0xc1, 0x27, 0x2d]

        def outline_screenshot(name, identifier):
            # Prepaint observations can arrive before the WGPU frame reaches
            # X11. Wait for both real focus and the actual two-row outline;
            # keep the assertion exact rather than relying on a fixed delay.
            deadline = time.monotonic() + 5
            actual = None
            while time.monotonic() < deadline:
                state = wait(lambda value: value["keyboardInput"] and node(value, identifier)["focused"])
                path = screenshot(name)
                actual = top_pixels(path, node(state, identifier)["rect"])
                if actual == [accent, accent]:
                    (output / name.replace(".png", ".json")).write_text(json.dumps(state, indent=2) + "\n")
                    return path
                time.sleep(0.05)
            raise AssertionError((identifier, "native focus outline did not paint", actual))

        def focused_paths(state):
            return [item["path"] for item in state["elements"] if item["focused"]]

        click("toggle-compositor")
        wait(lambda value: node(value, "compositor-tab-Home") is not None)
        click("compositor-tab-Home")
        mouse = wait(lambda value: not value["keyboardInput"] and node(value, "compositor-tab-Home")["focused"])
        mouse_path = screenshot("mouse-home.png")
        assert top_pixels(mouse_path, node(mouse, "compositor-tab-Home")["rect"]) != [accent, accent]
        checks.append("Actual mouse focus has no keyboard outline")
        press("Right")
        keyboard = wait(lambda value: value["keyboardInput"] and node(value, "compositor-tab-Insert")["focused"])
        keyboard_path = outline_screenshot("keyboard-insert.png", "compositor-tab-Insert")
        assert top_pixels(keyboard_path, node(keyboard, "compositor-tab-Insert")["rect"]) == [accent, accent]
        checks.append("Actual keyboard tab navigation paints the solid2px vermilion inset outline")
        state = keyboard
        for _ in range(12):
            previous_focus = focused_paths(state)
            press("Tab", shift=True)
            state = wait(lambda value: value["keyboardInput"] and focused_paths(value) != previous_focus)
            if node(state, "source-mode")["focused"]:
                break
        assert node(state, "source-mode")["focused"]
        source_path = outline_screenshot("keyboard-source.png", "source-mode")
        assert top_pixels(source_path, node(state, "source-mode")["rect"]) == [accent, accent]
        checks.append("Actual Shift-Tab reaches the retained Source button and paints its outline")
        click("write-mode")
        state = wait(lambda value: not value["keyboardInput"] and not node(value, "source-mode")["focused"])
        assert top_pixels(screenshot("pointer-write.png"), node(state, "source-mode")["rect"]) != [accent, accent]
        assert node(state, "go-to-page")["disabled"] is True
        click("go-to-page")
        state = wait(lambda value: not value["keyboardInput"])
        assert node(state, "go-to-page")["focused"] is not True
        checks.append("Pointer activation removes keyboard paint; disabled Pages cannot receive focus")
        assert {key: node(state, key)["rect"] for key in original_geometry} == original_geometry
        assert documents[0].read_bytes() == original_document
        checks.append("Control dimensions and exact stored manuscript stay unchanged")
        if args.page_selector:
            click("proof-mode")
            state = wait(lambda value: node(value, "go-to-page")["disabled"] is not True and node(value, "page-selection-label")["label"] != "Pages")
            count_label = node(state, "page-selection-label")["label"]
            count = int(count_label.split()[0])
            proof_document = documents[0].read_bytes()
            (output / "proof-manuscript.json").write_bytes(proof_document)
            original_value, proof_value = json.loads(original_document), json.loads(proof_document)
            assert proof_value["workspace"]["content"]["html"] == original_value["workspace"]["content"]["html"]
            assert all(proof_value[field] == original_value[field] for field in ("id", "title", "notes", "created_at", "archived"))
            assert proof_value["workspace"]["folio"] == original_value["workspace"]["folio"]
            assert proof_value["body"] == proof_value["workspace"]["content"]["typstSource"]
            if count == 1:
                assert node(state, "go-to-page")["rect"]["width"] == 71
            checks.append("First Proof retains imported HTML and metadata while preparing canonical Typst")
            page_label = f"Page 1 of {count}"
            click("go-to-page")
            state = wait(lambda value: node(value, "go-to-page")["expanded"] is True)
            assert node(state, "go-to-page")["value"] == count_label
            (output / "expanded-selector.json").write_text(json.dumps(state, indent=2) + "\n")
            click_menu_label(page_label)
            state = wait(lambda value: node(value, "page-selection-label")["label"] == page_label and node(value, "typeset-pages") is not None and node(value, "popup-menu") is None)
            assert node(state, "go-to-page")["expanded"] is False
            assert node(state, "go-to-page")["value"] == page_label
            checks.append("Native selector value follows selection and expanded state follows the actual popup")
            screenshot("selected-page.png")
            (output / "selected-manuscript.json").write_bytes(documents[0].read_bytes())
            checks.append("Actual page menu chooses the retained Page1 label in Proof")
            click("write-mode")
            state = wait(lambda value: node(value, "typeset-pages") is None and node(value, "page-selection-label")["label"] == page_label)
            screenshot("selected-page-write.png")
            (output / "write-manuscript.json").write_bytes(documents[0].read_bytes())
            checks.append("Returning to Write retains the selected page label")
            click("go-to-page")
            click_menu_label(count_label)
            state = wait(lambda value: node(value, "page-selection-label")["label"] == count_label and node(value, "typeset-pages") is None and node(value, "popup-menu") is None)
            checks.append("Choosing the count option leaves Write active")
            # The rich editor handles Shift-Tab as Outdent. Start from a real
            # chrome focus target so this checks the selector's Tab path.
            click("compositor-tab-Home")
            state = wait(lambda value: node(value, "compositor-tab-Home")["focused"])
            trail = []
            for _ in range(48):
                previous_focus = focused_paths(state)
                press("Tab", shift=True)
                state = wait(lambda value: value["keyboardInput"] and focused_paths(value) != previous_focus)
                trail.append([{"path": item["path"], "label": item["label"]} for item in state["elements"] if item["focused"]])
                if node(state, "go-to-page")["focused"]:
                    break
            (output / "tab-trail.json").write_text(json.dumps(trail, indent=2) + "\n")
            (output / "keyboard-geometry.json").write_text(json.dumps(state, indent=2) + "\n")
            screenshot("keyboard-pages.png")
            assert node(state, "go-to-page")["focused"]
            assert node(state, "go-to-page")["role"] == "ComboBox"
            assert top_pixels(outline_screenshot("keyboard-pages.png", "go-to-page"), node(state, "go-to-page")["rect"]) == [accent, accent]
            checks.append("Enabled page selector exposes its native combobox role and keyboard outline")
            press("Down")
            state = wait(lambda value: node(value, "page-selection-label")["label"] == page_label and node(value, "typeset-pages") is not None)
            assert node(state, "go-to-page")["focused"]
            press("Up")
            state = wait(lambda value: node(value, "page-selection-label")["label"] == count_label)
            assert node(state, "typeset-pages") is not None and node(state, "go-to-page")["focused"]
            checks.append("Closed-selector Arrow keys retain focus and count selection keeps Proof active")
            press("Right")
            state = wait(lambda value: node(value, "page-selection-label")["label"] == page_label)
            assert node(state, "go-to-page")["focused"]
            press("Left")
            state = wait(lambda value: node(value, "page-selection-label")["label"] == count_label)
            assert node(state, "go-to-page")["focused"]
            checks.append("Closed-selector Left/Right select adjacent options and retain native focus")
            press("End")
            state = wait(lambda value: node(value, "page-selection-label")["label"] == f"Page {count} of {count}")
            assert node(state, "go-to-page")["focused"]
            press("Home")
            state = wait(lambda value: node(value, "page-selection-label")["label"] == count_label)
            assert node(state, "go-to-page")["focused"]
            checks.append("Closed-selector Home/End retain focus and select the count/last page")
            press("Next")
            state = wait(lambda value: node(value, "page-selection-label")["label"] == f"Page {min(count, 3)} of {count}")
            assert node(state, "go-to-page")["focused"]
            press("Prior")
            state = wait(lambda value: node(value, "page-selection-label")["label"] == count_label)
            assert node(state, "go-to-page")["focused"]
            checks.append("Closed-selector PageUp/PageDown use the original three-option step and retain focus")
            press("p")
            state = wait(lambda value: node(value, "go-to-page")["value"] == page_label)
            assert node(state, "go-to-page")["focused"]
            press("p")
            target = min(count, 2)
            target_label = f"Page {target} of {count}"
            state = wait(lambda value: node(value, "go-to-page")["value"] == target_label)
            assert node(state, "go-to-page")["focused"]
            checks.append("Repeated typed letters cycle matching page labels through actual X11 input")
            press("Home")
            state = wait(lambda value: node(value, "go-to-page")["value"] == count_label)
            # This timed pause is the observed native select search-session
            # boundary; it does not replace a geometry/focus/frame predicate.
            time.sleep(1.15)
            for character in ("p", "a", "g", "e", "space", str(target)):
                press(character)
            state = wait(lambda value: node(value, "go-to-page")["value"] == target_label)
            assert node(state, "go-to-page")["focused"]
            assert node(state, "go-to-page")["expanded"] is False
            assert node(state, "popup-menu") is None
            checks.append("Typed page prefix includes Space without opening the popup or moving focus")
            time.sleep(1.15)
            press(str(count)[0])
            state = wait(lambda value: node(value, "go-to-page")["value"] == count_label)
            assert node(state, "go-to-page")["focused"] and node(state, "typeset-pages") is not None
            checks.append("Expired typed search selects the count label and retains Proof and focus")
            time.sleep(1.15)
            press("space")
            state = wait(lambda value: node(value, "go-to-page")["expanded"] is True)
            assert node(state, "popup-menu") is not None
            press("Escape")
            state = wait(lambda value: node(value, "go-to-page")["expanded"] is False and node(value, "go-to-page")["focused"])
            assert node(state, "go-to-page")["value"] == count_label
            checks.append("Idle Space opens the actual native popup and Escape restores selector focus")
            (output / "final-manuscript.json").write_bytes(documents[0].read_bytes())
            assert documents[0].read_bytes() == proof_document
            checks.append("Page selection and mode changes preserve exact stored bytes after legacy conversion")
        (output / "acceptance.json").write_text(json.dumps({"display": "new isolated Xvfb, terminated", "backend": "X11", "input": "separate-process XTEST", "proofPageCount": count if args.page_selector else None, "checks": checks}, indent=2) + "\n")
        print(json.dumps({"output": str(output), "checks": checks}))
    finally:
        if connection:
            libx.XCloseDisplay(connection)
        if app is not None and app.poll() is None:
            app.terminate()
            app.wait(timeout=5)
        server.terminate()
        server.wait(timeout=5)
