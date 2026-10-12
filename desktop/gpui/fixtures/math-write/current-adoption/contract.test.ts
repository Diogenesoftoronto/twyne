import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  atomEdge, completionMatches, diagnosticSpan, placeSpan,
  productWriteAdmitted, rasterKey, rowExtents,
  type CompletionToken, type DiagnosticSpan,
} from "./contract";

const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
// Read the frozen originals. No fixtures are generated or copied here.
const current = read("../current-css/results.json");
const source = read("../current-source-results.json");
const engine = read("../diagnostic-results.json");
const browser = read("../current-css/browser-glyphs.json");
const candidate = read("../nodeview/candidate-nodes.json");

describe("unmounted current Source geometry adoption contract", () => {
  test("all admitted spans preserve advance and signed paint-baseline placement", () => {
    const admitted = current.filter((output: any) => diagnosticSpan(output));
    expect(admitted).toHaveLength(11);
    for (const output of admitted) {
      const span = diagnosticSpan(output)!;
      const placed = placeSpan(span, 103.25, 301.5);
      expect(placed.logical.width).toBe(output.vector.widthPx);
      expect(placed.logical.height).toBe(output.vector.ascentPx + output.vector.descentPx);
      expect(placed.paint.y + span.paintBaseline).toBeCloseTo(placed.baseline, 8);
      expect(placed.paint.x).toBeLessThanOrEqual(placed.logical.x);
      expect(placed.paint.y).toBeLessThanOrEqual(placed.logical.y);
      expect(atomEdge(span, 1)).toBe(span.advance);
    }
  });

  test("existing image-frame substitution fails for the real fraction reference", () => {
    const span = diagnosticSpan(current[1])!;
    const placed = placeSpan(span, 228.640625, 321.484375);
    const legacyLogicalHeight = span.paintHeight;
    const legacyFontBoxBaseline = span.paintBaseline;
    expect(legacyLogicalHeight).not.toBe(placed.logical.height);
    expect(legacyFontBoxBaseline).not.toBe(span.ascent);
    expect(placed.logical.y).toBe(301.484375);
    expect(placed.paint.y + span.paintBaseline).toBeCloseTo(321.484375, 8);
    expect(placed.logical.height).toBe(26);
  });

  test("real NodeView outer flow differs from both font box and paint bounds", () => {
    for (const id of ["ordinary", "fraction", "radical", "scripts"]) {
      const row = browser.rows.find((row: any) => row.id === id);
      const output = current.find((output: any) => output.source === row.source && output.display === "inline");
      const span = diagnosticSpan(output)!;
      const wrapper = row.nodes[".twyne-math"].box;
      expect(wrapper.height).not.toBe(span.ascent + span.descent);
      expect(wrapper.height).not.toBe(span.paintHeight);
      expect(wrapper.width).toBe(span.advance);
    }
  });

  test("a candidate CSS capture cannot be substituted for the current Source reference", () => {
    const original = browser.rows.find((row: any) => row.id === "fraction");
    const changed = candidate.rows.find((row: any) => row.id === "fraction");
    // Different receipt shapes are intentional: inspect/CDP records retained.
    const changedWidth = changed.geometry.find((node: any) => node.selector.endsWith(" .twyne-math"))?.box.width;
    expect(changedWidth).toBeDefined();
    expect(changedWidth).not.toBe(original.nodes[".twyne-math"].box.width);
  });

  test("default Source, engine diagnostic, and block never become this span", () => {
    for (const output of [...source, ...engine]) expect(diagnosticSpan(output)).toBeNull();
    expect(current[4].issues[0].kind).toBe("current-css-display-flow");
    expect(diagnosticSpan(current[4])).toBeNull();
    const relabeled = { ...current[1], profile: "currentSource" };
    expect(diagnosticSpan(relabeled)).toBeNull();
  });

  test("real unsupported Unicode/text and parse/empty errors remain distinct", () => {
    expect(current[5].issues[0].kind).toBe("current-css-structure");
    expect(current[5].originalError).toBeNull();
    for (const index of [6, 7]) {
      expect(current[index].issues[0].kind).toBe("source");
      expect(current[index].originalError).toBeString();
      expect(diagnosticSpan(current[index])).toBeNull();
    }
  });

  test("font/CSS policy drift refuses the diagnostic seam", () => {
    expect(diagnosticSpan({ ...current[1], sourceCssSha256: "0".repeat(64) })).toBeNull();
    expect(diagnosticSpan({ ...current[1], cssGeometry: { ...current[1].cssGeometry, layoutModel: "unverified-other-os" } })).toBeNull();
  });

  test("synthetic horizontal ink overhang cannot enlarge the one-scalar advance", () => {
    // Arithmetic boundary only. This is not a formula or browser reference.
    const span: DiagnosticSpan = {
      advance: 10, ascent: 7, descent: 2, paintWidth: 14, paintHeight: 13,
      paintOffsetX: -3, paintOffsetY: -2, paintBaseline: 9,
    };
    const placed = placeSpan(span, 50, 90);
    expect(placed.logical).toEqual({ x: 50, y: 83, width: 10, height: 9 });
    expect(placed.paint).toEqual({ x: 47, y: 81, width: 14, height: 13 });
    expect(atomEdge(span, 0)).toBe(0);
    expect(atomEdge(span, 1)).toBe(10);
  });

  test("invalid numeric placement refuses rather than poisoning layout", () => {
    const span = diagnosticSpan(current[1])!;
    expect(() => placeSpan(span, NaN, 0)).toThrow();
    expect(() => placeSpan({ ...span, paintOffsetY: 1 }, 0, 20)).toThrow();
    expect(() => placeSpan({ ...span, paintBaseline: 1 }, 0, 20)).toThrow();
  });

  test("supplied row boxes reserve maximum above and below separately", () => {
    // A producer must supply real admitted wrapper baselines. These synthetic
    // unequal extents expose why max(total height) alone is insufficient.
    expect(rowExtents([{ above: 22, below: 10 }, { above: 10, below: 22 }]))
      .toEqual({ above: 22, below: 22, height: 44 });
  });

  test("exact completion refuses every reused owner/renderer/form/revision boundary", () => {
    const currentToken: CompletionToken = {
      owner: "folio-A/editor-1", rendererEpoch: 3, requestId: "job-7", generation: 9,
      expectedNode: "held-node-A", scalar: 12, payloadKey: "exact-style-and-raw-source",
    };
    expect(completionMatches(currentToken, { ...currentToken })).toBe(true);
    const changes: Partial<CompletionToken>[] = [
      { owner: "folio-B/editor-1" }, { rendererEpoch: 4 }, { requestId: "job-8" },
      { generation: 10 }, { expectedNode: "new-node-at-same-path" }, { scalar: 13 },
      { payloadKey: "same-trimmed-source-with-different-raw-bytes" },
    ];
    for (const change of changes)
      expect(completionMatches(currentToken, { ...currentToken, ...change })).toBe(false);
  });

  test("DPR or renderer policy changes the prepared raster key without changing span geometry", () => {
    const stamp = { vectorDigest: "svg-sha", rendererPolicy: "unverified-linux-policy", dpr: 1, deviceWidth: 58, deviceHeight: 33 };
    const first = rasterKey(stamp);
    expect(rasterKey({ ...stamp, dpr: 2, deviceWidth: 116, deviceHeight: 65 })).not.toBe(first);
    expect(rasterKey({ ...stamp, rendererPolicy: "unverified-other-os" })).not.toBe(first);
    expect(() => rasterKey({ ...stamp, dpr: Infinity })).toThrow();
  });

  test("no old or new diagnostic profile is authorized for product Write", () => {
    for (const output of [...current, ...source, ...engine])
      expect(productWriteAdmitted(output)).toBe(false);
  });
});
