# Original Marginalia reference, 2026-10-04

The isolated owned Playwriter session4 uses the original app at
`http://localhost:5180/editor/`, viewport1280×860. It has no personal account.
HTTP traffic is allowed only to localhost and the public Google Fonts origins
declared by original `src/root.tsx`; auth/provider/sync/analytics and external
WebSockets are blocked. Parent's owned session3 was not touched.

The fixture folio ID is `twyne-gpui-parity`. Actual original UI operations placed
the following marks, filed the first reply, and struck the second note:

| ID | Anchor | Filed material |
| --- | --- | --- |
| `ee1a4fcc-a91b-4be9-8063-116e211e4496` | `small enough to carry in a coat pocket.` | `Keep the opening concrete.\n\nThe notebook should feel **handled**, not described.`; reply `You can keep the softened corners.` |
| `a2e634dd-4ca5-4963-b145-e787ab4bab0c` | `Let the change in the room carry the ending.` | `The ending can stay in the room.`; resolved |

Browser selection supplied actual ranges to the original Add margin action.
Its advertised Meta+Enter action placed notes/replies; the original Board's
Strike button resolved note2. There was no direct store mutation for notes,
fake mark construction, persona request, audio playback or connected success.
The first in-flight Board overlay had stale Qwik class/ARIA attributes and
intercepted pointer clicks; actual keyboard placement worked. Reloading the
saved original removed those transient attributes before final measurements.

`export-browser.js` reads the actual DOM and saved folio-content snapshot and
exports a read-only copy of the persisted Lix blob to `/tmp`.
`export-comments.ts` opens that copy with the installed original Lix SDK and
reads its `/user-comments.json`. The fixture arrays/HTML are those exact saved
values; the source snapshot is retained without conversion. Native capture
imports the saved HTML and explicitly remaps this one foreign scope to its new
native folio copy. Raw DOM contains decorative/transient ProseMirror widgets
and is available separately; it is not regenerated canonical material.

Final original references are `/tmp/twyne-reference-marginalia-populated.png`
(drawer and Board open), `/tmp/twyne-reference-margin-thread.png` and
`/tmp/twyne-reference-margin-composer.png` (Board and drawer closed). Composer
selects the heading `The notebook`, matching the native capture's0..12 range.

| Context | Actual computed original type |
| --- | --- |
| Board instructions | DM Sans14px/22.4px |
| Board author / anchor quote | Libre Baskerville or Lora12px/16px |
| Board note / reply Markdown | Lora14px/22.4px, subsequent paragraphs top margin6.3px |
| Board struck plain text | Lora14px/20px |
| Board date | Special Elite11px/16.5px, tracking1.65px |
| Board reply textarea | Lora12px/16px, padding6px8px, height137.6px at860 |
| Inline note Markdown | Lora15.2px/24px, outer top margin12px, following paragraphs6.84px |
| Inline reply Markdown | Lora13.6px/20px, outer top margin2px, following paragraphs6.12px |
| Inline textarea | Lora13px/19.5px, padding10px12px; reply88px, composer119.5px |
| Resolve / Erase / Discard | DM Sans12px600/18px, padding7.2px14.4px, normal tracking |
| Reply / Place note | Special Elite11.2px400/16.8px, uppercase tracking2.016px, padding8.8px16px |

Real-font button dimensions are Resolve75.219×36.391,
Erase62.969×36.391, Reply77.563×36.391,
Discard75.188×36.391 and Place note117.875×36.391.
Disabled press buttons have actual opacity.4. Real-font thread card is
x12y368w340h451 (constrained by viewport); composer x12y335w340h346.
Board pending card x829y377w439h195. H1 is computed40px/44px, body18px/32.4px.
Typeface/version changes affect wraps; these values are observations, not
invented geometry for native tests.

`measure-board.js`, `measure-composer.js`, and `measure-masthead.js` read the
actual original UI without filing or mutating comments. Their JSON artifacts
retain unrounded rectangles and computed styles. The composer remains empty
and unplaced; Discard closes it after capture.

| Original composer part | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| Card | 12 | 334.59375 | 340 | 346.390625 |
| Head | 14 | 336.59375 | 336 | 69 |
| Body | 14 | 405.59375 | 336 | 273.390625 |
| Quote | 30 | 421.59375 | 304 | 45.5 |
| Composer | 30 | 479.09375 | 304 | 183.890625 |
| Textarea | 30 | 492.09375 | 304 | 119.5 |
| Actions | 30 | 626.59375 | 304 | 36.390625 |

The original textarea is `inline-block` with baseline alignment. Its bottom
is 15px above the actions: an 8px action margin plus a 7px baseline gap. The
reply thread has the same gap, with its 88px textarea ending at y760.375 and
actions beginning at y775.375. Thread body overflow is real at this viewport;
its card height is constrained by the original placement calculation.

The original masthead is 112px high with both sidebars closed and 142px high
with both open. At the narrow 528px central width, the department and dateline
wrap to two 15px lines, and Create dossier wraps to a 52.375px button. This is
natural flex/text sizing, not a separate fixed-height design. The
`browser-masthead-two-sidebars.json` artifact includes the drawer, File,
account and Board controls. Wordmark bounds include the source's animated
ink effect, so their small fractional variation is not a layout target.

