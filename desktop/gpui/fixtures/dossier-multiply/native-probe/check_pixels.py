#!/usr/bin/env python3
"""Authored, unexecuted framebuffer comparison; no pixels are fed to the app.

Uses existing ImageMagick to decode Root captures. The baseline is the SAME
live scene with its group disabled, not a baked backdrop implementation.
"""
import argparse
import json
import math
from pathlib import Path
import subprocess


def command(argv, env=None):
    return subprocess.run(["rtk", "proxy", *argv], env=env, check=True, stdout=subprocess.PIPE).stdout


def image(path, env=None):
    width, height = map(int, command(["magick", "identify", "-format", "%w %h", str(path)], env).split())
    pixels = command(["magick", str(path), "-depth", "8", "rgb:-"], env)
    if len(pixels) != width * height * 3:
        raise ValueError("Require one decoded RGB frame")

    def read(x, y):
        if not 0 <= x < width or not 0 <= y < height:
            raise ValueError(f"Sample outside actual client: {x},{y}")
        start = (y * width + x) * 3
        return list(pixels[start:start + 3])

    return (width, height), read


def rgba(data, x, y):
    at = (y * data["device_width"] + x) * 4
    blue, green, red, alpha = data["bgra"][at:at + 4]
    return [red / 255, green / 255, blue / 255], alpha / 255


def multiply(destination, group, opacity):
    # Independent standard multiply + SourceOver over an opaque backdrop.
    premultiplied, alpha = group
    straight = [value / alpha if alpha else 0 for value in premultiplied]
    source_alpha = alpha * opacity
    return [
        value * ((1 - source_alpha) + source_alpha * channel)
        for value, channel in zip(destination, straight)
    ]


def over(destination, ordinary):
    straight, alpha = ordinary
    return [channel * alpha + value * (1 - alpha) for value, channel in zip(destination, straight)]


