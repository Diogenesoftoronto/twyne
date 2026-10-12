#!/usr/bin/env python3
"""Measure actual CJK glyph pixels from owned browser and X11 captures.

Verification only, using ImageMagick to decode/crop unchanged screenshots.
The final row is left aligned; independent glyph crops avoid the separately
pending inter-character justification and URL line-layout differences.
"""
import argparse
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--evidence", type=Path, required=True)
parser.add_argument("--native-client-x", type=int, default=2)
parser.add_argument("--native-client-y", type=int, default=0)
parser.add_argument("--before", type=Path, help="Optional original pre-fix native capture directory")
args = parser.parse_args()
magick = shutil.which("magick")
if not magick:
    raise SystemExit("ImageMagick is needed to decode the verification captures")


def image(path):
    png = path.read_bytes()
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Expected an original PNG capture")
    width, height = struct.unpack(">II", png[16:24])
    pixels = subprocess.run(
        [magick, str(path), "-depth", "8", "RGB:-"],
        capture_output=True, check=True,
    ).stdout
    if len(pixels) != width * height * 3:
        raise ValueError("Unexpected decoded screenshot dimensions")
    return width, height, pixels


def mask(decoded, left, top, width, height):
    image_width, image_height, pixels = decoded
    background = tuple(pixels[-3:])
    if not (0 <= left <= image_width - width and 0 <= top <= image_height - height):
        raise ValueError("Glyph crop exceeds screenshot bounds")
    values = []
    for y in range(top, top + height):
        for x in range(left, left + width):
            pixel = pixels[(y * image_width + x) * 3:(y * image_width + x) * 3 + 3]
            # The original paper is light; darkness is measured directly from
            # actual RGB pixels, without synthetic boldening or resampling.
            values.append(sum(max(0, base - value) for base, value in zip(background, pixel)) / 3)
    active = [(index % width, index // width) for index, value in enumerate(values) if value >= 16]
    if not active:
        raise ValueError("The expected CJK glyph did not paint")
    x0, x1 = min(x for x, _ in active), max(x for x, _ in active)
    y0, y1 = min(y for _, y in active), max(y for _, y in active)
    trimmed = [values[y * width + x] for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    return {
        "width": x1 - x0 + 1,
        "height": y1 - y0 + 1,
        "darkness": sum(values),
        "inkPixels": len(active),
        "mask": trimmed,
    }


evidence = args.evidence
web_report = json.loads((evidence / "web-fonts.json").read_text())
native_report = json.loads((evidence / "native.json").read_text())
web = image(evidence / "web.png")
native = image(evidence / "native.png")
before = image(args.before / "native.png") if args.before else None
before_paragraph = json.loads((args.before / "native.json").read_text())["paragraphs"][-1] if args.before else None
style = web_report["styles"][-1]
paragraph = native_report["paragraphs"][-1]
line = paragraph["lines"][-1]
if style["text"] != paragraph["source"] or not line["text"].startswith("東京東京"):
    raise ValueError("Expected unchanged original CJK paragraph and final row")
web_line_top = style["bounds"]["top"] + (len(paragraph["lines"]) - 1) * float(style["lineHeight"].removesuffix("px"))
web_glyphs = [glyph for glyph in style["cjkGlyphs"] if glyph["sourceUtf16"] >= line["range"][0]][:4]
native_left = paragraph["right"] - paragraph["width"] + args.native_client_x
row_height = 33
measured = []
for index, glyph in enumerate(web_glyphs):
    web_x = math.floor(glyph["left"] - web_report["screenshotBounds"]["x"])
    web_y = math.floor(web_line_top - web_report["screenshotBounds"]["y"])
    native_x = round(native_left + index * 18)
    native_y = math.floor(line["top"] + args.native_client_y)
    browser_mask = mask(web, web_x, web_y, 18, row_height)
    native_mask = mask(native, native_x, native_y, 18, row_height)
    same_dimensions = (browser_mask["width"], browser_mask["height"]) == (native_mask["width"], native_mask["height"])
    mae = None
    if same_dimensions:
        mae = sum(abs(a - b) for a, b in zip(browser_mask["mask"], native_mask["mask"])) / len(browser_mask["mask"])
    before_ratio = None
    if before_paragraph is not None:
        if before_paragraph["source"] != paragraph["source"]:
            raise ValueError("Pre-fix capture has a different CJK source")
        before_mask = mask(
            before,
            round(before_paragraph["right"] - before_paragraph["width"] + args.native_client_x + index * 18),
            math.floor(before_paragraph["lines"][-1]["top"] + args.native_client_y),
            18, row_height,
        )
        before_ratio = before_mask["darkness"] / browser_mask["darkness"]
    measured.append({
        "character": glyph["character"],
        "sourceUtf16": glyph["sourceUtf16"],
        "webCell": [web_x, web_y, 18, row_height],
        "nativeCell": [native_x, native_y, 18, row_height],
        "webInkBoundsPx": [browser_mask["width"], browser_mask["height"]],
        "nativeInkBoundsPx": [native_mask["width"], native_mask["height"]],
        "nativeToWebDarknessRatio": native_mask["darkness"] / browser_mask["darkness"],
        "beforeToWebDarknessRatio": before_ratio,
        "webInkPixels": browser_mask["inkPixels"],
        "nativeInkPixels": native_mask["inkPixels"],
        "alignedInkMae8Bit": mae,
    })

for name, x, y in [
    ("web", measured[0]["webCell"][0], measured[0]["webCell"][1]),
    ("native", measured[0]["nativeCell"][0], measured[0]["nativeCell"][1]),
]:
    subprocess.run(
        [magick, str(evidence / f"{name}.png"), "-crop", f"72x{row_height}+{x}+{y}", "+repage", str(evidence / f"{name}-cjk-last-row.png")],
        capture_output=True, check=True,
    )
report = {
    "method": "Actual unchanged screenshots; left-aligned final-row cells; integer ink-bounds translation only; no resampling",
    "browser": web_report["browser"],
    "networkRequests": web_report["blockedNetworkRequests"],
    "nativeBackend": native_report["backend"],
    "nativeClientOriginPx": [args.native_client_x, args.native_client_y],
    "sourceUnchanged": True,
    "glyphs": measured,
    "limitations": [
        "Chrome and native FreeType/WGPU use different rasterization and pixel phases; these pixels are not identical",
        "This fixture proves Lora18 regular plus the exact original Droid CJK face, not other weights, platforms or Typst fonts",
        "CJK inter-character justification and long-URL line layout are separate editor geometry gaps",
    ],
}
(evidence / "raster-comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False))
