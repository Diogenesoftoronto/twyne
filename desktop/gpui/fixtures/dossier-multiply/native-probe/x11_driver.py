"""Actual Xlib/XTEST adapter for the parent's private multiply probe only.

No native connection is opened on import. Root owns execution. Captures remain
the existing xwd -> magick path; this module never supplies framebuffer pixels.
Primitives follow fixtures/dossier-native/check-native.py, with exact client
origin queried from X11 rather than a window-manager utility or guessed offset.
"""
import ctypes as C
import glob
import json
import math
from pathlib import Path
import time


class X11Error(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise X11Error(message)


class WindowAttributes(C.Structure):
    # Xlib XWindowAttributes ABI; ctypes supplies native pointer/long alignment.
    _fields_ = [
        ("x", C.c_int), ("y", C.c_int), ("width", C.c_int), ("height", C.c_int),
        ("border_width", C.c_int), ("depth", C.c_int), ("visual", C.c_void_p),
        ("root", C.c_ulong), ("window_class", C.c_int), ("bit_gravity", C.c_int),
        ("win_gravity", C.c_int), ("backing_store", C.c_int),
        ("backing_planes", C.c_ulong), ("backing_pixel", C.c_ulong),
        ("save_under", C.c_int), ("colormap", C.c_ulong), ("map_installed", C.c_int),
        ("map_state", C.c_int), ("all_event_masks", C.c_long),
        ("your_event_mask", C.c_long), ("do_not_propagate_mask", C.c_long),
        ("override_redirect", C.c_int), ("screen", C.c_void_p),
    ]


class ErrorEvent(C.Structure):
    _fields_ = [
        ("type", C.c_int), ("display", C.c_void_p), ("resource", C.c_ulong),
        ("serial", C.c_ulong), ("code", C.c_ubyte), ("request", C.c_ubyte),
        ("minor", C.c_ubyte),
    ]


def libraries():
    # The same cached-Nix/shared-library lookup used by the proven host driver.
    # No utility lookup, installation, credential env or child process is used.
    def load(name, pattern):
        candidates = sorted(glob.glob(pattern))
        return C.CDLL(candidates[0] if candidates else name)

    x = load("libX11.so.6", "/nix/store/*-lib[Xx]11-*/lib/libX11.so.6*")
    t = load("libXtst.so.6", "/nix/store/*-lib[Xx]tst-*/lib/libXtst.so.6*")
    x.XOpenDisplay.argtypes, x.XOpenDisplay.restype = [C.c_char_p], C.c_void_p
    x.XCloseDisplay.argtypes, x.XCloseDisplay.restype = [C.c_void_p], C.c_int
    x.XFlush.argtypes, x.XFlush.restype = [C.c_void_p], C.c_int
    x.XSync.argtypes, x.XSync.restype = [C.c_void_p, C.c_int], C.c_int
    x.XDefaultRootWindow.argtypes, x.XDefaultRootWindow.restype = [C.c_void_p], C.c_ulong
    x.XDefaultScreen.argtypes, x.XDefaultScreen.restype = [C.c_void_p], C.c_int
    x.XStringToKeysym.argtypes, x.XStringToKeysym.restype = [C.c_char_p], C.c_ulong
    x.XKeysymToKeycode.argtypes, x.XKeysymToKeycode.restype = [C.c_void_p, C.c_ulong], C.c_ubyte
    x.XSetErrorHandler.argtypes, x.XSetErrorHandler.restype = [C.c_void_p], C.c_void_p
    x.XQueryTree.argtypes, x.XQueryTree.restype = [
        C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_ulong),
        C.POINTER(C.POINTER(C.c_ulong)), C.POINTER(C.c_uint),
    ], C.c_int
    x.XFetchName.argtypes, x.XFetchName.restype = [C.c_void_p, C.c_ulong, C.POINTER(C.c_void_p)], C.c_int
    x.XFree.argtypes, x.XFree.restype = [C.c_void_p], C.c_int
    x.XGetWindowAttributes.argtypes, x.XGetWindowAttributes.restype = [
        C.c_void_p, C.c_ulong, C.POINTER(WindowAttributes),
    ], C.c_int
    x.XTranslateCoordinates.argtypes, x.XTranslateCoordinates.restype = [
        C.c_void_p, C.c_ulong, C.c_ulong, C.c_int, C.c_int,
        C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_ulong),
    ], C.c_int
    x.XGetInputFocus.argtypes, x.XGetInputFocus.restype = [
        C.c_void_p, C.POINTER(C.c_ulong), C.POINTER(C.c_int),
    ], C.c_int
    x.XSetInputFocus.argtypes, x.XSetInputFocus.restype = [
        C.c_void_p, C.c_ulong, C.c_int, C.c_ulong,
    ], C.c_int
    x.XQueryKeymap.argtypes, x.XQueryKeymap.restype = [C.c_void_p, C.c_void_p], C.c_int
    x.XResizeWindow.argtypes, x.XResizeWindow.restype = [
        C.c_void_p, C.c_ulong, C.c_uint, C.c_uint,
    ], C.c_int
    t.XTestFakeMotionEvent.argtypes, t.XTestFakeMotionEvent.restype = [
        C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong,
    ], C.c_int
    t.XTestFakeButtonEvent.argtypes, t.XTestFakeButtonEvent.restype = [
        C.c_void_p, C.c_uint, C.c_int, C.c_ulong,
    ], C.c_int
    t.XTestFakeKeyEvent.argtypes, t.XTestFakeKeyEvent.restype = [
        C.c_void_p, C.c_uint, C.c_int, C.c_ulong,
    ], C.c_int
    return x, t