def compare(baseline_path, baseline_receipt, capture_path, receipt, tolerance=2, env=None):
    base_size, base_pixel = image(baseline_path, env)
    actual_size, actual_pixel = image(capture_path, env)
    if base_size != actual_size:
        raise ValueError("Actual client dimensions changed between matched frames")
    if receipt["scale"] != baseline_receipt["scale"]:
        raise ValueError("Use a separately matched baseline for each real DPR")
    if receipt["root_bounds"] != baseline_receipt["root_bounds"]:
        raise ValueError("Root bounds changed; do not compensate with guessed offsets")
    if baseline_receipt["mode"] != "baseline" or baseline_receipt["paint_errors"]:
        raise ValueError("Need an error-free actual baseline submission")
    if receipt["paint_errors"] or receipt["paint_submissions"] < 1:
        raise ValueError("Multiply submission failed; retain error receipt and native log")
    scale = receipt["scale"]
    root = receipt["root_bounds"]
    if not math.isfinite(scale) or scale <= 0 or len(root) != 4:
        raise ValueError("Invalid observed native geometry")
    expected_size = (round(root[2] * scale), round(root[3] * scale))
    if expected_size != actual_size:
        raise ValueError("Capture is not the exact client/root viewport")
    summaries = []
    failures = []
    baseline_failures = []
    sample_count = 0
    strict_identity_count = 0
    black_ink_count = 0
    palette = {"black": [0, 0, 0], "white": [255, 255, 255], "red": [255, 0, 0],
               "green": [0, 255, 0], "blue": [0, 0, 255], "mixed": [128, 64, 32]}
    for region in receipt["regions"]:
        kind = region["kind"]
        group = receipt["images"].get(region["group"])
        sample_width = group["device_width"] if group else round(4 * scale)
        sample_height = group["device_height"] if group else round(4 * scale)
        x0 = (root[0] + region["x"]) * scale
        y0 = (root[1] + region["y"]) * scale
        if x0 != round(x0) or y0 != round(y0):
            raise ValueError("Probe samples need integral device origin")
        max_error = 0
        bad = 0
        for dy in range(sample_height):
            for dx in range(sample_width):
                x, y = round(x0) + dx, round(y0) + dy
                before = base_pixel(x, y)
                got = actual_pixel(x, y)
                destination = [channel / 255 for channel in before]
                clip = region.get("clip")
                inside_clip = not clip or (
                    (root[0] + clip[0]) * scale <= x + 0.5 < (root[0] + clip[0] + clip[2]) * scale and
                    (root[1] + clip[1]) * scale <= y + 0.5 < (root[1] + clip[1] + clip[3]) * scale
                )
                strict_identity = kind == "unchanged" or not inside_clip
                if kind == "late-ordinary":
                    # The underlying native root at this small region is pure
                    # opaque white. Its ordinary translucent sprite is painted
                    # AFTER the explicit multiply barrier in both frames.
                    destination = multiply([1, 1, 1], rgba(group, dx, dy), receipt["opacity"])
                    expected = over(destination, rgba(receipt["images"]["ordinary"], dx, dy))
                    expected_baseline = over([1, 1, 1], rgba(receipt["images"]["ordinary"], dx, dy))
                    if max(abs(round(value * 255) - got_base) for value, got_base in zip(expected_baseline, before)) > tolerance:
                        baseline_failures.append({"name": region["name"], "coordinate": [x, y], "reason": "Ordinary SourceOver baseline"})
                elif group and inside_clip:
                    expected = multiply(destination, rgba(group, dx, dy), receipt["opacity"])
                    if group["bgra"][(dy * sample_width + dx) * 4 + 3] == 0:
                        strict_identity = True
                else:
                    expected = destination
                if region["name"].split("-")[0] in palette:
                    want = palette[region["name"].split("-")[0]]
                    if max(abs(a - b) for a, b in zip(want, before)) > 1:
                        baseline_failures.append({"name": region["name"], "coordinate": [x, y], "reason": "Live opaque quad baseline"})
                if kind == "unchanged":
                    sprite = "hot" if region["name"] == "hot-atlas-sentinel" else "ordinary"
                    expected_baseline = over([1, 1, 1], rgba(receipt["images"][sprite], dx, dy))
                    if max(abs(round(value * 255) - channel) for value, channel in zip(expected_baseline, before)) > tolerance:
                        baseline_failures.append({"name": region["name"], "coordinate": [x, y], "reason": "Unchanged ordinary sprite baseline"})
                want = [round(value * 255) for value in expected]
                error = max(abs(a - b) for a, b in zip(want, got))
                allowed = 0 if strict_identity else tolerance
                if error > allowed:
                    bad += 1
                    if len(failures) < 64:
                        failures.append({"name": region["name"], "coordinate": [x, y],
                                         "before": before, "expected": want, "actual": got,
                                         "max_error": error, "allowed": allowed})
                if region["name"].startswith("live-text") and before == [0, 0, 0]:
                    black_ink_count += 1
                strict_identity_count += int(strict_identity)
                max_error = max(max_error, error)
                sample_count += 1
        summaries.append({"name": region["name"], "samples": sample_width * sample_height,
                          "mismatches": bad, "max_error": max_error})
    mismatches = sum(row["mismatches"] for row in summaries)
    max_error = max(row["max_error"] for row in summaries)
    return {
        "capture": str(capture_path), "mode": receipt["mode"], "actual_client": list(actual_size),
        "real_dpr": scale, "sample_count": sample_count, "strict_identity_samples": strict_identity_count,
        "live_black_glyph_pixels": black_ink_count, "mismatches": mismatches, "maximum_error": max_error,
        "accepted_correct_multiply": mismatches == 0 and not baseline_failures and black_ink_count > 0,
        "wrong_mode_detected": mismatches >= 8 and max_error >= 8 and not baseline_failures,
        "baseline_failures": baseline_failures[:64], "first_failures": failures, "regions": summaries,
        "limitations": ["RGB capture does not measure destination alpha", "atlas adjacency unknown",
                        "resvg versus Chromium radial raster unproved", "adapter/format proof comes from Root logs"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--baseline-receipt", required=True, type=Path)
    parser.add_argument("--capture", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = compare(args.baseline, json.loads(args.baseline_receipt.read_text()),
                     args.capture, json.loads(args.receipt.read_text()))
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    accepted = report["accepted_correct_multiply"] if report["mode"] == "multiply" else report["wrong_mode_detected"]
    raise SystemExit(0 if accepted else 1)


if __name__ == "__main__":
    main()
