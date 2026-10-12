#!/usr/bin/env python3
"""Extract exact stamp-alphabet outlines from already-bundled Special Elite.

Offline, pinned fontTools4.61.1. --check writes nothing. No font downloads,
substitution, scaling, hinting, timestamps, or edits to the original font.
"""
from pathlib import Path
from hashlib import sha256
from io import BytesIO
import argparse
import json
import fontTools
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[4]
OWNED = Path(__file__).resolve().parent
FONT = ROOT / "desktop/gpui/assets/fonts/specialelite-SpecialElite-Regular.ttf"
LICENSE = ROOT / "desktop/gpui/assets/fonts/specialelite-LICENSE.txt"
FONT_SHA = "a776fcb4ceb8bdf03e2967688ebdad42680de5b91a7e62c17e718ae212d14bc4"
LICENSE_SHA = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"


def outputs():
    if fontTools.__version__ != "4.61.1":
        raise RuntimeError("Use the reviewed existing fontTools4.61.1; do not install or silently change tools")
    data, license_bytes = FONT.read_bytes(), LICENSE.read_bytes()
    if sha256(data).hexdigest() != FONT_SHA or sha256(license_bytes).hexdigest() != LICENSE_SHA:
        raise RuntimeError("Original Special Elite font/license changed; explicit review required")
    face = TTFont(BytesIO(data), recalcTimestamp=False)
    glyphs = face.getGlyphSet()
    records = {}
    for character in sorted(set("01234567 /REVIEWED")):
        name = face.getBestCmap()[ord(character)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        records[str(face.getGlyphID(name))] = {
            "character": character, "name": name,
            "advanceUnits": face["hmtx"][name][0], "path": pen.getCommands(),
        }
    document = {
        "fontSha256": FONT_SHA, "version": face["name"].getDebugName(5),
        "copyright": face["name"].getDebugName(0), "unitsPerEm": face["head"].unitsPerEm,
        "ascentUnits": face["hhea"].ascent, "descentUnits": face["hhea"].descent,
        "lineGapUnits": face["hhea"].lineGap, "glyphs": records,
        "derivation": "fontTools4.61.1 SVGPathPen; exact font-unit quadratic/cubic outlines with no contour changes",
        "license": "Apache2.0; original license retained in Special-Elite-LICENSE.txt and assets/fonts",
    }
    return {
        "outlines.json": (json.dumps(document, indent=2, ensure_ascii=False) + "\n").encode(),
        "Special-Elite-LICENSE.txt": license_bytes,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for name, data in outputs().items():
        target = OWNED / name
        if args.check:
            if not target.is_file() or target.read_bytes() != data:
                raise RuntimeError(f"Derived asset differs: {name}")
        else:
            target.write_bytes(data)
    print("Exact original stamp glyph outlines/license verified" if args.check else "Exact original stamp glyph outlines/license extracted")
