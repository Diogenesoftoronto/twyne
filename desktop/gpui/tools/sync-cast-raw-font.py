#!/usr/bin/env python3
"""Verify/copy the original Manager raw Cast glyphs' Liberation Serif Bold.

Normal checks use packaged bytes; optional --source accepts only the exact
original file. No font download, transformation or global fallback change.
"""
import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "desktop/gpui/assets"
FONT_FILE = "fonts/LiberationSerif-Bold.ttf"
FONT_SHA = "d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce"
LICENSE_FILE = "licenses/cast-raw-liberation-serif-OFL.txt"
LICENSE_SHA = "93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
parser.add_argument("--source", type=Path)
args = parser.parse_args()
if args.source:
    data = args.source.read_bytes()
    if sha256(data).hexdigest() != FONT_SHA:
        raise SystemExit("Original browser's Liberation Serif Bold changed")
    if not args.check:
        (ASSETS / FONT_FILE).write_bytes(data)
for name, expected in [(FONT_FILE, FONT_SHA), (LICENSE_FILE, LICENSE_SHA)]:
    if sha256((ASSETS / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f"Restore exact original Manager glyph face/notice: {name}")
data = (ASSETS / FONT_FILE).read_bytes()
face = TTFont(BytesIO(data))
cmap = face.getBestCmap()
test_glyphs = {}
for text in "♠♥♦✦♣":
    name = cmap.get(ord(text))
    test_glyphs[text] = None if name is None else {
        "glyphId": face.getGlyphID(name), "advanceUnits": face["hmtx"][name][0],
    }
proof = {
    "usage": "Original Manager assistance raw symbol spans only; Libre Baskerville 16px/24px at 600/normal",
    "helper": "theme::cast_raw_glyph_font()",
    "fallbackOrder": ["Liberation Serif", "Adwaita Mono"],
    "file": FONT_FILE, "sha256": FONT_SHA, "sourceSha256": FONT_SHA, "bytes": len(data),
    "source": "/usr/share/fonts/liberation-serif-fonts/LiberationSerif-Bold.ttf",
    "package": "Fedora liberation-serif-fonts; actual face Version 2.1.5",
    "family": face["name"].getDebugName(1),
    "postScriptName": face["name"].getDebugName(6), "version": face["name"].getDebugName(5),
    "copyright": face["name"].getDebugName(0), "weight": face["OS/2"].usWeightClass,
    "style": "normal", "unitsPerEm": face["head"].unitsPerEm,
    "licenseFile": LICENSE_FILE, "licenseSha256": LICENSE_SHA,
    "licenseSource": "/usr/share/licenses/liberation-serif-fonts/LICENSE",
    "testGlyphs": test_glyphs,
    "originalGlyphs": [
        {"text": "♠", "family": "Liberation Serif", "glyphId": 2223, "advanceAt16Px": 8.5, "browserDomAdvancePx": 8.5},
        {"text": "♥", "family": "Liberation Serif", "glyphId": 2225, "advanceAt16Px": 9.5, "browserDomAdvancePx": 9.5},
        {"text": "♦", "family": "Liberation Serif", "glyphId": 2226, "advanceAt16Px": 8.1640625, "browserDomAdvancePx": 8.171875},
        {"text": "✦", "family": "Adwaita Mono", "glyphId": 6836, "advanceAt16Px": 9.6, "browserDomAdvancePx": 9.609375},
        {"text": "♣", "family": "Liberation Serif", "glyphId": 2224, "advanceAt16Px": 10.5, "browserDomAdvancePx": 10.5},
    ],
    "reusedFont": {"file": "fonts/AdwaitaMono-Regular.ttf", "sha256": "4d3185765317b011b959ad2f6a404cd1e5d542ed13f120d1e8d1f5c7b9c99562"},
    "browserEvidence": "fixtures/cast/browser-manager-raw-glyphs.json",
    "copy": "Byte-identical original TTF; no derivation",
    "badgeChainSourceDefaultAndTypstUnchanged": True,
    "rasterBoundary": "Original requested600 selects Bold700 for suits and Regular400 for star. Exact face/glyph/advance and nonzero Linux masks are verified separately from Chromium synthesis/hinting/GPU pixels and other OS rendering.",
}
face.close()
outputs = {
    "cast-raw-font-provenance.json": (json.dumps(proof, ensure_ascii=False, indent=2) + "\n").encode(),
    "licenses/cast-raw-FONTLOG.txt": (
        "Original Manager assistance raw Cast glyph spans, source symbols ♠ ♥ ♦ ✦ ♣.\n"
        "2026-10-04: Package byte-identical Liberation Serif Bold 2.1.5 and its\n"
        "original SIL OFL/copyright notice. Reuse existing Adwaita Mono for ✦.\n"
        "No outline, advance, hint, weight, family, source-symbol or source-attr edits.\n"
        "Apply only to raw Manager spans at original16px/24px600; circular DM Sans\n"
        "badges, Lora card headings, shared fallback and Typst fontbook stay unchanged.\n"
    ).encode(),
}
for name, data in outputs.items():
    path = ASSETS / name
    if args.check:
        if path.read_bytes() != data:
            raise SystemExit(f"Stale raw Cast font provenance: {path}")
    else:
        path.write_bytes(data)
print("Verified" if args.check else "Packaged", "exact original raw Cast Manager glyph face")
