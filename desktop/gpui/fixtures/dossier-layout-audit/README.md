# Dossier layout audit

Read-only audit of the current original form and native form, using retained
receipts. No native/browser process, server, network request, Cargo or Devenv
was run. Existing runtime, vendor and Source files were not edited. The overall
port and Dossier pixel parity remain unfinished.

[audit.json](audit.json) pins the inspected declarations and retained artifacts,
separates measurements from calculations, and includes the exact selected
observations. [parent-probes.json](parent-probes.json) is an **unexecuted** focused
measurement plan. [source-probe.js](source-probe.js) is an **unexecuted**, read-only
DOM collector for a Parent-owned anonymous fixture. It neither opens a browser
nor changes its page, inputs, theme, viewport or scroll position.

The actual-page evidence is the retained original `source-dossier-1280.png`,
`source-dossier-boxes.json` and `source-dossier-audience-textarea.json`. The
native evidence is the immutable paper build's title/Audience screenshots and
geometry, plus the later stamp workflow geometry. The latter passed eleven
actual input/filing/recovery/clean-exit checks; it did **not** check every frame's
centering or pixel parity. These builds are historical checkpoints, not the
current running application. Source and native JSON do not record DPR. A PNG's
physical size does not establish DPR.

The Nightpress/Broadsheet images in `../dossier-paper/raster/` are standalone
Librsvg CSS-layer projections, as their receipt states. They are not original
or native full-form layout captures. There is no retained measured narrow,
wide-above-cap, low-height or theme/DPR-transition layout proof in this audit.

## Concrete remaining differences

| Priority | Original contract | Native checkpoint | Evidence and consequence |
|---|---|---|---|
| 1 | A sheet change is naturally laid out before paint; `.folio-shift` adds only the specified feed animation. | Centering depends on two values learned during paint, with question height qualified by step alone. | Later stamp workflow's `roman-3-geometry.json` has question y 435/h 224 and lower ghost y 974, offscreen; its settled `live-geometry-1.json` has y 323/h 224 and ghost y 750. Both have the same y 84/h 702 sheet. The formula exactly explains the 112px question shift when the missing height changes from 0 to 224. This is an observed intermediate frame, not a persistent settled defect. Resize/content changes can likewise use an old height; their exact transient frames are unobserved. |
| 1 | Outer wrapper is centered, `max-w-[92rem]`, with 12px gutters below 640 and 20px gutters from 640; vertical gutters 12/16. | Root has no width cap/centering, and always 20px horizontal/16px vertical padding. | Declaration-derived: at 620×860 original frame x 12/y 12/w 596/h 836; native x 20/y 16/w 580/h 828. At 1600×860 original x 84/w 1432; native x 20/w 1560. Both agree at 1280. Do not change the paper background's full-viewport coordinate system when adding the bounded inner wrapper. |
| 1 | Two leaves begin at 1024. Below it, the original remains a grid with implicit **auto** row sizing. | Below 1024 the native container becomes a flex column and assigns the left leaf a 220px height. | The 220px value has no original declaration or measured row-height receipt. It also retains default flex shrink with min-height 0, so its used height may shrink under a short viewport. The original implicit row algorithm must be measured; replacing 220 with another fixed value or claiming equal halves would be unsupported. |
| 1 | Preview cards become two columns at 640; below 640 they are one column. Header hides `Surface:` below 640. Department truncates, while its folio counter stays unshrunk. Footer nav is min-width 0, horizontally scrollable; individual numerals and edge buttons do not shrink. | Cards always use two columns; `Surface:` is always drawn. Department/counter are untruncated tracked runs. Roman rail has min-width 0 but no horizontal scroll/overflow mask, and edge/numeral buttons have no explicit shrink 0. | Declaration mismatch; actual collisions, clipped scroll extent and hit targets at 320/620 are pending. Keep actual native controls and focus; do not compress fonts or omit numerals to fit. |
| 1 | Frame and leaf grid both have `overflow-hidden`; scroll is owned by the two `folio-column` frames. | Native frame and leaf row have no overflow mask. Only the central question leaf explicitly clips. | Under short-height pressure, chrome/footer/left content may escape the inset frame even if the outer application clips at the viewport. This is a declaration-derived risk, not a captured low-height defect. Any future multiply subtree must retain the same Source frame clipping. |
| 2 | The original title's tracking is−0.015em (−0.276px at 18.4px). CSS-derived card label/value heights quantize to 13.1875/16.40625px, consistent with the retained card bounds. | Title has no tracking. Normal GPUI text rounds the 12.16×1.35 value line height to 16px. | Retained original first card h 45.59375 vs native observed 45; two-line Audience h 62 vs native 61. Source y 167.984375 vs native 167 for that next row. This gradually compresses the preview. Whole native pixel bounds and custom tracked label height also contribute; this is not a claim that the font files differ. Source question width 366.46875 vs native observed 368 is a separate unqualified shaping/snapping difference. |
| 2 | Single-line answer uses `text-lg`:18px, line 28px, vertical padding 8px, border-bottom 2px. The preview masthead separately uses 18.4px. | Single-line input requests 18.4px with a 45.6px frame constraint. | Declaration mismatch at `anti-tabula-rasa.tsx:895–896` / `dossier_view.rs:1301–1319`. The native 46px observed input bounds and 132px group agree with the original total group height; that agreement does not establish the input's font size/advance. The retained Source input computed font size is not recorded, so measure it before a local correction. |
| 2 | The active preview value is unclamped and includes a 0.45em caret with 0.1em left margin. Inactive values are clamped to three lines and have `break-words`. | Active value is limited to a 500-scalar prefix and no caret is added. Inactive values use native line clamp without an explicitly equivalent CSS break policy. | Long active answers can produce a shorter left scroll extent; the native data itself is not truncated by this preview. A bounded cached layout/projection can preserve typing cost while retaining the actual answer. Long Latin tokens and exact clamp behavior need an actual comparison; no unprobed wrap mismatch is asserted. |
| 2 | `.folio` uses paper-soft and three inset/drop shadows. Top strip mixes paper-2 at 70% over that background. Footer mixes paper-2 at 50% over the right paper. | Frame uses paper without the folio shadows; top strip mixes over paper. Footer is opaque paper-2. | Retained screenshots at the empty header pixel 400,30: original[240,230,207], native[238,228,205]. This supports the different underlying fill; texture/raster is not certified. Footer/back-button samples and exact bytes are retained in audit.json. Colors change across presets without changing layout rules. |
| 2 | Back button requests actual DM Sans 12px 600; its CSS-derived border-box height is 34.375px (18px line +2×7.1875px padding +2px border). Back disabled state fades the whole button to 0.3. | Local `paper_button` uses shared DM Sans 600 with a fixed 32px height. Native scope already has an approved original opsz 12/wght 600 `BUTTON_FONT`, but this helper does not use it. | The captured Back button is 32px tall. Selected native 600 face/disabled final opacity should be measured before a font change; registering only 400/700 in the shared family is insufficient selected-face proof. These are local Dossier chrome changes, not a reason to alter global SANS or Typst. |
| 2 | Filing outlines/scales the existing frame; successful saved feedback is an absolute, pointer-neutral overlay and does not consume layout height. Storage/submit failures are overlays outside the frame. | Busy state disables controls but has no corresponding frame transform/style. `Filed` adds a normal-flow status child; errors add normal-flow strips. | Declaration difference in success/error geometry. The app normally exits after accepted filing, so whether the normal-flow saved strip is painted needs a Parent receipt; do not claim it was observed. Source acknowledgement/owner guards must remain unchanged. |

