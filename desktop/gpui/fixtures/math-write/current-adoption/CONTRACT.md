# Proposed adoption contract (unmounted)

## Minimal proposed production signature

The accompanying unapplied patch is limited to `src/math_write.rs`:

```rust
impl MathWriteOutput {
    pub fn current_css_diagnostic_span(
        &self,
    ) -> Result<Option<MathWriteDiagnosticSpan>, MathWriteError>;
}

pub struct MathWriteDiagnosticSpan {
    pub advance_px: f32,
    pub ascent_px: f32,
    pub descent_px: f32,
    pub paint_width_px: f32,
    pub paint_height_px: f32,
    pub paint_offset_x_px: f32,
    pub paint_offset_y_px: f32,
    pub paint_baseline_px: f32,
}
impl MathWriteDiagnosticSpan {
    pub fn place_at_baseline(
        &self, origin_x_px: f32, baseline_y_px: f32,
    ) -> Result<MathWriteDiagnosticPlacement, MathWriteError>;
}
pub struct MathWriteDiagnosticRect {
    pub x_px: f32, pub y_px: f32, pub width_px: f32, pub height_px: f32,
}
pub struct MathWriteDiagnosticPlacement {
    pub logical: MathWriteDiagnosticRect,
    pub paint: MathWriteDiagnosticRect,
    pub baseline_y_px: f32,
}
```

The accessor validates the existing output/request invariants and returns a
fragment only for `CurrentSourceCssDiagnostic` +
`CurrentSourceCssDerivedDiagnostic` + `KatexBaseInlineSpan` +
`Blink150Linux64ths`, inline with no issues/error. The geometry comes directly
from the validated vector. Other valid profiles/refusals return `None`; an
invalid output remains an error. Placement accepts finite coordinates, rejects
numeric overflow, and does not manufacture wrapper/paragraph metrics.

No Image is allocated, rasterized, or mounted by this accessor. Existing output
validation does parse the bounded SVG; call it once at an accepted completion
or explicit preparation boundary and retain the small copied metrics, never
from per-frame layout/paint or source-field input. Its name and documentation
deliberately retain the diagnostic boundary. There is
no default-profile change, product-admission enum, GPUI dependency, editor
patch, or implicit block fallback. A host must also verify its immutable
renderer/font manifest; ordinary output validation checks hash syntax and
scope but is not an independent font-byte provenance proof.

## Future Write presentation interface (proposal, not implemented)

```text
WritePayloadIdentity {
  exact MathWriteKey,
  renderer_epoch,
  helper/engine/source-CSS/font-manifest/layout-policy digests
}

WriteCompletionIdentity {
  editor/folio owner epoch,
  request UUID,
  presentation generation,
  expected held Node storage identity,
  guarded path + current one-scalar offset,
  exact WritePayloadIdentity
}

AcceptedInlineWrapper {
  advance,
  above_baseline, below_baseline,
  fragment_left, fragment_baseline_from_wrapper_baseline,
  inherited effective CSS font/line-height/vertical-align context,
  explicit admitted Source flow policy
}

PreparedWritePaint {
  accepted immutable payload,
  separate fragment geometry,
  prepared native raster/image,
  DPR/device-extent/platform-raster policy identity
}
```

These are design fields, not new declared runtime DTOs. Source-free flow/form
ownership remains `editor/math_source_flow.rs` and its existing patch. Coordinate
any eventual `Piece` changes with that owner/Root. Do not replace its retained
form measurement with SVG size. Do not extend `AtomFidelity::WebMathJaxProof`
to mean Write or retrofit diagnostic metrics as accepted `AtomRenderImage`.

For a future admitted closed inline atom, `Piece` uses **wrapper advance** for
one-scalar hit/selection edges and **wrapper above/below** for row maxima.
Paint uses wrapper origin + fragment offset + signed vector paint offset.
Rows must reserve `max(above_i) + max(below_i)`; `max(total_i)` alone can lose
space when different pieces supply the maximum ascent and descent. The
currently published `font_box_ascent/descent` cannot fill wrapper fields just
because their names contain ascent/descent. Actual Source inline-flex and
surrounding strut composition must first produce/admit those fields.

Source's outer inline wrapper can constrain width and descendants can wrap
between fragments. Current helper refuses overwidth natural spans instead.
Do not shrink a formula, stretch its SVG to fill the row, use viewBox extents
as advance, or claim Source wrapping when that refusal is returned. Hit
regions and selection rectangles need the actual admitted wrapper; paint
overflow may be separately clipped by the true ancestor clip, never by an
invented natural-span crop. Pending/invalid/unsupported states have their own
Source footprints and actionable explanations.

