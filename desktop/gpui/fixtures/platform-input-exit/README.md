# Real focused-input shutdown

The original X11 failure is preserved in Root's
`/tmp/twyne-cast-host-native-full-visible/app.log`: Ctrl-Q had already filed the
exact `held on quit!` draft, but GPUI exited with a leaked
`InputBaseState<TextareaMode>` entity. Removing the window before quit produced
the same failure. These are distinct persistence and entity-cleanup outcomes.

The narrow vendored fix is documented in
[`vendor/gpui-pre-linux/README.md`](../../vendor/gpui-pre-linux/README.md).
Its only runtime change releases the closed window's focused input handler
synchronously, after releasing the shared-state borrow. The original async
native close task remains unchanged. No editor, Source, font, history, text or
save path is altered, and leak detection remains enabled.

`check-native.py` starts the actual ui-tests main binary on a newly allocated
Xvfb display and activates that native window through X11. It observes real
native input bounds/focus/value and types through XTEST before closing, without
blurring the control. Each case uses a fresh local library and only explicit
anonymous manuscript/Cast fixtures. The Source cases open the real Source UI
from writing mode; no capture-only Source replacement or mocked input is used.

Four acceptance cases cover:

| Focused native control | Close mechanism | Durable value |
| --- | --- | --- |
| Cast Textarea | Ctrl-Q | `input exit!` |
| Cast Textarea | real WM_PROTOCOLS/WM_DELETE_WINDOW | `input exit!` |
| Source code Editor | Ctrl-Q | exact full draft ending `// final input!` |
| Source code Editor | real WM_PROTOCOLS/WM_DELETE_WINDOW | exact full draft ending `// final input!` |

Every case requires actual window activation, observed focused input containing
the final typed character, exit 0 with leak backtraces enabled, no leaked-handle
log, exact durable draft, and byte-identical canonical manuscript. Forced
termination is failure cleanup, never successful exit evidence. The normal
window-manager case uses a real X11 ClientMessage, not process termination.

```sh
rtk proxy python3 desktop/gpui/vendor/gpui-pre-linux/verify-upstream.py
rtk proxy env TWYNE_GPUI_RENDER_ICD=/nix/store/gqpsfqzgbcbwbh12n3sjxk2x4gqgy8lq-mesa-26.1.3/share/vulkan/icd.d/lvp_icd.x86_64.json devenv shell -- rtk proxy python3 desktop/gpui/fixtures/platform-input-exit/check-native.py --output /tmp/twyne-platform-input-exit-patched
```

The binary must be rebuilt against the exact restored lock graph and the
vendored platform path before running. Root owns that integration gate.
`native-acceptance.json` records the actual results, binary hash and draft /
canonical-source checks. Full owned native logs and geometry are retained at
the recorded `/tmp/twyne-platform-input-exit-patched/<case>` paths. Root also
verified its full nine-step Cast file/failure/retry/final-character workflow at
`/tmp/twyne-cast-host-native-clean-exit`, with clean Ctrl-Q exit and final draft
preserved. That broader application acceptance remains Root's evidence.

The failed XCB DestroyWindow branch is covered by the patch's unconditional
handler extraction/release; its native failure injection is not claimed as
tested here. Active IME composition, multi-window parent/child dialogs, server
loss and other platforms are separate boundaries.

Static related-path audit: the headless window has sole window-owned shared
state with no client WindowRef or detached close task in its constructor/drop
path. Wayland uses an analogous detached close task retaining shared state and
clears its client windows only in client Drop. This identifies a possible
related lifecycle gap; no real Wayland failure was reproduced and no Wayland
runtime code is changed by this patch.
