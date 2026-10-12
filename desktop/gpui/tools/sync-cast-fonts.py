#!/usr/bin/env python3
"""Verify/package the original browser's three Cast symbol fallback faces.

Normal checks use only the packaged files. Optional --liberation, --inter-ttc,
--adwaita inputs reproduce the exact copies and TTC face extraction; no font
download, subsetting, renaming, synthetic weight or outline edit occurs.
Inter's original TTC is identified by hash; only its Regular face is shipped.
"""
import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

import fontTools
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "desktop/gpui/assets"
FONTTOOLS_VERSION = "4.61.1"
GLYPHS = "♠♥♦✦♣"
INTER_TTC_SHA = "ea4e3d9970b9b6b566110a1b0e13635fe235280b83dd2443dcb3faca1e2456ef"
FONTS = [
    {
        "file": "fonts/LiberationSans-Regular.ttf",
        "sha256": "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8",
        "source": "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf",
        "package": "Fedora liberation-sans-fonts, original face Version2.1.5",
        "sourceSha256": "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8",
        "licenseFile": "licenses/cast-liberation-sans-OFL.txt",
        "licenseSha256": "93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b",
        "licenseSource": "/usr/share/licenses/liberation-sans-fonts/LICENSE",
        "copy": "Byte-identical original TTF; no derivation",
    },
    {
        "file": "fonts/Inter-Regular.ttf",
        "sha256": "60bd88b53049e6951bdb056e49ed44b201da650e1f096c10453d961ee378c66d",
        "source": "/nix/store/92yfgbmc9q083waxxg1nq5dncmjfpwfk-inter-4.1/share/fonts/truetype/Inter.ttc#face0",
        "package": "Nix inter4.1; Regular face reports Version4.001/git9221beed3",
        "sourceSha256": INTER_TTC_SHA,
        "licenseFile": "licenses/cast-inter-OFL.txt",
        "licenseSha256": "262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a",
        "licenseSource": "https://raw.githubusercontent.com/rsms/inter/v4.1/LICENSE.txt",
        "copy": "Original TTC face0 extracted to standalone TTF; every source table byte retained except required head.checkSumAdjustment",
    },
    {
        "file": "fonts/AdwaitaMono-Regular.ttf",
        "sha256": "4d3185765317b011b959ad2f6a404cd1e5d542ed13f120d1e8d1f5c7b9c99562",
        "source": "/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Regular.ttf",
        "package": "Fedora adwaita-mono-fonts, original face Version32.4.0",
        "sourceSha256": "4d3185765317b011b959ad2f6a404cd1e5d542ed13f120d1e8d1f5c7b9c99562",
        "licenseFile": "licenses/cast-adwaita-mono-OFL.txt",
        "licenseSha256": "52579dd4ebbda8e5a9d314e395dbfe40de82b4b7b3007ec8458876823af8dddd",
        "licenseSource": "/usr/share/licenses/adwaita-mono-fonts/LICENSE.md",
        "copy": "Byte-identical original TTF; no derivation",
    },
]

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
parser.add_argument("--liberation", type=Path)
parser.add_argument("--inter-ttc", type=Path)
parser.add_argument("--adwaita", type=Path)
args = parser.parse_args()
if fontTools.__version__ != FONTTOOLS_VERSION:
    raise SystemExit(f"Use pinned FontTools{FONTTOOLS_VERSION} for reproducible extraction/checks")

for source, record in [(args.liberation, FONTS[0]), (args.adwaita, FONTS[2])]:
    if source:
        data = source.read_bytes()
        if sha256(data).hexdigest() != record["sourceSha256"]:
            raise SystemExit(f"Original browser Cast font changed: {source}")
        if not args.check:
            (ASSETS / record["file"]).write_bytes(data)

if args.inter_ttc:
    source_data = args.inter_ttc.read_bytes()
    if sha256(source_data).hexdigest() != INTER_TTC_SHA:
        raise SystemExit("Original browser Inter TTC changed")
    source = TTFont(BytesIO(source_data), fontNumber=0, lazy=True,
                    recalcBBoxes=False, recalcTimestamp=False)
    output = BytesIO()
    source.save(output, reorderTables=False)
    data = output.getvalue()
    extracted = TTFont(BytesIO(data), lazy=True)
    if set(source.reader.keys()) != set(extracted.reader.keys()):
        raise SystemExit("Inter standalone extraction changed original table set")
    for table in source.reader.keys():
        original, native = source.reader[table], extracted.reader[table]
        if table == "head":
            original, native = original[:8] + original[12:], native[:8] + native[12:]
        if original != native:
            raise SystemExit(f"Inter standalone extraction changed original table: {table}")
    source.close()
    extracted.close()
    if sha256(data).hexdigest() != FONTS[1]["sha256"]:
        raise SystemExit("Inter TTC extraction is not byte-reproducible")
    if not args.check:
        (ASSETS / FONTS[1]["file"]).write_bytes(data)

