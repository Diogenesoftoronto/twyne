#!/usr/bin/env python3
"""Real Dossier form/file/recovery acceptance on one freshly owned Xvfb.

Authoring this driver is not an execution receipt. No imported draft is filed
by a simulated callback: clicks/keys reach the actual ui-tests application.
"""

import argparse
import ctypes as C
import glob
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time
import traceback


ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
TIMEOUT = 20.0
INPUT_ROLES = {"TextInput", "MultilineTextInput"}
STEPS = [
    ("I", "Dept. of the Working Title", "What are we calling it, for now?"),
    ("II", "Dept. of Form", "What kind of piece is this?"),
    ("III", "Dept. of the Reader", "Who is this for?"),
    ("IV", "Dept. of Intent", "What should the piece accomplish?"),
    ("V", "Dept. of Voice", "What tone should the room protect?"),
    ("VI", "Dept. of Non-Negotiables", "What constraints or non-negotiables matter?"),
    ("VII", "Dept. of the Landing", "How will we know the draft has landed?"),
    ("VIII", "Dept. of Particulars", "A few specifics, drawn from what you just told us."),
    ("IX", "Dept. of Prior Material", "Already have a draft, notes, or sources to bring in?"),
    ("X", "Dept. of References", "Anything else the room should know about, and why?"),
]


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_file(path):
    return json.loads(path.read_text(encoding="utf8"))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def libraries():
    def load(name, override, pattern):
        candidates = sorted(glob.glob(pattern))
        return C.CDLL(os.environ.get(override) or (candidates[0] if candidates else name))

    x = load("libX11.so.6", "TWYNE_X11_LIBRARY", "/nix/store/*-lib[Xx]11-*/lib/libX11.so.6*")
    t = load("libXtst.so.6", "TWYNE_XTEST_LIBRARY", "/nix/store/*-lib[Xx]tst-*/lib/libXtst.so.6*")
    x.XOpenDisplay.argtypes, x.XOpenDisplay.restype = [C.c_char_p], C.c_void_p
    x.XCloseDisplay.argtypes = [C.c_void_p]
    x.XFlush.argtypes = [C.c_void_p]
    x.XStringToKeysym.argtypes, x.XStringToKeysym.restype = [C.c_char_p], C.c_ulong
    x.XKeysymToKeycode.argtypes, x.XKeysymToKeycode.restype = [C.c_void_p, C.c_ulong], C.c_uint
    x.XDefaultRootWindow.argtypes, x.XDefaultRootWindow.restype = [C.c_void_p], C.c_ulong
    x.XQueryTree.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ulong)), C.POINTER(C.c_uint)]
    x.XFetchName.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(C.c_void_p)]
    x.XFree.argtypes = [C.c_void_p]
    x.XSetInputFocus.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_ulong]
    t.XTestFakeMotionEvent.argtypes = [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong]
    t.XTestFakeButtonEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
    t.XTestFakeKeyEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
    return x, t


