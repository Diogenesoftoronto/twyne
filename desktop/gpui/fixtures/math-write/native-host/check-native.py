#!/usr/bin/env python3
"""Actual equation-host input/save/history on a newly owned Xvfb only.

Authoring or syntax-checking this driver is not a native execution receipt.
The binary must contain Parent's real app canonical-preflight integration.
No fixture injects HTML projection, converter/renderer success, or a provider.
"""

import argparse
import copy
import ctypes as C
import hashlib
from html.parser import HTMLParser
import importlib.util
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import time
import traceback
import zlib


ROOT = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
BASE_DRIVER = ROOT / "desktop/gpui/fixtures/dossier-native/check-native.py"
FIELD = "twyne-math-source-field"
FORM = "twyne-math-source-editor"
RICH = "twyne-rich-manuscript"
MAX_JSON_BYTES = 64 * 1024 * 1024
TOTAL_SECONDS = 360
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    require(path.stat().st_size <= MAX_JSON_BYTES, f"Bounded fixture observation exceeded 64 MiB: {path}")
    return json.loads(path.read_text(encoding="utf8"))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def load_isolated_helper():
    # Reuse the already reviewed owned-display/XTEST/process-cleanup primitives.
    # Loading defines Python functions only; Native.__init__ starts the owned
    # Xvfb later. Never import this file during the authoring syntax check.
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("twyne_owned_dossier_native", BASE_DRIVER)
    require(spec is not None and spec.loader is not None, "Owned isolation helper is missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Frame(dict):
    def __init__(self, value, stamp):
        super().__init__(value)
        self.stamp = stamp


class HtmlShape(HTMLParser):
    """Inspect this authored corpus, preserving all interior text/attributes.

    Only root ASCII inter-block whitespace is ignored, like the proved Source
    document parser. This is an observation parser, never a document converter.
    """

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "root", "attrs": {}, "children": []}
        self.stack = [self.root]
        self.feed(html)
        self.close()
        require(len(self.stack) == 1, "Observed HTML contains an unclosed authored node")

    def handle_starttag(self, tag, attrs):
        require(len(dict(attrs)) == len(attrs), "Observed node has ambiguous duplicate attributes")
        node = {"tag": tag, "attrs": dict(attrs), "children": []}
        self.stack[-1]["children"].append(node)
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            return
        require(len(self.stack) > 1 and self.stack[-1]["tag"] == tag, f"Unexpected observed closing tag {tag}")
        self.stack.pop()

    def handle_data(self, value):
        if len(self.stack) == 1 and not value.strip(" \t\n\r\v\f"):
            return
        children = self.stack[-1]["children"]
        if children and isinstance(children[-1], str):
            children[-1] += value
        else:
            children.append(value)

    def handle_comment(self, value):
        self.stack[-1]["children"].append({"comment": value})


def html_nodes(node):
    if isinstance(node, dict) and "tag" in node:
        yield node
        for child in node["children"]:
            yield from html_nodes(child)


def inspected_html(html, expected):
    tree = HtmlShape(html).root
    found = {}
    for node in html_nodes(tree):
        kind = node["attrs"].get("data-type")
        if kind not in {"block-math", "inline-math"}:
            continue
        display = "block" if kind == "block-math" else "inline"
        require(display not in found, f"Expected exactly one {display} equation")
        raw = expected[display]
        require(node["attrs"].get("data-latex") == raw, f"Durable {display} data-latex lost exact raw characters")
        require(node["children"] == ([raw] if raw else []), f"Durable {display} text payload disagrees with exact raw source")
        require(node["attrs"].get("data-math-display") == display, f"Portable {display} display metadata changed")
        require(node["attrs"].get("aria-label") == f"{display.title()} equation: {raw or 'empty'}", f"Portable {display} equation label disagrees with raw source")
        found[display] = copy.deepcopy(node)
        node["attrs"]["data-latex"] = "<edited raw source>"
        node["attrs"]["aria-label"] = "<derived equation label>"
        node["children"] = ["<edited raw payload>"]
    require(set(found) == {"block", "inline"}, "Actual projection must contain both authored math atoms")
    return tree, found


MATH_CALL = re.compile(r'#twyne-math\(("(?:\\.|[^"\\])*"),\s*block:\s*(true|false)\)')


