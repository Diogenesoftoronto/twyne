# Typst-native editor

Status: source editor, bidirectional bridge, Typst proof, and canonical source
persistence implemented on 2026-09-28. See
[execution and verification](typst-native-editor-execution.md).

## Implemented

- The writing workspace offers **Write**, **Source**, and **Proof** views, plus
  an optional side-by-side proof on larger screens. Write remains the default.
- CodeMirror provides source highlighting, line numbers, search, undo, and
  Ctrl/Cmd-Enter to apply. Incomplete source is saved separately on this device
  and recovered after reload. Applying requires successful compilation and an
  unchanged saved base. A conflicting source draft can be downloaded before
  loading the newer manuscript.
- A bounded, non-evaluating two-way bridge preserves rich schema attributes and
  stores unsupported Typst syntax as opaque block/inline nodes. Source bodies
  are authoritative; HTML is a projection for editing, publishing, and AI.
- IndexedDB lazily migrates existing HTML folios without changing their revision
  timestamps. Canonical source travels through cloud sync, Lix collaboration,
  conflict copies, revisions, native imports, and backups. Legacy cloud writes
  cannot silently replace a native source document with HTML.
- Typst produces actual SVG proof pages and PDFs in a cancellable local WASM
  worker. The proof and page-layout PDF action share the same compiler and page
  setup. The writing surface uses a continuous column; its old measurement
  paginator is no longer registered. Paper size and margins control proof pages.
- Equations and Mermaid diagrams are rendered locally into SVG assets. Fonts
  used by the manuscript controls are bundled with their licenses. Image size
  limits and compiler diagnostics remain explicit.
- `.typ` import retains exact source; native backups include canonical source;
  source export embeds fetched image bytes for a standalone file.

## Boundaries

- The interactive writing column is not direct manipulation of the rendered
  Typst pages. Proof is the authoritative pagination view.
- Custom packages and missing fonts/images can produce compilation diagnostics;
  unknown syntax remains preserved even when it cannot compile locally.
- Cloud schema/functions require normal deployment before a hosted environment
  can sync the new fields. This implementation does not deploy them.
- The current Electrobun desktop application is a hosted web shell. Compiler,
  renderer, and fonts ship in the web build and use its existing asset cache;
  they are not yet bundled as a standalone offline desktop frontend. No native
  WebView/runtime or installer validation is claimed.

## Original plan and rationale

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
