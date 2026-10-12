# Private X11 adapter follow-up — authored, not executed

Root's retained runtime has Xvfb, xwd, magick, Python and RTK; xdotool and xwininfo are absent. That discovery failure is independent of GPU blending. This additive adapter replaces only the missing window/input utilities. The earlier probe README's xdotool requirement is superseded by this proposal; its rendering and pixel boundaries remain unchanged.

New `x11_driver.py` opens a connection only when Root instantiates `OwnedX11(env, events_path)`. It validates the explicit `DISPLAY` against `TWYNE_MULTIPLY_OWNED_DISPLAY` and accepts only the runner's local displayfd number. It does not open a user's display, start a server/app, run a utility or supply pixels. ctypes primitives follow `fixtures/dossier-native/check-native.py`; additional geometry/ABI declarations were checked against cached Xlib/Xorg/XTest headers. `XKeysymToKeycode` returns the actual unsigned-byte `KeyCode` ABI.

The **unapplied** `x11-runner.patch` preserves Root's private HOME/config/cache/data/runtime, DBus/audio isolation, display token, explicit client title and existing process-group cleanup. It makes these substitutions:

- `XQueryTree` / `XFetchName` locate exactly one `Twyne Multiply Probe` client within the private tree. Missing client means bounded polling; ambiguous clients or query failure refuse. Every attempt retains `MODE/x11-discovery.json`. A mapped InputOutput client on the actual root is required.
- `XGetWindowAttributes` and `XTranslateCoordinates` provide actual client dimensions and origin. Clicks use the emitted control bounds/DPR plus that origin. The observed full-window root must match the actual client extent, and the entire control must be inside it. There is no fixed X11 +2 offset, inferred titlebar or guessed control position.
- `XSetInputFocus` / `XGetInputFocus` establish actual server focus; XTEST generates one physical pointer/key event per requested action. Held keys are checked with `XQueryKeymap` and recorded. Unexpected pre-existing held keys fail; the adapter does not clear/restore guessed modifiers, retry lost text, inject clipboard values or change a retained Input directly. Native `counter` and exact `input_text` remain the acceptance authorities.
- `XResizeWindow` requests 820×660 and queries the actual client result. The runner still waits for that actual size to appear in the native receipt. Ctrl-Q uses real Control/q keys; only the adapter's attempted key presses are released if the client closes on key-down. Clean app exit remains mandatory.
- A process-local Xlib error handler retains protocol errors instead of allowing a vanished client to terminate Python through Xlib's default error handler. It is restored when this one owned connection closes. Protocol errors become acceptance failures, including any drained at close.

`actual-x11-events.json` records actual discovery, geometry, click coordinates, focus, individual physical key states, resize and protocol errors. It is written atomically. No environment/credential dump is produced. This records server state, not GPUI's private active input-handler ownership; an exact native field-value timeout stays a failure.

**Unchanged:** `capture()` uses xwd→magick; candidate stabilization and image conversion use their original calls; `check_pixels.py` is untouched; the five modes, supplied raster inputs, opaque-backdrop reference, tolerance2/strict-identity checks, wrong-mode detector thresholds, clean-exit rule and all existing proof limits remain intact. No PNG codec or dependency is added. The runner's newly imported adapter is a standard-library-only Python file.

The adapter is bounded to the probe's local single-screen X11 display and mapped client; the observed root origin must be zero. Physical control coordinates require finite DPR0.5…4 and matching client dimensions. It does not establish a DPR transition, atlas adjacency, framebuffer alpha, resource-memory bounds, other-OS/Wayland behavior or Source radial raster parity. The actual GPU acceptance and Source painting are separate from utility substitution.

Root review/execution commands (not run here):

```sh
rtk proxy git apply --check desktop/gpui/fixtures/dossier-multiply/native-probe/x11-runner.patch
rtk proxy git apply desktop/gpui/fixtures/dossier-multiply/native-probe/x11-runner.patch
rtk proxy python3 desktop/gpui/fixtures/dossier-multiply/native-probe/run_native.py --binary desktop/gpui/target/debug/examples/twyne-dossier-multiply-probe --runtime-env /owned/runtime-env.json --output desktop/gpui/target/verification/multiply-probe-X11-NEW
```

Use the already built probe/current private runtime and a **new** output directory; retain previous utility-discovery failures. Review the native input/quit observations as well as all five pixel cases. No threshold widening or zero-filled fallback is permitted.

Only source/header/file inspection, in-memory patch generation and Python AST parsing were performed in this lane. AST parsing does not import or execute the adapter. Neither the patch nor code has been applied, application-checked or run against Xlib/XTEST/native pixels here. Root owns execution. Existing `main.rs`, `run_native.py`, `check_pixels.py`, Source/runtime/vendor files and earlier frozen receipts were not changed.