def canonical_math(source):
    # The authored strings exercise JSON-compatible Typst escaping. This
    # bounded inspection is not a general Typst parser or a compiler claim.
    found = {}
    for match in MATH_CALL.finditer(source):
        display = "block" if match[2] == "true" else "inline"
        require(display not in found, f"Canonical source duplicates the {display} equation")
        found[display] = json.loads(match[1])
    require(set(found) == {"block", "inline"}, "Actual canonical source must contain both literal math calls")
    return found


def source_values(document):
    content = document.get("workspace", {}).get("content", {})
    return document.get("body"), content.get("typstSource"), content.get("html")


class XImageHeader(C.Structure):
    _fields_ = [
        ("width", C.c_int), ("height", C.c_int), ("xoffset", C.c_int), ("format", C.c_int),
        ("data", C.c_void_p), ("byte_order", C.c_int), ("bitmap_unit", C.c_int),
        ("bitmap_bit_order", C.c_int), ("bitmap_pad", C.c_int), ("depth", C.c_int),
        ("bytes_per_line", C.c_int), ("bits_per_pixel", C.c_int),
        ("red_mask", C.c_ulong), ("green_mask", C.c_ulong), ("blue_mask", C.c_ulong),
    ]


def make_native_class(base):
    class Native(base.Native):
        def __init__(self, binary, output, fixture):
            self.deadline = time.monotonic() + TOTAL_SECONDS
            self.actions = []
            super().__init__(binary, output, fixture)
            # Isolated fixture-only observation. This is not a field mutation.
            self.x.XSync.argtypes, self.x.XSync.restype = [C.c_void_p, C.c_int], C.c_int
            self.x.XGetInputFocus.argtypes, self.x.XGetInputFocus.restype = [C.c_void_p, C.POINTER(C.c_ulong), C.POINTER(C.c_int)], C.c_int
            self.x.XQueryKeymap.argtypes, self.x.XQueryKeymap.restype = [C.c_void_p, C.c_void_p], C.c_int
            self.native_window = None
            self.key_observations = []

        def key(self, name, down):
            # The same single physical event is still sent exactly once.
            code = self.x.XKeysymToKeycode(self.connection, self.x.XStringToKeysym(name.encode("ascii")))
            super().key(name, down)
            self.x.XSync(self.connection, 0)
            focus, revert, held = C.c_ulong(), C.c_int(), C.create_string_buffer(32)
            require(self.x.XGetInputFocus(self.connection, C.byref(focus), C.byref(revert)), "Owned X11 focus query failed")
            require(self.x.XQueryKeymap(self.connection, held), "Owned X11 key state query failed")
            pressed = [keycode for keycode in range(256)
                       if held.raw[keycode // 8] & (1 << (keycode % 8))]
            observation = {
                "launch": self.launches, "key": name, "requestedDown": down, "keycode": code,
                "xServerFocus": focus.value, "ownedWindow": self.native_window,
                "xServerFocusIsOwnedWindow": focus.value == self.native_window,
                "xServerPressedKeycodes": pressed, "requestedKeyIsDown": code in pressed,
                "serverQueueSynchronized": True,
            }
            try:
                state = self.state()
                observation["latestNativeObservation"] = {
                    "captureStamp": list(state.stamp), "fieldValue": self.field_value(state),
                    "fieldContainsFocus": self.input_focused(state, FIELD),
                    "lastInputWasKeyboard": state.get("keyboardInput"),
                    "windowActive": state.get("windowActive"),
                    "formPath": self.node(state, FORM).get("path") if self.node(state, FORM) else None,
                }
            except (FileNotFoundError, json.JSONDecodeError, KeyError) as error:
                observation["nativeObservationUnavailable"] = type(error).__name__
            self.key_observations.append(observation)
            write_json(self.output / "actual-keys.json", self.key_observations)

        def alive(self):
            super().alive()
            require(time.monotonic() < self.deadline, "Whole native-host run exceeded its six-minute deadline")

        def state(self):
            before = self.geometry.stat()
            value = read_json(self.geometry)
            after = self.geometry.stat()
            if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
                raise json.JSONDecodeError("Geometry was rewritten while reading", "", 0)
            return Frame(value, (after.st_mtime_ns, after.st_size))

        def document(self):
            paths = list((self.data / "manuscripts").glob("*.json"))
            if not paths:
                raise FileNotFoundError("The actual imported folio is not on disk yet")
            require(len(paths) == 1, "Owned fixture library must have exactly one copied folio")
            return paths[0], read_json(paths[0])

        def visible(self, state, target):
            if not super().visible(state, target):
                return False
            # The manuscript is clipped by the actual observed writing
            # scroller, not the whole desktop viewport/footer region.
            if 'Name("body-field")' in target["path"]:
                scroller = self.node(state, "body-field")
                require(scroller is not None, "Observed writing scroller is missing")
                rect, clip = target["rect"], scroller["rect"]
                return (clip["x"] <= rect["x"] and clip["y"] <= rect["y"]
                        and rect["x"] + rect["width"] <= clip["x"] + clip["width"]
                        and rect["y"] + rect["height"] <= clip["y"] + clip["height"])
            return True

        def start(self, import_fixture=False):
            require(self.app is None or self.app.poll() is not None, "A previous owned application is still running")
            self.launches += 1
            self.geometry = self.output / f"live-geometry-{self.launches}.json"
            self.log_path = self.output / f"app-{self.launches}.log"
            self.log = self.log_path.open("w", encoding="utf8")
            command = [str(self.binary), "--data-dir", str(self.data), "--capture-state", "writing",
                       "--capture-size", "1280x860", "--capture-geometry", str(self.geometry), "--capture-geometry-watch"]
            if import_fixture:
                command.append(str(self.fixture))
            self.app = subprocess.Popen(command, env=self.env, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log)
            self.wait_state("actual native writing window observations", lambda state: bool(state["elements"]))
            root, parent, children, count = C.c_ulong(), C.c_ulong(), C.POINTER(C.c_ulong)(), C.c_uint()
            require(self.x.XQueryTree(self.connection, self.x.XDefaultRootWindow(self.connection), C.byref(root), C.byref(parent), C.byref(children), C.byref(count)), "Could not query the owned window tree")
            windows = []
            try:
                for index in range(count.value):
                    name = C.c_void_p()
                    if self.x.XFetchName(self.connection, children[index], C.byref(name)) and name.value:
                        try:
                            if C.string_at(name.value) == b"Twyne":
                                windows.append(children[index])
                        finally:
                            self.x.XFree(name)
            finally:
                if children:
                    self.x.XFree(children)
            require(len(windows) == 1, "Exactly one native Twyne window must belong to the new owned display")
            self.native_window = windows[0]
            self.x.XSetInputFocus(self.connection, windows[0], 1, 0)
            self.x.XFlush(self.connection)
            self.wait_state("actual native activation", lambda state: state["windowActive"])

        def settled(self, description, read_target, predicate=lambda state: True):
            previous_stamp = previous_geometry = None
            frames = 0
            evidence = []

            def accept(state):
                nonlocal previous_stamp, previous_geometry, frames, evidence
                target = read_target(state)
                if not predicate(state) or not self.visible(state, target) or target.get("disabled") is True:
                    frames = 0
                    evidence = []
                    return False
                if state.stamp == previous_stamp:
                    return False
                previous_stamp = state.stamp
                form, page, scroller = self.node(state, FORM), self.node(state, RICH), self.node(state, "body-field")
                geometry = (target["rect"], state["windowOrigin"], state["viewport"],
                            form["rect"] if form else None, page["rect"] if page else None,
                            scroller["rect"] if scroller else None)
                frames = frames + 1 if geometry == previous_geometry else 1
                if frames == 1:
                    evidence = []
                evidence.append({"captureStamp": list(state.stamp), "targetRect": target["rect"],
                                 "windowOrigin": state["windowOrigin"], "viewport": state["viewport"],
                                 "formRect": form["rect"] if form else None,
                                 "pageRect": page["rect"] if page else None,
                                 "scrollerRect": scroller["rect"] if scroller else None})
                previous_geometry = geometry
                if frames >= 2:
                    self.settled_evidence = evidence[-2:]
                return frames >= 2

            return self.wait_state(description, accept)

        def click(self, identifier):
            state = self.settled(f"two fresh identical fully visible enabled bounds: {identifier}", lambda value: self.node(value, identifier))
            target = self.node(state, identifier)
            rect, origin = target["rect"], state["windowOrigin"]
            x = round(origin["x"] + rect["x"] + rect["width"] / 2)
            y = round(origin["y"] + rect["y"] + rect["height"] / 2)
            self.actions.append({"launch": self.launches, "action": "click", "id": identifier,
                                 "captureStamp": list(state.stamp), "rect": rect, "windowOrigin": origin,
                                 "x": x, "y": y, "settledFreshFrames": self.settled_evidence})
            write_json(self.output / "actual-clicks.json", self.actions)
            require(self.t.XTestFakeMotionEvent(self.connection, 0, x, y, 0), "Owned actual pointer motion failed")
            require(self.t.XTestFakeButtonEvent(self.connection, 1, 1, 0) and self.t.XTestFakeButtonEvent(self.connection, 1, 0, 0), "Owned actual pointer click failed")
            self.x.XFlush(self.connection)
            time.sleep(0.07)

        def type_ascii(self, text):
            # Explicit US XTEST mapping; exact observed textarea value is the
            # authority. No clipboard owner, helper callback, or IME is faked.
            punctuation = {
                " ": ("space", False), "\n": ("Return", False),
                "!": ("1", True), '"': ("apostrophe", True), "#": ("3", True),
                "$": ("4", True), "%": ("5", True), "&": ("7", True), "'": ("apostrophe", False),
                "(": ("9", True), ")": ("0", True), "*": ("8", True), "+": ("equal", True),
                ",": ("comma", False), "-": ("minus", False), ".": ("period", False),
                "/": ("slash", False), ":": ("semicolon", True), ";": ("semicolon", False),
                "<": ("comma", True), "=": ("equal", False), ">": ("period", True), "?": ("slash", True),
                "@": ("2", True), "[": ("bracketleft", False), "\\": ("backslash", False), "]": ("bracketright", False),
                "^": ("6", True), "_": ("minus", True), chr(96): ("grave", False), "{": ("bracketleft", True),
                "|": ("backslash", True), "}": ("bracketright", True), "~": ("grave", True),
            }
            for character in text:
                self.alive()
                if character in punctuation:
                    key, shift = punctuation[character]
                elif character.isascii() and (character.isalpha() or character.isdigit()):
                    key, shift = character.lower(), character.isupper()
                else:
                    raise AssertionError("Typed fixture must use bounded explicit ASCII XTEST mapping")
                self.press(key, shift=shift)

        def field_value(self, state):
            field = self.input(state, FIELD)
            return field.get("value") if field else None

        def wait_field(self, raw):
            return self.wait_state("exact current focused unblurred equation textarea", lambda state:
                self.node(state, FORM) is not None and self.field_value(state) == raw
                and self.input_focused(state, FIELD) and state["keyboardInput"])

        def edit_raw(self, raw):
            self.wait_state("actual equation textarea focus", lambda state: self.input_focused(state, FIELD))
            self.press("a", control=True)
            self.type_ascii(raw)
            return self.wait_field(raw)

        def anchor_id(self, display):
            def find(state):
                prefix = 'Name("twyne-math-anchor-'
                candidates = [node for node in state["elements"] if node["path"]
                              and node["path"][-1].startswith(prefix)
                              and (node.get("label") or "").startswith(f"{display.title()} equation:")]
                require(len(candidates) <= 1, f"Ambiguous actual {display} equation anchor")
                return candidates[0] if candidates else None
            state = self.wait_state(f"actual {display} equation anchor", lambda state: find(state) is not None)
            terminal = find(state)["path"][-1]
            return json.loads(terminal[len("Name("):-1])

        def open_equation(self, display, raw):
            self.click(self.anchor_id(display))
            # Require two fresh focused/visible field observations, not one
            # first-mount snapshot. Expected authored raw text stays unchanged.
            state = self.settled(f"two fresh focused retained {display} source field observations",
                lambda state: self.input(state, FIELD),
                lambda state: self.node(state, FORM) is not None
                and self.field_value(state) == raw and self.input_focused(state, FIELD)
                and state["windowActive"])
            write_json(self.output / f"opened-{self.launches}-{display}-field.json", {
                "expectedRaw": raw, "observations": self.settled_evidence,
                "field": self.input(state, FIELD),
                "limits": "Fresh observation/server-state proof does not identify the installed PlatformInputHandler",
            })
            field = self.input(state, FIELD)
            require(field["role"] == "MultilineTextInput", "Actual source editor must expose a native multiline textarea")
            return state

        def wait_closed(self, description):
            def closed(state):
                if self.node(state, "twyne-math-source-submit-error") is not None:
                    raise AssertionError("Real canonical preparation refused the equation; retain input/error geometry rather than report success")
                rich = self.node(state, RICH)
                return self.node(state, FORM) is None and rich is not None and rich.get("focused") is True
            return self.wait_state(description, closed)

        def ensure_write(self):
            if self.node(self.state(), RICH) is None:
                if self.node(self.state(), "write-mode") is None:
                    self.click("toggle-compositor")
                self.click("write-mode")
                self.wait_state("actual helper-projected rich Write mounted", lambda state: self.node(state, RICH) is not None)

        def snapshot(self, name, document=True, pixels=True):
            state = self.state()
            self.retain_state(name, state)
            if document:
                path, value = self.document()
                (self.output / f"{name}-manuscript.json").write_bytes(path.read_bytes())
                body, source, html = source_values(value)
                require(isinstance(body, str) and isinstance(source, str) and isinstance(html, str), "Snapshot needs actual retained source/body/HTML")
                (self.output / f"{name}-source.typ").write_text(source, encoding="utf8")
                (self.output / f"{name}-projection.html").write_text(html, encoding="utf8")
            if pixels:
                self.capture_pixels(name, state)

        def capture_pixels(self, name, state):
            # Standard-library PNG from the actual owned X11 root pixels. No
            # synthetic image or captured user's display can satisfy this.
            self.x.XGetImage.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_ulong, C.c_int]
            self.x.XGetImage.restype = C.POINTER(XImageHeader)
            self.x.XDestroyImage.argtypes = [C.POINTER(XImageHeader)]
            self.x.XDestroyImage.restype = C.c_int
            width, height = round(state["viewport"]["width"]), round(state["viewport"]["height"])
            x, y = round(state["windowOrigin"]["x"]), round(state["windowOrigin"]["y"])
            require(0 < width <= 1284 and 0 < height <= 864 and x >= 0 and y >= 0 and x + width <= 1284 and y + height <= 864, "Observed owned window must fit its fixed Xvfb screen")
            image = self.x.XGetImage(self.connection, self.x.XDefaultRootWindow(self.connection), x, y, width, height, C.c_ulong(-1).value, 2)
            require(bool(image), "Could not read actual owned X11 pixels")
            try:
                header = image.contents
                require(header.width == width and header.height == height and header.format == 2 and header.bits_per_pixel in {24, 32} and header.byte_order in {0, 1}, "Unsupported actual XImage format")
                pixel_bytes = header.bits_per_pixel // 8
                require(width * pixel_bytes <= header.bytes_per_line <= width * pixel_bytes + 16, "Unexpected actual XImage row bounds")
                payload = C.string_at(header.data, header.bytes_per_line * height)
                channels = []
                masks = (header.red_mask, header.green_mask, header.blue_mask)
                require(all(masks) and not (masks[0] & masks[1] or masks[0] & masks[2] or masks[1] & masks[2]), "Unexpected actual XImage color masks")
                for mask in masks:
                    shift = (mask & -mask).bit_length() - 1
                    maximum = mask >> shift
                    require(maximum & (maximum + 1) == 0, "Noncontiguous actual XImage channel mask")
                    channels.append((mask, shift, maximum))
                order = "little" if header.byte_order == 0 else "big"
                scan = bytearray()
                for row in range(height):
                    scan.append(0)
                    offset = row * header.bytes_per_line
                    for column in range(width):
                        start = offset + column * pixel_bytes
                        value = int.from_bytes(payload[start:start + pixel_bytes], order)
                        scan.extend(round(((value & mask) >> shift) * 255 / maximum) for mask, shift, maximum in channels)
                def chunk(kind, data):
                    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
                png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
                png += chunk(b"IDAT", zlib.compress(scan)) + chunk(b"IEND", b"")
                (self.output / f"{name}.png").write_bytes(png)
            finally:
                self.x.XDestroyImage(image)

    return Native


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True, help="Parent's fresh actual ui-tests binary including real math canonical preflight")
    parser.add_argument("--output", type=Path, help="Fresh nonexistent output directory; default allocates a new /tmp directory")
    parser.add_argument("--inline", action="store_true", help="Additional real inline phase, only after Parent enables and builds measured inline flow")
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    require(binary.is_file() and os.access(binary, os.X_OK), "Use an executable actual ui-tests binary")
    if args.output:
        output = args.output.absolute()
        output.mkdir(mode=0o700, parents=True, exist_ok=False)
    else:
        output = Path(tempfile.mkdtemp(prefix="twyne-equation-native-"))
    fixture, contract_path = HERE / "equations.typ", HERE / "input-contract.json"
    authored, contract = fixture.read_bytes(), read_json(contract_path)
    require(hashlib.sha256(authored).hexdigest() == contract["fixtureSha256"], "Authored source fixture drifted")
    require(contract["retainedSourceDefinition"].encode() in authored, "Authored retained Source definition is missing")
    (output / "original-input.typ").write_bytes(authored)
    write_json(output / "authored-input-contract.json", contract)
    receipt = {"status": "running", "scope": "actual isolated X11 equation field/host/canonical save/history/cancel/relaunch",
               "proofLimits": ["no browser/KaTeX/Source pixel parity", "no provider/account/network/other-OS proof", "no manufactured converter/renderer success", "no Source baseline certification"],
               "binarySha256": digest(binary), "driverSha256": digest(Path(__file__)),
               "isolationHelperSha256": digest(BASE_DRIVER), "fixtureSha256": digest(fixture),
               "optionalInline": args.inline, "display": "fresh owned Xvfb allocated with displayfd",
               "input": "actual XTEST keys/clicks at two fresh identical observed native bounds", "checks": []}
    write_json(output / "acceptance.json", receipt)
    ui = None

    def passed(label):
        receipt["checks"].append(label)
        write_json(output / "acceptance.json", receipt)

    try:
        base = load_isolated_helper()
        ui = make_native_class(base)(binary, output, fixture)
        ui.start(import_fixture=True)
        path, imported = ui.wait("actual CLI-imported source/provenance", ui.document)
        body, source, _ = source_values(imported)
        require(body.encode() == authored and source.encode() == authored, "Actual CLI import must retain authored source/body bytes")
        provenance = copy.deepcopy(imported["workspace"]["provenance"])
        require(bytes(provenance["originalBytes"]) == authored, "Actual import provenance must retain original bytes")
        folio_id = imported["id"]
        (output / "imported-manuscript.json").write_bytes(path.read_bytes())
        passed("Actual CLI copy retains exact authored canonical/source bytes, unknown metadata and original import provenance")

        ui.ensure_write()
        ui.press("s", control=True)
        initial = {"block": contract["initialBlockSource"], "inline": contract["untouchedInlineSource"]}
        path, baseline = ui.wait("durable verified real Write projection", ui.document, lambda item:
            item[1].get("workspace", {}).get("projection") == "verified"
            and bool(item[1]["workspace"]["content"]["html"]))
        require(source_values(baseline)[:2] == source_values(imported)[:2], "Actual Write projection must preserve authored source/body")
        preserved_shape, _ = inspected_html(source_values(baseline)[2], initial)
        attrs = {key: value for node in html_nodes(preserved_shape) for key, value in node["attrs"].items()}
        require(all(attrs.get(key) == value for key, value in contract["unknownAttributeSentinels"].items()), "Actual helper projection lost an authored unknown attribute")

        def valid(document, expected):
            body, source, html = source_values(document)
            require(document["id"] == folio_id and body == source, "Source and durable body must belong to the original copied folio")
            require(document["workspace"]["provenance"] == provenance, "Equation edits must retain exact original import provenance")
            require(contract["retainedSourceDefinition"] in source, "Equation edit erased authored Source outside the target")
            require(document["workspace"]["projection"] == "verified", "Accepted document must have actual verified projection")
            require(canonical_math(source) == expected, "Actual canonical math calls disagree with exact raw input")
            shape, _ = inspected_html(html, expected)
            require(shape == preserved_shape, "Equation edit altered unknown attrs, marks, Unicode/whitespace prose, another atom, or surrounding structure")

        valid(baseline, initial)
        ui.snapshot("baseline")
        passed("Actual native Write/Save uses the real local helper and keeps portable math metadata, marked Unicode prose and unknown attributes")

        def durable(name, expected, prior=None):
            ui.press("s", control=True)
            _, document = ui.wait(f"durable exact {name} source/HTML", ui.document, lambda item:
                item[1].get("workspace", {}).get("projection") == "verified"
                and canonical_math(source_values(item[1])[1]) == expected)
            valid(document, expected)
            if prior is not None:
                require(document["revision"] > prior["revision"], "Actual accepted edit/history action must advance the durable revision")
            ui.settled("two fresh actual Saved locally footer frames", lambda state: ui.node(state, "save-status"),
                       lambda state: ui.node(state, "save-status") is not None and ui.node(state, "save-status")["label"] == "Saved locally")
            ui.snapshot(name)
            return document

        ui.open_equation("block", initial["block"])
        ui.type_ascii("!")
        ui.wait_field(initial["block"] + "!")
        require(source_values(ui.document()[1]) == source_values(baseline), "End-caret field input leaked into canonical manuscript")
        ui.press("z", control=True)
        ui.wait_field(initial["block"])
        ui.press("z", control=True, shift=True)
        ui.wait_field(initial["block"] + "!")
        require(source_values(ui.document()[1]) == source_values(baseline), "Textarea Undo/Redo altered manuscript history/source")
        passed("Actual anchor opens end-focused textarea; real append/field Undo/Redo stays isolated from manuscript source")

        raw_a = contract["typedInputs"]["ctrlEnter"]
        ui.edit_raw(raw_a)
        ui.snapshot("unblurred-before-ctrl-enter")
        ui.press("s", control=True)
        ui.wait_field(raw_a)
        require(source_values(ui.document()[1]) == source_values(baseline), "Saving an unsubmitted equation textarea must not file its raw draft")
        ui.press("Return", control=True)
        ui.wait_closed("real modified-Enter canonical receipt closes retained block form")
        expected_a = {**initial, "block": raw_a}
        saved_a = durable("ctrl-enter-saved", expected_a, baseline)
        passed("Final unblurred spaces/backslash/braces/LF/punctuation commit through actual Ctrl+Enter, canonical preflight and native Ctrl+S")

        ui.press("z", control=True)
        undone_a = durable("ctrl-enter-undone", initial, saved_a)
        ui.press("z", control=True, shift=True)
        redone_a = durable("ctrl-enter-redone", expected_a, undone_a)
        require(source_values(redone_a) == source_values(saved_a), "Rich Redo must restore the exact prior accepted source/body/HTML")
        passed("One actual rich Undo restores only the original equation; Redo restores the exact accepted source and leaves other prose/atoms untouched")

        ui.open_equation("block", raw_a)
        raw_b = contract["typedInputs"]["button"]
        ui.edit_raw(raw_b)
        ui.snapshot("unblurred-before-render-button")
        ui.click("twyne-math-source-save")
        ui.wait_closed("actual Render equation click receives canonical acceptance")
        expected_b = {**initial, "block": raw_b}
        saved_b = durable("button-saved", expected_b, redone_a)
        passed("Actual Render equation button reads final unblurred quotes/ampersand/LF/spaces and durably files only its exact raw atom")

        ui.open_equation("block", raw_b)
        ui.edit_raw(contract["typedInputs"]["cancel"])
        ui.snapshot("unblurred-before-cancel")
        ui.click("twyne-math-source-cancel")
        ui.wait_closed("actual Cancel neutral focus return")
        ui.press("s", control=True)
        require(source_values(ui.document()[1]) == source_values(saved_b), "Cancel changed an exact saved raw atom or canonical/HTML bytes")
        ui.open_equation("block", raw_b)
        ui.edit_raw(contract["typedInputs"]["escape"])
        ui.press("Escape")
        ui.wait_closed("actual Escape neutral focus return")
        ui.press("s", control=True)
        require(source_values(ui.document()[1]) == source_values(saved_b), "Escape changed an exact saved raw atom or canonical/HTML bytes")
        ui.press("z", control=True)
        undone_b = durable("cancel-history-undone", expected_a, saved_b)
        ui.press("z", control=True, shift=True)
        saved_b = durable("cancel-history-redone", expected_b, undone_b)
        passed("Real Cancel/Escape preserve exact saved source/HTML and create no manuscript history entry; one Undo/Redo still reaches the preceding accepted equation")

        final_expected, final_saved = expected_b, saved_b
        if args.inline:
            ui.open_equation("inline", initial["inline"])
            inline_raw = "  a^2 + b^2  "
            ui.edit_raw(inline_raw)
            ui.snapshot("inline-real-child-open")
            ui.press("Return")
            ui.wait_closed("plain inline Enter receives canonical acceptance")
            expected_inline = {**expected_b, "inline": inline_raw}
            saved_inline = durable("inline-enter-saved", expected_inline, saved_b)
            ui.press("z", control=True)
            undone_inline = durable("inline-undone", expected_b, saved_inline)
            ui.press("z", control=True, shift=True)
            final_saved = durable("inline-redone", expected_inline, undone_inline)
            require(source_values(final_saved) == source_values(saved_inline), "Inline Redo must retain exact previously accepted canonical/HTML bytes")
            final_expected = expected_inline
            passed("Optional actual measured inline form/plain Enter is canonical and independently undoable without altering the accepted block equation")

        # Quit with an unsubmitted field still focused. Original Source form
        # drafts have no durable recovery contract; quitting may discard the
        # draft, but must not silently submit it or change its saved raw node.
        ui.open_equation("block", final_expected["block"])
        ui.edit_raw("not silently filed by clean quit!")
        ui.snapshot("unsubmitted-before-quit")
        ui.quit()
        require(source_values(ui.document()[1]) == source_values(final_saved), "Clean quit silently filed unsubmitted field input or changed accepted canonical/HTML bytes")
        passed("Actual focused Ctrl+Q exits zero without panic/leaked handles and leaves the unsubmitted equation draft unfiled")

        ui.start(import_fixture=False)
        ui.ensure_write()
        _, reopened = ui.document()
        valid(reopened, final_expected)
        require(source_values(reopened) == source_values(final_saved), "Fresh process did not reopen the same exact durable canonical/HTML")
        require(ui.node(ui.state(), FORM) is None, "Fresh process must not invent a restored unsubmitted source form")
        require(len(list((ui.data / "manuscripts").glob("*.json"))) == 1, "Fresh reopen created a duplicate imported folio")
        ui.open_equation("block", final_expected["block"])
        ui.snapshot("fresh-process-reopened-raw")
        ui.click("twyne-math-source-cancel")
        ui.wait_closed("fresh process final Cancel")
        ui.quit()
        valid(ui.document()[1], final_expected)
        require(source_values(ui.document()[1]) == source_values(final_saved), "Final Cancel/clean exit changed the accepted document")
        passed("Fresh actual process reopens the same copied folio and exact saved raw textarea; final Cancel/clean exit remains neutral")
        receipt["status"] = "pass"
    except BaseException as error:
        receipt["status"] = "fail"
        receipt["error"] = f"{type(error).__name__}: {error}"
        (output / "failure.txt").write_text(traceback.format_exc(), encoding="utf8")
        if ui is not None:
            try:
                ui.snapshot("failure")
            except BaseException as observation_error:
                receipt["failureObservationError"] = f"{type(observation_error).__name__}: {observation_error}"
            try:
                receipt["failureObservations"] = ui.retain_failure_observations(authored)
            except BaseException as observation_error:
                receipt["failureDiagnosticError"] = f"{type(observation_error).__name__}: {observation_error}"
        raise
    finally:
        if ui is not None:
            try:
                ui.close()
                receipt["ownedChildrenCleaned"] = True
            except BaseException as cleanup_error:
                receipt["status"] = "fail"
                receipt["ownedChildrenCleaned"] = False
                receipt["cleanupError"] = f"{type(cleanup_error).__name__}: {cleanup_error}"
                write_json(output / "acceptance.json", receipt)
                raise
        write_json(output / "acceptance.json", receipt)
        print(json.dumps({"output": str(output), "status": receipt["status"], "checks": len(receipt["checks"])}))


if __name__ == "__main__":
    main()
