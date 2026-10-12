# Native Dossier acceptance driver

Status: **Root's refreshed paper/input build passed all eleven native acceptance checks**. The durable output is `desktop/gpui/target/verification/dossier-padding-workflow-f54dee7de7/acceptance.json`; [parent-gates-paper-reviewed.json](parent-gates-paper-reviewed.json) pins the immutable binary, driver, tested source and limitations. It covers actual Create/Refine filing, unblurred multiline recovery, clean close/relaunch and exact imported source/body, nonempty HTML and provenance preservation. Root's driver now requires two fresh matching geometry frames before clicking moving question controls. The newly integrated stamp and equation coordinator are later changes with their own gates; they are not retroactively included in this native result.

The earlier eleven-check receipt in [parent-gates.json](parent-gates.json) refers to a historical `/tmp` run. Pixel parity remains unclaimed.
The earlier failed receipts below remain unchanged.
[check-native.py](check-native.py) uses real X11 activation, XTEST focused
keys/clicks and the application's `--capture-geometry-watch` observations.
It never invokes simulated filing callbacks, a test window, or a file picker.

The first process imports [retained.typ](retained.typ) through the real CLI
import path into a fresh owned library. This is nonempty prose with a harmless
retained `#let`, strong/emphasis markup, a doubled internal space, two spaces
before one LF, blank lines and a final LF. The original is 322 bytes, SHA-256
`8a9cc13b4f2c084a54759e9a4a4699e246224363aec8a8af0c99957c2a6a6479`.
The driver records the actual source bytes/digest and original import
provenance; the fresh process reopen does **not** import it again.

## Workflow being checked

1. Actually focus and type the final title character; observe the native
   input value and focus before pressing Escape. Check durable create-scope
   recovery and unchanged manuscript bytes after Cancel.
2. Use native Write/Save to request the actual local semantic helper's
   nonempty HTML projection. Require its verified disk state and unchanged
   canonical source/body. This projection transition is separate from
   filing; no cached HTML fixture is supplied.
3. Reopen Create and check the restored exact native title. Type/cancel/reopen
   a multiline reader answer under the same identity. Click all ten roman
   controls and check their actual question and accessibility labels.
4. Click the real “Send to press” action. Require durable title/answers,
   same folio ID, advancing revision, cleared matching recovery, and exact
   equality of nonempty source/body/HTML/import provenance.
5. Reopen Refine, change title and multiline goal, Cancel and reopen the
   same saved-brief base. Require exact pending input/recovery restoration
   and no premature change to the saved manuscript.
6. File Refine through its real action. Require new metadata, retained other
   answers/completion metadata, and exact canonical source/body/HTML and
   original-byte provenance.
7. Type a final unfiled multiline reader answer, observe it while focused,
   then use real Ctrl-Q. Require exit zero, no entity-leak/panic diagnostics,
   durable exact recovery, and unchanged filed manuscript bytes.
8. Launch a fresh process on the same owned library and require exact restored
   native fields, the same recovery identity/folio, no duplicate import, and
   unchanged manuscript. Cancel and Ctrl-Q again with the same clean-exit
   and preservation checks.

The scope is ordinary native form/filing/recovery behavior. This driver does
not establish delayed async receipt/race acceptance, provider/conversation
activity, Typst proof output, pixel parity, account behavior, other displays,
Wayland or other OS behavior. It requests Write projection, never Source
typing or a Proof/PDF action. Startup may still compile a proof; this driver
makes no compiler-output claim. Failure is preserved as failure; a forced
termination is cleanup and cannot satisfy the clean-close checks.

## First actual failure

Parent's immutable binary SHA-256
`a561a61375182dcde61f1123cf5e8b6980bb7a1f8820c06b573fc61c0ea921f3`
produced `/tmp/twyne-dossier-native-reviewed-20261005-a/acceptance.json` with
`status: fail`. Exact imported source/provenance and unblurred title
Cancel/recovery passed. The next condition timed out after 20 seconds:
Write/Save did not persist a verified, nonempty HTML projection.

The retained geometry shows the rich editor mounted and focused and the footer
label “Saved locally”. The actual manuscript remains byte-identical to the
initial import: revision `0`, projection `unavailable`, empty HTML, and exact
322-byte canonical source/body. This is not an enum spelling mismatch:
`workspace.rs` uses camelCase serde and `ProjectionState::Verified` serializes
as `verified`, exactly as the predicate requires.

Read-only diagnosis of the first failed application identified `set_write` installing
the projection into the active in-memory document without marking it dirty or
saving it. `snapshot` clones that document; an unedited rich view has the same
revision as `rich_saved_revision`. `flush` compares the result against the
already-mutated in-memory document, so the disk write could be skipped. Root's
production repair was checked in the second run. Roman navigation, durable Create/Refine filing and
clean quit/relaunch were **not reached** in this run. The failed receipt and
artifacts have not been rewritten or reclassified.

## Second actual failure

