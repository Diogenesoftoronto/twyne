#!/usr/bin/env python3
"""Verify/copy the exact original File disclosure's Noto Sans Math3.000 face.

Normal shipping/check paths use packaged bytes and never contact the network.
The source copier is optional, for the identified current-environment package.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "desktop/gpui/assets"
FONT_FILE = "fonts/NotoSansMath-Regular.ttf"
FONT_SHA = "d51afd5739c7ba6c44fcab35a88160e25dfb69a2d4ad0bd99533f8d894af1f96"
LICENSE_FILE = "licenses/noto-sans-math-OFL.txt"
LICENSE_SHA = "403a95275b469061b7d4371c328e0ada3bc7d63328abe2e88aad5cd243b2fe21"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
parser.add_argument("--source", type=Path)
args = parser.parse_args()
if args.source:
    data = args.source.read_bytes()
    if sha256(data).hexdigest() != FONT_SHA:
        raise SystemExit("Original browser's Math3.000 face changed")
    if not args.check:
        (ASSETS / FONT_FILE).write_bytes(data)
for name, expected in [(FONT_FILE, FONT_SHA), (LICENSE_FILE, LICENSE_SHA)]:
    if sha256((ASSETS / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f"Restore original Math glyph or official OFL notice: {name}")
proof = {
    "file": FONT_FILE, "sha256": FONT_SHA, "bytes": (ASSETS / FONT_FILE).stat().st_size,
    "family": "Noto Sans Math", "postScriptName": "NotoSansMath-Regular",
    "version": "3.000; ttfautohint (v1.8.4.7-5d5b)", "weight": 400, "style": "normal",
    "source": "/usr/share/fonts/google-noto/NotoSansMath-Regular.ttf",
    "package": "google-noto-sans-math-fonts-20250301-1.fc42.noarch",
    "licenseFile": LICENSE_FILE, "licenseSha256": LICENSE_SHA,
    "licenseSource": "https://raw.githubusercontent.com/notofonts/math/main/OFL.txt",
    "copyright": "Copyright 2022 Google LLC. All Rights Reserved.",
    "glyph": {"source": "▾", "codepoint": "U+25BE", "id": 4754, "advanceUnits": 462, "unitsPerEm": 1000},
    "usage": "File disclosure arrow only; requested600/normal; original font bytes unchanged",
    "evidence": "fixtures/source_view/font-evidence/file-arrow-actual-app.json",
    "rasterBoundary": "Chrome154 fallback600 synthesis differs from font-synthesis:none. Explicit native Math400/600 resolves original Regular, retaining exact glyph/advance; Chromium faux-bold raster remains separate.",
    "sharedSansSourceAttributesAndTypstUnchanged": True,
}
outputs = {
    "file-arrow-font-provenance.json": (json.dumps(proof, ensure_ascii=False, indent=2) + "\n").encode(),
    "licenses/file-arrow-FONTLOG.txt": (
        "Original File disclosure glyph U+25BE: Noto Sans Math3.000.\n"
        "2026-10-04: Package byte-identical current browser fallback and official\n"
        "SIL OFL1.1 notice. No font derivation or outline/advance edits.\n"
        "Use only for File arrow; default Sans, source attributes and Typst stay unchanged.\n"
        "Original requested600 fallback synthesis has a separate Chrome raster boundary.\n"
    ).encode(),
}
for name, data in outputs.items():
    path = ASSETS / name
    if args.check:
        if path.read_bytes() != data:
            raise SystemExit(f"Stale File glyph provenance: {path}")
    else:
        path.write_bytes(data)
print("Verified" if args.check else "Packaged", "exact original File Math3.000 glyph and OFL notice")