records = []
for record in FONTS:
    data = (ASSETS / record["file"]).read_bytes()
    if sha256(data).hexdigest() != record["sha256"]:
        raise SystemExit(f"Restore exact original Cast face: {record['file']}")
    if sha256((ASSETS / record["licenseFile"]).read_bytes()).hexdigest() != record["licenseSha256"]:
        raise SystemExit(f"Restore original Cast OFL notice: {record['licenseFile']}")
    face = TTFont(BytesIO(data), lazy=True)
    cmap = face.getBestCmap()
    test_glyphs = {}
    for text in GLYPHS:
        name = cmap.get(ord(text))
        test_glyphs[text] = None if name is None else {
            "glyphId": face.getGlyphID(name),
            "advanceUnits": face["hmtx"][name][0],
        }
    records.append({**record, "bytes": len(data),
        "family": face["name"].getDebugName(1),
        "postScriptName": face["name"].getDebugName(6),
        "version": face["name"].getDebugName(5),
        "copyright": face["name"].getDebugName(0),
        "weight": face["OS/2"].usWeightClass,
        "style": "normal", "unitsPerEm": face["head"].unitsPerEm,
        "testGlyphs": test_glyphs,
        "tableSha256": {str(table): sha256(face.reader[table]).hexdigest()
                        for table in sorted(face.reader.keys())},
    })
    face.close()

proof = {
    "usage": "Cast symbol controls only, after unchanged DM Sans400 primary",
    "helper": "theme::cast_badge_font()",
    "fallbackOrder": ["Inter", "Liberation Sans", "Adwaita Mono"],
    "fontToolsVersion": FONTTOOLS_VERSION,
    "fonts": records,
    "originalGlyphs": [
        {"text": "♠", "family": "Liberation Sans", "glyphId": 2230, "advanceAt11_2Px": 5.95},
        {"text": "♥", "family": "Inter", "glyphId": 1867, "advanceAt11_2Px": 11.4515625},
        {"text": "♦", "family": "Liberation Sans", "glyphId": 2233, "advanceAt11_2Px": 5.71484375},
        {"text": "✦", "family": "Adwaita Mono", "glyphId": 6836, "advanceAt11_2Px": 6.72},
        {"text": "♣", "family": "Liberation Sans", "glyphId": 2231, "advanceAt11_2Px": 7.35},
    ],
    "browserEvidence": "fixtures/fonts/cast-glyphs/actual-app-fonts.json",
    "sourceCss": "src/components/personas/personas-panel.tsx .cast-icon:11.2px/16.8px in21.6px bordered circle",
    "sourceAndDefaultFamiliesAndTypstUnchanged": True,
    "rasterBoundary": "Exact selected glyph/advance and actual nonzero Linux masks are checked. Chromium hinting/GPU pixels, other OS rendering, and actual assembled Cast painting are separate proof boundaries.",
}
outputs = {
    "cast-font-provenance.json": (json.dumps(proof, ensure_ascii=False, indent=2) + "\n").encode(),
    "licenses/cast-FONTLOG.txt": (
        "Original Cast glyph controls, source symbols ♠ ♥ ♦ ✦ ♣.\n"
        "2026-10-04: Package exact current original-app browser fallback faces:\n"
        "Liberation Sans2.1.5 and Adwaita Mono32.4.0 are byte-identical TTF copies.\n"
        "Inter4.001 Regular is TTC face0 extracted with FontTools4.61.1, preserving\n"
        "every original table byte except required standalone head.checkSumAdjustment.\n"
        "No glyph, outline, advance, hint, weight, name or source-symbol modification.\n"
        "Original OFL/copyright notices accompany all three faces.\n"
        "Use only the cached Cast fallback after DM Sans400. No global fallback,\n"
        "Source, canonical document attribute or Typst fontbook change.\n"
    ).encode(),
}
for name, data in outputs.items():
    path = ASSETS / name
    if args.check:
        if path.read_bytes() != data:
            raise SystemExit(f"Stale Cast font provenance: {path}")
    else:
        path.write_bytes(data)
print("Verified" if args.check else "Packaged", "exact original Cast fallbacks and notices")
