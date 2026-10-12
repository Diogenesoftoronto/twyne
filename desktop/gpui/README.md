# Twyne GPUI

Twyne's native desktop port uses Rust and [GPUI Kit 0.7](https://gpui-kit.com/).
The goal is the full hosted desktop experience with identical styling, original
assets and behavior. The working offline slice includes the rich editor, Dossier,
local editorial panels and native Typst proof/PDF.

The full Electrobun application remains the reference. The port is unfinished;
[PORT_PLAN.md](PORT_PLAN.md) separates implemented behavior, retained checks,
unmounted foundations and remaining work.

[ARCHITECTURE.md](ARCHITECTURE.md) maps native packages to their original web
counterparts, records ownership boundaries, and gives focused investigation checks.

## Run

Use Bun, the repository's Rust toolchain, and the native libraries in
[GPUI Kit's installation guide](https://gpui-kit.com/docs/installation/).
The repository's Devenv shell provides the Rust toolchain and Linux libraries.

From the repository root:

```bash
rtk proxy bun install --frozen-lockfile
rtk proxy devenv shell -- rtk proxy bun run desktop.gpui
```

Use an isolated library or import files on startup:

```bash
rtk proxy devenv shell -- rtk proxy bun run desktop.gpui --data-dir /tmp/twyne-native-library /path/to/draft.typ
```

Imports create library copies. Original files remain independent.

The developer build creates `twyne-document` from Twyne's existing TypeScript
document converters. Its compiled executable includes the Bun runtime. Offline
writing needs no web server or account; GPUI renders the interface and the native
Rust Typst engine renders proof/PDF. The helper handles source/HTML reconciliation,
starter generation and the original MathJax export conversion.

The helper build also creates `twyne-math-write`. It is a diagnostic executable,
not the main editor's math renderer or evidence of Write-view parity.

For direct Cargo development, build the helper first:

```bash
rtk proxy bun run desktop.gpui.build-helper
rtk proxy devenv shell -- rtk proxy cargo run --locked --manifest-path desktop/gpui/Cargo.toml
```

Linux requires X11 or Wayland and a graphics driver supported by WGPU. Native
file pickers use the desktop's XDG portal. macOS requires Xcode command line
tools; Windows requires the MSVC C++ toolchain. Bundles, installers, signing, and
automatic updates remain pending.

## Writing and proof

- **Write:** native rich text with Unicode input, selection, clipboard, IME,
  formatting, and undo/redo. Typing bursts form one undo group. Imported cached
  HTML is projected from canonical source before editing. Footnote and endnote
  markers open an editable note; collected notes navigate back to their
  manuscript references. Save and navigation capture unblurred note input.
- **Equation source:** activate an inline or block equation to edit its retained native textarea. Render equation submits through the actual canonical converter and preserves independent manuscript undo; Cancel keeps the saved source. Inline editing uses a measured child inside the original atom. Preview currently reports unavailable. Actual OS input and original-browser baseline/pixel parity remain separate gates.
- **Dossier:** the original ten sections, imported material, references, local
  probes, create/refine filing, and scoped recovery. Filing opens Write after
  the document is actually saved.
- **Source:** canonical Typst with a separate recoverable draft. Apply requires
  a successful current compile and verified projection. Discard preserves the
  manuscript. Source edits update the real proof after 450 ms of quiet. The
  native code editor provides Typst highlighting, line numbers,
  folded generated helpers, search/replace, source snippets, comments, wrapping,
  and line navigation. Pending Source edits lock the rich view.
- **Proof/Split:** the same pinned Typst fork and ordered fonts as the web
  renderer, original artwork, real SVG pages, zoom, page navigation, and PDF
  export. Failed compilation retains the last valid proof.
  The footer retains the selected page across Write/Proof transitions. Its
  count option leaves the current mode active; page choices reveal the page's
  top, and a shorter valid proof falls back to the count option.
  Closed Arrow/Home/End and PageUp/PageDown keys retain native focus. The
  combobox exposes its selected label and actual popup open state.
  Typed page labels retain focus; repeated letters cycle matching labels and
  search expires after the original one-second pause. Space continues an
  active prefix or opens the popup when search is idle.
- **Compositor:** Home, Insert, Review, and View controls act on the native
  document. Arrow keys change tabs and retain native focus through wrapping;
  Undo/Redo use the actual manuscript history and respect read-only mode.
  Page settings and header/footer text are saved with the folio.
  The page ruler changes the actual margins through drag or keyboard input.
  Optional native pagination has physical-page and input checks; the current
  web editor route does not register its existing pagination engine, so this
  does not establish matching active-route behavior.
  Local PNG/JPEG/GIF/WebP files become portable offline images; choosing a file
  retains the original bytes and one undo restores the preceding manuscript.
  File insertion checks the original converter in the background first: a
  valid image that exceeds the 5 MB Typst editing limit leaves the draft intact.
  Connected actions stay disabled until their native adapters exist.
- **Appearance:** original presets and colour overrides preview immediately
  and persist separately from manuscript formatting. Save failures retain the
  preview and expose a retry; the stored System choice follows OS appearance.
- **Versions:** local checkpoints and passage comparisons in the Editorial
  Board. Restore saves the current manuscript first and refuses to replace
  typing or Source edits made while a restore is being prepared. Saved status
  follows the actual durable write.
- **Cast:** the Room of Editors, local roster and assistance settings, retained
  editorial notes/replies, and saved Full Analysis use the original profiles
  and assets. The Board, roster page and analysis page share one retained room.
  Local writer replies can be filed without contacting a provider. Unfinished
  replies and roster forms survive navigation and closing; failed writes hold
  the exact request and block departure until retry. Existing analyses can be
  copied or downloaded. Provider notes, proposed edits, new analyses, spoken
  notes and persona-mark navigation remain unavailable.
- **Rubric:** local weights, custom criteria and retained grades share the
  Board and Galley. Changes follow the actual durable write, and a failed save
  keeps its candidate for retry. New provider grading remains unavailable.
- **Apparatus:** saved sources share the Board and full page. Local scans use
  the original citation rules; Copy publishes only the active folio's sources.
  Cite inserts an undoable footnote and saves the manuscript before confirming
  its source timestamp. Failed metadata writes retain a retry without repeating
  that insertion. Offline steering retains its draft and original provider
  error; connected research and source previews remain unavailable.
- **Marginalia:** anchored writer notes, replies, resolve/reopen, passage
  navigation, and erase use the actual manuscript marks and local note store.
  The inline thread and Board share one reply draft. Unblurred replies survive
  folio visits and closing; failed writes keep the exact request for retry and
  block departure. Placing a note saves its manuscript mark before filing its
  metadata. Deleting a marked passage reconciles only that folio after the
  manuscript save. Writer previews use the original Flow policy and measured
  passage geometry. Setting one aside is transient; reopening recalls its
  shared thread. An admitted rail thread follows width changes while retaining
  its reply and reserving the full measured card height.
  Connected editor replies, speech, and recorded audio remain
  unavailable until their native adapters exist.
- **House and Library:** offline House, collection, and folio context with
  original fields, inherited context, filing, and a shared context ledger.
  Library cards use the original preview/count rules; source-only imports stay
  visible while their writing projection is unavailable. Context changes are
  published only after their actual durable write.
- **Flow:** focused writing drives the original local rhythm classifier and
  spool ribbon. Automatic focus fades desk chrome while keeping the page in
  place; hovering, keyboard focus, or Escape restores the controls. Writing
  tools opens from the Drawer or Board and saves the automatic-focus setting
  and a separate local rhythm profile.
  Review, live margin tools, cover lookup, and contextual amendments need their
  connected adapters.
- **Save:** autosave follows 700 ms of quiet. Explicit Save, switches, mode
  transitions, and closing capture controls immediately. Serialization and
  conversion stay off the per-keystroke path.

Zen and compositor choices persist locally. Drawer, Board and its selected
panel remain part of the current desk visit.
Archive/restore preserves documents; archived text is read-only. Find selects
literal matches in the active editor.

Rich copy/paste preserves formatting and Twyne object metadata. Linux X11
exchanges HTML and UTF-8 text with other applications, and preserves the full
metadata between native instances. Actual native Paste/Copy/Undo/Redo checks
also cover clipboard ownership, focus, selection and editor changes during a
background import, verified multi-megabyte incremental transfers, and the
original 5 MB canonical-source limit before insertion. RTF-only input and
unsupported deep ProseMirror slice contexts are rejected.
[X11 acceptance](fixtures/editor/clipboard-interoperability.md) records those
transport and conversion boundaries. Wayland rich transfer is integrated:
retained private-Sway runs pass [29 native checks](fixtures/wayland-clipboard/native-acceptance.json)
and [8 ordinary-app checks](fixtures/wayland-clipboard/ordinary-app-acceptance.json).
These cover actual focused serials and owned clipboard offers. Other compositors,
macOS/Windows rich transfer and clipboard-manager handover remain unverified.
GIF animation renders natively; original WebP and APNG animation bytes survive,
but their current native display is static.

Write rendering still has typography and object-layout differences from the
browser editor. LaTeX atoms use the original MathJax proof SVG. The diagnostic
KaTeX helper's `CurrentSource` mode refuses the observed engine/CSS mismatch;
the scoped CSS/Mermaid proposal remains unapplied. Real NodeView and native Write
geometry proof remain pending. Navigation and panel parity, connected
House/collections, account sync, AI providers, voice, collaboration and publishing
are unfinished. Offline foundations do not establish those workflows or full
visual parity.

## Files and storage

Import accepts web `.twyne.json` backups, exact `.typ` source, HTML, Markdown,
text, and the earlier native prototype's `.twyne` format. Web imports preserve
unknown fields, absent/null values, briefs, folio metadata, and canonical
source. Cached HTML does not supersede source. Native library identity is
separate from imported web folio identity.

Source-aware documents export `.typ`, `.html`, or web `.twyne.json`.
Typst export preserves authored BOM and CRLF bytes. Prototype drafts also support
Markdown/text and their older `.twyne` envelope. PDF export writes actual
compiler output.

| Platform | Default library                                             |
| -------- | ----------------------------------------------------------- |
| Linux    | `$XDG_DATA_HOME/twyne-gpui`, or `~/.local/share/twyne-gpui` |
| macOS    | `~/Library/Application Support/love.twyne.twyne-gpui`       |
| Windows  | `%LOCALAPPDATA%\twyne\twyne-gpui\data`                      |

`TWYNE_GPUI_DATA_DIR` or `--data-dir` overrides the location. Manuscripts live
in `manuscripts/<id>.json`. The library is separate from web IndexedDB and Convex.
Local checkpoints live in `revisions/<id>.json`; these are a native recovery
format and do not claim compatibility with web Lix history.
House/collection context and rhythm preferences live separately in `house.json`
and `flow.json`; writer notes and held replies live in `user-comments.json`.
The local editor roster, room settings, retained Cast artifacts and their held
inputs live in `cast.json`. Cached Rubric results, criteria, history and
passage findings live in `rubric.json`, with explicit local criteria/history
overlays that preserve raw imported values. Unsubmitted custom-criterion
forms remain local to the retained view for this app session.
Web `.twyne.json` document exports omit these independent editorial records. These
records preserve unknown metadata, retain the last valid backup, and reject
stale acknowledgements. Unplaced inline note drafts are retained only for the
current app session.

Writes use synced temporary files and atomic replacement. A previous valid save
remains in `.json.bak`; damaged files are preserved and reported. Revision
checks prevent stale saves from replacing newer documents. An OS lock prevents
concurrent writers. Save failures retain live text and block switching, normal
window close and explicit Quit. The platform application-quit hook attempts a
final save but cannot veto quitting after a failed write. Forced shutdown during
debounce can still lose edits that have not been saved.
Manuscript and note files use separate atomic writes; they do not form one
crash-atomic transaction.

## Keyboard

Use Cmd on macOS and Ctrl on Linux/Windows.

| Shortcut                             | Action                                            |
| ------------------------------------ | ------------------------------------------------- |
| Cmd/Ctrl + N                         | New draft and Dossier                             |
| Cmd/Ctrl + O / S                     | Import / Save                                     |
| Cmd/Ctrl + Shift + E                 | Export                                            |
| Cmd/Ctrl + F / G                     | Find / next occurrence                            |
| Cmd/Ctrl + Shift + F                 | Enter/leave Zen                                   |
| Cmd/Ctrl + Shift + L                 | Drawer                                            |
| Cmd/Ctrl + Shift + M                 | Editorial board                                   |
| Cmd/Ctrl + B / I / U                 | Bold / italic / underline                         |
| Cmd/Ctrl + Z                         | Undo                                              |
| Cmd/Ctrl + Shift + Z / Y, in Write   | Redo                                              |
| Cmd + Shift + Z, in Source on macOS  | Redo                                              |
| Ctrl + Y, in Source on Linux/Windows | Redo; Linux also supports Ctrl + Shift + Z        |
| Cmd/Ctrl + Enter, in Source          | Apply source                                      |
| Cmd/Ctrl + Enter, in a margin note   | Place note / send reply                           |
| Cmd/Ctrl + /, in Source              | Toggle line comments                              |
| Alt + G, in Source                   | Go to line                                        |
| Escape                               | Release automatic focus or close compositor/popup |
| Cmd/Ctrl + Q                         | Save and quit                                     |

## Build and verify

```bash
rtk proxy bun run desktop.gpui.build-helper
rtk proxy bun test desktop/gpui/tools/semantic-worker.test.ts
rtk proxy devenv shell -- rtk proxy bun run desktop.gpui.check
rtk proxy devenv shell -- rtk proxy bun run desktop.gpui.test
rtk proxy devenv shell -- rtk proxy bun run desktop.gpui.test-ui
rtk proxy devenv shell -- rtk proxy bun run desktop.gpui.build
```

Build output includes `desktop/gpui/target/release/twyne-desktop`, `twyne-document`
and the diagnostic `twyne-math-write` (`.exe` on Windows). Required font, asset
and dependency notices accompany staging. `TWYNE_DOCUMENT_HELPER` overrides
the document helper path for development.

The retained [reviewed staging receipt](fixtures/distribution/parent-gates.json)
checks 47 actual files and three ELF executables. Its release app predates the
latest unmounted library exports; both helpers use a Nix-store ELF loader.
This proves staged-file integrity, not a current-source release, relocation,
runtime, installation or cross-platform portability. macOS/Windows packaging
metadata remains scaffold; an unimplemented URL scheme is not registered.

Core checks cover exchange, persistence, source recovery, Dossier filing, stale
saves, and editor commands. GPUI tests drive real controls and text input. Typst
checks compile SVG/PDF using original assets; fixtures also exercise the web
WASM compiler. The isolated Xvfb capture tool records native pixels without
operating the user's desktop. Its `--width` and `--height` options compare
responsive layouts at a chosen viewport; they require the UI-test build.
For `writing` or `quiet`, `--geometry path.json` also records observed native
control bounds, allowing direct comparisons with browser measurements.
The UI-test binary's `--capture-geometry-watch` records later rendered frames
and actual focus bindings without requesting extra frames. The isolated
[chrome driver](fixtures/chrome/README.md) exercises OS mouse/keyboard input,
keyboard-only focus paint, page selection, and storage boundaries.
Clean-install, macOS/Windows runtime,
assistive-technology, audio-device, provider, and connected-account proof remain
separate verification work.

Scoped foundation checks are retained separately from mounted behavior:

- Account outbox/CAS/conflict contracts pass [26 library checks](fixtures/account-sync/integration-gates.json);
  collaboration preparation passes [9](fixtures/native-collaboration/integration-gates.json),
  with a recorded strict UI Clippy checkpoint. Sign-in registration, trusted
  callbacks, auth transport, connected sync and mounted sharing/publishing remain
  pending. Constructed receipts are not verified authentication.
- The exported AI foundation passes [16 corrected library checks](fixtures/native-ai/runtime-review/integration-gates.json).
  Optional `native-audio` passes [18 synthetic Rust checks](fixtures/native-audio/integration-gates.json);
  its Source-backed Bun corpus passes 6 checks / 109 assertions.
  These do not exercise mounted controls,
  actual providers, local-model readiness or audio devices.
- Retained isolated X11 receipts cover [8 physical-page/input checks](fixtures/pagination/native-acceptance.json)
  and [16 assembled Apparatus checks](fixtures/host-apparatus/native-acceptance-pagination-integrated.json).
  They do not establish full current web-route, raster or operating-system parity.
- Dossier conversation repair, host integration and the real math NodeView fixture
  are active work. Aggregate, rendered and live filing evidence remain pending.

Earlier suite passes and these focused checks do not establish a fresh aggregate
suite, CI result, default rebuild or current release. The full port remains open.

The small [GPUI adapters](vendor/README.md) expose actual Source history,
validated helper folding, and atomic replacements that restore caret/selection
through undo/redo, plus an explicit fallback path for the original CJK font.
They retain upstream source provenance and Apache licenses. English hyphenation
notices are included in [licenses](licenses/).
