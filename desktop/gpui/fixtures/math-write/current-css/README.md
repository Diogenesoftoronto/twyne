# Current Source CSS glyph diagnostic

This is an additive diagnostic for **unchanged** Source KaTeX0.18.1 with its actual vendor0.16.47 stylesheet. It does not apply the proposed stylesheet replacement, alter the older engine-matched/NodeView/Mermaid receipts, or certify the Write editor. Source, native editor, MathJax Proof/PDF, manifests and helper build scripts were untouched.

The owned localhost fixture imports the frozen fixture assembly and the **actual** Source MathExtensions/NodeViews, source editor and renderer into installed Tiptap. Seven additional assembly cases exercise inline matrices, ASCII text, nested fractions/root, delimiters, Greek, and inherited12/18/32px sizes. No formula-specific rendering logic is copied into the fixture or adapter. The current published CSS and original local font bytes are served without an overlay. Playwriter session6 owns only this new fixture tab; session4/app/account/storage remain untouched. DOM, styles, boxes and selected faces are observed through CDP. The only page-evaluated probes read the fixture's canonical editor state, await font readiness, or call its pure OffscreenCanvas font-measurement API.

## Executed evidence

`browser-glyphs.json` records15 original Source NodeViews and69 direct-text leaves in Chrome150.0.7871.46 at1280×860. `results.json` contains11 accepted inline diagnostics and4 refusals. Across the59 admitted glyph runs, occupied width, x, signed baseline, inline-span font-box ascent/descent and natural formula width match the captured Source geometry exactly. The largest raw font advance difference is0.000584594727px. `comparison.json` retains every expected/actual run and the browser-receipt hash. Both the small12px fraction and large32px script case match the same general rules; no per-formula offsets are used.

The tests independently check actual Source fraction-rule and sqrt SVG paint boxes, ignored inline strut geometry, CSS vlist cell heights, intended custom font selection, canonical raw LaTeX, and native self-contained SVG rendering with system fonts disabled. That last check is a resvg replay, **not** GPUI/native raster parity. `original-glyphs-1280.png` is the real original fixture screenshot, not a native replay.

`fonts-and-css.json` pins all20 Source TTFs and all20 published WOFF2 faces. Nineteen are files; the3624-byte Size3 face is embedded in the actual published CSS as a data URL. Published WOFF2 bytes match their original Source and installed engine files. No font was fetched from an external origin or replaced. The vendor stylesheet SHA256 is `1d0be692cde606a132f39e5150d8c81d83649ab0e6825329e93c2a6dcffcbe0d`; the published CSS SHA256 is `71ddc6c68996dc01fed4c53b636dac92d573440504478b8cda76a4778ae701b7`. Additional exact Source/module/font hashes are retained in the receipts.

## Production API and boundaries

`renderMathWrite(input)` adds `profile: "currentSourceCssDiagnostic"` and accepts only the bounded natural inline-content lane. Successful output has `fidelity: "currentSourceCssDerivedDiagnostic"` plus optional `cssGeometry`. Existing `currentSource` still defaults to its original mismatch/unverified refusal; every saved old-profile output and SVG byte is unchanged.

Rust adds `MathWriteProfile::CurrentSourceCssDiagnostic`, `MathWriteFidelity::CurrentSourceCssDerivedDiagnostic` and `MathWriteOutput.css_geometry: Option<MathWriteCssGeometry>`. Its explicit scope is `KatexBaseInlineSpan` and model is `Blink150Linux64ths`. Fields retain CSS/platform font size, computed line-height, real font-box ascent/descent, ignored inline strut heights/vertical alignment, and CSS table row heights. It validates exact vendor version/hash, inline-only scope, bounded finite metadata and vector agreement. The existing owner/request/generation/style key, shared concurrency limit, bounded cache and stale-result guards apply unchanged. Diagnostic images validate that profile/metrics first; they do not promote a result to accepted product Write parity.

