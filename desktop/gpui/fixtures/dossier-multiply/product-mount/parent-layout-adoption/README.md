# Parent responsive-layout adoption

This is an **unapplied** rebase of the frozen parent-folder product mount. It
targets the responsive Dossier checkpoint pinned in `base-pins.json`; it does
not replace or update the old patch, receipts, test file or reference artifacts.
No Source, shared native or vendor file was written. No Rust parser, Cargo,
Devenv, native process, browser or GPU run was executed in this lane.

Apply order for Parent review:

1. `integration.patch`: only `desktop/gpui/src/dossier_view.rs`.
2. `tests.patch`: the same file, based on the proposed production result. Its
   relative `#[path]` loads this directory's `product_mount_tests.rs` as a child
   of `dossier_view`. The existing `tests::layout_correction` child stays intact.

The new final paint-only overlay follows the complete centered 1472px/gutter
wrapper on the positioned, opaque, full-viewport root. The root's existing
overflow mask, source breakpoints, gutters, equal centering spacers, controls,
input sizing and inline stamp geometry are unchanged. The responsive render
body is byte-identical after removing the one added final-overlay builder call.

Preparation stays at constructor/theme/real viewport-DPR/resume boundaries,
before the ordinary-paper cache early return. Both existing refusal transactions
restore the foxing pointer and recording receipt together with paper/stamps;
resume still acquires a fresh lease rather than reviving a retired one. The exact
premultiplied group is included once after available ordinary preparations.
Broadsheet has no group. Actual image/window/lease, palette, bounds and DPR guard
the painter; an unsupported backend leaves live ordinary content paintable and
does not upload the group. `Recorded` remains only a scene-recording status.

The prepared group, `.7` opacity applied exactly once, backend admission policy,
CPU cache, native supported-format restriction and existing atlas retirement
boundaries are unchanged from the reviewed original mount. No headless multiply
capability is invented. Source radial-gradient raster equivalence, fractional
device-grid sampling, ancestor fades/transparency and all-platform support
remain unproven or refused as documented in the frozen parent README. Original
Source fixed positive-z overlays are still a separate transient stacking gap.

## Font assumptions in the mounted tests

`TestAppContext::build` creates `TestPlatform::new`, whose default text system is
`NoopTextSystem`. Its `add_fonts` returns success without reading bytes;
`all_font_names` is empty, font metrics have 1000 UPEM, and shaping supplies
synthetic font/glyph IDs. `theme::apply` successfully calling `register_fonts`
therefore does **not** establish original Special Elite shaping.

`DossierStampSet::prepare` deliberately requires the original selected face,
glyph IDs, 2048 UPEM, advances, ascent and descent. Its failure leaves
`reviewed_stamps = None`; substituting fallback outlines would be a production
defect. The previously authored hard-coded nine/ten-image headless assertions
were invalid. This rebase changes only those test assumptions, not production
font registration or refusal.

The six authored mounted tests verify exact pointer/ID/order membership for the
actual ordinary paper and, **if present**, all eight atomic real stamp variants,
plus exactly one prepared group. A complete default Noop preparation can have
two images, not ten. The tests retain default-false backend refusal, live last
character/navigation, transparent theme, stale canvas identity, actual test
platform bounds notifications, explicit DPR staleness and retired-lease resume.
The added wrapper test exercises widths 620, 1600 and 1280: a multiply canvas
inside the capped/gutter wrapper would fail its pre-capability bounds guard.

Parent's separate real X11/actual text-system gate must **still require all eight
real stamp variants and nine ordinary prepared images**. Optional foxing changes
that native total to ten; this is not permission to waive native font proof.
Its separate driver adaptation is authored afterward in this directory, without
changing the pre-mount driver or its historical receipts.

## Checks and execution boundaries

Filesystem recipe (every shell command is prefixed):

```sh
rtk proxy python3 desktop/gpui/fixtures/dossier-multiply/product-mount/parent-layout-adoption/check_rebase.py
```

It verifies immutable Source/old-artifact and Parent input hashes, reconstructs
both patches strictly in memory, checks responsive render/rollback/order guards,
parses authored Python, runs `rtk proxy git apply --check --whitespace=error` for
the production patch, and checks test registration against a disposable owned
proposed tree. It never applies a patch to shared files. These syntax/context
checks establish neither Rust compilation nor mounted, font or native proof.

Parent alone applies, formats, compiles and runs the mounted tests/GPU capture.
Suggested scoped filter after application: `product_multiply_mount_tests` under
the existing `ui-tests` feature. No Cargo command was run by this lane.