Block math requires a separately admitted block contract: content width,
centered natural formula, Source padding (12px/16px at root16), margin-block
16px, display/CSS inline-formatting height, overflow-x behavior, and document
break constraints. Existing block matrix capture has a 58.390625px display
line inside a 118.390625px outer wrapper, versus an engine TeX box52.272px and
the inline font box26px. Current CSS diagnostic expressly refuses display
flow. Block adoption cannot reuse the inline matrix solely because both have
the same raw LaTeX.

## Payload, presentation, and cache transitions

| Boundary | Geometry payload | Live presentation and paragraph | Prepared raster |
| --- | --- | --- | --- |
| Same exact request/style in same manifest | Reuse bounded immutable cache | Fresh token required | Reuse only exact DPR/policy |
| Raw source edit, including whitespace | New complete key | Retire exact atom token and affected row | New SVG identity |
| Undo/Redo to previous source | Old exact payload may reuse | New token/node/revision; never revive old callback | Exact raster may reuse |
| Source form opens | Cache may remain | Suppress exact closed atom/request; real form reservation wins | Held but unmounted |
| Source form closes/cancels/files | Reuse current raw key if valid | New guarded closed token; canonical change only through real command | Mount only accepted current payload |
| Folio/view/document replaced | Cache can remain in immutable renderer | New owner epoch; cancel/clear exact old jobs/ready presentation | Release presentation references |
| Font size/ink/width/display/profile changed | New full key | Invalidate affected row context | New SVG/style identity |
| Helper/CSS/font/layout policy changed | New renderer + manifest/epoch | Retire all old epoch callbacks; no old renderer reinstall | New namespace; release old consumers/assets |
| DPR changed at same logical size | Keep exact geometry | Logical layout unchanged unless actual context changed | Reprepare DPR/device-size key; retire old raster |
| Native raster platform policy unsupported | Diagnostic may remain available | No product image; explicit refusal | Never synthesize proof |

Current `MathWriteRenderer` gives two bounded jobs, an LRU128/32MiB, and retries
Busy/timeout/unavailable failures. It stores validated successful outputs,
including stable diagnostic refusal outputs. A geometry cache hit must use
`cached`/`cached_key` with the **current** owner/request/generation. An old
`MathWriteResult` cannot be retokenized by changing only its source field.
Store clones share their immutable backend/cache. `clear_cache` alone is not
an epoch/cancellation barrier: an in-flight backend can still finish/store.

The host remains responsible for exact result.matches(request), current
renderer epoch, expected node/path/offset and current scope/form checks before
install. Detached tasks retain only weak/ID guarded views. Late completion may
finish its old immutable cache but must not change current renderer, canonical
source, selection/history, or a new job's busy marker. Job cleanup targets the
exact ticket. Bound queues to visible/fresh atoms; no full-document work or
SVG rasterization in input/render/paint.

The helper embeds outlines, so it does not rely on GPUI font fallback for the
formula. Its Current CSS policy remains Blink150/Linux64ths with exact Source
hashes, not a universal OS model. Effective Source run size/ink must be captured
before substituting fallback MONO13; the present native object path uses
block `base_size` and `colors.ink`, which cannot represent arbitrary inherited
font-size/color marks. The surrounding text font/line-height context belongs
in the future wrapper-policy and paragraph-cache key. A GPUI font-loader
revision must invalidate native text struts/layouts as appropriate, while a
changed embedded math-font manifest replaces the helper epoch.

## Required admission before product integration

1. Add exact Source wrapper/paragraph flow producer with executed mixed-text,
   inherited size/line-height/color, vertical-align, wrapping, invalid/pending,
   inline matrices and display controls. No formula-specific offsets.
2. Keep the diagnostic accessor separate; introduce an explicit reviewed
   product fidelity/policy only when the admitted scope is real. Matching
   CSS/engine versions alone is insufficient; current Source stays unchanged.
3. Wire the Write-only renderer behind guarded owner/epoch/key/node identities,
   preserving open-form measurement, one-scalar commands and canonical raw
   LaTeX bytes. Proof/PDF remain MathJax/Typst contracts.
4. Verify actual native paint overflow, baseline, mixed-row carets/selection,
   Undo/Redo, stale switch, DPR transitions, and GPU resource retirement on each
   claimed platform. Standalone resvg and helper paths are not those checks.

All new fixtures/patch tests are authored and unexecuted in this lane. Parent
owns all apply/format/compile/native acceptance work.
