#!/usr/bin/env python3
"""Embed the exact Droid face selected by the original browser CJK fixture.

This checks a pinned local font/distribution notice, then copies their original
bytes. It does not download fonts and the native application never reads the
system font paths. --check validates the embedded bytes without local sources.
"""
import argparse
import hashlib
import json
from pathlib import Path

FONT_SHA = "2392015530438bafc48edfc4aee6d9de2387f627a6134d8ab3dfcc99d21c8240"
NOTICE_SHA = "38751245389e1e23f73e6f5384b5cbe7fa972cc4410c5adc9c04b082a0b9561a"
ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "desktop/gpui/assets"
FONT = "fonts/DroidSansFallbackFull.ttf"
NOTICE = "licenses/droid-sans-fallback-NOTICE.txt"
PROVENANCE = {
    "source": "Android Open Source Project via Fedora google-droid-sans-fonts",
    "distributionPackage": "google-droid-sans-fonts-20200215-22.fc42.noarch",
    "sourceRpm": "google-droid-fonts-20200215-22.fc42.src.rpm",
    "upstream": "https://android.googlesource.com/",
    "license": "Apache-2.0",
    "fontFamily": "Droid Sans Fallback",
    "postScriptName": "DroidSansFallback",
    "style": "Regular",
    "fontVersion": "1.00",
    "browserEvidence": {
        "browser": "Chrome 154.0.8037.57",
        "method": "CSS.getPlatformFontsForNode on original zero-network writing fixture",
        "primaryFace": "Lora-Regular",
        "fallbackFace": "DroidSansFallback",
        "fallbackGlyphCount": 100,
        "weight": 400,
        "sizePx": 18,
        "networkRequests": 0,
        "sourceFixture": "desktop/gpui/fixtures/editor/capture-long-word-web.ts",
    },
    "glyphIds": {"東": 13577, "京": 7236},
    "originalFontPath": "/usr/share/fonts/google-droid-sans-fonts/DroidSansFallbackFull.ttf",
    "originalNoticePath": "/usr/share/licenses/google-droid-sans-fonts/NOTICE",
    "originalBytesRetained": True,
    "files": {FONT: FONT_SHA, NOTICE: NOTICE_SHA},
}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--font", type=Path)
parser.add_argument("--notice", type=Path)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
if not args.check and (not args.font or not args.notice):
    parser.error("reproduction requires --font and --notice from the pinned distribution")

sources = {FONT: args.font, NOTICE: args.notice}
files = {}
for name, expected in PROVENANCE["files"].items():
    source = sources[name]
    data = (source if source is not None else ASSETS / name).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit(f"Font/distribution notice differs from the executed browser: {name}")
    files[name] = data
files["cjk-fallback-provenance.json"] = (json.dumps(PROVENANCE, ensure_ascii=False, indent=2) + "\n").encode()
for name, data in files.items():
    destination = ASSETS / name
    if args.check:
        if not destination.exists() or destination.read_bytes() != data:
            raise SystemExit(f"Stale original CJK fallback asset: {destination}")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
print("Verified" if args.check else "Embedded", "byte-identical Droid Sans Fallback and original Apache notice.")
