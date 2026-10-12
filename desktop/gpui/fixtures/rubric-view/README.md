# Retained Rubric presentation evidence

`../rubric/retained-native.json` is deliberately synthetic retained metadata,
not a generated editorial reading. Its enclosing scope is
`original/path/folio:café`; result and live-review row `folioId` values deliberately
name other scopes. The native envelope also retains foreign and legacy data.

`generate-reference.ts` executes the current original TypeScript stamp,
summary and weight helpers into `source-presentation.json`. It demonstrates
initial visible-criterion score 58, typing 2 then increasing to 2.25, raw-score
Board reweighting to 67, and full-report visible-score projection 63 after that
edit. These calculations never replace the stored overall C+/65.

## Original browser evidence

`screenshots/` holds eight unedited original-app frames at 1280×860 and
620×860: Passages, Criteria, expanded configuration and the Galley route.
Only the four task-owned IndexedDB artifact keys for `twyne-gpui-parity` were
seeded from the synthetic fixture. The enclosing metadata key was scoped to
that known test folio; row aliases were preserved. No grading, Ask editors,
Suggest, review-guide, tool, provider, account or anchor action was invoked.
The existing marked Notebook manuscript was not edited.

`browser-metrics.json` retains the actual original DOM rectangles and computed
styles. Some Chrome rectangles belong to offscreen content or descendants of
a closed disclosure; the screenshots establish which content was painted.
The Board frames have the drawer closed, compositor collapsed and Zen off.
The main capture tool's expanded `rubric` preset is a distinct chrome state.
Finite UI transitions were completed for the narrow captures.

The document font set was loaded. Actual CDP platform-font results identify
custom Libre Baskerville for the Galley heading, Lora for its prose and Special
Elite for its labels/date. The application used its original Google stylesheet;
no substitute font was injected.

Measured original seams:

| Surface / control | Original measurement |
| --- | --- |
| 1280 Board | x817, y162.8125, width463 |
| 620 Board | x173, y156.5625, width447 |
| 1280 verdict | y200.8125, height191.28125 |
| Board tabs | 11px Special Elite, line16.5px, tracking1.32px, height34.5px |
| Board summary | 14px Lora italic, line22.4px |
| Grade again | 12px DM Sans600, line16px, padding7.2px14.4px, height32.375px |
| Disabled Grade again | Same opacity1, color, border, cursor:pointer and bounds |
| Galley heading | x152/y51 wide, x24/y51 narrow; 28px Libre Baskerville700/42px |
| Galley Back, wide | 12px Libre Baskerville600/17.1429px, height33.515625px |
| Grade impressions | 88px Board / 144px Galley, original C+ mask, -2deg rotation |
| Enabled checkbox | 14×14px |
| Weight control | width105.59375px, height28.796875px; 12px Special Elite input/18px |

The temporary disabled attribute was restored immediately. The four seeded
Rubric keys were restored by a completed transaction before reference reload.
That reload encountered a repeated module-import/bridge failure. Resetting only
session4 recovered a responsive, empty test namespace. The read-back in
`browser-restoration.json` confirms the four keys absent there; it does not
independently confirm the prior namespace. No browser-wide cache/cookie clear,
browser kill/restart or server change was used.

## Native gates and limits

Eight mounted Rubric checks pass: real local toggle and step clicks, final
unblurred weight capture, physical backup-write failure/retry with exact ACK,
retained focused input across idle ACK/continued typing, per-scope custom forms
filed only by Add, immutable spine and raw/foreign retention, malformed/missing
artifacts, passage order/repeated quotes/no anchor inference, packaged mask
bytes and first-frame resize/read-only Galley navigation. Scoped rustfmt and
strict all-target `ui-tests` Clippy pass. Root separately reports ten actual
X11 host workflow checks with final weight3 durable and clean exit0 after its
background host tasks stopped retaining strong view handles.

The requested Grade-again label/icon correction now matches its measured
Source typography. Offline grading remains disabled. The fallback status uses
the neutral original sentence “Your draft is saved as usual.”; actual supplied
review status takes precedence and existing retained findings carry the prior-
reading warning.

Pixel parity is not established. Compared with the host driver's initial
Board frame, the weakest-line label still uses uppercase native chrome and
the Work link is centered instead of the original normal-case left alignment.
Native Possible ratings disclosures are centered in the full report. Narrow
Galley header shrink/wrap and checkbox/stepper geometry remain approximate.
The native driver's Galley frame was captured after local weight edits
(63 weighted score) and while context/date were unresolved; the original
baseline frame shows58 plus its stale warning/date, so those frames cannot
establish equal vertical geometry. Grade-mask sampling also has only byte/
alpha and mounted proof, not a pixel-equivalence claim.

Connected grading, automatic live review, provider reasoning, tools, guidance
routes and anchor navigation remain capability-gated. No manuscript backup
coverage or fabricated active review is claimed.
