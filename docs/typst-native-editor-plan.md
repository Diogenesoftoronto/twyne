# Typst-native editor — brief plan

Status: first outbound export bridge implemented on 2026-09-26. Source editing,
round-trip conversion, the proof pane, and storage migration remain planned.

## Implemented first

- **File → PDF (Typst)…** compiles the current folio to a downloadable PDF in a
  dedicated worker. It uses the existing export payload, including unsaved editor
  text, page setup, bibliography, and explicitly opted-in persona comments.
- **File → Typst source (.typ)** downloads the same generated source. Images are
  embedded in the source so the file does not depend on temporary browser URLs.
- `src/utils/typst/serialize.ts` converts the saved editor HTML into safely quoted
  Typst content. It handles paragraphs, headings, inline marks, links, lists and
  task lists, quotations, code, manual page breaks, images/captions, tables with
  merged cells, paragraph spacing/alignment/indentation, running headers/footers,
  page numbers, native footnotes, endnotes, and bibliography entries.
- `src/utils/typst/compiler.worker.ts` loads the packaged typst.ts compiler and
  bundled Libertinus Serif / DejaVu Sans Mono fonts. No manuscript is sent to a
  typesetting service and no fonts are requested from a third-party CDN.
- `src/utils/typst/export.ts` loads manuscript images, caps their size, handles
  compilation progress, and terminates the worker on completion, failure,
  cancellation, or timeout. Leaving the folio cancels its export.

This is an **outbound HTML → Typst bridge**, not the proposed bidirectional
ProseMirror serializer. The `.typ` download cannot yet be imported back into
Twyne. No source-of-truth or collaboration changes have been made.

### Current limits

- Equations and Mermaid diagrams stop Typst export with an explanation. The
  existing browser PDF export remains available for those documents.
- Typography uses the bundled font families. Font-family overrides, drop caps,
  custom table border styles/column widths, and image cropping are not yet
  reproduced. Typst page breaks can differ from the live editor.
- Fonts have limited script coverage. Missing-glyph diagnostics stop PDF export.
  External `.typ` compilation requires the named fonts to be installed.
- Images must be fetchable by the browser (including CORS for remote images).
  The limits are 8 MB per image and 24 MB total unique image data.
- Web export needs its local compiler/font assets to be available. They ship in
  the build; this does not add a browser offline cache or verify desktop runtime.

### Verification (2026-09-26)

- 14 focused tests pass: real WASM compilation, literal text escaping, rich
  prose, merged tables, notes, embedded images in standalone source, image size
  limits, cancellation, worker cleanup, and explicit unsupported-content errors.
- 28 existing export/folio tests pass.
- Client production build passes, including the separate worker and font assets.
- Full TypeScript check passes after the normal i18n preparation step.
- A Chromium integration test produces a PDF through the real Vite worker with
  an embedded image and no external compiler/font requests. This is exporter
  integration coverage, not a visual check of the File menu or desktop runtime.
- Testing found and fixed the transferable-buffer TypeScript error in the worker.

Commands: `bun test --conditions=production --preload ./tests/qwik-test-preload.ts
src/utils/typst`, `bun run build.client`, and
`bunx playwright test e2e/typst-export.e2e.ts` with a Vite development server.
The browser run used an isolated localhost port because port 5173 already had
another service running.

Next: expand schema fidelity, then build the two-way conversion needed for an
editable source view and a proof pane. Keep HTML authoritative until that work
preserves collaborative edits and unsupported source constructs.

## What "Typst-native" should mean

The writer keeps writing in the page-view editor they have now. What changes is the document's source of truth:
it becomes a Typst document instead of HTML, and Typst sets the pages. The writer should never have to see
markup unless they open a source view.

The default is **not** a code editor for Typst. The text-first mode is an opt-in view of the same document.

## What it touches (measured 2026-09-23)

| Area          | Today                                                                      | Files                  |
| ------------- | -------------------------------------------------------------------------- | ---------------------- |
| Editor schema | Tiptap/ProseMirror, 33 extensions under `src/components/editor/extensions` | 33                     |
| Storage       | `folio-content.html` in IDB; `html: v.string()` in `convex/schema.ts`      | ~25 read/write `.html` |
| Pagination    | our own measurement engine (`__twynePagination`)                           | 15                     |
| Export        | DOCX (`exchange-docx`), PDF/print, markdown                                | 3 + 7 + 5              |
| Publishing    | `htmlToMarkdown`/`stripHtml` → standard.site, micropub, blog               | 5                      |
| AI            | prompts, personas, editorial notes all read manuscript HTML/text           | many — read-only       |

Rewriting the editor would touch most of the app. A bridge does not have to.

## Recommended shape: bridge, don't replace

1. **ProseMirror ↔ Typst serializer (both directions)** for the schema we already have: paragraphs, headings,
   marks, lists, quotes, notes, drop cap, and page layout settings. HTML stays the storage format in phase 1.
2. **Typst as the typesetter.** Compile with the typst WASM build (typst.ts) in a worker.
   - Use it for PDF export and a "proof" pane first.
   - Our measurement pagination stays for live editing until the proof matches it.
3. **Source view.** A CodeMirror pane with the Typst source of the current folio. Edits round-trip through the
   serializer. Anything the serializer can't represent is kept as an opaque "raw Typst" node, so it is never
   lost.
4. **Flip the source of truth** (only if 1–3 prove out).
   - Store `.typ` alongside HTML; add a `format` field to folio content and to the Convex schema.
   - Migrate lazily when a folio is opened.
   - Publishing and AI keep reading derived HTML/markdown.
5. **Retire the measurement pagination** once Typst proof and live view agree on page breaks.

## Risks

- WASM bundle size (typst.ts is several MB). Lazy-load it, and ship it inside the desktop app.
- Fonts: Typst needs the actual font files. We already commit Libre Baskerville cuts for OG cards, so reuse them.
- Round-trip fidelity. Collaborative edits and AI suggestions operate on ProseMirror steps. Typst is the output,
  not the editing model, until phase 4.
- Two paginators disagreeing during the transition. Label the Typst one "proof".

## First slice (about a week)

Serializer for the current schema + a "Export → PDF (Typst)" menu item + round-trip unit tests on the e2e
fixtures. That shows whether fidelity is achievable before anything else commits.
