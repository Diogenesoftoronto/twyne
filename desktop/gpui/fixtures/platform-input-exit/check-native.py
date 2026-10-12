#!/usr/bin/env python3
"""Check real focused input shutdown on newly allocated owned Xvfb displays.

Uses the main ui-tests binary and its observed capture geometry. Each case has
an isolated local test library, actual X11 activation/XTEST keys, and either
Ctrl-Q or a real WM_PROTOCOLS/WM_DELETE_WINDOW ClientMessage. No user display,
provider calls, force-kill success, headless platform or mock Window is used.
"""
import argparse
import ctypes as C
import glob
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[4]
CASES = ["textarea-quit", "textarea-close", "source-quit", "source-close"]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--binary", type=Path, default=ROOT / "desktop/gpui/target/debug/twyne-desktop")
parser.add_argument("--fixture", type=Path, default=ROOT / "desktop/gpui/fixtures/marginalia/browser-manuscript.html")
parser.add_argument("--cast", type=Path, default=ROOT / "desktop/gpui/fixtures/cast/native-retained.json")
parser.add_argument("--cast-folio", default="web/folio:café")
parser.add_argument("--output", type=Path, default=Path("/tmp/twyne-platform-input-exit"))
parser.add_argument("--cases", nargs="+", choices=CASES, default=CASES)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


class ClientMessageData(C.Union):
    _fields_ = [("b", C.c_char * 20), ("s", C.c_short * 10), ("l", C.c_long * 5)]


class ClientMessageEvent(C.Structure):
    _fields_ = [("type", C.c_int), ("serial", C.c_ulong), ("send_event", C.c_int),
               ("display", C.c_void_p), ("window", C.c_ulong), ("message_type", C.c_ulong),
               ("format", C.c_int), ("data", ClientMessageData)]


class XEvent(C.Union):
    _fields_ = [("client", ClientMessageEvent), ("pad", C.c_long * 24)]


def native_libraries():
    x11 = glob.glob("/nix/store/*-lib[Xx]11-*/lib/libX11.so.6*")
    xtest = glob.glob("/nix/store/*-lib[Xx]tst-*/lib/libXtst.so.6*")
    x = C.CDLL(os.environ.get("TWYNE_X11_LIBRARY") or (x11[0] if x11 else "libX11.so.6"))
    t = C.CDLL(os.environ.get("TWYNE_XTEST_LIBRARY") or (xtest[0] if xtest else "libXtst.so.6"))
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
    x.XInternAtom.argtypes, x.XInternAtom.restype = [C.c_void_p, C.c_char_p, C.c_int], C.c_ulong
    x.XSendEvent.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_long, C.POINTER(XEvent)]
    t.XTestFakeMotionEvent.argtypes = [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong]
    t.XTestFakeButtonEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
    t.XTestFakeKeyEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
    return x, t


