# Current Source Write adoption assessment

This lane plans adoption; it does not adopt a renderer. Source CSS, existing
KaTeX references, native runtime, Proof/PDF, and the other agent's inline-source
form remain untouched. No Bun tests, Rust compilation, Cargo, Devenv, browser,
provider, or native raster runs were performed for this lane. The files are
authored contracts for Parent review/execution. Hashing and source/receipt
inspection are the only local checks.

The engine/CSS diagnostic has enough information to place its natural **inline
span** and signed paint frame correctly. It does not yet have enough information
to replace the complete Source NodeView in a paragraph. A minimal diagnostic
geometry accessor is therefore proposed in the **unapplied** `integration.patch`;
there is deliberately no editor/GPUI call site, new accepted fidelity, or change
to `CurrentSource` refusal.

## Three boxes, with different responsibilities

The frozen `../current-css/results.json` and `browser-glyphs.json` give these
values at inherited 18px. No new golden result is generated here.

| Reference | Natural advance | Base font box A / D | SVG paint height | Signed paint Y from base top | Actual NodeView height |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary `x+1` | 49.9375 | 20 / 6 | 26 | 0 | 32.390625 |
| fraction | 57.9375 | 20 / 6 | 32.3744375 | -3.07403125 | 36.90625 |
| radical | 96.203125 | 20 / 6 | 27.875 | -1.734375 | 34.265625 |
| scripts | 54.421875 | 20 / 6 | 29.547828125 | -3.27715625 | 34.140625 |
| inline matrix | 76.65625 | 20 / 6 | 52.215734375 | -11.56015625 | See retained wrapper receipt; not admitted flow |

The formula's natural advance belongs to the one-scalar atom's horizontal
layout, edges, selection, and wrapping. Its glyph paint may overhang that box.
The base-font A/D describe the diagnostic's `.katex-base` fragment, **not** the
outer inline-flex baseline. The NodeView is `inline-flex`; its render span is
blockified and contains a CSS inline formatting context. Its inherited Lora
strut, line-height, descendants' vertical-align, and vlist/table extents affect
wrapper/row flow. Even the ordinary wrapper differs from the 26px fragment.
The CSS computed line-height 26.136px is a fourth quantity; it is neither the
font-box height nor the actual outer wrapper height.

For a placed diagnostic base span with natural left `x` and font baseline `B`:

```text
logical = (x, B - ascent, advance, ascent + descent)
paint   = (x + paintOffsetX,
           B - ascent + paintOffsetY,
           paintWidth, paintHeight)
paint.y + paintBaseline == B
```

The signed offsets are essential. Reusing the paint height/baseline as logical
metrics enlarges the real fraction's 26px font box to 32.3744375px and changes
its A=20 to 23.07403125. Using only the font box as the Source wrapper instead
shrinks its real 36.90625px flow to 26px. Neither substitution is acceptable.

## Current native seams that must change before adoption

`editor/view.rs` currently sends closed LaTeX math to `InlineProofRenderer`,
whose explicit fidelity is `WebMathJaxProof`. `AtomRenderImage` contains only
image width, height, and baseline. `Piece::width`, `shape_block`, image prepaint,
and `finish_line` consequently treat those dimensions as both logical and
paint geometry. Replacing only that image would preserve this conflation.

Keep MathJax in its Proof/PDF contract. A future Write-only child/enum needs
separate admitted inline wrapper flow and signed paint geometry, as described
in `CONTRACT.md`. No MathJax fallback may be labeled a Source Write preview.
Unsupported KaTeX structures, unavailable fonts/policy, current-CSS mismatch,
and engine/helper failures must remain distinct from genuinely invalid LaTeX.

`set_atom_renderer` clears ready images and advances `atom_revision`, but it
does not retire the current job/generation. The existing job completion can
assign its previously captured renderer back to the view. This is a static
code finding, not an executed race reproduction. A new Write pipeline needs
an independent immutable renderer epoch and exact completion token; do not
copy that replacement behavior.

## Font, cache, DPR, and retirement

The helper uses original KaTeX font **outlines**, already embedded in SVG paths.
Changing a GPUI UI font resolver cannot repair or change those paths. Cache
geometry by complete raw LaTeX + display + explicit profile + effective
inherited font size + ink + available width **within one immutable renderer
manifest** (engine, helper, CSS, font hashes, CSS-layout policy). Current
`MathWriteKey` has the style/source fields; the backend is immutable per
`MathWriteRenderer`. Manifest changes require a new renderer instance/epoch,
not swapping a binary underneath its executable path or relying on
`clear_cache` while an old render can repopulate it.

Geometry remains reusable across DPR changes; prepared raster does not.
Pinned GPUI `Image::to_image_data` sends SVG to `render_single_frame(..., 1.0)`;
`ImageDecoder` caches by the image source. `diagnostic_image()` supplies no
window scale. A future prepared-raster cache must include vector digest,
actual DPR/device extent, platform/render policy, and retain exact logical
bounds separately. It must explicitly retire GPUI assets/atlas entries after
all consumers have released the old prepared image. Dropping a bounded
geometry LRU is not proof of GPU-cache eviction. This lane neither changes
GPUI nor certifies a raster policy on Linux, Wayland, X11, macOS, or Windows.

On folio/view replacement, helper/font/CSS policy replacement, atom edit,
Undo/Redo, or source-form opening, retire the relevant presentation tokens
before queued completion. The accepted raw payload may remain in its bounded
immutable cache and receive a fresh token on reuse. The form's real retained
AnyElement size/reservation is independent; while open, that exact atom must
not mount/request its closed image. Closing creates a new guarded closed
presentation from the current authored node. Only affected paragraph cache
entries need retirement; neither full-document work nor helper execution
belongs on a typing or paint path.

## Existing proof reused, not rerun

The already-retained `../current-css/parent-gates.json` records Parent's 13 Rust
model checks, 18 Bun tests / 1913 assertions, and exact production-helper replay
of 71 JSON+SVG results in each of two packaged helpers. The current-CSS browser
receipt records 15 actual NodeView cases / 59 admitted glyph runs on
Chrome150/Linux. Those establish the documented diagnostic bounds, not
complete Source Write/native raster parity. The candidate CSS capture is a
different reference and remains unapplied; it cannot replace these originals.

`pins.json` records exact inspected source/reference/font-manifest/core hashes.
`contract.test.ts` authors **13** pure checks that read the frozen references,
expose the existing image-conflation failure, cover signed placement, row
extents, stale tokens, policy drift, and DPR identity. Its positive cases prove
only arithmetic/admission intent when executed. The proposed Rust patch adds
three analogous **authored, uncompiled** tests. Parent can run:

```sh
rtk proxy bun test desktop/gpui/fixtures/math-write/current-adoption/contract.test.ts
rtk proxy git apply --check desktop/gpui/fixtures/math-write/current-adoption/integration.patch
```

No tests or `git apply --check` were run here. Parent should verify the pinned
math module before applying the patch, format/compile it if selected, and
retain all existing math/profile tests. Actual Source wrapper/paragraph/block
admission and actual GPUI glyph/baseline/overflow/DPR/selection/Undo comparisons
remain required before any production Write integration.
