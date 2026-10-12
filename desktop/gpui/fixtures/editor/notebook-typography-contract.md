# Notebook typography evidence

The exact 1,077-byte authored fixture is
`fixtures/marginalia/browser-manuscript.html`. The independent diagnostics use
the original editor CSS/extensions, original Lora 3.008 variable font in Chrome,
and the native registered 3.008-derived UI faces. They preserve all HTML, scalar
offsets, selection commands and history; selection is used only to measure the
already shaped native caret positions.

## Illuminated initial geometry

`src/global.css:827–839` specifies sizes 3em, 4.2em and 5.5em. At the original
18px body size these are 54, 75.6 and 99px. The rendered artwork is 1.16em square
with margins 0.035em 0.14em 0.02em 0. The native view now keeps these values as
`f32`, including the top/bottom float extent, instead of rounding medium to 76.
The Root settings bridge supplies the same three exact presets. Drop-cap mode
retains its existing separate width/extent factors.

This resolves the measured wide first-paragraph split. At a 704px page width:

| Measurement | Original Chrome | Native before | Native after |
| --- | ---: | ---: | ---: |
| Medium initial size | 75.6px | 76px | 75.6px |
| Float inset | 98.265625px | 98.8px | 98.28px |
| Remaining row width | 605.734375px | 605.2px | 605.72px |
| Full row prefix through `remem‐` | 605.282105px | 605.285950px | 605.285950px |
| Row 2 / row 3 | `remem-` / `ber` | `re-` / `member` | `remem-` / `ber` |

The dictionary already provided both break positions (`re`, `mem`, `ber`). The
longer prefix exceeded the old native reservation by about 0.086px; it fits the
correct source reservation. The prefix widths differ by only 0.004px, so this
case did not require a font, dictionary or guessed spacing adjustment. Chrome
retains 1/64px CSS layout precision, accounting for the small inset difference.

The actual X11 diagnostic also checks the 554px opening rows against the retained
original behavior: `…a coat`, `pocket. By…softened and`, `…shape of a`, `hand.`.
Those rows and all other native paragraph rows are unchanged by this correction.
HTML, revision zero and empty undo history are checked at the diagnostic boundary.
Root's assembled room screenshots provide the final visual comparison; the
diagnostic reports measured rendering and does not claim whole-UI pixel parity.

## Separate remaining differences

The owned browser has no English hyphenation dictionary. Its canvas width and
DOM geometry measurements are valid, but its unhyphenated `remember`/`after`
rows must not be substituted for the retained actual-app browser break evidence.
The original app's measured 704px row ends `remem-` and resumes `ber`, and the
original app's narrow rows are retained separately by the coordinator.

The initial-only correction left vertical drift unmodified. At the same 40px fixture padding, source H1
content height is 66.390625px versus native 67; first paragraph height is
97.171875px versus native 98; second paragraph is 64.78125px versus native 65.
H2 consequently begins at source y378.4375 versus native y380. The pinned GPUI
`taffy.rs` rounds authored absolute metrics and ceil-snaps measured leaves before
layout, then snaps absolute near/far edges. These fractional text-flow losses
accumulate. A baseline paint offset would conceal the cause and disagree with
hit testing; no such adjustment has been applied. The subsequent approved
fractional-flow implementation now preserves one exact measured frame across
paint/input and rounds only the final outer extent. Its actual X11 H2 is
y378.5 versus source y378.4375 at 704px, and y443.300018 versus source y443.21875
at 554px. See `fractional-text-flow-proposal.md` and
`fractional-text-flow-evidence.json` for the new geometry, wrap-threshold extent
regression gate and remaining fractional metric difference. The old native
before/after-initial reports below are retained as historical measurements.

Source H1 has -0.01em tracking, which the current native H1 does not yet apply.
Libre 24px H2 isolated `Hgjp` advances match, but the complete spaced heading is
about 1.44px wider natively; cross-word shaping remains under investigation.
Actual source `⋮⋮` grips resolve to Noto Sans Math. The native generic fallback
has smaller vertical metrics, so grip raster/placement remains a separate
font-owner seam. None of these gaps is claimed resolved by the float correction.

## Reproducible diagnostics

```sh
rtk proxy bun desktop/gpui/fixtures/editor/capture-notebook-typography.ts
rtk proxy devenv shell -- cargo build --locked --offline --features desktop --example twyne-clipboard-probe --manifest-path desktop/gpui/Cargo.toml
rtk proxy devenv shell -- python3 desktop/gpui/fixtures/editor/check-notebook-typography.py
rtk proxy devenv shell -- cargo test --locked --offline --features ui-tests --lib --manifest-path desktop/gpui/Cargo.toml editor:: -- --test-threads=1
```

The Python driver allocates a new owned Xvfb display and starts a separate native
X11 process for each width; the Rust entry point requires that exact explicit
display and compositor. The browser driver starts a separate ephemeral browser,
serves only the local original initial artwork and blocks all external requests.
No user desktop or profile is accessed. Results default to
`/tmp/twyne-notebook-typography/{native,web}-{704,554}.json`. Native body paragraph
rows include the hidden source initial `T`, while browser visual row text omits
the floated initial; the authored text itself is unchanged in both.

`notebook-typography-evidence.json` retains the six before/after/browser summary
reports, source-font and authored-fixture SHA-256 hashes, the actual original-app
DOM/range provenance, and the coordinator's assembled room captures after the
correction. The evidence explicitly distinguishes the isolated dictionary gap
from the retained actual-app break. Root confirmed both assembled native widths
after the change: `twyne-native-writing-initial-1280.png` and `-620.png`.
