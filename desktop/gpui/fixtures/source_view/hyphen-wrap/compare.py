#!/usr/bin/env python3
"""Compare actual executed CodeMirror and GPU source rows, with honest fallback gaps."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--web", type=Path, default=Path(__file__).with_name("web-hyphen-wrap.json"))
parser.add_argument("--native", type=Path, default=Path(__file__).with_name("native-fixed-hyphen-wrap.json"))
parser.add_argument("--output", type=Path, default=Path(__file__).with_name("verified-comparison.json"))
args = parser.parse_args()
web = json.loads(args.web.read_text())
native = json.loads(args.native.read_text())
assert web["networkRequests"] == 0
assert web["compatMode"] == "CSS1Compat"
reference = {case["width"]: {entry["id"]: entry for entry in case["results"]} for case in web["cases"]}
verified = 0
fallback_gaps = []
cases = []
for case in native["cases"]:
    width = case["width"]
    counts = {"width": width, "asciiVerified": 0, "fallbackMatches": 0, "fallbackCount": 0}
    for entry in case["results"]:
        expected = reference[width][entry["id"]]
        assert entry["source"] == expected["source"]
        assert entry["sourceUnchanged"] and expected["sourceUnchanged"]
        assert not entry["canUndo"] and not entry["canRedo"]
        assert not expected["undo"] and not expected["redo"]
        assert expected["plainCssRows"] == expected["rowTexts"]
        printable_ascii = all(32 <= ord(scalar) <= 126 for scalar in entry["source"].rstrip("\n"))
        if printable_ascii:
            assert entry["asciiRowsVerified"]
            assert entry["rowTexts"] == expected["rowTexts"], (width, entry["id"])
            counts["asciiVerified"] += 1
            verified += 1
        else:
            assert not entry["asciiRowsVerified"]
            counts["fallbackCount"] += 1
            if entry["rowTexts"] == expected["rowTexts"]:
                counts["fallbackMatches"] += 1
            else:
                fallback_gaps.append({"width": width, "id": entry["id"], "browser": expected["rowTexts"], "native": entry["rowTexts"]})
    cases.append(counts)
report = {
    "browser": web["browser"],
    "networkRequests": 0,
    "compatMode": web["compatMode"],
    "asciiRowsVerified": verified,
    "sourceAndHistoryUnchanged": True,
    "plainCssMatchesOriginalCodeMirror": True,
    "nativeRenderer": native["renderer"],
    "boundary": "Only printable-ASCII Source rows opt in. Unsupported rows retain upstream behavior and reported differences; glyph raster parity is not asserted.",
    "cases": cases,
    "fallbackGaps": fallback_gaps,
}
args.output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"asciiRowsVerified": verified, "fallbackGaps": len(fallback_gaps), "output": str(args.output)}))
