# Rubric host computations

`browser-draft-context.json` records the original pure Twyne functions executed
in Chrome150 at the owned anonymous reference origin. The fixture does not
mutate manuscripts, IndexedDB or provider state. `browser-functions.ts` bundles
the source static scorer and readiness helper alongside the exact generated
`htmlToPlainText` and SHA256 function; browser persistence imports are omitted.
The generated functions are refreshed from their source on each helper build.

`browser-room-parts.json` observes the original retained-room explanation:
low-score penalties, the relevance cap under fixed45/35/20 weights, missing
target fit and the source's legacy empty-room fallback. Its authored judges
are clearly test metadata. The helper returns explanation parts only; it
does not return or file a recomputed grade, summary or result. Retained grades
remain authoritative.

Six cases cover an empty draft, the original limited entity/block projection,
the499/500-word boundary and formatting that preserves the text fingerprint.
In particular, the original projection leaves hexadecimal numeric entities
literal and inserts a single newline at block endings. Native editor plain
text or DOM `textContent` would produce a different fingerprint.

The executable helper test compares every retained digest, readiness field and
static measurement with these browser observations. These are deterministic
text measurements, not a saved editorial grade or provider reading. Host
integration must invoke this operation at explicit panel/report freshness
boundaries, outside native input transactions. A missing helper must expose
unavailable freshness rather than call a cached report current.

```sh
rtk proxy bun run desktop.gpui.build-helper
rtk proxy bun test desktop/gpui/tools/semantic-worker.test.ts
```

## Host integration and actual control driver

The host retains one Rubric view across the Board and full Galley. Accepted
metadata is independent of manuscript source and is saved through exact
candidate acknowledgements. Scoped artifact keys are authoritative; legacy
values and row `folioId` fields never provide import aliases. A folio switch
flushes its held weight request before re-scoping the view.

Fingerprint/readiness/date/room work runs on the background executor after
opening or accepted quiet/explicit Save. Typing invalidates freshness with
constant work. Native ID, manuscript revision, metadata generation, request
generation, scope and view identity guard completion. Dirty or unfiled rich
revisions prevent an old saved HTML projection from being called current.

Seven mounted host checks cover scoped retention, folio changes, held writes,
retry and late acknowledgements, joining a background candidate, explicit
Save freshness and a metadata acknowledgement during unsaved typing. Dirty
writing cannot become fresh through an old accepted HTML projection.

The [actual driver](check-native.py) passes all ten checks in the retained
[acceptance](native-acceptance.json). It activates a newly allocated Xvfb window,
observes native input focus/value, and drives XTEST weight edits, full-report
navigation, a physical backup-write obstruction/retry, explicit custom
Add/Remove and final focused Ctrl-Q. It also requires unchanged grades,
history, passage findings, foreign/unscoped data and canonical manuscript
bytes. Unsubmitted custom forms must never be automatically filed.
The final focused weight is demonstrably unfiled before Ctrl-Q, then durable
on a clean exit with leak detection enabled. Background host tasks retain
view identity rather than owning the view after the window closes. The
retained original/final manuscript files are byte-identical; saved judgment,
history, review and foreign data remain exact through criteria changes.

[Board](visual/rubric-board.png), [Galley](visual/galley.png),
[write failure](visual/failed-write.png) and
[held form](visual/held-form-before-quit.png) frames show the actual run. They
record native control behavior; they are not matched original/native visual
comparisons.

```sh
rtk proxy devenv shell -- rtk proxy python3 desktop/gpui/fixtures/host-rubric/check-native.py --binary desktop/gpui/target/debug/twyne-desktop --fixture desktop/gpui/fixtures/marginalia/browser-manuscript.html --rubric desktop/gpui/fixtures/rubric/retained-native.json --rubric-folio 'original/path/folio:café'
```

These retained results are authored test metadata. Cached reading, local
criteria changes and explanatory arithmetic do not establish provider
grading, automatic review, an editorial anchor, visual parity or other-OS
shutdown behavior. Normal window close and explicit Quit veto a failed save;
the platform application-quit hook is a final best-effort write without that
veto.
