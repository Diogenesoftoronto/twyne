# Original Lora UI face evidence

The actual original application's Google responses are Lora version 3.008.
The earlier native static files are version 3.021. Native UI rendering now uses
four deterministic instances of the existing 3.008 variable source files at
wght 400/700, upright/italic. Source variables and the Typst static font book
retain their original bytes and order. The derived internal family is
`Twyne Body`; canonical HTML/Typst family attrs and font menu labels stay `Lora`.

`../lora-ui-provenance.json` records exact source/output hashes, axes,
FontTools 4.61.1, and original license. The original OFL and a FONTLOG are
embedded. The internal rename follows the original Reserved Font Name and the
[OFL modification guidance](https://openfontlicense.org/how-to-modify-ofl-fonts/).

`native-font-proof.json` uses the actual Linux Cosmic/Swash text system. All
four requested weights/styles select distinct native faces and exactly match
the source-derived glyph IDs and advance units. A separate check confirms the
pinned renderer selects only default coordinates from the original variable
face for both 400 and 700; the static UI instances address that limitation.
`native-cjk-font-proof.json` separately proves the original Droid fallback
after the final Lora-to-native family mapping. Its glyph IDs are read from the
platform shaper, not the private rich-editor runs.

`original-response-comparison.json` reconstructs the owned browser's actual
Google WOFF2 responses. Across 226 shared Latin codepoints, regular 400 and
italic 400 have no advance or decomposed-outline differences from the derived
native faces; regular 400's 141 shared math-subset codepoints also match.
All checked 700 advance units match, but 25 regular Latin outlines, 12 regular
math-subset outlines, and one italic outline differ. The source Google CSS
declares normal 400/500/600 and italic 400/500; checking the 700 axis does not
prove its CSS face-selection/synthesis behavior. Other Lora weights remain
outside this four-face correction.

Matching advance units/outlines is separate from full-run shaping, CSS
matching, line breaks, hinting, and actual native/browser pixels. Integrated
thread paragraph row differences remain visible in Root's capture comparison;
this artifact does not claim complete body-layout parity.

Reproduce from the repository root:

```sh
rtk proxy python3 desktop/gpui/tools/sync-lora-ui.py --check
rtk proxy python3 desktop/gpui/tools/probe-lora-original.py --responses /tmp/twyne-original-web-fonts --output desktop/gpui/assets/lora-ui-evidence/original-response-comparison.json
rtk proxy bun desktop/gpui/tools/sync-assets.ts --check
```

The comparison reads only actual response files already captured by the owned
browser. It never downloads a font, accesses user tabs, or changes source data.
FontTools/Bun are reproduction tools; native UI has no runtime dependency on
them and performs no font generation while typing.
