#!/usr/bin/env python3
"""Exercise physical pages and source/history on a private, owned X11 display."""
import argparse
import ctypes as C
import glob
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--output", default="/tmp/twyne-native-pagination")
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    binary = Path(args.binary).resolve()
    checks = []
    source = (
        '<p>Before the break<sup data-type="endnote" '
        'data-endnote-text="A retained source."></sup></p>'
        '<div data-type="page-break" data-future="retained"></div>'
        '<p>After the deliberate break.</p>'
    )
    # Synthetic authored export, never a real account/library or provider fixture.
    fixture = {
        "version": 2,
        "exportedAt": "2026-10-04T00:00:00.000Z",
        "title": "Measured pages",
        "folios": [{
            "id": "native-page-fixture", "name": "Measured pages", "type": "draft",
            "createdAt": 1791072000000, "updatedAt": 1791072000000,
            "layout": {
                "width": "normal", "margin": "normal", "runningHeader": True,
                "pageNumbers": True, "paper": "letter", "orientation": "portrait",
                "pagination": "paginated", "columns": 1,
            },
            "header": "A retained running head", "footer": "A retained footer",
        }],
        "content": {"html": source},
    }
    (output / "authored-fixture.twyne.json").write_text(json.dumps(fixture, indent=2) + "\n")
    with tempfile.TemporaryDirectory(prefix="twyne-pagination-owned-") as temporary:
        root = Path(temporary)
        geometry_path = root / "geometry.json"
        fixture_path = root / "Measured pages.twyne.json"
        fixture_path.write_text(json.dumps(fixture))
        read_fd, write_fd = os.pipe()
        server = subprocess.Popen(
            ["Xvfb", "-displayfd", str(write_fd), "-screen", "0", "1284x864x24", "-nolisten", "tcp"],
            pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        os.close(write_fd)
        app = connection = log = None
        try:
            with os.fdopen(read_fd) as reader:
                number = reader.readline().strip()
            assert number, "Owned Xvfb did not start"
            display = ":" + number
            env = {**os.environ, "DISPLAY": display, "XDG_RUNTIME_DIR": str(root), "GPUI_X11_SCALE_FACTOR": "1"}
            for name in ("WAYLAND_DISPLAY", "GPUI_HEADLESS", "DBUS_SESSION_BUS_ADDRESS", "SWAYSOCK"):
                env.pop(name, None)
            if env.get("TWYNE_GPUI_RENDER_ICD"):
                env["VK_DRIVER_FILES"] = env["TWYNE_GPUI_RENDER_ICD"]
            log = (output / "app.log").open("w")
            app = subprocess.Popen(
                [str(binary), "--data-dir", str(root / "library"), "--capture-state", "writing",
                 "--capture-size", "1280x860", "--capture-geometry", str(geometry_path),
                 "--capture-geometry-watch", str(fixture_path)], env=env, stdout=log, stderr=log,
            )

            def node(state, name):
                rows = [e for e in state["elements"] if e["path"][-1] == f'Name("{name}")']
                assert len(rows) <= 1, name
                return rows[0] if rows else None

            def sheets(state):
                return sorted(
                    [e for e in state["elements"] if "page-sheet" in e["path"][-1]],
                    key=lambda e: e["rect"]["y"],
                )

            def wait(predicate, label):
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    if app.poll() is not None:
                        raise RuntimeError((output / "app.log").read_text())
                    try:
                        state = json.loads(geometry_path.read_text())
                        if predicate(state):
                            return state
                    except (FileNotFoundError, json.JSONDecodeError):
                        pass
                    time.sleep(0.025)
                raise TimeoutError(label)

            state = wait(lambda d: d.get("captureReady") and node(d, "twyne-rich-manuscript"), "Ready imported editor")
            libx = C.CDLL(glob.glob("/nix/store/*-lib[Xx]11-*/lib/libX11.so.6*")[0])
            libt = C.CDLL(glob.glob("/nix/store/*-lib[Xx]tst-*/lib/libXtst.so.6*")[0])
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
            libx.XResizeWindow.argtypes = [C.c_void_p, C.c_ulong, C.c_uint, C.c_uint]
            libt.XTestFakeMotionEvent.argtypes = [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong]
            libt.XTestFakeButtonEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
            libt.XTestFakeKeyEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
            connection = libx.XOpenDisplay(display.encode())
            assert connection
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
            assert owned_window is not None
            libx.XSetInputFocus(connection, owned_window, 1, 0)
            libx.XFlush(connection)
            state = wait(lambda d: d["windowActive"], "Actual platform activation")
            checks.append("Owned X11 window is actually activated before input")

            def key(name, down):
                code = libx.XKeysymToKeycode(connection, libx.XStringToKeysym(name.encode()))
                assert code and libt.XTestFakeKeyEvent(connection, code, int(down), 0)
                libx.XFlush(connection)
                time.sleep(0.025)

            def press(name, control=False):
                if control:
                    key("Control_L", True)
                key(name, True)
                key(name, False)
                if control:
                    key("Control_L", False)

            def click_point(x, y):
                current = json.loads(geometry_path.read_text())
                origin = current["windowOrigin"]
                assert libt.XTestFakeMotionEvent(connection, 0, round(origin["x"] + x), round(origin["y"] + y), 0)
                assert libt.XTestFakeButtonEvent(connection, 1, 1, 0)
                assert libt.XTestFakeButtonEvent(connection, 1, 0, 0)
                libx.XFlush(connection)
                time.sleep(0.075)

            def click(name):
                current = wait(lambda d: node(d, name), f"Actual {name} control")
                rect = node(current, name)["rect"]
                click_point(rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2)

            def capture(label):
                frame = root / "frame.xwd"
                subprocess.run(["xwd", "-display", display, "-name", "Twyne", "-silent", "-out", str(frame)], env=env, check=True, capture_output=True)
                subprocess.run(["magick", str(frame), str(output / f"{label}.png")], env=env, check=True, capture_output=True)
                (output / f"{label}.json").write_bytes(geometry_path.read_bytes())

            def document():
                paths = list((root / "library/manuscripts").glob("*.json"))
                rows = [json.loads(p.read_text()) for p in paths]
                matches = [d for d in rows if d.get("workspace", {}).get("folio", {}).get("name") == "Measured pages"]
                assert len(matches) == 1, "The imported fixture must have one owned durable record"
                return matches[0]

            def wait_document(predicate):
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    row = document()
                    if predicate(row):
                        return row
                    if app.poll() is not None:
                        raise RuntimeError((output / "app.log").read_text())
                    time.sleep(0.025)
                raise TimeoutError("Durable authored manuscript")

            # Backup envelopes do not identify their active folio. Import
            # retains the original catalog in backup_template and creates a
            # fresh destination; choose paper through the real native control.
            initial_html = document()["workspace"]["content"]["html"]
            if node(state, "compositor-layout") is None:
                click("toggle-compositor")
            click("compositor-tab-View")
            click("compositor-layout")
            click("compositor-paginated")
            press("Escape")
            state = wait(lambda d: len(sheets(d)) == 2 and not node(d, "compositor-layout-panel"), "Two accepted physical pages after real layout choice")
            press("s", control=True)
            wait_document(lambda d: d["workspace"]["folio"]["layout"].get("pagination") == "paginated")
            assert document()["workspace"]["content"]["html"] == initial_html
            checks.append("Actual Match paper layout control selects pagination without treating the backup catalog as an active folio or changing the manuscript")
            canvas = node(state, "manuscript-page-canvas")["rect"]
            page_rows = sheets(state)
            assert canvas["width"] == 816
            assert all(p["rect"]["height"] == 1056 for p in page_rows)
            assert page_rows[1]["rect"]["y"] - page_rows[0]["rect"]["y"] == 1080
            assert canvas["height"] >= 2136
            assert node(state, "manuscript-notes") is not None
            checks.append("Actual font-backed editor accepts two 816 by 1056 sheets with the original 24px gap and one collected note tail")
            before = document()
            before_html = before["workspace"]["content"]["html"]
            assert "page-break" in before_html and "A retained source." in before_html
            assert before["workspace"]["folio"]["layout"]["pagination"] == "paginated"
            capture("wide-initial")
            editor = node(state, "twyne-rich-manuscript")["rect"]
            click_point(editor["x"] + 70, editor["y"] + 14)
            press("End", control=True)
            for character in "native":
                press(character)
            press("s", control=True)
            after = wait_document(lambda d: "native" in d["workspace"]["content"]["html"])
            after_html = after["workspace"]["content"]["html"]
            assert after_html.count("page-break") == before_html.count("page-break")
            assert "A retained source." in after_html
            assert after["workspace"]["folio"]["layout"] == before["workspace"]["folio"]["layout"]
            capture("wide-edited")
            checks.append("Actual caret travels to the later sheet and Ctrl-S files typed prose without changing manual break, note or page settings")
            press("z", control=True)
            press("s", control=True)
            wait_document(lambda d: d["workspace"]["content"]["html"] == before_html)
            press("y", control=True)
            press("s", control=True)
            wait_document(lambda d: d["workspace"]["content"]["html"] == after_html)
            checks.append("Focused Undo and Redo restore the exact durable manuscript across physical page geometry")
            press("a", control=True)
            press("c", control=True)
            copied = subprocess.run(["xclip", "-display", display, "-selection", "clipboard", "-o"], env=env, capture_output=True, timeout=5)
            assert copied.returncode == 0
            clipboard = copied.stdout.decode()
            assert "Before the break" in clipboard and "After the deliberate break.native" in clipboard
            (output / "native-clipboard.txt").write_text(clipboard)
            checks.append("A separate X11 clipboard client reads selected text from both physical pages")
            libx.XResizeWindow(connection, owned_window, 620, 860)
            libx.XFlush(connection)
            state = wait(lambda d: d["viewport"]["width"] <= 620 and len(sheets(d)) == 2, "Narrow physical page resize")
            assert node(state, "manuscript-page-canvas")["rect"]["width"] == 816
            assert all(p["rect"]["height"] == 1056 for p in sheets(state))
            assert document()["workspace"]["content"]["html"] == after_html
            capture("narrow")
            checks.append("Actual 620px window resize retains 816px physical sheet width and both 1056px pages without mutating authored content")
            press("q", control=True)
            app.wait(timeout=15)
            assert app.returncode == 0, (output / "app.log").read_text()
            assert document()["workspace"]["content"]["html"] == after_html
            checks.append("Clean Ctrl-Q retains the accepted paginated manuscript")
            (output / "final-manuscript.json").write_text(json.dumps(document(), indent=2) + "\n")
            receipt = {
                "backend": "X11", "display": "new owned Xvfb, terminated", "input": "separate-process XTEST",
                "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "checks": checks,
                "boundary": "Synthetic authored export with original bundled fonts; actual native pages/input/clipboard/history/save/resize. Current Source route does not register its pagination extension; full original route and raster parity are not established. No provider/account or device activity.",
            }
            (output / "acceptance.json").write_text(json.dumps(receipt, indent=2) + "\n")
            print(json.dumps({"output": str(output), "checks": checks}))
        finally:
            if geometry_path.exists():
                (output / "last-geometry.json").write_bytes(geometry_path.read_bytes())
            for path in (root / "library/manuscripts").glob("*.json"):
                (output / ("last-" + path.name)).write_bytes(path.read_bytes())
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


if __name__ == "__main__":
    main()
