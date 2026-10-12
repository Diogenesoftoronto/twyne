# Inline note reference corpus

`source-reference.json` is produced by `generate-reference.ts` using the active
web `InlineNoteNode`, the original note-editing helpers and ProseMirror parser.
It records selection and HTML for update, kind conversion, empty text and
deletion. It also records the original Apparatus manuscript's trailing newline,
inter-block ASCII whitespace, meaningful top-level text, NBSP and interior
paragraph/preformatted whitespace.

Document-level block whitespace handling does not apply to a native inline
clipboard slice. Those slices decode with a separate parser context that keeps
their root text, including a space between marked text and an inline source
atom. The assembled suite exposed two regressions when the document rule also
removed that authored space. The corrected inline path passes the four focused
rich-clipboard checks and the full mounted Copy/Cut/Paste gate in the assembled
393-pass library suite. Document import still follows the recorded original
ProseMirror block-spacing observations.

`research-text-reference.json` is produced by `probe-research-text.ts` using the
same current schema and its actual Tiptap `getText` serializers. The cases cover
block separators, nested lists/tables, hard breaks, notes, images, math and
source atoms, including emoji and combining text. This is a separate explicit
boundary projection; Flow's `textBetween` projection is unchanged.

Regenerate from the repository root:

```sh
rtk proxy bun desktop/gpui/fixtures/editor/notes/generate-reference.ts
rtk proxy bun desktop/gpui/fixtures/editor/notes/probe-research-text.ts
```

The native tests compare the actual reference states, unknown metadata and
wrapped marks, stale/read-only refusal, subtree cache reuse and Unicode
selection/history. Mounted checks exercise real native marker buttons, the
retained textarea, kind select, navigation and atomic citation history. The
source-reference programs do not access the user browser, manuscript storage or
providers.

The scoped GPUI test-platform gate passes all nine note checks, followed by the
three existing mounted citation commit checks. The tests include actual
click/Up/Enter kind conversion, pending native input flushed before Save or
Reference dismissal, and two independent Undo steps for a retained note burst
followed by citation placement. Run them with:

```sh
rtk proxy devenv shell -- rtk proxy cargo test --offline --locked --manifest-path desktop/gpui/Cargo.toml --features ui-tests --lib editor::view::notes::tests
rtk proxy devenv shell -- rtk proxy cargo test --offline --locked --manifest-path desktop/gpui/Cargo.toml --features ui-tests --lib editor::view::citations::tests
```

Presentation values come from `inline-note-popover.ts` and the note selectors in
`global.css`; Source Write footnotes retain the dagger, while Typst Proof's
decimal footnotes remain independent. Native marker tooltip, hover, selection
outline and reduced-motion-aware reference flash do not yet prove matching
browser rasterization. The 220 ms insertion animation and 150 ms hover
transition are not implemented. Textarea vertical resizing remains pending.
The reference flash follows the original 1.4 s CSS timing: a 30% currentColor
background through the 35% hold, then CSS ease-out (cubic-bezier 0, 0, .58, 1).
Zen uses the muted marker color for this flash. Reduced motion prevents the
flash; the correction affects paint only, with no geometry, text or history
change. The integrated UI-test executable builds with this final bounded paint
correction. The current 393-pass library suite includes all nine note and three
citation checks after that correction. Whole-app visual proof remains separate.
The original popup textarea (`inline-note-popover.ts:166–180`) has five rows,
16 px inherited text, 23.2 px line height, 8.8 px padding and a 1 px border.
Its logical height is 135.6 px, leaving 116 px for the five rows. Kit 0.7.0's
`input/input.rs:579` installs multiline editor padding independently of
`appearance(false)` and outer style padding. The default Medium size adds
10 px horizontally and 8 px vertically; vendored
`gpui-base/src/input/base/state.rs:4805–4809` applies those insets to the inner
text frame. The former native `.p(8.8)` therefore left only 100 px vertically
and added 10 px on each horizontal side. The pre-correction X11 popup capture
(`/tmp/twyne-apparatus-host-native-notes/note-popup.png`) shows the intact
324 by 136 px border box and first text about 20 px inside its left border,
consistent with those additive insets.

The bounded correction uses `.xsmall().px(4.8).py(8.8)`: XSmall contributes
4 px horizontally and zero vertically (`gpui-component/src/sizing.rs:147–165`),
so the total content padding is 8.8 px on each side. The explicit 135.6 px
height, 16 px text and 1.45 line height override the size defaults. No input,
focus, measured note marker geometry or history behavior changes. Root's
16-check actual X11 interaction gate includes this inset correction; the retained
[popup capture](native-note-popup.png) shows the corrected text inset inside the
unchanged 324 by 136 px field. The native Kind selector
retains one shared 144 by 28 px trigger/focus box. Actual screen-reader
announcement remains a separate acceptance boundary.

The [save-state regression](save-state-regression.json) reproduced a queued
note-change event making an already saved document dirty again. The host now
ignores rich revisions included in its accepted save. The mounted regression
checks retained Unicode note text, unchanged durable bytes and revision, no
redundant autosave, the Saved locally footer, retained input focus and a later
edit becoming dirty. All 83 application checks pass after the correction.
The separate 16-check actual X11 gate captures an unblurred Save with the
textarea focused and the Saved locally footer. The geometry observer can run
before the GPU presents that frame: its first PNG still showed the preceding
unsaved footer. The driver now compares the presented footer pixels to the same
window's pre-edit saved footer before keeping the
[popup PNG](native-note-popup.png) and
[observed geometry](native-note-popup-geometry.json). The
[presentation receipt](native-note-save-presentation.json) records the two
captures needed to reach that frame. This establishes the native saved state;
it does not establish original-browser popup raster parity.
