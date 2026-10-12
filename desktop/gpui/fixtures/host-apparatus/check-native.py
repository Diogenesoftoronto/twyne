#!/usr/bin/env python3
"""Drive local Apparatus routes and durable criteria on a newly allocated X11 display."""

import argparse
import ctypes as C
import glob
import hashlib
import json
import os
import re
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument("--binary", required=True)
parser.add_argument("--fixture", required=True)
parser.add_argument("--apparatus", required=True)
parser.add_argument("--apparatus-folio", required=True)
parser.add_argument("--output", default="/tmp/twyne-apparatus-host-native")
parser.add_argument("--notes", action="store_true", help="Also drive the inserted note's actual popup, save, kind and history controls")
args = parser.parse_args()
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
checks = []

with tempfile.TemporaryDirectory(prefix="twyne-apparatus-host-") as temporary:
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
             "--capture-apparatus", str(Path(args.apparatus).resolve()), "--capture-apparatus-folio", args.apparatus_folio,
             str(Path(args.fixture).resolve())],
            env=env, stdout=log, stderr=log,
        )

        def node(state, identifier):
            matches = [item for item in state["elements"] if item["path"][-1] == f'Name("{identifier}")']
            assert len(matches) <= 1, identifier
            return matches[0] if matches else None

        def labeled_input(state, label):
            matches = [item for item in state["elements"]
                       if item["label"] == label and item["role"] == "MultilineTextInput"]
            assert len(matches) <= 1, label
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
            raise TimeoutError("Native Apparatus did not reach the expected rendered state")

        def wait_file(predicate):
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                try:
                    record = json.loads(apparatus_path.read_text())
                    if predicate(record):
                        return record
                except (FileNotFoundError, json.JSONDecodeError):
                    pass
                time.sleep(0.025)
            raise TimeoutError("Apparatus did not reach the expected durable state")

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
            if 'Name("apparatus-scroll")' in target["path"]:
                scroll = node(state, "apparatus-scroll")["rect"]
                top = max(top, scroll["y"])
                bottom = min(bottom, scroll["y"] + scroll["height"])
            return top <= rect["y"] and rect["y"] + rect["height"] <= bottom

        def reveal(identifier):
            for _ in range(30):
                state = wait(lambda value: node(value, "apparatus-scroll") is not None)
                target = node(state, identifier)
                if fully_visible(state, target):
                    return
                rect = node(state, "apparatus-scroll")["rect"]
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

        def region_pixels(name, rect):
            crop = f'{round(rect["width"])}x{round(rect["height"])}+{round(rect["x"])}+{round(rect["y"])}'
            return subprocess.run(
                ["magick", str(output / name), "-crop", crop, "+repage", "rgba:-"],
                check=True, capture_output=True,
            ).stdout

        def wait_clipboard():
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                if app.poll() is not None:
                    raise RuntimeError(log_path.read_text())
                copied = subprocess.run(
                    ["xclip", "-display", display, "-selection", "clipboard", "-o"],
                    env=env, capture_output=True, timeout=3,
                )
                if copied.returncode == 0:
                    return copied.stdout.decode()
                time.sleep(0.075)
            raise TimeoutError("Actual Copy all did not publish an X11 clipboard selection")

        def rows(record):
            return record.get("localBibliography", record["bibliography"])

        def settings(record):
            return record.get("localSettings", record["settings"])

        def retained_scopes(record):
            return [row for row in rows(record) if not isinstance(row, dict) or row.get("folioId") != scope]

        def canonical_html():
            return json.loads(documents[0].read_text())["workspace"]["content"]["html"]

        def inline_notes(html):
            class Reader(HTMLParser):
                def __init__(self):
                    super().__init__(convert_charrefs=True)
                    self.notes = []

                def handle_starttag(self, tag, attrs):
                    values = dict(attrs)
                    kind = values.get("data-type")
                    if kind in ("footnote", "endnote"):
                        # Original InlineNoteNode shares its payload attribute
                        # and class across footnote/endnote kind conversions.
                        self.notes.append((kind, values.get("data-endnote-text", "")))

            reader = Reader()
            reader.feed(html)
            return reader.notes

        def note_marker(state):
            matches = [item for item in state["elements"]
                       if item["path"][-1].startswith('Name("twyne-note-reference-')
                       and item["role"] == "Button"]
            assert len(matches) <= 1, "This authored fixture has exactly one inline note"
            return matches[0] if matches else None

        def wait_document(predicate):
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                if app.poll() is not None:
                    raise RuntimeError(log_path.read_text())
                try:
                    if predicate(canonical_html()):
                        return canonical_html()
                except (FileNotFoundError, json.JSONDecodeError):
                    pass
                time.sleep(0.025)
            raise TimeoutError("The manuscript did not reach the expected durable state")

        def idle():
            return wait(lambda value: node(value, "apparatus-saving") is None and node(value, "apparatus-error") is None)

        apparatus_path = root / "library/apparatus.json"
        initial = json.loads(apparatus_path.read_text())
        scope = rows(initial)[0]["folioId"]
        documents = list((root / "library/manuscripts").glob("*.json"))
        assert len(documents) == 1
        original_bytes = documents[0].read_bytes()
        original_html = canonical_html()
        parser_reference = json.loads((Path(__file__).resolve().parents[1] / "editor/notes/source-reference.json").read_text())
        source_case = next(row for row in parser_reference["parser"] if row["html"] == original_html)
        edited_baseline = source_case["htmlAfterParse"]
        (output / "original-manuscript.json").write_bytes(original_bytes)
        (output / "original-apparatus.json").write_bytes(apparatus_path.read_bytes())
        foreign = retained_scopes(initial)

        click("toggle-notebook")
        wait(lambda value: node(value, "board-tab-Apparatus") is not None)
        click("board-tab-Apparatus")
        state = wait(lambda value: value["captureReady"] and node(value, "apparatus-root") is not None and node(value, "apparatus-cite-1") is not None and not node(value, "apparatus-cite-1")["disabled"])
        assert node(state, "apparatus-cite-1")["disabled"] is not True
        assert node(state, "apparatus-open-1")["disabled"] is True
        checks.append("Actual Board opens retained scoped sources with citation enabled and provider preview disabled")
        screenshot("apparatus-board.png")
        (output / "apparatus-board-geometry.json").write_text(json.dumps(state, indent=2) + "\n")
        saved_footer_rect = node(state, "save-status")["rect"]
        assert node(state, "save-status")["label"] == "Saved locally"
        saved_footer_pixels = region_pixels("apparatus-board.png", saved_footer_rect)

        click("steering-input")
        press("Return")
        state = wait(lambda value: labeled_input(value, "Research direction") is not None)
        assert labeled_input(state, "Research direction")["value"] == ""
        assert node(state, "steering-error") is None
        type_ascii("trace the original quotation")
        press("Return", shift=True)
        type_ascii("prefer primary sources")
        direction = "trace the original quotation\nprefer primary sources"
        state = wait(lambda value: labeled_input(value, "Research direction")["value"] == direction)
        press("Return", control=True)
        state = wait(lambda value: node(value, "steering-error") is not None)
        assert node(state, "steering-error")["label"] == "Choose an AI provider in Settings before steering a draft-wide pass."
        assert labeled_input(state, "Research direction")["value"] == direction
        assert documents[0].read_bytes() == original_bytes
        assert json.loads(apparatus_path.read_text()) == initial
        checks.append("Actual blank Enter is consumed, Shift-Enter writes a line, and modified Enter keeps the draft with the original offline provider error without writing manuscript or bibliography")
        screenshot("offline-steering.png")

        click("board-tab-Cast")
        wait(lambda value: node(value, "research-steering") is None)
        click("board-tab-Apparatus")
        state = wait(lambda value: value["captureReady"] and labeled_input(value, "Research direction") is not None)
        assert labeled_input(state, "Research direction")["value"] == direction
        assert node(state, "steering-error") is not None
        checks.append("Actual Board context switch retains the steering draft and original error")

        reveal("apparatus-cite-1")
        (output / "before-cite-geometry.json").write_bytes(geometry_path.read_bytes())
        click("apparatus-cite-1")
        cited = wait_file(lambda record: any(row.get("id") == "background-retained" and row.get("folioId") == scope and row.get("citationInsertedAt", 0) > 0 for row in rows(record) if isinstance(row, dict)))
        after_citation = wait_document(lambda html: html.count('data-type="footnote"') == 1)
        (output / "cited-manuscript.json").write_bytes(documents[0].read_bytes())
        idle()
        assert retained_scopes(cited) == foreign
        # An edit serializes the parsed tree. Compare its unchanged prose to
        # the actual original PM parser, which discards inter-block whitespace.
        assert re.sub(r'<sup\b[^>]*data-type="footnote"[^>]*>.*?</sup>', "", after_citation) == edited_baseline
        checks.append("Actual cite inserts a durable native footnote before its source timestamp is confirmed and keeps foreign rows exact")
        press("z", control=True)
        wait_document(lambda html: html == edited_baseline)
        press("y", control=True)
        wait_document(lambda html: html == after_citation)
        checks.append("Actual focused editor Ctrl-Z and Ctrl-Y restore the draft and its single citation exactly")

        if args.notes:
            state = wait(lambda value: fully_visible(value, note_marker(value)))
            click_item(note_marker(state))
            state = wait(lambda value: labeled_input(value, "Note text") is not None)
            click_item(labeled_input(state, "Note text"))
            press("a", control=True)
            type_ascii("a retained native note")
            note_text = "a retained native note"
            wait(lambda value: labeled_input(value, "Note text")["value"] == note_text)
            press("s", control=True)
            wait_document(lambda html: inline_notes(html) == [("footnote", note_text)])
            state = wait(lambda value: labeled_input(value, "Note text") is not None
                         and node(value, "save-status") is not None
                         and node(value, "save-status")["label"] == "Saved locally")
            assert labeled_input(state, "Note text")["focused"] is True
            assert labeled_input(state, "Note text")["value"] == note_text
            # The geometry observer can run before the GPU presents that frame.
            # Retain the actual Saved pixels, using this same window's pre-edit
            # saved footer as a reference, before advancing the interaction.
            presentation_started = time.monotonic()
            presentation_deadline = presentation_started + 4
            captures = 0
            while time.monotonic() < presentation_deadline:
                state = wait(lambda value: labeled_input(value, "Note text") is not None
                             and node(value, "save-status")["label"] == "Saved locally")
                assert labeled_input(state, "Note text")["focused"] is True
                assert node(state, "save-status")["rect"] == saved_footer_rect
                screenshot("note-popup.png")
                captures += 1
                if region_pixels("note-popup.png", saved_footer_rect) == saved_footer_pixels:
                    break
                time.sleep(0.05)
            else:
                raise AssertionError("Saved note state was observed but its saved footer pixels were not presented")
            (output / "note-popup-geometry.json").write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
            (output / "note-save-presentation.json").write_text(json.dumps({
                "kind": "Actual X11 pixels compared to the same window's pre-edit saved footer",
                "savedFooterRect": saved_footer_rect,
                "savedFooterRgbaSha256": hashlib.sha256(saved_footer_pixels).hexdigest(),
                "savedFooterMatches": True,
                "captures": captures,
                "elapsedSeconds": time.monotonic() - presentation_started,
            }, indent=2) + "\n")
            checks.append("Actual unblurred note textarea Ctrl-S files the latest text, keeps the popup input focused and presents Saved locally")

            press("Return", shift=True)
            type_ascii("a second line")
            note_text += "\na second line"
            wait(lambda value: labeled_input(value, "Note text")["value"] == note_text)
            click("twyne-note-return")
            wait(lambda value: labeled_input(value, "Note text") is None)
            wait_document(lambda html: inline_notes(html) == [("footnote", note_text)])
            checks.append("Actual Reference dismissal captures the pending multiline note before restoring its manuscript marker")

            state = wait(lambda value: fully_visible(value, note_marker(value)))
            click_item(note_marker(state))
            wait(lambda value: node(value, "twyne-note-kind") is not None)
            click("twyne-note-kind")
            wait(lambda value: node(value, "twyne-note-kind")["expanded"] is True)
            press("Down")
            assert inline_notes(canonical_html()) == [("footnote", note_text)]
            press("Return")
            wait_document(lambda html: inline_notes(html) == [("endnote", note_text)])
            click("twyne-note-return")
            wait(lambda value: labeled_input(value, "Note text") is None)
            checks.append("Actual Kind select previews without filing, then confirms Endnote with the authored multiline text retained")

            press("z", control=True)
            wait_document(lambda html: inline_notes(html) == [("footnote", note_text)])
            press("z", shift=True, control=True)
            after_citation = wait_document(lambda html: inline_notes(html) == [("endnote", note_text)])
            checks.append("Actual focused note reference Undo and Redo restore kind conversion without replacing its note text")
            (output / "note-edited-manuscript.json").write_bytes(documents[0].read_bytes())

        reveal("apparatus-full-view")
        click("apparatus-full-view")
        state = wait(lambda value: node(value, "apparatus-page-back") is not None and node(value, "apparatus-style-apa") is not None)
        assert node(state, "research-steering") is None
        state = wait(lambda value: node(value, "apparatus-copy-all") is not None
                     and not node(value, "apparatus-copy-all")["disabled"]
                     and not (node(value, "apparatus-page-detection-state") is not None
                              and node(value, "apparatus-page-detection-state")["label"] == "Scanning the saved manuscript…"))
        screenshot("apparatus-page.png")
        (output / "apparatus-page-geometry.json").write_text(json.dumps(state, indent=2) + "\n")
        click("apparatus-copy-all")
        # A separate X11 client requests the actual CLIPBOARD selection owned
        # by the running native app. This never reads the user's display.
        clipboard = wait_clipboard()
        assert clipboard.count("Cached original fixture citation.") == 1
        assert "Retained background source" in clipboard
        assert "Foreign source" not in clipboard and "Explicitly unscoped" not in clipboard
        (output / "clipboard.txt").write_text(clipboard)
        checks.append("Actual Copy all publishes writer and background sources for the exact active scope to a separate X11 clipboard client")
        click("apparatus-style-apa")
        saved = wait_file(lambda record: settings(record).get("defaultCitationStyle") == "apa")
        idle()
        assert retained_scopes(saved) == foreign
        assert canonical_html() == after_citation
        checks.append("Actual style change files only local metadata and preserves the cited manuscript")
        click("apparatus-page-back")
        state = wait(lambda value: node(value, "apparatus-cite-1") is not None and labeled_input(value, "Research direction") is not None)
        assert labeled_input(state, "Research direction")["value"] == ""
        assert node(state, "steering-error") is None
        checks.append("Actual full-page Back returns to the scoped Apparatus Board with a fresh steering mount")

        backup = apparatus_path.with_suffix(".json.bak")
        previous_backup = backup.read_bytes() if backup.exists() else None
        if backup.exists():
            backup.unlink()
        backup.mkdir()
        accepted = apparatus_path.read_bytes()
        reveal("apparatus-drop-1")
        click("apparatus-drop-1")
        state = wait(lambda value: node(value, "apparatus-error") is not None)
        assert apparatus_path.read_bytes() == accepted
        assert canonical_html() == after_citation
        reveal("apparatus-full-view")
        click("apparatus-full-view")
        wait(lambda value: node(value, "apparatus-error") is not None)
        assert node(json.loads(geometry_path.read_text()), "apparatus-page-back") is None
        checks.append("Actual backup obstruction keeps accepted source bytes and blocks full-page departure")
        screenshot("failed-write.png")
        backup.rmdir()
        if previous_backup is not None:
            backup.write_bytes(previous_backup)
        reveal("apparatus-retry")
        click("apparatus-retry")
        saved = wait_file(lambda record: not any(row.get("id") == "background-retained" and row.get("folioId") == scope for row in rows(record) if isinstance(row, dict)))
        idle()
        assert retained_scopes(saved) == foreign
        assert canonical_html() == after_citation
        checks.append("Actual Retry files the held scoped removal once while preserving the footnote and foreign rows")

        press("q", control=True)
        app.wait(timeout=12)
        assert app.returncode == 0, log_path.read_text()
        final = json.loads(apparatus_path.read_text())
        assert final == saved and retained_scopes(final) == foreign
        assert canonical_html() == after_citation
        checks.append("Actual Ctrl-Q exits cleanly with the accepted bibliography and cited manuscript")
        (output / "final-apparatus.json").write_text(json.dumps(final, ensure_ascii=False, indent=2) + "\n")
        (output / "final-manuscript.json").write_bytes(documents[0].read_bytes())
        acceptance = {"display": "new isolated Xvfb, terminated", "backend": "X11", "input": "separate-process XTEST", "clipboard": "separate-process xclip on owned display", "fixture": "explicit retained test metadata; no provider activity", "notes": args.notes, "checks": checks}
        (output / "acceptance.json").write_text(json.dumps(acceptance, indent=2) + "\n")
        print(json.dumps({"output": str(output), "checks": checks}))
    finally:
        if geometry_path.exists():
            (output / "last-geometry.json").write_bytes(geometry_path.read_bytes())
        retained_path = root / "library/apparatus.json"
        if retained_path.is_file():
            (output / "last-apparatus.json").write_bytes(retained_path.read_bytes())
        for manuscript in (root / "library/manuscripts").glob("*.json"):
            (output / "last-manuscript.json").write_bytes(manuscript.read_bytes())
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
