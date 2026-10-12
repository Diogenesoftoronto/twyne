# KaTeX Write reference and executable groundwork

The original engine, supplied stylesheet and fonts are independently recorded. The current Source mismatch is an observed reference defect, not a reason to label a corrected diagnostic as current Write parity.

| Original input | Version / SHA-256 |
| --- | --- |
| Installed and actually served KaTeX | 0.18.1 |
| Supplied `src/components/editor/math/katex.min.css` | 0.16.47; `1d0be692cde606a132f39e5150d8c81d83649ab0e6825329e93c2a6dcffcbe0d` |
| Installed engine full `katex.css`, used only by diagnostic | 0.18.1; `67c6047f54406dbeae30c180d39cc9db1238eded330ae76e362d13368761395b` |
| Installed engine min CSS, separately recorded | 0.18.1; `0fb711c9c74cb1718661933948b653fbc09a627da5dde8926b4d10585370993e` |
| Original wrapper `math.css` | `f29bbdea2806650b758422416d2a8e08a5a985f908feeddc8442362c412308b0` |

Original `renderLatex` trims only its rendering input. Raw source is preserved independently. Its exact options are `displayMode`, `output: "htmlAndMathml"`, `strict: "error"`, `throwOnError: true`, `trust: false`. Empty input and parse-error prefix handling match the original wrapper.

## Actual original browser observation

`browser-reference.js` creates one task-owned localhost source-module fixture page. It imports the actual built/served KaTeX chunk from the current Qwik manifest, loads the actual published main stylesheet and checks valid HTML byte-for-byte against the actual original `renderLatex` output in `original-results.json`. It does not seed or mutate the editor, folio IDB, localStorage, auth, providers or manuscript. The controlled surrounding font is 18 px/line-height 32.4 px with 600 px available width and original math wrapper classes; this is not a full editor/NodeView baseline claim.

`browser-source.json` and `browser-current-source.png` retain that unmodified rendering. Actual class output includes `katex-base`, `katex-strut`, `katex-sizing`, `katex-root`; CSS 0.16.47 targets old `base`, `strut`, `sizing`, `root`. For the fraction, actual current Source's sized run is **21.78 px**, and `katex-strut` is **inline**. The actual built assets have not repaired this mismatch.

`diagnostic-reference.js` changes CSS only in that task-created page by adding exact engine 0.18.1 rules, reusing Source's byte-identical font faces. `browser-engine-matched-diagnostic.json/.png` are explicitly separate diagnostics: fraction run **15.246 px**, strut **inline-block**. They do not replace the current Source baseline.

Both `browser-fonts-*.json` record actual Chrome selected custom faces, plus precise strut quads and computed styles through the documented CDP seam. Main, Math Italic, Size2, AMS, Caligraphic, Fraktur, Typewriter and SansSerif select their KaTeX custom fonts. All 20 original TTF files match the installed engine TTFs byte-for-byte. Font hashes are included per accepted vector. `restoration.json` records closure of only the task-created page; the prior `/dossier/create/` app tab, other tabs, metadata and manuscript were unchanged.

## Executed comparison

```sh
rtk proxy bun run desktop/gpui/fixtures/math-write/generate.ts
rtk proxy bun test desktop/gpui/fixtures/math-write/adapter.test.ts
```

The 28-case original corpus covers raw whitespace, fractions/nesting, roots/indexed roots, superscripts/subscripts, sums/integrals, scaled delimiters, matrices/alignment, text/ligature behavior, accented/Greek Unicode, font families, overline, spacing/color, trust/error guards and unsupported structures. The adapter has no formula-specific fixture rendering rules.

Current results: **10 Bun checks pass, 758 assertions**. **21 engine-derived vectors** are accepted. Natural advances differ from measured matching-CSS Chrome by at most **0.148692 px** across this corpus. Engine ascent differs from Chrome strut metrics by less than **0.025 px**, depth by less than **0.002 px**. These are natural math metrics with browser CSS/font quantization; they do not establish pixel equality or paragraph/NodeView baseline parity.

`native-comparison.json` and `native/*.svg/.png` use the actual native `@resvg/resvg-js 2.6.2` binding, with system font loading disabled. Every accepted vector paints real ink and survives an expanded-frame check without paint-frame clipping. Natural layout metrics remain separate from the original outline overhang. The PNGs are verification artifacts of the vector adapter, never the production renderer's input. This is native resvg replay, not an assembled GPUI GPU capture.

The compiled Bun helper runs from an empty working directory with an empty PATH and yields byte-equivalent direct results for fractions, block matrices, font families and CurrentSource refusal. No project/font files, browser or installed Bun executable are required by that compiled binary at runtime. Other OS/architecture packaging is not yet proven.

Explicit diagnostic refusals:

| Cases | Boundary |
| --- | --- |
| `accent` (`hat` + `vec`) | `katex-overlay` anatomy not implemented; no substituted arrow. |
| `unsupported-lap` | `katex-vbox` overlap/flex anatomy not implemented. |
| `unsupported-tag` | `katex-tag` placement not implemented. |
| `unsupported-unicode-fallback` | `cjk_fallback` requires actual fallback font/CSS authority. |
| Unknown command, broken group, empty input | Exact original Source errors. |

Trust-false remote link/image commands originally produce red literal command text. That behavior is retained as outline paths, with no hyperlink/image/external-resource element. Source still contains the authored URL as inert metadata/title text.

## Remaining proof and integration limits

Rust request/cache/refusal/closed-vector code and ten meaningful fixture/race/stale-result checks are authored and scope-rustfmt passed. **Cargo/Devenv and Rust tests were deliberately not run in this slice; the parent owns those gates.** `integration.patch` supplies only registration/helper-build changes for review and does not wire editor behavior.

Engine-derived diagnostics do not implement CSS/DOM flex overlap/tag/arrow/fallback structures that were refused. CSS selector/property support is bounded to the accepted closed engine anatomy. Generic engine/font changes fail closed and require a new corpus. The natural-width comparison does not test wrapping long formulas. Paragraph line-box/inline-flex baselines, block margins/padding/overflow, selection painting, source editing, Undo/Redo, stale completion on a real GPUI surface, full browser/native pixel equality and other OS proof remain separate acceptance work. CurrentSource stays refused even after a future matching CSS version until those boundaries are addressed.
