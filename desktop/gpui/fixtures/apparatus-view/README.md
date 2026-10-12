# Apparatus presentation and interaction evidence

The native view is `src/apparatus_view.rs`; its host API is in
[CONTRACT.md](CONTRACT.md). The view presents accepted retained metadata and
emits guarded requests. Scanning, formatting, entry construction, clipboard
publication, citation placement and storage remain host operations. No provider
discovery, account connection, source-preview response or automatic footnote is
simulated by the renderer.

## Original executable fixtures

`generate-reference.ts` executes the current original bibliography formatting,
citation detection and entry/footnote builders. `source-presentation.json`
records all three styles, global raw-array indices, explicitly scoped copy-all
text, real detected-row IDs and builder output. Its fixed timestamp belongs to
that deterministic fixture only. It also evaluates the original Board append
expression, including the duplicate-within-one-payload behavior.

`visual-native.json` is a separately labelled native capture envelope derived
from the valid rows in the model fixture. Its explicit scope is
`original/path/folio:café`; a foreign row remains in the envelope. The two visible
rows represent retained sources, not new discoveries. Invalid and opaque rows
remain covered by the hostile model/interaction fixture rather than being
silently altered for screenshots.

`generate-lix-visual.ts` uses the actual installed `@lix-js/sdk` and JSON plugin
to create the original `/bibliography.json` file-table blob. The resulting
`visual-bibliography.lix` has sync disabled. `seed-reference.js` installs that
blob and the exact 1077-byte marked Notebook from
`../marginalia/browser-manuscript.html` in the task-owned localhost test tab.
It backs up each changed IndexedDB and localStorage key. No account/provider
service is needed to reproduce the retained-source panel.

Rebuild the pure fixtures from the repository root:

```sh
rtk proxy bun desktop/gpui/fixtures/apparatus-view/generate-reference.ts
rtk proxy bun desktop/gpui/fixtures/apparatus-view/generate-lix-visual.ts
```

## Original browser observations

`apparatus-{board,page}-{1280,620}.png` are screenshots of the actual original
app at localhost:5180. Their matching `browser-*.json` files retain inspected
element bounds, computed styles, loaded font metadata and CDP-selected faces.
They use the real public Google font assets and the same marked Notebook. There
is no substituted renderer or injected typography. Auth/provider/sync/analytics
traffic and WebSockets stayed blocked; only localhost and the original public
font hosts were allowed.

The measured full route uses 976px of inner content at 1280, with 396.656px and
555.344px columns separated by 24px. At 620 its 572px inner width stacks the same
sections in DOM order. Its Back button naturally wraps at the narrow width.

The original Board Signal monitor is full width, with only a bottom rule. At 1280
its section is x785/y342/w495/h51; its 50.4px header combines a 36px disclosure and
7.2px vertical padding. The summary has a 0.8px top margin and the optional raw
query is a separate row below the header. Deep trace uses the same monitor
anatomy. The native mounted gate verifies full-width geometry and that
collapsing the query retains the summary without a metadata write.

Original Board URLs request Mono 11px400/15.95px, with 1.1px tracking,
`white-space:normal`, `overflow-wrap:anywhere`, `word-break:normal` and visible
overflow. CDP selected the actual `NotoSansMono-Regular` face. The native view
uses the already-bundled original Noto Sans Mono 2.014 through the bounded
`theme::apparatus_mono_font()` helper and Root's whole-run wrapping/tracking
helper. Page URLs use 10.4px/15.6px with no tracking and `word-break:break-all`.
The native Page now uses the bounded `chrome::break_all_text` helper. The
actual-platform gate `actual_platform_page_urls_match_original_css_break_all`
matches all 20 original Chrome observations in
[`browser-page-url-wrap-observations.json`](../host-apparatus/browser-page-url-wrap-observations.json),
including narrow punctuation/URL breaks, line-box heights and repeated resize
of the same cached layout. This supersedes the earlier ordinary-GPUI URL-wrap
limitation. It proves this corpus's selected-face metrics and line placement;
the assembled screenshots remain the separate GPU comparison.

`restore-reference.js` restored all six changed IndexedDB rows and both changed
localStorage values, then verified exact read-back after a real reload.
`browser-restoration.json` records that successful check. It also records removal
of only the synthetic folio's Dossier recovery row created by the original
departure listener. The owned tab is back at its original empty
`/dossier/create/` route and 1280×860; other drafts were retained. This check is
specific to this task's isolated tab/namespace.

## Native gates and limits

The scoped native suite passes 9/9:

- actual scan/disclosure/dismissal/re-scan and Source accumulation behavior;
- real Add click, held builder failure, physical backup-write obstruction,
  retry and exact durable ACK;
- scoped Drop with opaque/foreign/raw envelope preservation;
- original global style edit with accepted-state visibility only after ACK;
- global-index formatting, scoped copy text and actual clipboard ACK;
- citation failure neutrality and staging only a host-confirmed real timestamp;
- scope/surface switching with rejection of late scan/build/copy tokens;
- Source full-width monitor/query-collapse geometry;
- actual first frame and event-driven 1280→620 resize of the original page grid.

```sh
rtk proxy devenv shell -- rtk proxy cargo test --offline --locked \
  --manifest-path desktop/gpui/Cargo.toml --features ui-tests \
  --lib apparatus_view::interaction -- --test-threads=1
```

The current assembled library gate includes all 9/9 view checks, and the
application gate passes all 83 cases. Strict all-target Clippy and the current
UI-test executable build pass. Root's separate actual X11 driver passes all
16 checks, including clipboard, citation, unblurred note Save and lifecycle
acceptance. The [assembled receipt](../host-apparatus/assembled-gates.json) and
[native receipt](../host-apparatus/native-acceptance.json) record their boundaries.

The subsequent bounded presentation pass keeps those nine interaction tests and
all request/control IDs unchanged. It places the Auto-footnote label at the
leading edge and its checkbox at the trailing edge, gives Open ↗ the original
compact border/padding, and preserves MLA / APA / Chicago label case. Full-page
`for:` text uses italic typewriter text with a normal uppercase kind suffix;
Board kind labels are uppercase. Account sources now follows the original
anonymous compact AccountKnowledge section: a plain heading, original guidance
and a gated underlined Open account settings action, with no invented disclosure
card. Its paragraph width uses the original 65ch measure. No connected account
or research success is inferred from retained metadata. The current assembled
gate and all four `native-{board,page}-{1280,620}` captures include this pass.
They retain the same marked Notebook, explicit metadata and observed readiness.

Offline copy differs deliberately where original text promises a watcher or
connected account. No imported settings alone enable those services. Metadata
disclosure retains all values. The current desktop build enables serde_json's
preserve_order transitively through GPUI; exact conformance to original
`Object.entries` enumeration is still unverified. This renderer does not change
the manifest. Board card utilities currently reveal on pointer hover; Source's
keyboard focus-within reveal remains a presentation limit. Board quotations
still use one italic serif run, so the small normal typewriter kind span is not
fully reproduced. Full-page target-kind spacing uses the existing text space
rather than the Source span's 4px margin. The anonymous account-settings action
is a native button and wraps as one object; the original inline link can break
between words. Its disabled appearance is an explicit offline capability state.
These limits and the pending assembled pixel comparison mean the passing
interaction tests do not constitute complete visual parity.

Root's capture tool can reproduce the native populated state with the paired
`--apparatus visual-native.json --apparatus-folio 'original/path/folio:café'`,
the marked Notebook via `--fixture`, and `--state apparatus` or
`--state apparatus-page`. Scope remapping is an explicit UI-test fixture seam;
production imported IDs are not rewritten.