def run_case(case):
    textarea = case.startswith("textarea")
    close = case.endswith("close")
    output = args.output / case
    output.mkdir(parents=True, exist_ok=True)
    log_path = output / "app.log"
    result = {"case": case, "backend": "X11", "display": "fresh owned Xvfb",
              "binarySha256": sha256(args.binary.read_bytes()).hexdigest(),
              "exit": "WM_DELETE_WINDOW" if close else "Ctrl-Q", "checks": []}
    with tempfile.TemporaryDirectory(prefix="twyne-input-exit-") as temporary:
        temporary = Path(temporary)
        data = temporary / "library"
        geometry = temporary / "geometry.json"
        read_fd, write_fd = os.pipe()
        server = subprocess.Popen(["Xvfb", "-displayfd", str(write_fd),
            "-screen", "0", "1284x864x24", "-nolisten", "tcp"],
            pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        os.close(write_fd)
        app, connection, log = None, None, None
        try:
            with os.fdopen(read_fd) as reader:
                number = reader.readline().strip()
            assert number, "Owned Xvfb failed to allocate a display"
            env = {**os.environ, "DISPLAY": ":" + number, "XDG_RUNTIME_DIR": str(temporary),
                   "GPUI_X11_SCALE_FACTOR": "1", "LEAK_BACKTRACE": "1"}
            env.pop("WAYLAND_DISPLAY", None)
            env.pop("GPUI_HEADLESS", None)
            if env.get("TWYNE_GPUI_RENDER_ICD"):
                env["VK_DRIVER_FILES"] = env["TWYNE_GPUI_RENDER_ICD"]
            log = log_path.open("w")
            command = [str(args.binary.resolve()), "--data-dir", str(data), "--capture-state",
                       "writing", "--capture-size", "1280x860",
                       "--capture-geometry", str(geometry), "--capture-geometry-watch"]
            if textarea:
                command += ["--capture-cast", str(args.cast.resolve()), "--capture-cast-folio", args.cast_folio]
            command += [str(args.fixture.resolve())]
            app = subprocess.Popen(command, env=env, stdout=log, stderr=log)

            def node(state, identifier):
                matches = [item for item in state["elements"] if item["path"][-1] == f'Name("{identifier}")']
                assert len(matches) <= 1, identifier
                return matches[0] if matches else None

            def wait(predicate):
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    if app.poll() is not None:
                        raise RuntimeError(log_path.read_text())
                    try:
                        state = json.loads(geometry.read_text())
                        if predicate(state):
                            return state
                    except (FileNotFoundError, json.JSONDecodeError):
                        pass
                    time.sleep(0.025)
                raise TimeoutError(f"Native input state did not settle: {case}")

            state = wait(lambda value: node(value, "toggle-notebook") is not None)
            origin = state["windowOrigin"]
            x, t = native_libraries()
            connection = x.XOpenDisplay(env["DISPLAY"].encode())
            assert connection
            tree_root, tree_parent, count = C.c_ulong(), C.c_ulong(), C.c_uint()
            children = C.POINTER(C.c_ulong)()
            assert x.XQueryTree(connection, x.XDefaultRootWindow(connection), C.byref(tree_root), C.byref(tree_parent), C.byref(children), C.byref(count))
            owned = None
            try:
                for index in range(count.value):
                    name = C.c_void_p()
                    if x.XFetchName(connection, children[index], C.byref(name)) and name.value:
                        try:
                            if C.string_at(name.value) == b"Twyne":
                                owned = children[index]
                        finally:
                            x.XFree(name)
            finally:
                x.XFree(children)
            assert owned is not None
            x.XSetInputFocus(connection, owned, 1, 0)
            x.XFlush(connection)
            wait(lambda value: value["windowActive"])
            result["checks"].append("Owned native window is actually activated")

            def key(name, down):
                code = x.XKeysymToKeycode(connection, x.XStringToKeysym(name.encode()))
                assert code and t.XTestFakeKeyEvent(connection, code, int(down), 0)
                x.XFlush(connection)
                time.sleep(0.015)

            def press(name, control=False, shift=False):
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

            def click_item(item):
                rect = item["rect"]
                assert t.XTestFakeMotionEvent(connection, 0, round(origin["x"] + rect["x"] + rect["width"] / 2), round(origin["y"] + rect["y"] + rect["height"] / 2), 0)
                assert t.XTestFakeButtonEvent(connection, 1, 1, 0)
                assert t.XTestFakeButtonEvent(connection, 1, 0, 0)
                x.XFlush(connection)
                time.sleep(0.075)

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

            def click(identifier):
                state = wait(lambda value: fully_visible(value, node(value, identifier)))
                click_item(node(state, identifier))

            def reveal(identifier):
                for _ in range(30):
                    state = wait(lambda value: node(value, "cast-scroll") is not None)
                    target = node(state, identifier)
                    if fully_visible(state, target):
                        return
                    rect = node(state, "cast-scroll")["rect"]
                    direction = 4 if target is not None and target["rect"]["y"] < rect["y"] else 5
                    t.XTestFakeMotionEvent(connection, 0, round(origin["x"] + rect["x"] + rect["width"] / 2), round(origin["y"] + rect["y"] + rect["height"] / 2), 0)
                    for _ in range(3):
                        t.XTestFakeButtonEvent(connection, direction, 1, 0)
                        t.XTestFakeButtonEvent(connection, direction, 0, 0)
                    x.XFlush(connection)
                    time.sleep(0.3)
                raise AssertionError(f"Native control must be reachable: {identifier}")

            if textarea:
                click("toggle-notebook")
                wait(lambda value: node(value, "cast-root") is not None)
                reveal("cast-reply-open-0")
                click("cast-reply-open-0")
                reveal("cast-reply-input-0")
                target = "cast-reply-input-0"
            else:
                state = wait(lambda value: node(value, "toggle-compositor") is not None)
                if node(state, "source-mode") is None:
                    click("toggle-compositor")
                click("source-mode")
                wait(lambda value: node(value, "source-field") is not None)
                target = "source-field"
            click(target)
            wait(lambda value: any(item["focused"] and f'Name("{target}")' in item["path"] for item in value["elements"]))
            document = list((data / "manuscripts").glob("*.json"))
            assert len(document) == 1
            canonical = document[0].read_bytes()
            (output / "original-manuscript.json").write_bytes(canonical)

            if textarea:
                press("a", control=True)
                typed = "input exit!"
            else:
                press("End", control=True)
                press("Return")
                typed = "// final input!"
            for character in typed:
                if character == " ":
                    press("space")
                elif character == "!":
                    press("1", shift=True)
                elif character == "/":
                    press("slash")
                else:
                    assert character.isascii() and character.islower()
                    press(character)
            def current_input(state):
                return next((item.get("value") for item in state["elements"]
                    if f'Name("{target}")' in item["path"] and item.get("role") in {"MultilineTextInput", "TextInput"}
                    and isinstance(item.get("value"), str)), None)
            state = wait(lambda value: value["keyboardInput"] and current_input(value) is not None
                and (current_input(value) == typed if textarea else current_input(value).endswith(typed)))
            exact_input = current_input(state)
            assert any(item["focused"] and f'Name("{target}")' in item["path"] for item in state["elements"])
            (output / "focused-typed-geometry.json").write_text(json.dumps(state, indent=2) + "\n")
            result["checks"].append("Real focused native input contains the final typed character without blurring")

            if close:
                message = XEvent()
                message.client.type = 33
                message.client.send_event = 1
                message.client.display = connection
                message.client.window = owned
                message.client.message_type = x.XInternAtom(connection, b"WM_PROTOCOLS", False)
                message.client.format = 32
                message.client.data.l[0] = x.XInternAtom(connection, b"WM_DELETE_WINDOW", False)
                message.client.data.l[1] = 0
                assert x.XSendEvent(connection, owned, False, 0, C.byref(message))
                x.XFlush(connection)
            else:
                press("q", control=True)
            app.wait(timeout=15)
            result["exitCode"] = app.returncode
            assert app.returncode == 0, log_path.read_text()
            assert "leaked handles" not in log_path.read_text().lower()
            result["checks"].append("Actual requested close exits zero with leak detection enabled")
            assert document[0].read_bytes() == canonical
            (output / "final-manuscript.json").write_bytes(document[0].read_bytes())
            if textarea:
                final = json.loads((data / "cast.json").read_text())
                scope = next(identifier for identifier in final["folios"] if identifier != "unimported/foreign")
                assert final["replyDrafts"][scope]["pn-source:one"] == exact_input
                (output / "final-cast.json").write_text(json.dumps(final, ensure_ascii=False, indent=2) + "\n")
            else:
                drafts = list((data / "source-drafts").glob("*.json"))
                assert len(drafts) == 1
                final = json.loads(drafts[0].read_text())
                assert final["draft"]["source"] == exact_input
                (output / "final-source-draft.json").write_text(json.dumps(final, ensure_ascii=False, indent=2) + "\n")
            result["checks"].append("Exact unblurred draft reaches disk and canonical manuscript bytes stay unchanged")
            (output / "acceptance.json").write_text(json.dumps(result, indent=2) + "\n")
            return result
        finally:
            if geometry.exists():
                (output / "last-geometry.json").write_bytes(geometry.read_bytes())
            if data.exists():
                for pattern in ["cast.json", "source-drafts/*.json", "manuscripts/*.json"]:
                    for path in data.glob(pattern):
                        (output / ("last-" + path.parent.name + "-" + path.name)).write_bytes(path.read_bytes())
            if connection is not None:
                x.XCloseDisplay(connection)
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


results = [run_case(case) for case in args.cases]
(args.output / "acceptance.json").write_text(json.dumps({"cases": results}, indent=2) + "\n")
print(json.dumps({"output": str(args.output.resolve()), "cases": results}))
