#!/usr/bin/env python3
"""Compare actual app CDP advances with old defaults and bundled-only glyphs."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
fixture = Path(__file__).resolve().parent
web = json.loads((fixture / "actual-app-fonts.json").read_text())
baseline = json.loads((fixture / "native-fonts.json").read_text())
bundled = json.loads((fixture / "native-bundled-only.json").read_text())
platform = json.loads((fixture / "native-with-bundled-platform.json").read_text())
assert bundled["embeddedOnly"] is True
assert bundled["initialFontNames"] == []
old_rows = {row["text"]: row for row in baseline["rows"] if row["request"] == "shipping-sans-automatic"}
new_rows = {row["text"]: row for row in bundled["rows"] if row["request"] == "bundled-cast-helper"}
platform_rows = {row["text"]: row for row in platform["rows"] if row["request"] == "shipping-sans-automatic"}
rows = []
expected_ids = {"♠": 2230, "♥": 1867, "♦": 2233, "✦": 6836, "♣": 2231}
for original in web["glyphs"]:
    text = original["text"]
    before, after = old_rows[text], new_rows[text]
    ordinary = platform_rows[text]
    assert ordinary["advancePx"] == before["advancePx"]
    assert ordinary["selectedRuns"][0]["glyphs"][0]["id"] == before["selectedRuns"][0]["glyphs"][0]["id"]
    assert len(original["fonts"]) == 1
    assert len(after["selectedRuns"]) == 1
    assert len(after["selectedRuns"][0]["glyphs"]) == 1
    glyph = after["selectedRuns"][0]["glyphs"][0]
    assert glyph["id"] == expected_ids[text]
    assert glyph["index"] == 0 and glyph["isEmoji"] is False
    assert glyph["nativeMask"]["nonzeroBytes"] > 0
    difference = after["advancePx"] - original["advancePx"]
    assert abs(difference) < 0.008
    rows.append({
        "text": text,
        "sourceFamily": original["style"]["font-family"],
        "actualBrowserFace": original["fonts"][0],
        "originalDomAdvancePx": original["advancePx"],
        "nativeAutomaticBeforePx": before["advancePx"],
        "automaticGapPx": before["advancePx"] - original["advancePx"],
        "bundledOnlyAdvancePx": after["advancePx"],
        "bundledGapPx": difference,
        "bundledGlyphId": glyph["id"],
        "actualNativeMask": glyph["nativeMask"],
    })
report = {
    "source": "Actual original Twyne .cast-icon; DM Sans 400, 11.2px/16.8px, 21.6px bordered circle",
    "browser": web["browser"]["product"],
    "integration": "theme::cast_badge_font() applied only to Cast glyph Font; style/source symbols unchanged",
    "cachedFallbacks": ["Inter", "Liberation Sans", "Adwaita Mono"],
    "nativeSystemFontsDisabled": True,
    "allFiveOriginalGlyphIdsAndNonzeroMasks": True,
    "currentLinuxAutomaticFiveSymbolsUnchangedAfterRegistration": True,
    "maxBundledAdvanceDifferencePx": max(abs(row["bundledGapPx"]) for row in rows),
    "boundary": "Exact glyph/advance and real Linux masks establish font selection/renderability. This does not establish Chromium pixel identity, actual assembled Cast painting, or other OS proof.",
    "rows": rows,
}
data = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
output = fixture / "verified-comparison.json"
if args.check:
    assert output.read_text() == data, "Stale Cast glyph comparison"
else:
    output.write_text(data)
print(f"Verified five bundled Cast glyphs; max original DOM advance difference {report['maxBundledAdvanceDifferencePx']:.8f}px")