class OwnedX11:
    def __init__(self, env, events_path):
        display = env.get("DISPLAY")
        require(isinstance(display, str) and display.startswith(":")
                and display == env.get("TWYNE_MULTIPLY_OWNED_DISPLAY"),
                "Require the runner's explicit private display/token")
        require(display[1:].isdigit(), "Only the runner's displayfd number is supported")
        self.events_path = Path(events_path)
        self.events = []
        self.display = display
        self.connection = None
        self.x, self.t = libraries()
        self.connection = self.x.XOpenDisplay(display.encode("ascii"))
        require(self.connection, "Cannot connect to the explicitly owned X11 display")
        self.errors = []
        self.checked_error_count = 0

        def observe_error(_, event):
            # A disappearing owned client must be a retained Python failure,
            # not Xlib's default process-exit handler. Never call Xlib here.
            value = event.contents
            self.errors.append({"resource": value.resource, "serial": value.serial,
                                "code": value.code, "request": value.request, "minor": value.minor})
            return 0

        self.error_callback = C.CFUNCTYPE(C.c_int, C.c_void_p, C.POINTER(ErrorEvent))(observe_error)
        self.previous_error_handler = self.x.XSetErrorHandler(C.cast(self.error_callback, C.c_void_p))
        self.root = self.x.XDefaultRootWindow(self.connection)
        self.screen = self.x.XDefaultScreen(self.connection)
        self.record("connect", display=display, root=self.root, screen=self.screen,
                    xlib=self.x._name, xtest=self.t._name)

    def record(self, action, **fields):
        self.events.append({"sequence": len(self.events), "action": action, **fields})
        require(len(self.events) <= 2048, "Bounded X11 observation ledger exceeded")
        temporary = self.events_path.with_suffix(".pending.json")
        temporary.write_text(json.dumps(self.events, indent=2) + "\n")
        temporary.replace(self.events_path)

    def close(self):
        if self.connection:
            self.x.XSync(self.connection, 0)
            self.x.XCloseDisplay(self.connection)
            self.connection = None
            self.x.XSetErrorHandler(self.previous_error_handler)
            if self.errors:
                self.record("protocol-errors", errors=self.errors)
        return list(self.errors)

    def sync(self):
        self.x.XSync(self.connection, 0)
        if len(self.errors) != self.checked_error_count:
            self.checked_error_count = len(self.errors)
            self.record("protocol-errors", errors=self.errors)
            raise X11Error("Actual X11 protocol error; see actual-x11-events.json")

    def client(self, window):
        attributes = WindowAttributes()
        require(self.x.XGetWindowAttributes(self.connection, window, C.byref(attributes)),
                f"Cannot query actual client {window}")
        require(attributes.root == self.root and attributes.window_class == 1,
                "Require an InputOutput client on the owned root")
        require(attributes.map_state == 2, "Require a mapped/viewable client")
        x, y, child = C.c_int(), C.c_int(), C.c_ulong()
        require(self.x.XTranslateCoordinates(self.connection, window, self.root, 0, 0,
                                           C.byref(x), C.byref(y), C.byref(child)),
                "Cannot query the actual client-to-root origin")
        require(attributes.width > 0 and attributes.height > 0, "Empty client geometry")
        return {"window": window, "origin": [x.value, y.value],
                "size": [attributes.width, attributes.height],
                "borderWidth": attributes.border_width, "depth": attributes.depth}

    def find_named_client(self, title, discovery_path):
        # The owned runner has no WM. A bounded depth-two tree also tolerates
        # a direct client wrapper, without choosing a window by guessed order.
        queue, visited, names, matches = [(self.root, 0)], set(), [], []
        while queue:
            parent_window, depth = queue.pop(0)
            if parent_window in visited:
                continue
            visited.add(parent_window)
            require(len(visited) <= 128, "Owned display window tree exceeded the fixture bound")
            root, parent, children, count = C.c_ulong(), C.c_ulong(), C.POINTER(C.c_ulong)(), C.c_uint()
            require(self.x.XQueryTree(self.connection, parent_window, C.byref(root), C.byref(parent),
                                     C.byref(children), C.byref(count)), "Cannot query owned window tree")
            try:
                require(count.value <= 128, "Owned display child count exceeded the fixture bound")
                for index in range(count.value):
                    window = int(children[index])
                    name = C.c_void_p()
                    text = None
                    if self.x.XFetchName(self.connection, window, C.byref(name)) and name.value:
                        try:
                            text = C.string_at(name.value).decode("utf8", errors="replace")
                        finally:
                            self.x.XFree(name)
                    names.append({"window": window, "parent": parent_window, "depth": depth + 1, "name": text})
                    if text == title:
                        matches.append(window)
                    if depth == 0:
                        queue.append((window, depth + 1))
            finally:
                if children:
                    self.x.XFree(children)
        receipt = {"display": self.display, "root": self.root, "title": title,
                   "windows": names, "matches": matches, "method": "actual XQueryTree/XFetchName"}
        Path(discovery_path).write_text(json.dumps(receipt, indent=2) + "\n")
        require(len(matches) <= 1, "Multiple exact named clients on the owned display")
        if not matches:
            return None
        self.record("discover", title=title, client=self.client(matches[0]))
        return matches[0]

    def focused_window(self):
        focus, revert = C.c_ulong(), C.c_int()
        require(self.x.XGetInputFocus(self.connection, C.byref(focus), C.byref(revert)),
                "Cannot query actual X server input focus")
        return focus.value

    def focus(self, window):
        geometry = self.client(window)
        self.x.XSetInputFocus(self.connection, window, 1, 0)  # RevertToPointerRoot, CurrentTime.
        self.sync()
        require(self.focused_window() == window, "X server did not focus the owned client")
        self.record("focus", client=geometry, focusedWindow=window)

    def click_control(self, receipt, name, window):
        client = self.client(window)
        scale, root = receipt["scale"], receipt["root_bounds"]
        require(isinstance(scale, (int, float)) and math.isfinite(scale) and 0.5 <= scale <= 4,
                "Require finite observed native DPR in the probe's supported range")
        require(isinstance(root, list) and len(root) == 4
                and all(isinstance(v, (int, float)) and math.isfinite(v) for v in root),
                "Require actual observed root geometry")
        require(root[:2] == [0, 0] and [round(root[2] * scale), round(root[3] * scale)] == client["size"],
                "Observation/client viewport differ; do not compensate using guessed offsets")
        bounds = receipt["observed_control_content_bounds"][name]
        require(len(bounds) == 4 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in bounds),
                "Require finite actual control bounds")
        left, top, width, height = bounds
        require(width > 0 and height > 0 and left >= 0 and top >= 0
                and left + width <= root[2] and top + height <= root[3],
                "Control is not fully inside the observed client")
        local = [round((left + width / 2) * scale), round((top + height / 2) * scale)]
        require(0 <= local[0] < client["size"][0] and 0 <= local[1] < client["size"][1],
                "Control center is outside the actual client")
        actual = [client["origin"][0] + local[0], client["origin"][1] + local[1]]
        self.focus(window)
        self.record("click", name=name, observedBounds=bounds, scale=scale,
                    client=client, clientPixel=local, rootPixel=actual)
        require(self.t.XTestFakeMotionEvent(self.connection, self.screen, *actual, 0),
                "Actual XTEST pointer motion failed")
        require(self.t.XTestFakeButtonEvent(self.connection, 1, 1, 0)
                and self.t.XTestFakeButtonEvent(self.connection, 1, 0, 0),
                "Actual XTEST pointer click failed")
        self.x.XFlush(self.connection)
        time.sleep(0.07)

    def keycode(self, name):
        symbol = self.x.XStringToKeysym(name.encode("ascii"))
        code = self.x.XKeysymToKeycode(self.connection, symbol)
        require(symbol and code, f"Actual X11 key mapping unavailable: {name}")
        return code

    def pressed_keys(self):
        held = C.create_string_buffer(32)
        require(self.x.XQueryKeymap(self.connection, held), "Cannot query X server held keys")
        return [code for code in range(256) if held.raw[code // 8] & (1 << (code % 8))]

    def key(self, window, name, down):
        # Ctrl-Q may close the client on key-down. Release our own pressed keys
        # even after that window exits; no further key-down may target it.
        if down:
            require(self.focused_window() == window, "Owned client lost actual X server key focus")
        code = self.keycode(name)
        require(self.t.XTestFakeKeyEvent(self.connection, code, int(down), 0),
                f"Actual XTEST key event failed: {name}")
        self.x.XFlush(self.connection)
        time.sleep(0.012)  # Same physical-event cadence as the existing host driver.
        self.sync()
        held = self.pressed_keys()
        self.record("key", window=window, key=name, keycode=code, requestedDown=down,
                    focusedWindow=self.focused_window(), pressedKeycodes=held)
        require((code in held) == down, "X server key state disagrees with the requested physical event")

    def press(self, window, name, control=False, shift=False):
        require(self.focused_window() == window, "Focus owned client before sending keys")
        require(not self.pressed_keys(), "Unexpected held keys on private display; do not clear/restore guessed modifiers")
        held = []
        try:
            for modifier, enabled in [("Control_L", control), ("Shift_L", shift)]:
                if enabled:
                    held.append(modifier)
                    self.key(window, modifier, True)
            held.append(name)
            self.key(window, name, True)
            self.key(window, name, False)
            held.pop()
        finally:
            # Release only keys this adapter attempted to press. This does not
            # synthesize lost text or erase a failure observation.
            for modifier in reversed(held):
                self.key(window, modifier, False)

    def type_ascii(self, window, text):
        # The probe needs only its literal LIVE FIELD CHECK ASCII fixture.
        # Real observed input_text remains the acceptance authority.
        require(all(ch.isascii() and (ch.isalpha() or ch.isdigit() or ch == " ") for ch in text),
                "Unsupported physical fixture text; no clipboard/IME fallback")
        for character in text:
            self.press(window, "space" if character == " " else character.lower(), shift=character.isupper())

    def resize(self, window, width, height):
        require(isinstance(width, int) and isinstance(height, int)
                and 1 <= width <= 8192 and 1 <= height <= 8192, "Invalid bounded client resize")
        before = self.client(window)
        self.x.XResizeWindow(self.connection, window, width, height)
        self.sync()
        after = self.client(window)
        self.record("resize", before=before, requestedSize=[width, height], after=after)
        require(after["size"] == [width, height], "Actual client resize did not match the request")