Source pointers:

- `src/components/onboarding/dossier-folio.tsx:54–92`: viewport, capped wrapper,
  frame/grid masks, responsive leaves and saved overlay.
- `src/components/onboarding/dossier-top-bar.tsx:62–128`: shrink 0 header,
  responsive surface label and controls.
- `src/components/onboarding/anti-tabula-rasa.tsx:780–860,1092–1129,1165–1195`:
  department, centered sheet, ghost margins and horizontal rail.
- `src/components/brief/dossier-preview.tsx:82–114,164–239`: title tracking,
  shrink 0 stamp, responsive cards, clamp, wrapping and active caret.
- `src/global.css:583–589,699–707,1937–1993,5860–5990,6030–6097`:
  type metrics, folio/button/filer styles, animation, scrollbars and reduced motion.
- Native `src/dossier_view.rs:1005–1145,1784–1962,1995–2014,2032–2372` and
  `vendor/gpui-pre/src/style.rs:553–556` supply the compared declarations.

## Limits at theme, scale and viewport changes

The original Editorial, Nightpress and Broadsheet blocks change colors and
texture tokens, not these Dossier sizes, breakpoints or font families
(`src/global.css:16–66,240–310`). Broadsheet disables body grain and foxing,
but `.paper-sheet` still has its ink stripes/dots. The native palette contains
the same inspected core tokens. Existing paper/stamp/multiply and atlas work
has its own acceptance boundary; this audit does not reopen or certify it.

`DossierPaperMetrics` accepts CSS dimensions 1..4096 and scale 0.5..4, then caps
the prepared raster at 8,388,608 pixels/8192 per dimension. At 1280×860, DPR 2
passes and DPR 3 fails. At 1920×1080/DPR 2 it passes; at 2560×1440/DPR 2 it fails.
Those are calculations, not device runs. `prepare_paper` drops the failed
preparation and retains the plain root paper color. Paint refuses a stale
size/theme/scale instead of stretching it. Source CSS has no corresponding
raster cap. This gap affects texture coverage, not the declared frame size.
Parent should record a truthful fallback before considering bounded tiling or
another Source-derived preparation; a larger unbounded cache is not a remedy.

Constructor/window-bounds/palette observers prepare images, not typing/paint.
Question layout is separately measured in paint and currently does not carry
width, viewport/DPR, content or visit identity in its measurement key. Theme
changes have identical declared geometry but may still coincide with a resize
or content update. Cached measurements must not restore a retired question or
move focus after close/reopen. The production owner/filing/renderer epoch
guards remain outside this audit and must be preserved.

## Bounded Parent follow-up

First measure the original implicit rows at 620 and 1023; do not implement the
native 220px replacement on a guess. Then a Source-backed presentation patch
can add the cap/gutters,640px card/header branches, explicit shrink/scroll and
frame masks without changing form state, source or history. Resolve centering
with same-pass measured child geometry (a retained Element with layout then
prepaint), not more nested paint updates or a second explicit Window draw.
If the exact CSS auto-row algorithm needs a framework seam, send that smallest
layout seam for separate review.

The probe plan checks title/Audience/long Particulars,640/1024 boundaries,
above-cap and short viewports, blank padding focus, real rail scrolling and
first-frame→settled bounds on navigation/resize/reopen. It independently checks
exact raw input, recovery identity, canonical bytes and qualified filing state.
It includes theme/DPR failures as explicit fallback observations. Existing
eleven-check durable filing acceptance must be rerun after an eventual patch;
neither that run nor any new visual run was performed by this audit.

Run the retained evidence/derived arithmetic check only:

```bash
rtk proxy python 3 desktop/gpui/fixtures/dossier-layout-audit/inspect.py --check
```

This checks artifacts and calculations; it does not run the application or
establish renderer/browser parity.
