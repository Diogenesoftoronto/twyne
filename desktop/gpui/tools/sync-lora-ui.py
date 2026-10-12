#!/usr/bin/env python3
"""Reproduce native UI instances of Twyne's original Lora 3.008 variable fonts.

FontTools 4.61.1 is a build-tool-only dependency. The original variable and
Typst static assets remain byte-identical; only new UI instances are written.
The derived family's internal name respects the original Reserved Font Name.
"""
import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

TOOL_VERSION = "4.61.1"
ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "desktop/gpui/assets"
FAMILY = "Twyne Body"
SOURCES = {
    "Regular": ("src/assets/typst/lora-Lora-wght.ttf", "822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7"),
    "Italic": ("src/assets/typst/lora-Lora-Italic-wght.ttf", "22d8d8854b53807aa664ca34f2031a9ed57a1d0dea296b8b96cdd3aad937a2b3"),
}
LICENSE_PATH = "src/assets/typst/lora-OFL.txt"
LICENSE_SHA = "1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if fontTools.__version__ != TOOL_VERSION:
    raise SystemExit(f"Reproduction requires FontTools {TOOL_VERSION}; found {fontTools.__version__}")


def checked_bytes(path, expected):
    data = (ROOT / path).read_bytes()
    if sha256(data).hexdigest() != expected:
        raise ValueError(f"Original source bytes changed: {path}")
    return data


license_bytes = checked_bytes(LICENSE_PATH, LICENSE_SHA)
outputs = {}
instances = []
for italic in [False, True]:
    source_path, source_sha = SOURCES["Italic" if italic else "Regular"]
    original = checked_bytes(source_path, source_sha)
    for weight in [400, 700]:
        source = TTFont(BytesIO(original), recalcTimestamp=False)
        if source["name"].getDebugName(5) != "Version 3.008":
            raise ValueError("Expected original browser Lora version 3.008")
        instance = instantiateVariableFont(
            source, {"wght": weight}, inplace=False, optimize=True,
            updateFontNames=True,
        )
        instance.recalcTimestamp = False
        style = "Bold Italic" if italic and weight == 700 else "Italic" if italic else "Bold" if weight == 700 else "Regular"
        compact_style = style.replace(" ", "")
        names = {
            1: FAMILY,
            2: style,
            3: f"TwyneBody-{compact_style};Version 3.008;wght={weight}",
            4: f"{FAMILY} {style}",
            6: f"TwyneBody-{compact_style}",
            16: FAMILY,
            17: style,
            18: f"{FAMILY} {style}",
        }
        for name in list(instance["name"].names):
            if name.nameID in names:
                instance["name"].setName(
                    names[name.nameID], name.nameID,
                    name.platformID, name.platEncID, name.langID,
                )
        for platform_id, encoding_id, language_id in [(3, 1, 0x409), (1, 0, 0)]:
            for name_id, value in names.items():
                instance["name"].setName(value, name_id, platform_id, encoding_id, language_id)
        # Explicit style links let the pinned renderer choose each static face.
        instance["OS/2"].usWeightClass = weight
        instance["OS/2"].fsSelection &= ~((1 << 0) | (1 << 5) | (1 << 6))
        instance["OS/2"].fsSelection |= (1 if italic else 0) | ((1 << 5) if weight == 700 else 0) | ((1 << 6) if not italic and weight == 400 else 0)
        instance["head"].macStyle = (1 if weight == 700 else 0) | (2 if italic else 0)
        if "fvar" in instance or "gvar" in instance:
            raise ValueError("Full static instancing left variation tables")
        file = f"fonts/TwyneBody-{compact_style}.ttf"
        buffer = BytesIO()
        instance.save(buffer, reorderTables=True)
        data = buffer.getvalue()
        outputs[file] = data
        instances.append({
            "file": file,
            "sha256": sha256(data).hexdigest(),
            "bytes": len(data),
            "source": source_path,
            "sourceSha256": source_sha,
            "version": "3.008",
            "family": FAMILY,
            "style": style,
            "axes": {"wght": weight},
            "glyphs": len(instance.getGlyphOrder()),
            "unitsPerEm": instance["head"].unitsPerEm,
            "testGlyphs": {
                character: {
                    "glyphId": instance.getGlyphID(instance.getBestCmap()[ord(character)]),
                    "advanceUnits": instance["hmtx"].metrics[instance.getBestCmap()[ord(character)]][0],
                }
                for character in "AWagmxé"
            },
        })

outputs["licenses/twyne-body-OFL.txt"] = license_bytes
outputs["lora-ui-provenance.json"] = (json.dumps({
    "source": "Existing original Lora 3.008 variable assets from src/assets/typst",
    "originalVersion": "3.008",
    "browserEvidence": "fixtures/marginalia/browser-font-proof.json (actual original Google Lora version/axes)",
    "tool": {"package": "fontTools", "version": TOOL_VERSION},
    "method": "instantiateVariableFont wght=400/700, optimize=True, updateFontNames=True, unchanged source timestamps, deterministic SFNT table order",
    "family": FAMILY,
    "reservedFontName": "Lora",
    "nameMapping": "Canonical source Lora is mapped to native UI family Twyne Body only while rendering",
    "license": "SIL Open Font License 1.1",
    "licenseSource": LICENSE_PATH,
    "licenseSha256": LICENSE_SHA,
    "originalVariableAndTypstBytesUnchanged": True,
    "glyphDesignChanges": False,
    "instances": instances,
}, ensure_ascii=False, indent=2) + "\n").encode()
outputs["licenses/twyne-body-FONTLOG.txt"] = (
    "Twyne Body: static native UI instances of the original Lora 3.008 variable fonts.\n"
    "2026-10-04: Instantiated original wght coordinates 400 and 700 in upright and italic.\n"
    "Internal family and face names changed to Twyne Body to respect the Reserved Font Name.\n"
    "Original outlines, spacing, features and hinting follow deterministic variable instancing; no glyph redesign.\n"
    "The original copyright, RFN declaration and SIL OFL 1.1 remain in the accompanying license.\n"
    "Original source variable files and the existing Typst static font book remain unchanged.\n"
).encode()

for name, data in outputs.items():
    destination = ASSETS / name
    if args.check:
        if not destination.exists() or destination.read_bytes() != data:
            raise SystemExit(f"Stale original Lora UI instance/provenance: {destination}")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
print("Verified" if args.check else "Generated", "four deterministic original Lora 3.008 native UI faces (Twyne Body).")
