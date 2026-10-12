#!/usr/bin/env python3
"""Inspect existing receipts only. No app, browser, subprocess or network use."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[4]
OWNED = Path(__file__).resolve().parent
VERIFICATION = "desktop/gpui/target/verification/"
SOURCE_FILES = (
    "src/global.css",
    "src/components/onboarding/dossier-folio.tsx",
    "src/components/onboarding/dossier-top-bar.tsx",
    "src/components/onboarding/anti-tabula-rasa.tsx",
    "src/components/brief/dossier-preview.tsx",
    "desktop/gpui/src/dossier_view.rs",
    "desktop/gpui/src/dossier_paper.rs",
    "desktop/gpui/src/dossier_stamp.rs",
    "desktop/gpui/src/theme.rs",
    "desktop/gpui/src/chrome.rs",
    "desktop/gpui/assets/palette.rs",
    "desktop/gpui/vendor/gpui-pre/src/style.rs",
)
RECEIPT_FILES = (
    VERIFICATION + "source-dossier-1280.png",
    VERIFICATION + "source-dossier-audience-1280.png",
    VERIFICATION + "source-dossier-boxes.json",
    VERIFICATION + "source-dossier-audience-textarea.json",
    VERIFICATION + "dossier-paper-reviewed-haitx1l7/title-focused.png",
    VERIFICATION + "dossier-paper-reviewed-haitx1l7/title-focused-geometry.json",
    VERIFICATION + "dossier-paper-reviewed-haitx1l7/audience-focused.png",
    VERIFICATION + "dossier-paper-reviewed-haitx1l7/audience-focused-geometry.json",
    VERIFICATION + "dossier-paper-reviewed-haitx1l7/build-receipt.json",
    VERIFICATION + "dossier-stamp-workflow-6a5b32e702/roman-3-geometry.json",
    VERIFICATION + "dossier-stamp-workflow-6a5b32e702/live-geometry-1.json",
    "desktop/gpui/fixtures/dossier-native/parent-gates-stamp-reviewed.json",
    "desktop/gpui/fixtures/dossier-paper/raster/receipt.json",
)


def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def read_json(path):
    return json.loads((ROOT / path).read_text())


def original_box(row):
    quad = row["box"]["border"]
    x, y = quad[::2], quad[1::2]
    return {
        "x": min(x), "y": min(y),
        "width": max(x) - min(x), "height": max(y) - min(y),
    }


def native_nodes(path, ids):
    receipt = read_json(path)
    selected = {}
    for item in receipt["elements"]:
        key = item["path"][-1]
        if key in ids:
            if key in selected:
                raise ValueError(f"Ambiguous retained node: {path}: {key}")
            selected[key] = {
                "rect": item["rect"], "visible": item["visible"],
                "label": item.get("label"),
            }
    if set(selected) != set(ids):
        raise ValueError(f"Missing retained nodes: {path}: {set(ids)-set(selected)}")
    return {"path": path, "viewport": receipt["viewport"], "nodes": selected}


def original_frame(width, height):
    """Declared CSS calculation, not an observed browser layout."""
    wrapper = min(width, 92 * 16)
    x_padding, y_padding = (20, 16) if width >= 640 else (12, 12)
    return {
        "x": (width - wrapper) / 2 + x_padding, "y": y_padding,
        "width": wrapper - 2 * x_padding, "height": height - 2 * y_padding,
    }


def native_frame(width, height):
    """Declared current root calculation, not a native render."""
    return {"x": 20, "y": 16, "width": width - 40, "height": height - 32}


def paper_budget(width, height, dpr):
    rw, rh = math.ceil(width * dpr), math.ceil(height * dpr)
    return {
        "css": [width, height], "dpr": dpr, "raster": [rw, rh],
        "pixels": rw * rh,
        "acceptedByInspectedNativeContract": (
            1 <= width <= 4096 and 1 <= height <= 4096
            and 0.5 <= dpr <= 4 and rw <= 8192 and rh <= 8192
            and rw * rh <= 8_388_608
        ),
        "proof": "Arithmetic only; no DPR/device/native run",
    }


def png_samples(path, points):
    """Read existing 8-bit, noninterlaced RGB(A) PNGs; never edit an image."""
    blob = (ROOT / path).read_bytes()
    if len(blob) > 32 * 1024 * 1024 or blob[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Unsupported retained PNG")
    offset, compressed = 8, []
    header = None
    while offset < len(blob):
        length = struct.unpack(">I", blob[offset:offset + 4])[0]
        kind = blob[offset + 4:offset + 8]
        data = blob[offset + 8:offset + 8 + length]
        if len(data) != length:
            raise ValueError("Truncated retained PNG")
        offset += length + 12
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", data)
        if kind == b"IDAT":
            compressed.append(data)
    if header is None:
        raise ValueError("Missing retained PNG header")
    width, height, bits, kind, compression, filtering, interlace = header
    if (bits != 8 or kind not in (2, 6) or compression or filtering or interlace
            or not 1 <= width * height <= 8_388_608):
        raise ValueError(f"Unsupported retained PNG header: {header}")
    channels = 3 if kind == 2 else 4
    stride = width * channels
    expected_bytes = (stride + 1) * height
    inflater = zlib.decompressobj()
    raw = inflater.decompress(b"".join(compressed), expected_bytes + 1)
    if len(raw) != expected_bytes or not inflater.eof:
        raise ValueError("Retained PNG expanded size mismatch")
    if any(not (0 <= x < width and 0 <= y < height) for x, y in points):
        raise ValueError("Sample point outside retained PNG")
    previous = bytearray(stride)
    result = {}
    for y in range(max(p[1] for p in points) + 1):
        mode = raw[y * (stride + 1)]
        row = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if mode not in (0, 1, 2, 3, 4):
            raise ValueError("Invalid retained PNG filter")
        if mode:
            for x in range(stride):
                left = row[x - channels] if x >= channels else 0
                above = previous[x]
                corner = previous[x - channels] if x >= channels else 0
                if mode == 1:
                    add = left
                elif mode == 2:
                    add = above
                elif mode == 3:
                    add = (left + above) // 2
                else:
                    prediction = left + above - corner
                    distances = [abs(prediction - left), abs(prediction - above),
                                 abs(prediction - corner)]
                    add = [left, above, corner][distances.index(min(distances))]
                row[x] = (row[x] + add) & 255
        for px, py in points:
            if py == y:
                result[f"{px},{py}"] = list(row[px * channels:px * channels + channels])
        previous = row
    return {"path": path, "physicalPngSize": [width, height], "samples": result}


def collect():
    source_rows = read_json(VERIFICATION + "source-dossier-boxes.json")
    rows = {
        row["selector"]: {
            "quad": row["box"]["border"], "rect": original_box(row),
            "roundedOffsetSize": [row["box"]["width"], row["box"]["height"]],
            "styles": row["styles"],
        } for row in source_rows
    }
    stable_ids = [
        'Name("dossier-active-question")', 'Name("dossier-question")',
        'Name("dossier-question-leaf")', 'Name("dossier-question-sheet")',
        'Name("dossier-ghost-below")', 'Name("dossier-left-leaf")',
        'NamedInteger("dossier-preview-field", 0)',
        'NamedInteger("dossier-preview-field", 2)', 'Name("dossier-back")',
    ]
    transition_ids = [
        'Name("dossier-active-question")', 'Name("dossier-question-sheet")',
        'Name("dossier-ghost-below")',
    ]
    return {
        "schema": 1,
        "status": "Read-only audit, no proposed runtime patch applied",
        "boundary": {
            "performed": ["Read current declarations and retained receipts",
                          "View/decode existing screenshots", "Derived arithmetic"],
            "notPerformed": ["Native/browser execution", "Cargo/Devenv", "Network",
                             "Current assembled runtime pixel parity", "Device/DPR runs"],
            "sourceDpr": "Not recorded in retained Source geometry or screenshot",
            "nativeDpr": "Not recorded in retained geometry; do not infer from PNG size",
            "themeLayoutObserved": ["Editorial retained1280x860 title/Audience"],
            "themeLayoutUnobserved": ["Nightpress", "Broadsheet", "Foolscap"],
            "paperThemeRasters": "Standalone Librsvg projections; not full-form layout proof",
        },
        "sourceHashesAtAudit": {p: digest(p) for p in SOURCE_FILES},
        "retainedArtifactHashes": {p: digest(p) for p in RECEIPT_FILES},
        "originalUsedGeometry": rows,
        "originalAudience": read_json(VERIFICATION + "source-dossier-audience-textarea.json"),
        "nativeTitle": native_nodes(
            VERIFICATION + "dossier-paper-reviewed-haitx1l7/title-focused-geometry.json", stable_ids),
        "nativeAudience": native_nodes(
            VERIFICATION + "dossier-paper-reviewed-haitx1l7/audience-focused-geometry.json", stable_ids),
        "nativeIntermediateAudience": native_nodes(
            VERIFICATION + "dossier-stamp-workflow-6a5b32e702/roman-3-geometry.json", transition_ids),
        "nativeSettledAudience": native_nodes(
            VERIFICATION + "dossier-stamp-workflow-6a5b32e702/live-geometry-1.json", transition_ids),
        "nativePaperBuild": read_json(
            VERIFICATION + "dossier-paper-reviewed-haitx1l7/build-receipt.json"),
        "nativeStampWorkflow": read_json(
            "desktop/gpui/fixtures/dossier-native/parent-gates-stamp-reviewed.json"),
        "declaredFrameCalculations": [
            {"viewport": [w, 860], "source": original_frame(w, 860),
             "native": native_frame(w, 860), "proof": "CSS/native declaration-derived"}
            for w in [320, 620, 639, 640, 1023, 1024, 1280, 1472, 1473, 1600]
        ],
        "declaredBreakpointPolicies": {
            "sourcePreviewColumns": "1 below640;2 at/above640",
            "nativePreviewColumns": "Always2",
            "sourceLeaves": "Auto grid rows below1024;1fr/1.02fr columns at/above1024",
            "nativeLeaves": "Flex column/left height220 below1024;ratio columns at/above1024",
            "sourceSurfaceCaption": "Hidden below640",
            "nativeSurfaceCaption": "Always present",
            "sourceNarrowRowUsedHeights": "Unobserved; cannot substitute a fixed or50/50 split",
        },
        "paperBudgetCalculations": [paper_budget(*values) for values in [
            (1280, 860, 1), (1280, 860, 2), (1280, 860, 3),
            (1920, 1080, 2), (2560, 1440, 1), (2560, 1440, 2),
            (3840, 2160, 1), (3840, 2160, 1.25), (5120, 1440, 1),
        ]],
        "existingPixelSamples": [png_samples(p, [(400, 30), (1120, 810), (700, 805)]) for p in [
            VERIFICATION + "source-dossier-1280.png",
            VERIFICATION + "dossier-paper-reviewed-haitx1l7/title-focused.png",
        ]],
        "sampleMeaning": {
            "400,30": "Empty inset header; original paper-soft vs native paper under70%paper-2",
            "1120,810": "Empty right footer; original50%paper-2 vs native opaque paper-2",
            "700,805": "Inside disabled Back; includes control background/opacity, not blank footer",
            "limits": "Different historical renderer checkpoints, no global pixel parity metric",
        },
    }


def check(audit):
    original = audit["originalUsedGeometry"]
    assert original[".folio-column .my-auto"]["rect"]["height"] == 132
    assert original[".folio-column dl button:first-child"]["rect"]["height"] == 45.59375
    assert original[".folio-column dl button:nth-child(3)"]["rect"]["height"] == 62
    # Same sheet bounds isolate the measured centering transition; these are
    # real captured rows, not a simulation labelled as asynchronous acceptance.
    early = audit["nativeIntermediateAudience"]["nodes"]
    settled = audit["nativeSettledAudience"]["nodes"]
    sheet, question, ghost = ('Name("dossier-question-sheet")',
                              'Name("dossier-active-question")',
                              'Name("dossier-ghost-below")')
    assert early[sheet]["rect"] == settled[sheet]["rect"]
    assert early[question]["rect"]["height"] == settled[question]["rect"]["height"] == 224
    assert early[question]["rect"]["y"] - settled[question]["rect"]["y"] == 112
    assert early[ghost]["rect"]["y"] - settled[ghost]["rect"]["y"] == 224
    assert early[ghost]["visible"] is False and settled[ghost]["visible"] is True
    assert original_frame(1280, 860) == native_frame(1280, 860)
    assert original_frame(620, 860) == {"x": 12, "y": 12, "width": 596, "height": 836}
    assert original_frame(1473, 860)["x"] == 20.5
    assert original_frame(1600, 860)["width"] == 1432
    assert paper_budget(1280, 860, 2)["acceptedByInspectedNativeContract"] is True
    assert paper_budget(1280, 860, 3)["acceptedByInspectedNativeContract"] is False
    assert paper_budget(1920, 1080, 2)["acceptedByInspectedNativeContract"] is True
    assert paper_budget(2560, 1440, 2)["acceptedByInspectedNativeContract"] is False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", action="store_true", help="Write only this owned audit.json")
    group.add_argument("--check", action="store_true", help="Validate retained hashes/selected data")
    args = parser.parse_args()
    actual = collect()
    check(actual)
    target = OWNED / "audit.json"
    if args.write:
        if target.exists():
            raise FileExistsError("Audit already exists; preserve the retained checkpoint")
        target.write_text(json.dumps(actual, indent=2) + "\n")
        print("Wrote owned read-only audit; no application/browser execution")
    else:
        expected = json.loads(target.read_text())
        if actual != expected:
            raise ValueError("Audit source/artifact checkpoint changed; do not rewrite old proof")
        print("Retained hashes, observations and derived arithmetic pass; no runtime/parity proof")


if __name__ == "__main__":
    main()
