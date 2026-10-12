# Native equation input diagnosis — frozen, read-only

The first append failure is real, but the retained run does **not** identify its cause. Expected `x+1!` remained `x+1`; the screenshot shows the caret at the end of the actual focused textarea. No caret or source-value repair is justified by this evidence. The two proposed patches are unapplied and address different concerns.

## Retained failure

Original run: `target/verification/math-inline-native-workflow-f379dceab0/`. Driver: `fixtures/math-write/native-host/check-native.py`. Terminal log: `target/verification/math-inline-native-workflow.log`.

- `acceptance.json` is FAIL, with only the import and native Write/Save checks completed. The timeout is at driver line 525 after `type_ascii("!")`, waiting for exact `x+1!`.
- `failure-geometry.json` contains the retained `MathSourceEditorView` and real multiline input, value `x+1`, focused true, disabled absent. Form bounds are 305,463 / 672×218; input bounds are 316,502 / 650×77. Save remains enabled. `failure.png` visibly shows the end caret.
- Window active and `keyboardInput` true do not establish a working textarea handler. `capture_geometry.rs:71` defines the latter as `window.last_input_was_keyboard()`: input modality, not handler readiness. `test_support.rs:371` reports `contains_focused`; ancestor rich/drag views therefore also report focused without owning text input.
- Failure manuscript body/canonical source remain the exact 8,923-byte authored source, projection verified, revision 2. No successful text edit or canonical mutation can be inferred.
- `app-1.log` records only geometry readiness. No raw X11 key, translated `key_char`, propagation result or active-handler owner was captured.

`evidence.json` extracts these observations and `pins.json` hashes the inspected files. The immutable build receipt pins the binary and several rich/host files, but does not pin `math_source_editor.rs`, `view_drag.rs`, the Base input implementation or GPUI/Linux input files. Current-source reasoning about these files is consequently distinct from proof of their exact inclusion in that binary.

## Input/focus path

`editor/math_source_editor.rs:337–433` creates one retained `TextareaState`, disables submit-on-enter, focuses it once at the end on the next frame and never resets its rope during Render. Change cancels stale submissions/previews without replacing text. Render makes the textarea read-only only when the form is retired or read-only. Enabled Save and the unchanged visible rope do not show a form replacement or erroneous insertion point.

`editor/view_math_source.rs` retains the form/session and selects the actual atom. The initial failure is **block** math: `editor/view.rs` mounts the real form as the block child. The inline reservation path is not the first failed field.

GPUI `window.rs:5299–5313` registers an input handler only for a strictly focused handle. Base `input/base/element.rs` registers the actual input handle; rich `editor/view.rs` registers a different rich handle. A later ordinary rich paragraph cannot overwrite that textarea handler on a fresh paint merely because its ancestor snapshot also says focused. At the end of draw GPUI selects the last nonempty handler entry; cached paint can replay handlers, but a focus change requests a refresh and the view cache refuses reuse while refreshing. A stale cached-handler defect remains possible only with more evidence; it is not demonstrated by current painter order.

Next-frame callbacks run before the next draw, and capture facts come from the preceding rendered frame. A captured focused input normally already passed through its paint/registration path. This weakens the simple claim that the driver observed focus strictly before the first handler paint; that claim is **unproven**, not the diagnosis.

Linux X11 KeyPress passes its event modifiers through XKB and produces a `Keystroke`. `x11/window.rs` calls GPUI dispatch first; only a propagated KeyDown with admissible modifiers, `Some(key_char)` and an installed input handler reaches `replace_text_in_range`. The unchanged value could reflect translation/modifier state, consumed dispatch, absent/wrong handler, or driver/native readiness. `keyboardInput` says only that a KeyDown was observed somewhere, and cannot distinguish these branches.

The original Source form (`src/components/editor/math/math-source-editor.ts:176–216`) focuses the textarea and sets its selection to the end; ordinary `!` and Space are normal textarea input. Its NodeView (`extensions/math.ts:166–203`) stops treating open-form keys as equation-opening keys and isolates events originating inside the form. Native's intended end-caret policy agrees with Source. No original browser run was performed in this diagnosis.

## Unapplied proposals

**`driver-observation.patch`** is diagnostic/readiness only. It requires two fresh, fully visible, enabled, focused field observations with the window active. It sends each physical key exactly once using the existing mapping, then records X server focus, held keycodes and latest native value after a server queue sync. Expected raw text, end-caret append, source/history checks and failure retention are unchanged. It does not retry a lost key, mutate a rope, fake clipboard input or certify the installed handler. Queue synchronization and observation add latency and may mask a timing issue; a pass would be bounded evidence, not proof of the original failure's cause. X server key state also does not reveal GPUI's translated key character or propagation.

Root can first run this against the **same immutable binary** and retain the physical event observations. If it fails with correct server focus/key state, add a narrowly gated native trace recording translated key/modifiers, propagation and handler presence/owner at the X11 replacement boundary. If it passes, compare readiness-only versus observation-only changes before claiming a driver timing fix. Do not change the expected `x+1!` or force/retry its insertion.

**`drag-focus-guard.patch`** addresses a separate static production issue, **not the first `!` failure**. `editor/view_drag.rs:501–530` consumes bare Space/Enter/Escape/Up/Down and can start keyboard dragging. The block atom wrapper (`:710–763`) mounts the real form beneath that wrapper and its bubbling key listener does not check whether the handle itself owns focus. Ordinary Space from a textarea descendant can therefore reach a drag command. `!` is not in that handled set and this issue cannot explain the first timeout.

The proposal adds strict `key_focus.is_focused(window)` guards to both drag-handle listeners, preserving keyboard drag while the actual handle owns focus and leaving descendant controls their own keys. Parent acceptance should include actual textarea Space/caret movement/Enter/Escape, untouched canonical source until submit/cancel, plus existing focused-handle keyboard drag/drop/cancel tests. This is a source-derived correction proposal, not a demonstrated native regression or a first-character fix.

## Execution boundary

Only filesystem/source/JSON inspection and local viewing of the retained failure image were performed. No existing file was changed; patches have not been applied or application-checked. No Cargo, Devenv, rustc, native app, X11 server/client, browser, provider, network, test driver or new server was executed. The patches are uncompiled and unexecuted; Root owns review and execution. Original Source, frozen math/multiply lanes and existing runtime remain untouched.
