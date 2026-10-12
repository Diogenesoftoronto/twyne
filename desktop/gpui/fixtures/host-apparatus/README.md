# Original offline Apparatus computations

The [browser observations](browser-observations.json) run the original pure
Twyne functions in Chrome150 at the owned anonymous reference origin. Eight
scan cases retain the original regex priority, punctuation trimming, ISBN
pattern, author/month rules and JavaScript UTF-16 offsets. Eighteen formatting
cases cover MLA/APA/Chicago, cached formatting only for the matching style,
nullable fields, signed/fractional dates and URL normalization. Four source
candidates cover exact folio ownership, normalized URL merging, empty URLs and
case-sensitive paths. The original editor HTML remains unchanged.

The packaged helper extracts thirteen exact pure declarations from
`src/utils/bibliography.ts` using the installed TypeScript parser on each build.
It imports `src/utils/citations.ts` directly; that module has only a type
import. Browser storage, research watchers and provider clients are omitted.
The [probe inputs](probe-input.json) are authored test strings and metadata.

Source URL deduplication ignores protocol, query and hash while retaining path
case. A merge keeps the existing source ID and spreads the original raw
builder before JSON serialization. This intentionally clears old author,
publisher, date, year, DOI, style and formatted-citation fields whose new value
is undefined, while preserving notes, keys, targets, insertion timestamps and
unknown fields. The helper returns the complete candidate and an exact raw-row
guard; it does not write bibliography or manuscript state.

`apparatusFormat` returns ordered citations, footnotes and copy-all text.
Accessed dates use the original local `Date.toLocaleDateString` behavior.
The observed locale is en-US in America/Toronto; the executable comparisons
use that environment. Safely qualified rows are formatted while malformed
retained rows expose issues. Malformed data is not converted into an accepted
empty bibliography. These text scans do not verify sources, resolve editor
anchors, run research or place a citation in the manuscript.

The packaged-helper suite includes six Apparatus/citation comparisons alongside
the document/Rubric/proof checks. Offline steering has its own
[original-guard observations](../steering-offline/README.md).

The [anchor observations](browser-anchor-observations.json) execute the
unmodified original editor's `findTextRange` function in a fresh blank Chrome
page. Twelve authored positional text-block cases cover JavaScript whitespace,
literal regex punctuation, omitted atom gaps, the first matching block,
case-sensitive lookup and UTF-16 emoji/combining-text positions. That surface
contains no original editor; it proves the pure matcher, not mounted editor
selection or citation placement. The packaged helper regenerates that exact
function with the TypeScript parser.

The [scan observations](browser-scan-observations.json) compare twelve original
Board/full-page HTML projections. Explicit Board re-scan uses DOM textContent;
the full route replaces HTML tags with spaces. Entity decoding, adjacent
paragraphs and inline note text intentionally differ. Native host scans use
the matching surface's projection instead of inventing a common text string.

```sh
rtk proxy bun run desktop.gpui.build-helper
rtk proxy bun test desktop/gpui/tools/semantic-worker.test.ts
```

The retained model passes twelve checks. Nine mounted view checks cover
detected rows, source mutation acknowledgements, failures/retry, exact scope,
copy acknowledgement and actual responsive resizing. Nine mounted host checks
cover guarded scans, durable citation placement, one-step undo, held timestamp
retry, folio switches, scoped clipboard publication and original source building.
The original formatting-context check is a separate pure host check. Those
mounted clipboard checks use the GPUI test platform. The current ten-case host
family (nine mounted checks plus the pure formatting-context check) passes in
the 83-pass application gate, including clipboard refresh and the removed-Retry
keyboard check. The [assembled receipt](assembled-gates.json) records the
separate 393-pass library gate, strict all-target Clippy and current executable.

`check-native.py` is the separate actual X11 acceptance driver. It allocates its
own display, drives real pointer/keyboard input, reads the clipboard through a
separate client, obstructs a physical metadata backup write, and retains frames,
accepted records and an explicit receipt. Its fixture must be
`native-manuscript.html`; the post-edit baseline comes from the actual original
ProseMirror parser observation in `../editor/notes/source-reference.json`.
Inter-block ASCII whitespace discarded by that parser is not authored prose.
The actual driver with `--notes` passes all sixteen checks, including unblurred
steering and note Save, focused note input, note-kind confirmation/history,
scoped X11 clipboard exchange, failure/retry, manuscript Undo/Redo and clean
Ctrl-Q. The [retained receipt](native-acceptance.json) records the binary hash and
boundary. It waits for the application's own ready signal after a remount;
an earlier click used geometry while asynchronous formatting was still changing
the panel's scroll area. Failure records and the pre-citation bounds remain in
the isolated output. Source/provider, overall raster and release proof remain
separate.

For note Save, the geometry-ready signal precedes actual GPU presentation. The
driver compares the saved footer pixels against this same window's pre-edit
saved state before retaining the popup PNG. The native receipt includes that
bounded pixel check; it is independent of original-browser raster comparison.