Parent's repaired binary SHA-256
`d054cb784bac34911a1aa6e62d07f017682bfb609985952b6b85c1099f629e24`
produced `/tmp/twyne-dossier-native-reviewed-20261005-b/acceptance.json` with
`status: fail` and six accepted checks. Write/Save now durably stores verified
nonempty HTML; Create reopen, all ten roman controls and actual Send to press
filing also passed. Canonical source/body remain the authored 322 bytes, HTML
remains 423 bytes, and original import provenance is unchanged.

The next check incorrectly required `dossier-start-over` to identify Refine.
That control requires both Refine and `capabilities.start_over`, so its absence
does not indicate a failed Refine transition. The actual failed geometry shows
the mode-specific exit accessibility label “Back to desk” and the exact filed
title in `dossier-answer-0`. Create instead labels that same exit “Back home”.
The revised department caption is painted tracked text without an observed
label, so the driver cannot honestly inspect its casing from this geometry.

The corrected driver checks the actual exit label with case normalization and
exact saved title, then verifies the actual saved audience and durable recovery
identity `refine:<folio>`, owner `null`, base equal to the saved brief's
`updatedAt`. This scope is checked before editing and again after Cancel and
reopen. Start over remains unavailable and its behavior unproven. Source/body,
nonempty HTML, provenance, filing receipts and shutdown checks are unchanged.
Neither retained failed receipt was modified. Refine filing and clean
quit/relaunch remain unreached in the second run; the corrected driver has
only been syntax-checked by this worker, not rerun.

## Isolation and artifacts

The driver always allocates Xvfb with `-displayfd` and connects XTEST only to
that new display. It does not accept a display flag or inherit user
DISPLAY/WAYLAND/DBus/audio/session/provider/account environment. Its explicit
environment allowlist preserves local tool/font/shared-library paths and an
optional explicit render ICD/document helper. HOME/XDG paths are private;
DBus/Pulse/PipeWire addresses point to absent endpoints in its own runtime.
No account/provider/audio controls are invoked.

`--output` must not exist; omission allocates a fresh `/tmp` directory. Nothing
deletes or overwrites an existing destination. The owned library, original
source, before/after manuscripts, recovery specimens, geometry, per-process
logs and failure trace remain in output on both success and failure. Condition
waits and process quits are at most 20 seconds each; display allocation is
at most 10 seconds. Cleanup targets only processes this driver started and
closes its own X connection; it never terminates a discovered display/process.
`acceptance.json` is written incrementally and only changes to `pass` after
all checks finish. Syntax validation does not create that receipt.
On failure, the driver also retains the last actual manuscript and geometry,
and records projection/revision/HTML byte count/source equality/focus/save-label
observations before cleanup. Diagnostic read failures remain diagnostic errors;
they cannot satisfy acceptance or replace its original exception.

## Parent execution

Use Parent's current built ui-tests binary, not an unreviewed release artifact.
The following example is a future Parent run; it was **not** executed here.
Choose a fresh output name for each run. The explicit helper can be omitted
when the reviewed binary has its actual packaged sibling helper.

```bash
rtk proxy env \
  TWYNE_GPUI_RENDER_ICD=/nix/store/gqpsfqzgbcbwbh12n3sjxk2x4gqgy8lq-mesa-26.1.3/share/vulkan/icd.d/lvp_icd.x86_64.json \
  TWYNE_DOCUMENT_HELPER=/home/diogenes/Projects/twyne/desktop/gpui/target/release/twyne-document \
  devenv shell -- rtk proxy python3 desktop/gpui/fixtures/dossier-native/check-native.py \
  --binary /tmp/twyne-gpui-dossier-current-ui-20261005-y0s3c7mh/twyne-desktop \
  --output /tmp/twyne-dossier-native-reviewed
```

Only the standard library is required by the driver, alongside existing
Xvfb/libX11/libXtst and the native runtime. No installs are performed. Binary
and fixture SHA-256 values are recorded in the eventual execution receipt.

Source contracts: `main.rs:207` capture state and its ordinary import path;
`capture_geometry.rs` actual observed bounds/value/focus output;
`dossier_view.rs` answer IDs, Escape, roman navigation and filing action;
`dossier.rs` create/refine owner/folio/base recovery identity;
`app.rs` actual qualified filing/save/acknowledgement; `dossier_filing.rs`
source-preserving existing-manuscript filing. Owned display/XTEST precedents
were read from `../platform-input-exit/check-native.py` and the `host-*` drivers.

Syntax check actually run, without importing/executing the driver or creating
`__pycache__`:

```bash
rtk proxy python3 - <<'PY'
from pathlib import Path
path = Path('desktop/gpui/fixtures/dossier-native/check-native.py')
compile(path.read_text(), str(path), 'exec')
print('syntax pass; driver not executed')
PY
```

Worker validation: syntax pass; fixture whitespace/digest checked; no native execution,
Cargo/Devenv, browser, network, install or shared-file edits by this worker.