An earlier native Board capture had a pending card at y374 with height188,
compared with the original y377.09375 and height194.96875. The
source author/date baseline row is 18.5px high, with the date beginning 2px
below the author. That evidence is retained separately from native font
shaping and Markdown rendering. Owned corrections removed an empty status
text row, aligned the jump quotation at the card's left inset, and replaced
per-character flex spacing with the shared whole-run tracked-font painter.
The author/date row also uses the observed 2px baseline offset because GPUI's
measured layout nodes do not expose browser font baselines to its flex layout.
The subsequent Root captures include this correction, original source Lora,
and the cumulative Board tab-row rounding/shadow: outer panel content now starts
at163px in both, while the pending card remains approximately native375/192
versus original377/195. This inner paragraph/reply rounding gap is retained;
exact pixel parity is not claimed from the interaction gates. Ten core tests, eight mounted interaction
tests and strict all-target Clippy pass with the stable owned code.

Separate current-font writing references are
`/tmp/twyne-reference-quiet-original-fonts.png` (Zen off) and
`/tmp/twyne-reference-zen-original-fonts.png` (Zen on), both with compositor and
sidebars closed. `capture-writing.js` verifies that the original saved HTML
still equals the exact 1077-byte exported fixture and captures fresh CDP
resolved-font evidence in `browser-writing-font-proof.json` and
`browser-zen-font-proof.json`. Libre Baskerville and Lora are custom loaded
source fonts in both; the single additional Adwaita Mono glyph in H1 is its
source ornament, while the stored H1 remains `<h1>The notebook</h1>`.

Zen-off H1 is x289 y238.59375 w704 h66.390625, including the ornament; Zen-on
H1 is x87.390625 y105 w1107.21875 h66.390625. Actual H1 typography is 40/44 and
body 18/32.4. Zen hides the masthead, ruler, frame, comment highlights and
margin surface. The Zen-off original also renders a real From the margin
preview from this fixture's retained scoped writer note; no comment metadata
or marks were removed to simplify the screenshot. That preview is supplied
by the offline comment producer in FlowConductor and rendered by FlowSurface,
separate from the active-tool MarginRails shelf.

An initial all-external-network block also blocked Google Fonts. Although
computed family names and `document.fonts.check` looked correct, CDP proved
Liberation Serif fallback. Those early screenshots cannot prove typography.
Final references were regenerated after authorized public source font loading;
CDP confirms custom Libre Baskerville and Lora. `browser-font-proof.json`
records received original font versions and bundled native files: source
Lora3.008 matches the bundled variable Lora3.008, while the then-current native
static Lora3.021 differs. Libre2.005, DM Sans4.004 and Special Elite1.001 match
base versions; hinting/static/optical-size differences remain separate proof.
Font assets/theme are outside this slice's ownership.

The new writer-note renderer's source measurements are retained in
`browser-rail-metrics.json`: the original quiet preview is x964 y635.640625,
300×179.359375, Lora13.44/20.16 with the original10.4/12/9.6 padding,
7.2 gap and top3/side1/bottom1 borders. The native actual GPU captures now place
the same300px preview at x964 (1280-wide) and x304 (620-wide), with matching
body/reply wording and line wrap. Final Source purple top-border pixels are
wide636–638 and narrow632–634; native final pixels are wide637–639 and
narrow633–635, all exact rgb(127,69,96). The previous inset-child stripe at
native cardtop+3 and the subsequently masked negative child are superseded by
the final borderless-wrapper paint. Content/outer height remained intact.
The remaining approximately1px vertical/rounding gap is recorded, not tuned
away through arbitrary font changes or described as exact pixel parity.

Seven source-derived core and five mounted native rail tests pass, including
actual hover/Tab+Enter, Open, Set aside/recall, More/Fewer, transparent background
and card-local pointer handling, capability/foreign/quiet guards, exact measured
outer-border reservation, and retained raw body/cache data across geometry
updates. Final all-targets ui-tests strict Clippy passes. `RAIL-CONTRACT.md`
distinguishes ambient enabled flags, explicit peeks and initial Rail admission
from an already-open thread following a Dock slot after resize.

`browser-grip-font-proof.json` separately records read-only1280/620 original
DOM grip geometry for the Rich owner. The source `⋮⋮` resolves through CDP to
system Noto Sans Math, not the computed Lora family: both glyphs occupy an8×23
DOM range beginning4px below the18/32.4 grip box, with0.55 opacity. The viewport
was restored to1280 afterward. This font finding does not rewrite stored source
or imply that all native fallback glyphs have visual parity.

`check-rail-browser.js` exercises the actual original Dock preview after the
owned fixture is settled: hover moves y635.640625 to634.640625 and reveals the
previously invisible close control; Set aside removes the preview.
`browser-rail-interaction.json` contains these actual observations. The saved
1077-byte marked manuscript remains identical, and `verify-rail-comments.ts`
opens a read-only exported post-interaction Lix copy and proves that both flat
comments, their reply, resolved state and unknown fields remain identical.
Dock has no initial rail reservation handshake; actual Rail recall/thread
geometry is covered separately by native mounted and Root editor integration
checks. The browser was reloaded afterward to restore its transient preview.