The native Board/full page, actual clipboard and durable UI workflows have
separate acceptance boundaries. Bibliography metadata remains independent of
authored canonical source; imported entries are not automatically present in
Proof/PDF. Original wide/narrow reference captures and overall pixel comparison
are also separate from these interaction checks.

The [tracked URL observations](browser-url-wrap-observations.json) contain
twenty authored ASCII cases in a fresh blank Chrome150 page, with network
requests blocked and the exact bundled Noto Sans Mono2.014 bytes. They use the
original Board detail CSS: 11px type, 1.1px tracking, 15.95px line height,
`white-space: normal`, `word-break: normal`, and `overflow-wrap: anywhere`.
They do not mount the original application editor.

Chromium's ordinary printable-ASCII opportunities follow its compatibility
pair rules in [LineBreakData::FillAscii](https://chromium.googlesource.com/chromium/src/+/6ee6dc9cceed8ba8a0b87772afa7eec6fbcd50c1/third_party/blink/renderer/platform/text/character_property_data_generator.cc),
with the contextual hyphen/digit check in
[LazyLineBreakIterator::Context::ShouldBreakFast](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/text/text_break_iterator.cc).
Slash, period, equals, and hash are not ordinary URL opportunities. The
[CSS overflow-wrap rule](https://drafts.csswg.org/css-text-3/#overflow-wrap-property)
first permits ordinary breaks; it retries at complete grapheme boundaries
when no ordinary break fits the current line. An oversized following segment
does not cancel an already-fitting ordinary break. This explains why the
query/hash remains together at 80px and splits at 40px without a hash-specific
rule.

The native tracked helper caches ordinary opportunities and shapes the whole
run before placing its grapheme fragments. The compatibility rule is restricted
to printable ASCII in the `anywhere` helper; Unicode, whitespace, and control
text retain the existing Unicode-break path. The existing typewriter helper
retains its 10px/15px metrics and original Unicode opportunities. This is a
bounded ASCII wrapping contract, not general Unicode or GPU-raster parity.

The focused native check compares all twenty unchanged browser line sequences
using the actual Linux platform font system; all twenty pass. It also checks
remeasurement/cache retention and the existing typewriter overflow/hyphen
behavior. Heights retain the original 0.2px tolerance: Chrome quantizes these
line boxes to 1/64px while the native helper uses the authored 15.95px float.
The longest fixture has a 0.1px accumulated height difference. This is not a
claim of identical GPU pixels or coverage of other scripts/platforms.

```sh
rtk proxy devenv shell -- rtk proxy cargo test --locked --offline --manifest-path desktop/gpui/Cargo.toml --features ui-tests --lib chrome::tests::actual_platform_tracked_urls_match_original_css_wrapping -- --exact --nocapture --test-threads=1
```

The [Page URL observations](browser-page-url-wrap-observations.json) are a
separate twenty-case fresh blank Chrome150 probe using the same exact bundled
Noto Sans Mono2.014 bytes. The original full-route URL nodes in
`src/routes/apparatus/index.tsx:798` and `:931` use 10.4px type, no tracking,
15.6px line height, `white-space: normal`, `overflow-wrap: normal`, and
`word-break: break-all`. These observations retain their original labels,
widths, lines, and heights; they do not mount the application editor.

Unlike Board's overflow fallback, the
[CSS word-break rule](https://drafts.csswg.org/css-text-3/#word-break-property)
adds opportunities within letters/numbers while retaining punctuation rules.
The Page helper combines Chromium's ordinary ASCII compatibility opportunities
with the additional printable-ASCII class relations in
[kBreakAllLineBreakClassTable / ShouldBreakAfterBreakAll](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/text/text_break_iterator.cc).
It also retains the iterator's `+` alphabetic tailoring. The result does not
cut at every grapheme: the 40px URL begins `http` then `s://EX`, because the
letters before `://` cannot be separated from that punctuation sequence.
There are no URL-label-specific punctuation exceptions.

`chrome::break_all_text(label, face, size, color, line_height)` has zero
tracking and is used only for the full-route background/writer URL child in
`ApparatusView::page_source`. It uses the existing cached whole-run shaping
and grapheme painting. Board retains its separate anywhere policy, and the
department/typewriter helper retains its existing 10px/15px behavior.
Non-ASCII, whitespace, and control text keep the existing Unicode path:
general Unicode `word-break: break-all` fidelity remains outside this bounded
ASCII contract. Neither this helper nor its actual-font checks establish GPU
raster or cross-platform parity.

The two focused Linux platform comparisons pass: all twenty unchanged Board
cases and all twenty unchanged Page cases. The Page comparison also checks
cache retention, remeasurement, and unchanged source. It retains the same
0.2px height tolerance; Chromium's 15.59375px
quantized line box differs from the authored native 15.6px float by 0.16875px
over the longest 27-row fixture. Run both distinct actual-platform comparisons:

```sh
rtk proxy devenv shell -- rtk proxy cargo test --locked --offline --manifest-path desktop/gpui/Cargo.toml --features ui-tests --lib chrome::tests::actual_platform_ -- --nocapture --test-threads=1
```
