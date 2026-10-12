# Native KaTeX Write groundwork, schema 1

This is a browser-free engine/vector adapter and a bounded native request/cache boundary. It does not replace MathJax Proof/PDF, change the manuscript, or certify current Source Write parity. No existing runtime file is modified. `integration.patch` is for the parent to review; it registers/builds the foundation without enabling it in the editor.

## Request, result and cache

```rust
MathWriteRequest {
    owner: Uuid,
    request_id: Uuid,
    generation: u64,
    source: Arc<str>,
    display: MathWriteDisplay::{Inline, Block},
    profile: MathWriteProfile::{CurrentSource, EngineMatchedDiagnostic},
    font_size_px: f32,
    color: u32, // RGB
    width_px: f32,
}

MathWriteRequest::key(&self) -> Result<MathWriteKey, MathWriteError>
MathWriteRenderer::with_executable(PathBuf) -> Result<Self, MathWriteError>
MathWriteRenderer::with_backend(Arc<dyn MathWriteBackend>) -> Self
MathWriteRenderer::render(&self, MathWriteRequest) -> MathWriteResult
MathWriteRenderer::cached(&self, &MathWriteRequest) -> Option<MathWriteResult>
MathWriteRenderer::cached_key(
    &self, &MathWriteKey, owner: Uuid, request_id: Uuid, generation: u64,
) -> Option<MathWriteResult>
MathWriteRenderer::clear_cache(&self)
MathWriteResult::matches(&self, &MathWriteRequest) -> bool
MathWriteOutput::refusal_kind(&self) -> Option<MathWriteRefusalKind>
// desktop only; call on the background executor:
MathWriteOutput::diagnostic_image(&self)
    -> Result<Option<Arc<gpui_kit::Image>>, MathWriteError>
```

The key contains exact raw source, display/profile, font/width float bits and RGB. Owner/token/generation are completion guards, independent of a reusable geometry key. Keep the key with the existing atom; do not rebuild/hash it on every frame. The helper echoes source, display, profile, font size, width and color. A wrong echo/version, inconsistent fidelity, unbundled/zero glyph, nonfinite geometry or nonlocal SVG is a failure, not a success to cache.

Clones share one mutex cache and an atomic two-job limit. The cache has 128 entries and a conservative 32 MiB payload budget. It stores accepted diagnostics and explicit deterministic refusals, never transport failures/busy results. There is no hidden work queue. The caller owns its bounded queue of currently visible/edited atoms and its bounded decoded image cache; decoded GPU image memory is not part of this metadata/vector cache. Helper stdin/stdout are both read/written off-thread under a ten-second process deadline. An absolute existing executable path is required; no machine browser/PATH discovery is used.

Limits: source 64 KiB UTF-8, encoded request 128 KiB, response 16 MiB, SVG 8 MiB, tree visits 20,000, glyph visits 12,000, each natural/paint dimension 4096 px, font input 4–192 px, width input 1–4096 px. A tree pass may visit a vertical-list child twice to resolve percent-width rules; both visits count toward the budget. Only original static KaTeX font files are used.

## Fidelity and geometry

`MathWriteFidelity` is `Refused` or `EngineDerivedDiagnostic`. `CurrentSource` currently returns `CurrentSourceCssMismatch`, preserving the exact original HTML/error. An original parse error has precedence. A future matching Source stylesheet still returns `CurrentSourceUnverified` until a separate renderer/paragraph/raster acceptance is implemented; updating the stylesheet cannot silently promote this diagnostic.

`MathWriteRefusalKind` distinguishes InvalidSource, CurrentSourceCssMismatch, CurrentSourceUnverified, UnsupportedStructure, FontUnavailable, InvalidRequest, TooLarge, EngineUnavailable, AdapterFailure and Unknown. Exact helper kind/message/tree path remains available alongside the category.

`MathWriteVector` keeps two frames:

| Field | Contract |
| --- | --- |
| `width_px` | Natural math content advance; independent of block wrapper width. |
| `height_px`, `ascent_px`, `descent_px`, `baseline_px` | Engine math metrics; baseline from natural frame top. This does not include the paragraph line box. |
| `paint_width_px`, `paint_height_px` | Self-contained SVG image dimensions, including original outline/path overhang. |
| `paint_offset_x_px`, `paint_offset_y_px` | Signed paint-frame placement relative to the natural frame; zero or negative. |
| `paint_baseline_px` | SVG baseline from image top; `paint_baseline + paint_offset_y == baseline`. |
| `glyphs` | Actual font glyph IDs, original font name, codepoint, natural-frame x, baseline-relative y, size and advance. |
| `fonts` | Exact source TTF SHA-256 and units per em for used faces. |

SVG contains original TrueType quadratic outline paths plus KaTeX's own engine SVG paths/rules. It needs no system font lookup, remote resource, MathJax conversion or browser screenshot. `katex svg path { stroke: none }` is carried into the standalone vector; inherited stroke must not thicken radical/stretchy paths. Glyf outline bounds retain overhang that KaTeX's advance/height/depth intentionally excludes. The natural advance must not be replaced by the wider paint frame when positioning the caret.

## Native editor integration to review

1. Retain authored `NodeKind::Math`/`data-latex`, `MathDisplay` and the existing one-scalar inline object range. A render result never applies a document command or history transaction.
2. Enqueue changed/current visible math atoms on the background executor at the atom's existing freshness boundary. Source-editor preview may request only its edited equation; no manuscript scan/conversion belongs on the keystroke path. Retain a weak entity/owner guard in futures.
3. Before publishing any completion, check current owner, token, atom revision, raw source, display, theme size/color, width and profile with `matches`. Remove only the corresponding in-flight request; a late result cannot remove or overwrite a newer job.
4. Diagnostic selection/advance uses the natural width and engine baseline. Paint the SVG at its signed offsets, preserving overflow and the existing single-object hit/selection/Undo semantics. Error/source fallback retains raw authored text. This painting seam is not yet wired or verified in GPUI.
5. Apply original wrapper behavior separately: inline baseline/max-width; block centered, width 100%, margin-block 16 px, padding 12 px vertically/16 px horizontally and horizontal scroll at a 16 px root. These wrapper values do not authorize scaling the formula to available width. Full paragraph/font line-box behavior and the native source-editing form require their own matched acceptance.
6. Preserve the current MathJax Proof/PDF path and its independent fidelity enum. Do not map `EngineDerivedDiagnostic` to `WebMathJaxProof`, or fall back silently between them.

No new Cargo dependency is required. The optional image/XML dependencies already exist. The packaged helper imports the installed exact KaTeX, supplied CSS and the 20 original Source TTFs; compiled-empty-directory checks prove these assets are embedded. Initial patch registration/build does not enable an editor rendering path or change the Source stylesheet.
