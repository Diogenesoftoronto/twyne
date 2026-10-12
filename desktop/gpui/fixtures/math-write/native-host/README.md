# Native equation-host acceptance driver

Status: **authored and syntax-checked; no native execution yet**. Parent owns the fresh integrated binary, display execution, and eventual receipts. No passing native receipt or screenshot is supplied here.

[check-native.py](check-native.py) sends real XTEST events to one newly allocated Xvfb. It imports [equations.typ](equations.typ) through the actual CLI, opens the actual equation anchor and retained textarea, and saves through the application's canonical preparation and Store. It never calls a fixture converter, prepared-command callback, renderer-success stub, test window, account, or provider.

The input is 8,923 bytes, SHA-256
b1893ad992aa6fd7e9f59a61aab357a2d33343356dec7c77b0f490b95ee8d874.
It uses the current original TYPST_DOCUMENT_PREAMBLE and portable
Twyne node/math wrappers. The preamble was copied by bounded read-only
template-literal extraction; this authored fixture is not an executed
conversion result. [input-contract.json](input-contract.json) records its
Source/preamble hashes and typed inputs.

The fixture retains a harmless authored definition, heading/paragraph/strong/
math unknown attributes, a doubled prose space, Japanese and a combining
accent. Initial block source is x+1; a separate inline a+b atom remains
unchanged in the default block run. Both have exact original portable type,
display, class, ARIA and source metadata. Typst import also exercises real
original-byte provenance; plain HTML imports currently have no corresponding
provenance contract. No HTML cache is supplied. The driver requests actual
Write through native UI if a projection is needed.

## Checks on Parent execution

The default run appends nine acceptance entries only after their actual gates:

1. CLI import creates exactly one copied folio with exact authored canonical/
   body bytes and original-byte provenance.
2. Actual Write/Save produces nonempty verified HTML through the real local
   helper while preserving authored source, unknown attributes, marked Unicode
   prose, whitespace and both math atoms.
3. A fully observed block anchor click opens the real end-focused textarea.
   Appending one character and native field Undo/Redo leave manuscript source
   unchanged. This does not assume grouped Undo for a whole typed string.
4. Exact final unblurred backslashes/braces/LF/punctuation/spaces survive actual
   Ctrl+Enter, canonical preflight and Ctrl+S. Ctrl+S before submission must
   preserve the pending field and leave its draft unfiled.
5. One rich Undo restores the preceding equation; Redo restores the exact
   accepted canonical/body/HTML. Prose, other atoms and unknown attributes
   remain unchanged.
6. The actual “Render equation” button reads final unblurred quotes/ampersand/
   LF/spaces and saves only the intended raw atom.
7. Cancel/Escape preserve the exact saved raw node/canonical/HTML and produce
   no manuscript history entry; Undo/Redo still reaches the preceding accepted
   equation.
8. Ctrl+Q with an unsubmitted field focused exits zero without panic/leak
   diagnostics and does not silently file input. Source forms have no durable
   pending-draft recovery contract, so this run does not invent one.
9. A new native process opens the same library without another import,
   restores the exact accepted equation in its actual field, and closes
   cleanly after neutral Cancel.

Optional --inline adds a separate tenth entry after Parent integrates and
enables the measured inline child: actual inline anchor/retained field,
plain Enter submission, canonical Save and independent rich Undo/Redo. It
does not claim browser first-baseline, wrapper, clipping or KaTeX pixel parity.
Default block gates do not depend on this flag.

The driver compares durable literal math calls with portable HTML
attributes/text. A bounded observation-only HTML tree masks only each math
raw payload and derived ARIA label; all other nodes, interior characters,
marks, metadata and unknown attributes must match the actual initial
projection. It ignores only root ASCII inter-block whitespace. Cancel, Redo
and reopen also compare exact canonical/body/HTML bytes with prior accepted
specimens. These scanners are specific to this authored corpus, not a
replacement compiler, converter or general schema adapter.

## Isolation, fresh geometry and failures

The driver reuses reviewed owned-display/XTEST/process-cleanup primitives
from ../../dossier-native/check-native.py. Every eventual receipt records
that helper's hash; importing it creates no bytecode cache. The app gets
fresh private HOME/XDG/library directories and an explicit environment
allowlist. It inherits no user DISPLAY/Wayland/DBus/audio/session/provider/
account environment. No display override is accepted: Xvfb allocates its
own display through displayfd, and XTEST connects only there.

Every click requires **two different captured file stamps with identical
observed target, form, manuscript, scroller, viewport and window-origin
bounds**. Polling one JSON twice cannot satisfy it. Both observations are
retained in actual-clicks.json. Targets must be fully visible/enabled and
inside the real observed body-field writing clip when applicable. No text
coordinate or clipped control is guessed. Opening focuses the actual
textarea, so typing uses that focused field without a blank-textarea click.

Inherited waits are bounded to 20 seconds; display allocation is at most
10 seconds, clean quit 20 seconds, and the whole interaction has a six-minute
deadline. Output must be nonexistent, or a fresh temporary directory is
allocated. Existing destinations/libraries are never removed or overwritten.
Cleanup targets only processes this driver started; forced cleanup cannot
count as clean quit. No installs are performed.

Output retains incremental acceptance.json, app/Xvfb logs, original input,
before/after manuscript JSON, canonical Typst, projected HTML, geometry and
**actual root-window XImage PNG pixels**. PNG encoding uses the standard
library with explicit dimensions/channel/format bounds. XImage/XTEST ABI
behavior remains unexecuted here. A timeout, inaccessible control, missing
real helper, refused preflight, lost final value, wrong history or bad exit
fails honestly. Failure retains last geometry/document/pixels when available,
the original exception and diagnostic-read errors; it never advances by
injecting success or modifying a manuscript file.

## Parent run

Use a **fresh Parent-reviewed ui-tests binary containing the current app
math-source coordinator**. The older pre-coordinator immutable binary is
insufficient. This is a future example, not an executed worker run. Use a
new output name each time and retain failed receipts unchanged:

    rtk proxy env \
      TWYNE_GPUI_RENDER_ICD=/absolute/path/to/lavapipe.json \
      TWYNE_DOCUMENT_HELPER=/absolute/path/to/actual/twyne-document \
      python3 desktop/gpui/fixtures/math-write/native-host/check-native.py \
      --binary /absolute/path/to/parent-reviewed/twyne-desktop \
      --output /tmp/twyne-equation-native-reviewed

Explicit helper/ICD paths may be omitted if Parent's reviewed environment
and packaged helper provide them. The isolation helper validates overrides.
Add --inline only for a binary with measured flow enabled. Dependencies are
existing Xvfb/libX11/libXtst plus the real app/local document helper; this
driver adds no package dependency.

Source/native pointers: src/components/editor/extensions/math.ts portable
attributes/selected-node update; math/math-source-editor.ts raw controls and
keys; src/utils/typst/document.ts source-preserving wrappers;
desktop/gpui/src/main.rs import/capture CLI; src/capture_geometry.rs observed
values/focus/bounds; src/editor/math_source_editor.rs field/Save/Cancel IDs;
src/editor/view_math_source.rs anchors and guarded receipt;
src/app/math_source_coordinator.rs original document_edit::apply_html
preflight; src/storage.rs actual copy/save/reload.

Only syntax/JSON/fixture/hash inspection was performed by this worker: no
display/library load, Cargo/Devenv, browser, network, provider, Source/shared
edit, installation or commit. Saved math rendering remains the existing
MathJax/proof boundary; this driver certifies no KaTeX, Source geometry or
other-OS behavior.
