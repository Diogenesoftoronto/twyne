"""Read-only metadata for approved public source fonts and bundled originals.

Run after the owned browser has saved its actual font responses in /tmp.
Does not download or change any font. fontTools is already installed.
"""
import json
import io
import struct
import subprocess
from pathlib import Path
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.woff2 import WOFF2DirectoryEntry

root = Path(__file__).resolve().parents[2] / "assets" / "fonts"
assets = json.loads(Path("/tmp/twyne-original-web-fonts/assets.json").read_text())


def open_metadata(path):
    if not str(path).endswith(".woff2"):
        return TTFont(path)
    # The installed fontTools lacks its optional Python Brotli extension.
    # Read untransformed metadata tables using installed Bun's Brotli decoder;
    # no new dependency, network request or outline reconstruction is needed.
    stream = io.BytesIO(Path(path).read_bytes())
    header = stream.read(48)
    table_count = struct.unpack_from(">H", header, 12)[0]
    compressed_length = struct.unpack_from(">I", header, 20)[0]
    entries = []
    for _ in range(table_count):
        entry = WOFF2DirectoryEntry()
        entry.fromFile(stream)
        entries.append(entry)
    decoded = subprocess.check_output([
        "rtk", "proxy", "bun", "-e",
        "process.stdout.write(require('node:zlib').brotliDecompressSync(Buffer.from(await Bun.stdin.arrayBuffer())))",
    ], input=stream.read(compressed_length))
    font = TTFont()
    offset = 0
    for entry in entries:
        if entry.tag in {"name", "head", "fvar"}:
            if entry.transformed:
                raise ValueError(f"Unexpected transformed metadata {entry.tag}")
            table = newTable(entry.tag)
            table.decompile(decoded[offset:offset + entry.length], font)
            font[entry.tag] = table
        offset += entry.length
    if offset != len(decoded):
        raise ValueError("WOFF2 directory does not match decoded bytes")
    return font


def describe(path):
    with open_metadata(path) as font:
        def name(identifier):
            record = font["name"].getDebugName(identifier)
            return record or ""
        return {
            "path": str(path),
            "family": name(1), "subfamily": name(2),
            "postScriptName": name(6), "version": name(5),
            "unitsPerEm": font["head"].unitsPerEm,
            "axes": [{"tag": axis.axisTag, "min": axis.minValue,
                      "default": axis.defaultValue, "max": axis.maxValue}
                     for axis in font["fvar"].axes] if "fvar" in font else [],
        }


proof = {
    "originalSource": [dict(describe(asset["path"]), url=asset["url"])
                       for asset in assets if asset["path"].endswith(".woff2")],
    "nativeBundled": [describe(root / name) for name in [
        "librebaskerville-LibreBaskerville-Regular.ttf",
        "librebaskerville-LibreBaskerville-Bold.ttf",
        "lora-Lora-Regular.ttf", "lora-Lora-Bold.ttf",
        "lora-Lora-wght.ttf", "lora-Lora-Italic-wght.ttf",
        "dmsans-DMSans-Regular.ttf", "dmsans-DMSans-Bold.ttf",
        "specialelite-SpecialElite-Regular.ttf",
    ]],
}
Path(__file__).with_name("browser-font-proof.json").write_text(
    json.dumps(proof, ensure_ascii=False, indent=2) + "\n"
)
print(json.dumps(proof, ensure_ascii=False, indent=2))
