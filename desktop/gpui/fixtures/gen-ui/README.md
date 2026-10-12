# In-flow writing tools

The full hosted Twyne desktop is the reference. Native Sentence Lab, Rhythm
Strip, Claim Check and Reader Questions are mounted in `WritingRoom`, with the
original fonts, palette, labels, card, rail/popover positioning and saved-tool
shelf. This is progress toward the complete desktop port, not full-app parity.

The host translates paragraph text and UTF-16 sentence offsets into the native
rich document's scalar coordinates. Applying a working copy preserves the
other sentences, marks outside its replacement, and the original Undo caret.
Changes to the anchored sentence retain the proposal and show Source's notice.
Folio, editor visit, tool identity and request identity guard late callbacks.
Saved tools and successful Jots are written locally and read back before their
acknowledgments. Real mounted button tests verify persistence after reopen.

Inputs use GPUI Kit's base editing engine with Twyne's own field presentation,
focus bindings and accessibility actions. The compact Rhythm controls include
the original widths, internal suffix and number font. A replay of seven real
Source browser interactions verifies arrow keys, bounds, typed values, clearing
and subsequent stepping in the mounted native editor. The checkbox and mixed
size Claim labels use Source's dimensions and shared inline baseline.

Source/browser and actual native GPU captures have been made for all four
default cards at 1280 x 860, scale 1. They establish those states only. The
Source captures run the real editor in isolated browser storage; they do not
establish Electrobun-host equivalence. Fractional spacing, emoji/font raster,
focus rings, tooltips, narrow layouts, night mode and further states still need
comparison. Current runtime and capture receipts are under `target/verification`.
Existing failed receipts remain available there.

The executed Source oracles cover:

- Catalog validation, cumulative append-only streams, deterministic writer
  seeds and offline fill. Writer-owned sentences and attempts remain uncapped;
  model candidates retain Source's caps and validation behavior.
- Kept-tool and notebook normalization, native paragraph/atom offsets and
  rail/popover geometry.
- 63 paragraph signal cases with 791 frames and six hedge strings.
- 15 shared System One budget timelines with 852 frames.
- 150 exact classification request/response cases and four fallback cases,
  including JavaScript coercions, UTF-16 clips and malformed answers.
- 112 forward/inverse ProseMirror StepMap cases with 9,476 frames, including
  deletion boundaries, multiple ranges and IEEE-754 recovery rounding.

StepMap accepts valid nonnegative native coordinates within JavaScript's safe
integer domain. It refuses invalid native maps and uses opaque floating-point
recovery tokens to preserve the original Number arithmetic. Source NaN
recovery is represented as failure. The host still uses a single projection
replacement between snapshots; ordered transaction maps, rebase mirrors and
complex moves remain unfinished. The adapted algorithm's MIT notice is in
`prosemirror-transform-LICENSE.txt`.

The detector, classification and budget modules have Source-backed pure
contracts. Automatic struggle tracking and shared live transport are not
connected. Classification's exact JSON can contain an escaped lone UTF-16
surrogate; parsing that request through `serde_json::Value` would change or
reject it. Other Rust strings still cannot represent JavaScript lone
surrogates in generated specs or writer labels sliced through a pair.

Research currently opens the native Apparatus and reports its unavailable
adapter. Jot storage is integrated; the writing-tools notebook surface still
needs its bridge. Live Jev/System One, writer model generation, account-owned
knowledge, connected authentication and online sync remain part of the full
port objective and are not proved by these tests or captures.

Run Root-owned Cargo checks sequentially:

```sh
rtk proxy python3 desktop/gpui/fixtures/gen-ui/check.py ui
rtk proxy python3 desktop/gpui/fixtures/gen-ui/check.py lint
```

Freeze and capture a checked build using an explicit document-helper origin:

```sh
rtk proxy python3 desktop/gpui/fixtures/gen-ui/build.py --helper /absolute/path/to/twyne-document
rtk proxy python3 desktop/gpui/fixtures/gen-ui/capture-native.py /absolute/path/to/frozen/build
```

These use isolated capture libraries and displays. They leave the user's
running preview and existing writing untouched. Source web/Convex files,
provider registrations and account data are preserved.

The `*-proposal` folders retain actual isolated Sakana fugu-max inputs and
outputs. Review receipts distinguish adopted code, coordinator corrections,
timeouts and remaining proof boundaries. The coordinator executes the original
implementation for comparison rather than treating an advisory response as
verification.