`vector.widthPx` is the natural unwrapped math-content advance, possibly across several `.katex-base` spans. **The current-CSS `vector.heightPx/ascentPx/descentPx/baselinePx` describe the common inline-span font box, not TeX extents or the atom's surrounding line box.** At18px body size this is26px with20px ascent/6px descent. The fraction's authored27.190152px strut height is ignored by the real legacy CSS because the renamed strut remains `display:inline`. Glyph/script paint can extend outside the26px frame; the existing separate signed paint frame preserves that overflow.

The declared26.136px line-height is retained as `lineHeightPx`; it is not substituted for the Source inline-flex wrapper or paragraph height. Font shape sizes and CSS lengths use the observed Blink150/Linux1/64px rules: CSS lengths/platform font sizes truncate towards zero; occupied inline text runs round up. Font-box metrics derive from the immutable Main font's hhea values, not the engine's height/depth fields. This diagnostic makes its platform model explicit; other browser/platform rounding and GPU raster remain unverified.

Supported CSS is bounded to the actual frozen vendor cascade: simple tag/class/universal selectors, descendants/direct children and its present `:not(.class)` form; specificity, source order, `!important` and inline precedence are resolved. Font-face rules cannot execute URLs. The exact SHA guard refuses stylesheet drift. Budgets:64KiB CSS/source,512 CSS rules,1024 selectors,4096 declarations,256 bytes per selector;20000 tree nodes,12000 glyphs,8MiB SVG and4096px dimensions. PostCSS8.5.10 was already installed transitively and is embedded in the compiled helper; no manifest/install was changed. A clean dependency-resolution/package gate remains the parent's responsibility.

Explicit refusals include full block/display line flow, over-width wrapping, accented overlap (including Café), indexed roots, large operators/limits, decoration and other unimplemented structures/cascades. Original invalid/empty-source errors take precedence. The block matrix's internal glyphs are separately proven by an actual **inline** matrix; the block itself still refuses. Its actual58.390625px display line is not relabeled as the26px span or the engine's52.272px TeX box.

Remaining work for product adoption: Source inline-flex wrapper/paragraph baselines and spacing, actual display/line breaking, GPUI selection/hit geometry and SVG raster, async child/view mounting and real editor/Undo/Redo integration. This module does not supply those proofs or change row completion.

## Reproduction

Run from the repository root. Commands use installed cached modules; no Cargo/Devenv/install/download/provider/device step runs.

```sh
rtk proxy bun desktop/gpui/fixtures/math-write/current-css/serve.ts
rtk proxy bunx --no-install playwriter session new --browser headless
rtk proxy bunx --no-install playwriter -s NEW_OWN_SESSION -f desktop/gpui/fixtures/math-write/current-css/open.js
rtk proxy bunx --no-install playwriter -s NEW_OWN_SESSION --timeout 60000 -f desktop/gpui/fixtures/math-write/current-css/capture.js
rtk proxy bun desktop/gpui/fixtures/math-write/current-css/generate.ts
rtk proxy bun test desktop/gpui/fixtures/math-write/adapter.test.ts desktop/gpui/fixtures/math-write/current-css/current-css.test.ts
rtk proxy bun desktop/gpui/fixtures/math-write/current-css/run-rust.ts
```

The direct Rust runner uses cached compatible serde/serde_json/uuid artifacts, selects by the host compiler's exact version, writes temporary binaries under `/tmp`, and removes them. It compiles only `math_write.rs` with `-Dwarnings` and runs12 model/cache/response tests. GPUI/cfg-desktop parsing and aggregate Cargo/Clippy gates are parent-owned and are not implied by this check.

At delivery the combined Bun gate passed18/18, and direct cached Rust passed12/12. Parent still owns the packaged-helper rebuild, Cargo/Clippy and eventual native adoption. Cleanup is recorded separately in `cleanup.json`; only the owned fixture tab/server are closed, preserving shared browsers and all other sessions.
