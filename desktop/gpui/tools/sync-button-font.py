#!/usr/bin/env python3
"""Derive the actual 12px/600 paper-button face from original DM Sans 4.004.

The original browser probe establishes opsz=12 for CSS auto at 12px. This is
an explicitly selected UI face, not a change to default/source/Typst families.
FontTools 4.61.1 is needed only to reproduce the embedded static bytes.
"""
import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "desktop/gpui/assets"
SOURCE = "src/assets/typst/dmsans-DMSans-opsz-wght.ttf"
SOURCE_SHA = "8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d"
LICENSE = "src/assets/typst/dmsans-OFL.txt"
LICENSE_SHA = "9af36190332437f5ecd09974de43c1f7c77a310a996cdd8ceb25628b458840e1"
FAMILY = "Twyne Button Sans"
FILE = "fonts/TwyneButtonSans-SemiBold.ttf"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if fontTools.__version__ != "4.61.1":
    raise SystemExit("Reproduction requires FontTools 4.61.1")
original, license_bytes = (ROOT / SOURCE).read_bytes(), (ROOT / LICENSE).read_bytes()
if sha256(original).hexdigest() != SOURCE_SHA or sha256(license_bytes).hexdigest() != LICENSE_SHA:
    raise SystemExit("Original DM Sans source or notice bytes changed")
source = TTFont(BytesIO(original), recalcTimestamp=False)
if not source["name"].getDebugName(5).startswith("Version 4.004"):
    raise ValueError("Expected the original DM Sans 4.004 variable font")
instance = instantiateVariableFont(source, {"opsz": 12, "wght": 600}, inplace=False, optimize=True)
instance.recalcTimestamp = False
names = {
    1: FAMILY, 2: "SemiBold", 3: "TwyneButtonSans-SemiBold;Version4.004;opsz12;wght600",
    4: f"{FAMILY} SemiBold", 6: "TwyneButtonSans-SemiBold",
    16: FAMILY, 17: "SemiBold", 18: f"{FAMILY} SemiBold",
}
for record in list(instance["name"].names):
    if record.nameID in names:
        instance["name"].setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
for platform_id, encoding_id, language_id in [(3, 1, 0x409), (1, 0, 0)]:
    for identifier, value in names.items():
        instance["name"].setName(value, identifier, platform_id, encoding_id, language_id)
instance["OS/2"].usWeightClass = 600
instance["OS/2"].fsSelection = (instance["OS/2"].fsSelection & ~((1 << 0) | (1 << 5))) | (1 << 6)
instance["head"].macStyle &= ~3
if "fvar" in instance or "gvar" in instance:
    raise ValueError("Static button face retains variation tables")
buffer = BytesIO()
instance.save(buffer, reorderTables=True)
data = buffer.getvalue()
outputs = {
    FILE: data,
    "licenses/twyne-button-sans-OFL.txt": license_bytes,
    "button-font-provenance.json": (json.dumps({
        "source": SOURCE, "sourceSha256": SOURCE_SHA,
        "sourceVersion": "4.004", "file": FILE, "sha256": sha256(data).hexdigest(),
        "bytes": len(data), "family": FAMILY, "style": "SemiBold",
        "axes": {"opsz": 12, "wght": 600},
        "sourceEvidence": "assets/button-font-evidence/web-metrics.json: original Google response at12px600 auto matches explicit opsz12",
        "tool": {"package": "fontTools", "version": "4.61.1"},
        "method": "instantiateVariableFont, optimize=True, unchanged original timestamps, deterministic SFNT order; explicit internal UI family",
        "license": "SIL Open Font License 1.1", "licenseSource": LICENSE, "licenseSha256": LICENSE_SHA,
        "defaultSansAndSourceAndTypstUnchanged": True,
        "testGlyphs": {character: {
            "glyphId": instance.getGlyphID(instance.getBestCmap()[ord(character)]),
            "advanceUnits": instance["hmtx"].metrics[instance.getBestCmap()[ord(character)]][0],
        } for character in "Save notWm"},
    }, ensure_ascii=False, indent=2) + "\n").encode(),
    "licenses/twyne-button-sans-FONTLOG.txt": (
        "Twyne Button Sans: native paper-button instance of original DM Sans 4.004.\n"
        "2026-10-04: Instantiated original axes opsz12/wght600 for actual 12px/600 CSS buttons.\n"
        "Renamed internal UI family; no glyph redesign or change to source or Typst fonts.\n"
        "Original copyright and SIL OFL 1.1 remain in the accompanying license.\n"
    ).encode(),
}
for name, contents in outputs.items():
    destination = ASSETS / name
    if args.check:
        if not destination.exists() or destination.read_bytes() != contents:
            raise SystemExit(f"Stale original paper-button font: {destination}")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(contents)
print("Verified" if args.check else "Generated", "deterministic original DM Sans 4.004 button face (opsz12/wght600).")
