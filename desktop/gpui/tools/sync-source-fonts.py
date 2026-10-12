#!/usr/bin/env python3
"""Reproduce Source-only Noto Mono 2.014 faces and the browser's quarter shear.

The originals are exact files selected by the original app's current Linux
browser. Reproduction is offline from those packaged OFL originals. Native
UI family names avoid changing canonical/source/code/Typst font families.
FontTools 4.61.1 is a build-time reproduction tool, never a runtime dependency.
"""
import argparse
from hashlib import sha256
from io import BytesIO
import json
from math import atan, degrees
from pathlib import Path

import fontTools
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ASSETS = Path(__file__).resolve().parents[1] / "assets"
FAMILY = "Twyne Source"
ORIGINALS = {
    "Regular": ("fonts/source/NotoSansMono-Regular.ttf", "65b5e2b2c4a1fba9ae8be1f026cb35b03dcb8886d9b2a4147054fde12f7e767d", 400),
    "SemiBold": ("fonts/source/NotoSansMono-SemiBold.ttf", "82e49094ec3a1a3c8fa0d730016f5f890384f6e164dd2cc84f39b30639bb6e8f", 600),
}
LICENSE = "licenses/source-mono-OFL.txt"
LICENSE_SHA = "cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if fontTools.__version__ != "4.61.1":
    raise SystemExit("Reproduction requires FontTools 4.61.1")
license_bytes = (ASSETS / LICENSE).read_bytes()
if sha256(license_bytes).hexdigest() != LICENSE_SHA:
    raise SystemExit("Packaged original Noto OFL notice changed")


def renamed(font, style, weight):
    names = {
        1: FAMILY, 2: style, 3: f"TwyneSource-{style};Noto2.014",
        4: f"{FAMILY} {style}", 6: f"TwyneSource-{style}",
        16: FAMILY, 17: style, 18: f"{FAMILY} {style}",
    }
    for record in list(font["name"].names):
        if record.nameID in names:
            font["name"].setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
    for platform_id, encoding_id, language_id in [(3, 1, 0x409), (1, 0, 0)]:
        for identifier, value in names.items():
            font["name"].setName(value, identifier, platform_id, encoding_id, language_id)
    font["OS/2"].usWeightClass = weight
    font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~((1 << 0) | (1 << 5) | (1 << 6))) | (1 << (0 if style == "Oblique" else 6))
    font["head"].macStyle = (font["head"].macStyle & ~3) | (2 if style == "Oblique" else 0)
    font.recalcTimestamp = False
    return font


outputs, originals, faces = {}, {}, []
for style, (path, expected, weight) in ORIGINALS.items():
    data = (ASSETS / path).read_bytes()
    if sha256(data).hexdigest() != expected:
        raise SystemExit(f"Original browser-selected Source face changed: {path}")
    original = TTFont(BytesIO(data), recalcTimestamp=False)
    if not original["name"].getDebugName(5).startswith("Version 2.014"):
        raise ValueError("Expected original Noto Sans Mono 2.014")
    originals[style] = (original, data)

