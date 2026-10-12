#!/usr/bin/env python3
"""Compare owned original-browser Lora responses with native UI instances.

Read-only verification: no download or source-font mutation. FontTools' WOFF2
reconstructor uses installed Bun's Brotli decoder when Python lacks Brotli.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import subprocess

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont, woff2
from fontTools.varLib.instancer import instantiateVariableFont


class BunBrotli:
    @staticmethod
    def decompress(data):
        return subprocess.check_output([
            "rtk", "proxy", "bun", "-e",
            "process.stdout.write(require('node:zlib').brotliDecompressSync(Buffer.from(await Bun.stdin.arrayBuffer())))",
        ], input=data)


if not woff2.haveBrotli:
    woff2.brotli = BunBrotli
    woff2.haveBrotli = True

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--responses", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
provenance = json.loads((root / "desktop/gpui/assets/lora-ui-provenance.json").read_text())
responses = json.loads((args.responses / "assets.json").read_text())
comparisons = []
for response in responses:
    if "/lora/" not in response["url"] or not response["path"].endswith(".woff2"):
        continue
    original_path = Path(response["path"])
    original = TTFont(original_path, recalcTimestamp=False)
    italic = "Italic" in original["name"].getDebugName(2)
    for instance in provenance["instances"]:
        if ("Italic" in instance["style"]) != italic:
            continue
        weight = instance["axes"]["wght"]
        browser_face = instantiateVariableFont(original, {"wght": weight}, inplace=False, optimize=True)
        native_face = TTFont(root / "desktop/gpui/assets" / instance["file"])
        browser_cmap, native_cmap = browser_face.getBestCmap(), native_face.getBestCmap()
        browser_set, native_set = browser_face.getGlyphSet(), native_face.getGlyphSet()
        shared = sorted(browser_cmap.keys() & native_cmap.keys())
        advance_differences, outline_differences = [], []
        for codepoint in shared:
            browser_name, native_name = browser_cmap[codepoint], native_cmap[codepoint]
            browser_advance = browser_face["hmtx"][browser_name][0]
            native_advance = native_face["hmtx"][native_name][0]
            if browser_advance != native_advance:
                advance_differences.append({"character": chr(codepoint), "codepoint": codepoint, "browser": browser_advance, "native": native_advance})
            browser_pen, native_pen = DecomposingRecordingPen(browser_set), DecomposingRecordingPen(native_set)
            browser_set[browser_name].draw(browser_pen)
            native_set[native_name].draw(native_pen)
            if browser_pen.value != native_pen.value:
                outline_differences.append({"character": chr(codepoint), "codepoint": codepoint})
        comparisons.append({
            "url": response["url"],
            "responseSha256": sha256(original_path.read_bytes()).hexdigest(),
            "version": original["name"].getDebugName(5),
            "nativeFile": instance["file"],
            "nativeSha256": instance["sha256"],
            "weight": weight,
            "sharedCodepoints": len(shared),
            "advanceDifferences": advance_differences,
            "decomposedOutlineDifferences": outline_differences,
        })
report = {
    "method": "Owned actual original browser WOFF2 responses, reconstructed by FontTools/Bun Brotli; exact shared character advance units and decomposed static outline coordinates",
    "noNetworkOrSourceMutation": True,
    "source": "Actual original application's Google font responses captured by owned browser",
    "comparisons": comparisons,
    "limitations": [
        "Glyph advances/outlines are separate from full-run shaping, CSS weight selection, line breaking, hinting and rasterization",
        "Original Google CSS declares normal400/500/600 and italic400/500; checking the700 axis does not prove its CSS face selection",
    ],
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"output": str(args.output), "comparisons": [{key: item[key] for key in ["nativeFile", "weight", "sharedCodepoints"]} | {"advanceDifferences": len(item["advanceDifferences"]), "outlineDifferences": len(item["decomposedOutlineDifferences"])} for item in comparisons]}))
