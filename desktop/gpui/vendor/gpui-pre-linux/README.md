# GPUI X11 focused-input cleanup

This directory vendors the exact published Apache-2.0 `gpui-pre-linux` 0.3.7
crate, from its cached registry archive. The archive's SHA-256 matches the
original Cargo.lock package checksum:

`0aac7022e347409454777701082201742710052813964a1e25160f7e22c965ad`

`upstream-sha256.json` records all 31 original file hashes, the source archive
and its gpui-pre snapshot revision `1a28cff4b409169bac058bca40dfbfeb7621d19b`.
The original `LICENSE-APACHE`, normalized manifest, feature definitions and
dependency versions are retained. The original files total 758,731 bytes.
The application-level path patch/lock integration is owned separately.

Only `src/linux/x11/window.rs` changes at runtime. Its `X11Window::drop` takes
the focused `PlatformInputHandler` out of shared state and drops that local
after releasing the `RefCell` borrow, before the destructor returns. This also
occurs when XCB DestroyWindow fails. Existing renderer destruction, parent
cleanup, XCB calls and deferred close/drop_window callbacks are unchanged.
`twyne-input-handler-drop.patch` records the complete narrow upstream diff.

The original lifecycle is:

1. Base input paint installs an `ElementInputHandler` with a strong input-state
   entity; the platform handler owns it in `X11WindowState.input_handler`.
2. Application quit stops the X11 event loop. After it returns, the platform
   quit callback runs `App::shutdown`, clearing GPUI windows and flushing effects.
3. The original X11 window destructor clones its shared state into a detached
   foreground close task. That task and the client's WindowRef can retain the
   focused handler past entity-map teardown; it is no longer collected by the
   preceding effect flush.
4. Releasing the platform handler synchronously lets that existing effect flush
   collect the final focused entity. The closed native window no longer needs
   an input handler even while its deferred native cleanup is pending.

No text-input/unmark callback is invoked and no text, selection, IME ranges,
save behavior, history, font, Source or editor logic changes. The patch does
not suppress leak detection, drain arbitrary tasks or weaken entity handles.
Wayland and headless runtime paths are unchanged; their lifecycle audit and
the four successful isolated native focus/quit/window-close cases are recorded
in [`fixtures/platform-input-exit`](../../fixtures/platform-input-exit/README.md).

Verify upstream provenance with the already cached registry archive. Compare
each archive member with `upstream-sha256.json`; every shipped upstream file
must retain its hash except the one declared patched file. Reapplying the
included diff to the original archive must reproduce that patched file exactly.
No network or registry modification is needed.