def private_env(output):
    # An allowlist, not a copy of the user's display/session/credential env.
    allowed = ("PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "LD_LIBRARY_PATH", "FONTCONFIG_FILE", "FONTCONFIG_PATH")
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    for name in ("home", "runtime", "config", "cache", "data-home"):
        (output / name).mkdir(mode=0o700)
    env.update({
        "HOME": str(output / "home"),
        "XDG_RUNTIME_DIR": str(output / "runtime"),
        "XDG_CONFIG_HOME": str(output / "config"),
        "XDG_CACHE_HOME": str(output / "cache"),
        "XDG_DATA_HOME": str(output / "data-home"),
        "GPUI_X11_SCALE_FACTOR": "1",
        "LEAK_BACKTRACE": "1",
        "RUST_BACKTRACE": "1",
        "DBUS_SESSION_BUS_ADDRESS": f"unix:path={output / 'runtime/no-session-bus'}",
        "DBUS_SYSTEM_BUS_ADDRESS": f"unix:path={output / 'runtime/no-system-bus'}",
        "PULSE_SERVER": f"unix:{output / 'runtime/no-pulse'}",
        "PIPEWIRE_REMOTE": str(output / "runtime/no-pipewire"),
    })
    icd = os.environ.get("TWYNE_GPUI_RENDER_ICD")
    if icd:
        require(Path(icd).is_absolute() and Path(icd).is_file(), "Render ICD must be an existing explicit absolute file")
        env["VK_DRIVER_FILES"] = icd
    helper = os.environ.get("TWYNE_DOCUMENT_HELPER")
    if helper:
        require(Path(helper).is_absolute() and Path(helper).is_file(), "Document helper must be an explicit absolute file")
        env["TWYNE_DOCUMENT_HELPER"] = helper
    return env


def stop_child(process):
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


class Native:
    def __init__(self, binary, output, fixture):
        self.binary, self.output, self.fixture = binary, output, fixture
        self.data = output / "library"
        self.env = private_env(output)
        self.x, self.t = libraries()
        self.server = self.app = self.connection = self.log = None
        self.launches = 0
        self.xvfb_log = (output / "xvfb.log").open("w", encoding="utf8")
        read_fd, write_fd = os.pipe()
        try:
            self.server = subprocess.Popen(["Xvfb", "-displayfd", str(write_fd), "-screen", "0", "1284x864x24", "-nolisten", "tcp"],
                env=self.env, stdin=subprocess.DEVNULL, pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=self.xvfb_log)
            os.close(write_fd)
            write_fd = None
            os.set_blocking(read_fd, False)
            deadline, number = time.monotonic() + 10, b""
            while b"\n" not in number and time.monotonic() < deadline:
                require(self.server.poll() is None, "Owned Xvfb exited before allocating its display")
                if select.select([read_fd], [], [], 0.1)[0]:
                    part = os.read(read_fd, 128)
                    require(part, "Owned Xvfb closed its allocation pipe")
                    number += part
            number = number.strip()
            require(number.isdigit(), "Owned Xvfb did not allocate a display within 10 seconds")
            self.env["DISPLAY"] = ":" + number.decode("ascii")
            self.connection = self.x.XOpenDisplay(self.env["DISPLAY"].encode())
            require(self.connection, "Could not connect to the new owned display")
        except BaseException:
            self.close()
            raise
        finally:
            os.close(read_fd)
            if write_fd is not None:
                os.close(write_fd)

    def alive(self):
        require(self.server.poll() is None, "Owned Xvfb exited unexpectedly")
        if self.app is not None and self.app.poll() is not None:
            raise RuntimeError(f"Native process exited {self.app.returncode}; inspect {self.log_path}")

    def wait(self, description, read, predicate=lambda value: bool(value)):
        deadline = time.monotonic() + TIMEOUT
        while time.monotonic() < deadline:
            self.alive()
            try:
                value = read()
                if predicate(value):
                    return value
            except (FileNotFoundError, json.JSONDecodeError):
                pass
            time.sleep(0.03)
        raise TimeoutError(f"20-second native condition deadline: {description}")

    def state(self):
        return json_file(self.geometry)

    def wait_state(self, description, predicate):
        return self.wait(description, self.state, predicate)

    @staticmethod
    def node(state, identifier):
        terminal = (f'NamedInteger("{identifier[0]}", {identifier[1]})' if isinstance(identifier, tuple) else f'Name("{identifier}")')
        matches = [item for item in state["elements"] if item["path"] and item["path"][-1] == terminal]
        require(len(matches) <= 1, f"Ambiguous observed control {identifier}")
        return matches[0] if matches else None

    @staticmethod
    def input(state, identifier):
        token = f'Name("{identifier}")'
        values = [item for item in state["elements"] if token in item["path"] and item.get("role") in INPUT_ROLES and isinstance(item.get("value"), str)]
        require(len(values) <= 1, f"Ambiguous actual native input {identifier}")
        return values[0] if values else None

    @staticmethod
    def input_focused(state, identifier):
        token = f'Name("{identifier}")'
        return any(item.get("focused") is True and token in item["path"] for item in state["elements"])

    def visible(self, state, target):
        if not target or not target["visible"]:
            return False
        rect = target["rect"]
        left, top, right, bottom = 0, 0, state["viewport"]["width"], state["viewport"]["height"]
        for ancestor in ("dossier-question-leaf", "dossier-left-leaf"):
            if f'Name("{ancestor}")' in target["path"]:
                scroll = self.node(state, ancestor)
                require(scroll is not None, f"Observed ancestor {ancestor} is missing")
                clip = scroll["rect"]
                left, top = max(left, clip["x"]), max(top, clip["y"])
                right, bottom = min(right, clip["x"] + clip["width"]), min(bottom, clip["y"] + clip["height"])
        return (rect["width"] > 0 and rect["height"] > 0 and left <= rect["x"] and top <= rect["y"]
                and rect["x"] + rect["width"] <= right and rect["y"] + rect["height"] <= bottom)

    def key(self, name, down):
        code = self.x.XKeysymToKeycode(self.connection, self.x.XStringToKeysym(name.encode("ascii")))
        require(code and self.t.XTestFakeKeyEvent(self.connection, code, int(down), 0), f"XTEST key unavailable: {name}")
        self.x.XFlush(self.connection)
        time.sleep(0.012)

    def press(self, name, control=False, shift=False):
        if control:
            self.key("Control_L", True)
        if shift:
            self.key("Shift_L", True)
        self.key(name, True)
        self.key(name, False)
        if shift:
            self.key("Shift_L", False)
        if control:
            self.key("Control_L", False)

    def type_ascii(self, text):
        for character in text:
            if character in {" ", "\n", "!", "."}:
                self.press({" ": "space", "\n": "Return", "!": "1", ".": "period"}[character], shift=character == "!")
            else:
                require(character.isascii() and (character.islower() or character.isdigit()), "Authored input must use the explicit ASCII XTEST mapping")
                self.press(character)

    def click(self, identifier):
        # A new question's label can arrive before its natural height has
        # recentered the sheet. Require the same visible bounds in two fresh
        # captured native frames; polling one stale file twice is not proof.
        last_stamp = last_geometry = None
        stable_frames = 0

        def settled(state):
            nonlocal last_stamp, last_geometry, stable_frames
            target = self.node(state, identifier)
            if not self.visible(state, target) or target.get("disabled") is True:
                stable_frames = 0
                return False
            stamp = self.geometry.stat().st_mtime_ns
            if stamp == last_stamp:
                return False
            last_stamp = stamp
            question = self.node(state, "dossier-active-question")
            sheet = self.node(state, "dossier-question-sheet")
            geometry = (target["rect"], state["windowOrigin"],
                        question["rect"] if question else None,
                        sheet["rect"] if sheet else None)
            stable_frames = stable_frames + 1 if geometry == last_geometry else 1
            last_geometry = geometry
            return stable_frames >= 2

        state = self.wait_state(f"stable fully visible enabled {identifier}", settled)
        rect, origin = self.node(state, identifier)["rect"], state["windowOrigin"]
        require(self.t.XTestFakeMotionEvent(self.connection, 0, round(origin["x"] + rect["x"] + rect["width"] / 2), round(origin["y"] + rect["y"] + rect["height"] / 2), 0), "Actual pointer motion failed")
        require(self.t.XTestFakeButtonEvent(self.connection, 1, 1, 0) and self.t.XTestFakeButtonEvent(self.connection, 1, 0, 0), "Actual pointer click failed")
        self.x.XFlush(self.connection)
        time.sleep(0.07)

    def edit(self, identifier, text):
        self.click(identifier)
        self.wait_state(f"focused {identifier}", lambda s: self.input(s, identifier) is not None and self.input_focused(s, identifier))
        self.press("a", control=True)
        self.type_ascii(text)
        state = self.wait_state(f"exact unblurred text in {identifier}", lambda s: s["keyboardInput"] and self.input(s, identifier) is not None and self.input_focused(s, identifier) and self.input(s, identifier)["value"] == text)
        return state

    def section(self, index):
        self.click(("dossier-section", index))
        return self.wait_state(f"actual roman section {STEPS[index][0]}", lambda s: self.node(s, "dossier-question") is not None and self.node(s, "dossier-question")["label"] == STEPS[index][2])

    def retain_state(self, name, state=None):
        write_json(self.output / f"{name}-geometry.json", state or self.state())

    def document(self):
        paths = list((self.data / "manuscripts").glob("*.json"))
        if not paths:
            raise FileNotFoundError("The native manuscript is not created yet")
        require(len(paths) == 1, "Fixture must have exactly one actual copied folio")
        return paths[0], json_file(paths[0])

    def retain_failure_observations(self, fixture_bytes):
        # Read the actual failed state before cleanup. Diagnostics cannot turn
        # a timeout into success or replace the source/HTML acceptance gates.
        observations = {}
        try:
            path, document = self.document()
            payload = path.read_bytes()
            workspace = document.get("workspace") or {}
            content = workspace.get("content") or {}
            body = document.get("body", "").encode("utf8")
            source = content.get("typstSource", "").encode("utf8")
            html = content.get("html", "").encode("utf8")
            (self.output / "failure-manuscript.json").write_bytes(payload)
            observations["manuscript"] = {
                "path": str(path), "id": document.get("id"),
                "revision": document.get("revision"),
                "projection": workspace.get("projection"),
                "fileSha256": hashlib.sha256(payload).hexdigest(),
                "bodyBytes": len(body), "canonicalSourceBytes": len(source),
                "htmlBytes": len(html),
                "canonicalSourceSha256": hashlib.sha256(source).hexdigest(),
                "bodyEqualsAuthoredFixture": body == fixture_bytes,
                "canonicalSourceEqualsAuthoredFixture": source == fixture_bytes,
            }
        except BaseException as diagnostic_error:
            observations["manuscriptReadError"] = f"{type(diagnostic_error).__name__}: {diagnostic_error}"
        try:
            state = self.state()
            self.retain_state("failure", state)
            saved = self.node(state, "save-status")
            observations["window"] = {
                "windowActive": state.get("windowActive"),
                "keyboardInput": state.get("keyboardInput"),
                "richEditorMounted": self.node(state, "twyne-rich-manuscript") is not None,
                "saveStatus": saved.get("label") if saved else None,
                "focusedElements": [item["path"] for item in state["elements"] if item.get("focused") is True],
            }
        except BaseException as diagnostic_error:
            observations["geometryReadError"] = f"{type(diagnostic_error).__name__}: {diagnostic_error}"
        return observations

    def recovery(self, mode, folio_id, base):
        expected = {"scope": f"{mode}:{folio_id}", "owner": None, "base": str(base)}
        matches = []
        for path in (self.data / "dossier-recovery").glob("*.json"):
            record = json_file(path)
            if record.get("identity") == expected:
                matches.append((path, record))
        require(len(matches) <= 1, "Recovery identity must own exactly one file")
        return matches[0] if matches else None

    def wait_recovery(self, mode, folio_id, base, answers):
        return self.wait("exact scoped recovery answers", lambda: self.recovery(mode, folio_id, base),
            lambda item: item is not None and all(item[1]["draft"]["answers"].get(key) == value for key, value in answers.items()))

    def start(self, import_fixture=False):
        require(self.app is None or self.app.poll() is not None, "A previous owned application is still running")
        self.launches += 1
        self.geometry = self.output / f"live-geometry-{self.launches}.json"
        self.log_path = self.output / f"app-{self.launches}.log"
        self.log = self.log_path.open("w", encoding="utf8")
        command = [str(self.binary), "--data-dir", str(self.data), "--capture-state", "dossier", "--capture-size", "1280x860", "--capture-geometry", str(self.geometry), "--capture-geometry-watch"]
        if import_fixture:
            command.append(str(self.fixture))
        self.app = subprocess.Popen(command, env=self.env, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log)
        self.wait_state("mounted real Dossier", lambda s: self.node(s, "dossier-form") is not None)
        root, parent, children, count = C.c_ulong(), C.c_ulong(), C.POINTER(C.c_ulong)(), C.c_uint()
        require(self.x.XQueryTree(self.connection, self.x.XDefaultRootWindow(self.connection), C.byref(root), C.byref(parent), C.byref(children), C.byref(count)), "Could not query owned window tree")
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
        require(len(windows) == 1, "Exactly one native Twyne window must belong to the owned display")
        self.x.XSetInputFocus(self.connection, windows[0], 1, 0)
        self.x.XFlush(self.connection)
        self.wait_state("actual native activation", lambda s: s["windowActive"])

    def quit(self):
        self.press("q", control=True)
        self.app.wait(timeout=20)
        self.log.close()
        self.log = None
        require(self.app.returncode == 0, f"Ctrl-Q exited {self.app.returncode}; inspect {self.log_path}")
        text = self.log_path.read_text(encoding="utf8", errors="replace").lower()
        require("leaked handles" not in text and "panicked at" not in text, f"Native shutdown diagnostics failed; inspect {self.log_path}")

    def close(self):
        # Termination is cleanup only; never counted as an accepted close.
        try:
            stop_child(self.app)
        finally:
            if self.log is not None:
                self.log.close()
                self.log = None
            try:
                if self.connection is not None:
                    self.x.XCloseDisplay(self.connection)
                    self.connection = None
            finally:
                try:
                    stop_child(self.server)
                finally:
                    self.xvfb_log.close()


def source_values(document):
    workspace = document.get("workspace") or {}
    content = workspace.get("content") or {}
    return document.get("body"), content.get("typstSource"), content.get("html")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=ROOT / "desktop/gpui/target/debug/twyne-desktop")
    parser.add_argument("--output", type=Path, help="Fresh nonexistent output directory; default allocates a new /tmp directory")
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    require(binary.is_file() and os.access(binary, os.X_OK), "Use an executable actual ui-tests binary")
    if args.output:
        output = args.output.absolute()
        output.mkdir(mode=0o700, parents=True, exist_ok=False)
    else:
        output = Path(tempfile.mkdtemp(prefix="twyne-dossier-native-"))
    fixture = HERE / "retained.typ"
    fixture_bytes = fixture.read_bytes()
    require(b"keeps its  double space" in fixture_bytes and b"_.  \n" in fixture_bytes and b"#let retained_value" in fixture_bytes, "Authored source whitespace/formatting fixture drifted")
    (output / "original-source.typ").write_bytes(fixture_bytes)
    receipt = {"status": "running", "scope": "actual isolated X11 native Dossier form/filing/recovery; no race/provider/Proof/other-OS claim",
        "binarySha256": digest_file(binary), "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(), "display": "fresh owned Xvfb", "input": "XTEST keys/clicks at actual observed geometry", "checks": []}
    write_json(output / "acceptance.json", receipt)
    ui = None

    def passed(label):
        receipt["checks"].append(label)
        write_json(output / "acceptance.json", receipt)

    def unchanged(document, baseline):
        require(source_values(document) == source_values(baseline), "Canonical source/body/projected HTML changed during Dossier metadata work")
        require(document["workspace"]["provenance"] == baseline["workspace"]["provenance"], "Original imported bytes/provenance changed")

    try:
        ui = Native(binary, output, fixture)
        ui.start(import_fixture=True)
        path, original = ui.wait("actual imported source copy", ui.document)
        original_bytes = path.read_bytes()
        folio_id = original["id"]
        require(original["body"].encode("utf8") == fixture_bytes and original["workspace"]["content"]["typstSource"].encode("utf8") == fixture_bytes, "Import must preserve exact authored source/body bytes")
        require(bytes(original["workspace"]["provenance"]["originalBytes"]) == fixture_bytes, "Native import must retain original bytes")
        (output / "imported-manuscript.json").write_bytes(original_bytes)
        passed("Actual imported copy preserves nonempty authored source, formatting, #let and exact whitespace")

        title = "native dossier keeps the final character!"
        ui.section(0)
        ui.retain_state("create-unblurred-title", ui.edit("dossier-answer-0", title))
        ui.press("Escape")
        ui.wait_state("cancel without blur closes Dossier", lambda s: ui.node(s, "dossier-form") is None)
        create_recovery, recovery = ui.wait_recovery("create", folio_id, 0, {"workingTitle": title})
        require(path.read_bytes() == original_bytes, "Cancel must not file the pending brief into the manuscript")
        write_json(output / "create-cancel-recovery.json", recovery)
        passed("Unblurred final title survives actual Escape Cancel in exact create-scope recovery without filing")

        # Request the actual writing projection through native UI, never a
        # fixture-supplied HTML cache or synthetic provider/compiler response.
        ui.click("toggle-compositor")
        ui.wait_state("real Write control", lambda s: ui.node(s, "write-mode") is not None)
        ui.click("write-mode")
        ui.wait_state("helper-projected rich writing mounted", lambda s: ui.node(s, "twyne-rich-manuscript") is not None)
        ui.press("s", control=True)
        path, baseline = ui.wait("durable nonempty verified projection", ui.document,
            lambda item: item[1].get("workspace", {}).get("projection") == "verified" and "The opening prose stays exact" in item[1]["workspace"]["content"]["html"])
        require(source_values(baseline)[:2] == source_values(original)[:2], "Opening Write must not rewrite authored source/body")
        require(baseline["workspace"]["provenance"] == original["workspace"]["provenance"], "Projection must retain original import bytes")
        (output / "before-create-manuscript.json").write_bytes(path.read_bytes())
        passed("Actual local helper projects nonempty HTML through Write/Save while retaining authored source/body")

        ui.click("create-dossier")
        ui.wait_state("same-scope title restored", lambda s: ui.input(s, "dossier-answer-0") is not None and ui.input(s, "dossier-answer-0")["value"] == title)
        reopened_path, reopened = ui.wait_recovery("create", folio_id, 0, {"workingTitle": title})
        require(reopened_path == create_recovery and reopened["identity"] == recovery["identity"], "Same create scope must reopen its actual recovery file")
        passed("Actual Create reopen restores the exact native input from the same recovery identity")
        audience = "a skeptical reader\nkeeps the final line!"
        ui.section(2)
        ui.retain_state("create-unblurred-audience", ui.edit("dossier-answer-2", audience))
        ui.press("Escape")
        ui.wait_state("textarea Cancel closes", lambda s: ui.node(s, "dossier-form") is None)
        ui.wait_recovery("create", folio_id, 0, {"workingTitle": title, "audience": audience})
        unchanged(ui.document()[1], baseline)
        ui.click("create-dossier")
        ui.wait_state("same-scope textarea restored", lambda s: ui.input(s, "dossier-answer-2") is not None and ui.input(s, "dossier-answer-2")["value"] == audience)
        for index, (numeral, department, _) in enumerate(STEPS):
            state = ui.section(index)
            require(ui.node(state, ("dossier-section", index))["label"] == f"{numeral} · {department}", "Roman control must expose its actual source label")
            ui.retain_state(f"roman-{index + 1}", state)
        require(ui.node(ui.state(), "dossier-next")["label"] == "Send to press", "Section X must expose the actual filing action")
        passed("All ten actual roman controls navigate the original questions and retain unblurred multiline recovery")

        ui.click("dossier-next")
        ui.wait_state("actual Create filing closes only after receipt", lambda s: ui.node(s, "dossier-form") is None)
        path, created = ui.wait("durably filed Create brief", ui.document,
            lambda item: (item[1].get("workspace", {}).get("brief") or {}).get("answers", {}).get("workingTitle") == title)
        require(created["workspace"]["brief"]["answers"]["audience"] == audience and created["title"] == title, "Actual Create must file exact title/audience")
        require(created["id"] == folio_id and created["revision"] > baseline["revision"], "Create must update the same durable folio")
        unchanged(created, baseline)
        ui.wait("filed Create recovery cleared", lambda: not create_recovery.exists())
        created_bytes = path.read_bytes()
        (output / "after-create-manuscript.json").write_bytes(created_bytes)
        passed("Actual Send to press durably files Create and clears only its recovery; nonempty source/body/HTML stay exact")

        refined_title = "native refined dossier kept!"
        goal = "the reader can name the point\nand the retained source stays exact!"
        base = created["workspace"]["brief"]["updatedAt"]
        ui.click("create-dossier")
        # Start over is an independent unavailable capability, not a mode
        # indicator. This actual exit node is Back home only in Create, and
        # Back to desk only in Refine. Check restored fields and the exact
        # saved-brief recovery scope separately before editing them.
        ui.wait_state("actual Refine mode with saved title", lambda s:
            ui.node(s, "dossier-form") is not None
            and ui.node(s, "dossier-exit") is not None
            and (ui.node(s, "dossier-exit").get("label") or "").casefold() == "back to desk"
            and ui.input(s, "dossier-answer-0") is not None
            and ui.input(s, "dossier-answer-0")["value"] == title)
        ui.section(2)
        require(ui.input(ui.state(), "dossier-answer-2")["value"] == audience, "Refine must hydrate the actual filed audience before editing")
        initial_refine_path, initial_refine_recovery = ui.wait_recovery("refine", folio_id, base, {"workingTitle": title, "audience": audience})
        write_json(output / "refine-open-recovery.json", initial_refine_recovery)
        require(path.read_bytes() == created_bytes, "Opening Refine must not change the saved manuscript")
        ui.section(0)
        ui.edit("dossier-answer-0", refined_title)
        ui.section(3)
        ui.retain_state("refine-unblurred-goal", ui.edit("dossier-answer-3", goal))
        ui.press("Escape")
        ui.wait_state("actual Refine Cancel", lambda s: ui.node(s, "dossier-form") is None)
        refine_recovery, recovery = ui.wait_recovery("refine", folio_id, base, {"workingTitle": refined_title, "goal": goal})
        require(refine_recovery == initial_refine_path and recovery["identity"] == initial_refine_recovery["identity"], "Refine edits must remain in the actual saved-brief recovery scope")
        require(path.read_bytes() == created_bytes, "Refine Cancel must not alter the saved manuscript/brief")
        write_json(output / "refine-cancel-recovery.json", recovery)
        ui.click("create-dossier")
        ui.wait_state("actual recovered Refine goal", lambda s: ui.input(s, "dossier-answer-3") is not None and ui.input(s, "dossier-answer-3")["value"] == goal)
        reopened_path, reopened = ui.wait_recovery("refine", folio_id, base, {"workingTitle": refined_title, "goal": goal})
        require(reopened_path == refine_recovery and reopened["identity"] == recovery["identity"], "Refine reopen must retain the exact saved-brief base identity")
        passed("Same-base Refine Cancel/reopen restores actual pending title/goal and preserves the saved manuscript")
        ui.section(9)
        ui.click("dossier-next")
        ui.wait_state("actual Refine receipt closes", lambda s: ui.node(s, "dossier-form") is None)
        path, refined = ui.wait("durably filed Refine brief", ui.document,
            lambda item: (item[1].get("workspace", {}).get("brief") or {}).get("answers", {}).get("workingTitle") == refined_title)
        brief = refined["workspace"]["brief"]
        require(brief["answers"]["goal"] == goal and brief["answers"]["audience"] == audience, "Refine must file exact pending fields and retain other answers")
        require(brief["completedAt"] == created["workspace"]["brief"]["completedAt"], "Refine must preserve original completion metadata")
        require(refined["id"] == folio_id and refined["revision"] > created["revision"], "Refine must durably advance the same folio")
        unchanged(refined, baseline)
        ui.wait("filed Refine recovery cleared", lambda: not refine_recovery.exists())
        refined_bytes = path.read_bytes()
        (output / "after-refine-manuscript.json").write_bytes(refined_bytes)
        passed("Actual Refine filing updates brief metadata while canonical source/body/projected HTML/import bytes stay exact")

        held = "held through a clean quit\nwith the last character!"
        ui.click("create-dossier")
        ui.section(2)
        ui.retain_state("unblurred-before-quit", ui.edit("dossier-answer-2", held))
        ui.quit()
        require(path.read_bytes() == refined_bytes, "Quit must not file pending Refine answers into the manuscript")
        base = brief["updatedAt"]
        held_recovery = ui.recovery("refine", folio_id, base)
        require(held_recovery is not None, "Clean quit must leave a scoped recovery file")
        held_path, held_record = held_recovery
        require(held_record["draft"]["answers"]["audience"] == held, "Clean quit must keep the exact final unblurred textarea value on disk")
        write_json(output / "quit-recovery.json", held_record)
        passed("Actual focused Ctrl-Q exits zero without entity leaks and durably retains the final unblurred textarea")

        ui.start(import_fixture=False)
        ui.wait_state("fresh native process restores exact held textarea", lambda s: ui.input(s, "dossier-answer-2") is not None and ui.input(s, "dossier-answer-2")["value"] == held)
        require(ui.document()[0] == path and path.read_bytes() == refined_bytes, "Fresh process must reopen the same copied folio without a second import")
        require(ui.recovery("refine", folio_id, base)[0] == held_path, "Fresh process must reopen the exact durable recovery scope")
        ui.retain_state("fresh-process-restored")
        ui.section(0)
        require(ui.input(ui.state(), "dossier-answer-0")["value"] == refined_title, "Saved Refine title must also survive fresh process reopen")
        passed("Fresh actual process restores exact scoped draft and filed metadata with the same nonempty canonical manuscript")
        ui.press("Escape")
        ui.wait_state("final actual Cancel", lambda s: ui.node(s, "dossier-form") is None)
        ui.quit()
        require(path.read_bytes() == refined_bytes, "Second clean quit must preserve canonical and saved brief bytes")
        passed("Second real Cancel/Ctrl-Q exits cleanly without altering the saved manuscript")
        receipt["status"] = "pass"
    except BaseException as error:
        receipt["status"] = "fail"
        receipt["error"] = f"{type(error).__name__}: {error}"
        (output / "failure.txt").write_text(traceback.format_exc(), encoding="utf8")
        if ui is not None:
            receipt["failureObservations"] = ui.retain_failure_observations(fixture_bytes)
        raise
    finally:
        if ui is not None:
            try:
                ui.close()
                receipt["ownedChildrenCleaned"] = True
            except BaseException as cleanup_error:
                receipt["ownedChildrenCleaned"] = False
                receipt["status"] = "fail"
                receipt["cleanupError"] = f"{type(cleanup_error).__name__}: {cleanup_error}"
                write_json(output / "acceptance.json", receipt)
                raise
        write_json(output / "acceptance.json", receipt)
        print(json.dumps({"output": str(output), "status": receipt["status"], "checks": len(receipt["checks"])}))


if __name__ == "__main__":
    main()