for style in ["Regular", "SemiBold", "Oblique"]:
    base_style = "Regular" if style == "Oblique" else style
    original, original_bytes = originals[base_style]
    source_path, source_hash, weight = ORIGINALS[base_style]
    font = renamed(TTFont(BytesIO(original_bytes), recalcTimestamp=False), style, weight)
    if style == "Oblique":
        # Chromium synthetic italic uses SkFont.skewX = -1/4 in downward Y.
        # TrueType upward-Y outlines therefore use x' = x + y/4. Decomposing
        # composites avoids double-transforming their already sheared children.
        glyph_set = original.getGlyphSet()
        for name in original.getGlyphOrder():
            recording = DecomposingRecordingPen(glyph_set)
            glyph_set[name].draw(recording)
            pen = TTGlyphPen(None)
            recording.replay(TransformPen(pen, (1, 0, .25, 1, 0, 0)))
            glyph = pen.glyph()
            font["glyf"][name] = glyph
            glyph.recalcBounds(font["glyf"])
            advance = original["hmtx"].metrics[name][0]
            font["hmtx"].metrics[name] = (advance, getattr(glyph, "xMin", 0))
        # Original autohint instructions target unsheared outlines. Removing
        # them is explicit: this outline adapter still needs real raster proof.
        for table in ["cvt ", "fpgm", "prep", "hdmx", "LTSH", "VDMX"]:
            if table in font:
                del font[table]
        font["post"].italicAngle = -degrees(atan(.25))
        font["hhea"].caretSlopeRise, font["hhea"].caretSlopeRun = 4, 1
        font["maxp"].maxSizeOfInstructions = 0
    if font.getGlyphOrder() != original.getGlyphOrder():
        raise ValueError("Source glyph order/IDs changed")
    if any(font["hmtx"].metrics[g][0] != original["hmtx"].metrics[g][0] for g in original.getGlyphOrder()):
        raise ValueError("Source advances changed")
    if style != "Oblique":
        if font["glyf"].compile(font) != original["glyf"].compile(original):
            raise ValueError("Source regular/heading outlines or hinting changed")
        if font["hmtx"].compile(font) != original["hmtx"].compile(original):
            raise ValueError("Source regular/heading metrics changed")
    destination = f"fonts/TwyneSource-{style}.ttf"
    buffer = BytesIO()
    font.save(buffer, reorderTables=True)
    data = buffer.getvalue()
    outputs[destination] = data
    cmap = original.getBestCmap()
    faces.append({
        "file": destination, "sha256": sha256(data).hexdigest(), "bytes": len(data),
        "family": FAMILY, "style": style, "weight": weight,
        "source": source_path, "sourceSha256": source_hash,
        "glyphIdsAndAdvancesUnchanged": True,
        "outlinesAndHintingUnchanged": style != "Oblique",
        "shear": .25 if style == "Oblique" else 0,
        "originalGlyphAutohintInstructionsRemoved": style == "Oblique",
        "testGlyphs": {character: {
            "glyphId": original.getGlyphID(cmap[ord(character)]),
            "advanceUnits": original["hmtx"].metrics[cmap[ord(character)]][0],
        } for character in "// Source: Café = #m()›⌄" if ord(character) in cmap},
    })

# The original 11px helper's CSS optical size is11. Restrict this derived
# original-variable face to Source helper/footer labels; default DM/code/Typst
# remain unchanged. The footer alias reuses these exact bytes.
dm_source = "fonts/dmsans-DMSans-opsz-wght.ttf"
dm_sha = "8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d"
dm_bytes = (ASSETS / dm_source).read_bytes()
if sha256(dm_bytes).hexdigest() != dm_sha:
    raise SystemExit("Original DM4.004 helper variable changed")
dm_license = (ASSETS / "fonts/dmsans-OFL.txt").read_bytes()
if sha256(dm_license).hexdigest() != "9af36190332437f5ecd09974de43c1f7c77a310a996cdd8ceb25628b458840e1":
    raise SystemExit("Original DM4.004 helper OFL notice changed")
outputs["licenses/twyne-source-label-OFL.txt"] = dm_license
helper = instantiateVariableFont(TTFont(BytesIO(dm_bytes), recalcTimestamp=False), {"opsz": 11, "wght": 400}, inplace=False, optimize=True)
helper.recalcTimestamp = False
helper_family = "Twyne Source Label"
helper_names = {1: helper_family, 2: "Regular", 3: "TwyneSourceLabel-Regular;DM4.004;opsz11;wght400", 4: helper_family,
                6: "TwyneSourceLabel-Regular", 16: helper_family, 17: "Regular", 18: helper_family}
