# Native writing-room chrome

`browser-page-selector.json` records actual interactions in the original
Twyne TypstWorkspace using the owned anonymous browser reference. It verifies
the default count option, retained page label on return to Write, mode-neutral
count selection, changed counts, removal of an unavailable page, and closed
Arrow/Home/End selection with focus retained. A13-page proof confirms the
original three-option PageUp/PageDown step; Left/Right and prefix search are
also recorded. Temporary Source edits were undone exactly, and the browser
returned to Write/count0.

The mounted `page_selector_navigates_the_real_proof_and_retains_selection_across_modes`
test compiles a real multi-page manuscript, drives the popup controls,
checks page-top alignment, actual value/open-state accessibility properties,
closed multi-page keyboard navigation and typed label search, and failed/shorter valid Source proofs
without changing the canonical manuscript or rich history.

`check-focus-native.py` allocates a new isolated Xvfb display and sends real
mouse/key input through a separate XTEST process. It derives coordinates from
the rendered native geometry and window origin. It never uses the user's
display. The first5 checks cover pointer/keyboard focus, the solid2px vermilion
outline on native tabs and Source, disabled Pages, stable control dimensions,
and exact stored manuscript bytes. `--page-selector` adds15 checks covering
initial legacy-HTML conversion, real page selection, retained labels in Write,
mode-neutral count selection, native combobox role/value/open state and
keyboard outline, closed Arrow/Home/End/PageUp/PageDown input, typed prefix and
repeated-letter cycling, the observed one-second search expiry, idle Space
opening the real popup, Escape restoring focus, and exact saved bytes after
conversion. The Tab
check starts on a real compositor tab: inside the manuscript, Shift-Tab is
the editor's Outdent command.

```bash
rtk proxy devenv shell -- rtk proxy cargo build --locked --offline --features ui-tests --manifest-path desktop/gpui/Cargo.toml --bin twyne-desktop
rtk proxy devenv shell -- rtk proxy python3 desktop/gpui/fixtures/chrome/check-focus-native.py --binary desktop/gpui/target/debug/twyne-desktop --fixture desktop/gpui/fixtures/marginalia/browser-manuscript.html --page-selector
```

The driver writes screenshots, acceptance facts, logs, and before/after
manuscript snapshots to `/tmp/twyne-chrome-focus-native` by default. For the
one-page Notebook fixture, it also checks the original intrinsic71px select
width. A separate120-paragraph fixture produced three actual native proof
pages and passed all20 checks, including the three-option PageUp/PageDown
step. The one-page Notebook also passed all20. Each Tab waits for an observed focus change, and outline checks wait for
the exact native pixels after prepaint; a geometry snapshot alone can precede
the WGPU frame on X11. Source's initial Pages control is51px. Current native fractional footer
positions, arrow antialiasing, File fallback synthesis, the remaining controls'
focus states, non-ASCII search folding and assistive-technology/device behavior still need
their own comparison; this slice does not establish full interface parity.

The typeahead fixture includes17 actual browser input steps and two observed
timeout cases. Repeated letters cycle page labels; multi-character prefixes
search from the current option, and a failed prefix leaves it selected. Home
does not reset the search buffer. Native search is bounded to the small option
labels and performs no manuscript reads. Space extends an active search; with
no active prefix it opens the existing GPUI Kit popup. These rules follow the
original Chromium150 interaction and its primary `TypeAhead` implementation.