for record in list(helper["name"].names):
    if record.nameID in helper_names:
        helper["name"].setName(helper_names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
for platform_id, encoding_id, language_id in [(3, 1, 0x409), (1, 0, 0)]:
    for identifier, value in helper_names.items():
        helper["name"].setName(value, identifier, platform_id, encoding_id, language_id)
helper["OS/2"].usWeightClass = 400
helper["OS/2"].fsSelection = (helper["OS/2"].fsSelection & ~((1 << 0) | (1 << 5))) | (1 << 6)
helper["head"].macStyle &= ~3
helper_output = BytesIO()
helper.save(helper_output, reorderTables=True)
helper_bytes = helper_output.getvalue()
helper_path = "fonts/TwyneSourceLabel-Regular.ttf"
outputs[helper_path] = helper_bytes
helper_provenance = {
    "file": helper_path, "sha256": sha256(helper_bytes).hexdigest(), "bytes": len(helper_bytes),
    "source": dm_source, "sourceSha256": dm_sha, "version": "4.004",
    "family": helper_family, "axes": {"opsz": 11, "wght": 400},
    "usage": "Original11px/400 Source helper and footer labels; footer alias reuses exact bytes",
    "licenseSource": "src/assets/typst/dmsans-OFL.txt",
    "licenseSha256": "9af36190332437f5ecd09974de43c1f7c77a310a996cdd8ceb25628b458840e1",
    "testGlyphs": {ch: {"glyphId": helper.getGlyphID(helper.getBestCmap()[ord(ch)]), "advanceUnits": helper["hmtx"].metrics[helper.getBestCmap()[ord(ch)]][0]} for ch in "Document helpers"},
}
outputs["source-font-provenance.json"] = (json.dumps({
    "sourceVersion": "2.014; ttfautohint (v1.8.4.7-5d5b)",
    "package": "Fedora google-noto-sans-mono-fonts-20250301-1.fc42.noarch",
    "originalDirectory": "/usr/share/fonts/google-noto/",
    "originals": [{"file": p, "sha256": h, "weight": w} for p, h, w in ORIGINALS.values()],
    "browserEvidence": "fixtures/source_view/font-evidence/actual-app-source-fonts.json",
    "headingAndFallbackEvidence": "fixtures/source_view/font-evidence/web-cjk-fonts.json",
    "syntheticItalicMechanism": "https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/fonts/font_platform_data.cc#CreateSkFont",
    "syntheticItalicEvidenceBoundary": "Browser selects original Regular for CSS italic. Current primary Chromium source specifies -1/4 skew; derived outline raster is not asserted pixel-identical to that Chrome build.",
    "faces": faces, "helperFont": helper_provenance,
    "tool": {"package": "fontTools", "version": "4.61.1"},
    "method": "Renamed explicit Source-only family; original timestamps and deterministic SFNT order. Oblique decomposes composites, quarter-shears upward-Y outlines and removes original autohints; all glyph IDs/advance widths retained.",
    "license": "SIL Open Font License 1.1", "licenseFile": LICENSE, "licenseSha256": LICENSE_SHA,
    "licenseSource": "https://raw.githubusercontent.com/notofonts/latin-greek-cyrillic/main/OFL.txt",
    "sharedMonoAndSourceBytesAndTypstUnchanged": True,
    "explicitCjkFallback": "Droid Sans Fallback; original Hangul Noto Sans CJK JP Thin and Noto Color Emoji remain platform-dependent gaps",
}, ensure_ascii=False, indent=2) + "\n").encode()
outputs["licenses/twyne-source-FONTLOG.txt"] = (
    "Twyne Source: Source-only native adapter of original Noto Sans Mono 2.014.\n"
    "2026-10-04: Retain exact Regular400/SemiBold600 OFL files selected by original browser.\n"
    "Rename native UI family; regular and heading outlines/hints/metrics are unchanged.\n"
    "Oblique applies x'=x+y/4 to decomposed original Regular outlines, removes original\n"
    "autohint instructions, and retains all glyph IDs and advance widths. This matches\n"
    "Chromium's documented synthetic-skew mechanism; real raster parity is separate.\n"
    "Shared mono/code/canonical Source text/Typst font bytes and ordering stay unchanged.\n"
    "Source Label400 derives original DM4.004 at opsz11 for Source helper/footer11px labels.\n"
    "Original copyright and SIL OFL 1.1 accompany exact originals and derivations.\n"
).encode()
for name, contents in outputs.items():
    destination = ASSETS / name
    if args.check:
        if not destination.exists() or destination.read_bytes() != contents:
            raise SystemExit(f"Stale original Source font adapter: {destination}")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(contents)
print("Verified" if args.check else "Generated", "deterministic Noto Mono 2.014 Source400/600/quarter-shear oblique; advances unchanged.")
