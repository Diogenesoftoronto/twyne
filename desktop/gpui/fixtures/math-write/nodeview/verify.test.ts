import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import postcss from "postcss";

const own = import.meta.dir;
const root = path.resolve(own, "../../../../..");
const read = (file: string) => fs.readFileSync(path.join(own, file), "utf8");
const json = (file: string): any => JSON.parse(read(file));
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const provenance = json("provenance.json");
const profiles = ["original", "candidate"];
const ids = ["ordinary", "fraction", "radical", "scripts", "block", "unicode", "invalid", "empty"];
const row = (receipt: any, id: string) => receipt.rows.find((value: any) => value.id === id);
const geometry = (value: any, suffix: string) => value.geometry.find((item: any) => item.selector.endsWith(suffix));
function source(value: any): string {
  if (value.type === "inlineMath" || value.type === "blockMath") return value.attrs.source;
  for (const child of value.content ?? []) {
    const result = source(child);
    if (result !== undefined) return result;
  }
  return undefined as unknown as string;
}
const sourceOf = (receipt: any, id: string) => source(row(receipt, id).json);
const sameDocuments = (a: any, b: any) => {
  expect(a.rows.map((r: any) => ({ id: r.id, html: r.html, json: r.json })))
    .toEqual(b.rows.map((r: any) => ({ id: r.id, html: r.html, json: r.json })));
};
const isFace = (value: any, name: string) => value.fonts.fonts.some((face: any) =>
  face.postScriptName === name && face.isCustomFont && face.glyphCount > 0);

describe("retained actual Source NodeView observations (not a new live-browser run)", () => {
  test("Source, published CSS, installed engine and cached original fonts remain byte-exact", () => {
    expect(provenance.versions).toEqual({ tiptap: "3.22.4", katex: "0.18.1", globalVendor: "0.16.47", scopedCandidate: "0.18.1" });
    for (const [file, expected] of Object.entries(provenance.sourceHashes)) {
      expect(hash(fs.readFileSync(path.join(root, file)))).toBe(expected);
    }
    expect(read("original.css")).toBe(fs.readFileSync(path.join(root, "dist/assets", provenance.stylesheet.file), "utf8"));
    for (const [url, expected] of Object.entries(provenance.originalFonts)) {
      expect(hash(fs.readFileSync(path.join(root, "dist", url)))).toBe(expected);
    }
    const replay = json("font-replay.json");
    expect(hash(read("captured-google-fonts.css"))).toBe(replay.originalCssSha256);
    expect(hash(read("original-fonts.css"))).toBe(replay.localCssSha256);
    expect(replay.files).toHaveLength(7);
    for (const font of replay.files) expect(hash(fs.readFileSync(path.join(own, "fonts", font.file)))).toBe(font.sha256);
    expect(read("client.ts")).toContain('from "../../../../../src/components/editor/extensions/math"');
    expect(read("client.ts")).not.toContain("createMathSourceEditor(");
  });

  test("candidate has only scoped engine rules and retains the global stylesheet/font faces", () => {
    const candidate = postcss.parse(read("candidate-overlay.css"));
    expect(hash(read("candidate-overlay.css"))).toBe(provenance.stylesheet.overlayHash);
    candidate.walkAtRules(() => { throw new Error("Candidate must not replace global fonts or install other at-rules."); });
    candidate.walkRules((rule) => {
      for (const selector of rule.selectors) expect(selector.trim().startsWith(":is(.twyne-math,.twyne-math-source-preview) ")).toBe(true);
    });
    expect(provenance.stylesheet.retainedVendorFaces).toBe(20);
    expect(provenance.stylesheet.overlayFontFaces).toBe(0);
  });

  test("identical authored documents and rendered DOM are compared at both viewport widths", () => {
    for (const width of [1280, 620]) {
      const suffix = width === 1280 ? "" : `-${width}`;
      const a = json(`original-nodes${suffix}.json`);
      const b = json(`candidate-nodes${suffix}.json`);
      sameDocuments(a, b);
      expect(a.rows.map((r: any) => r.id)).toEqual(ids);
      expect(a.viewport).toEqual({ width, height: 860 });
      expect(b.viewport).toEqual(a.viewport);
      for (const id of ids) {
        expect(geometry(row(a, id), " .twyne-math").html).toBe(geometry(row(b, id), " .twyne-math").html);
        expect(row(a, id).html).not.toMatch(/katex|source-preview|<form/);
      }
    }
  });

  test("published current CSS mismatch and candidate repair occur in actual visible NodeViews", () => {
    for (const width of [1280, 620]) {
      const suffix = width === 1280 ? "" : `-${width}`;
      const a = json(`original-nodes${suffix}.json`);
      const b = json(`candidate-nodes${suffix}.json`);
      for (const id of ids.slice(0, 6)) {
        expect(geometry(row(a, id), " .katex-strut").styles.display).toBe("inline");
        expect(geometry(row(b, id), " .katex-strut").styles.display).toBe("inline-block");
      }
      for (const id of ["fraction", "scripts", "radical"]) {
        expect(geometry(row(a, id), " .katex-sizing").styles["font-size"]).toBe("21.78px");
        expect(geometry(row(b, id), " .katex-sizing").styles["font-size"]).toBe("15.246px");
      }
      expect(geometry(row(a, "fraction"), " .twyne-math").box.width).toBe(57.9375);
      expect(geometry(row(b, "fraction"), " .twyne-math").box.width).toBe(39.9375);
      // Ordinary math and the invalid/empty fallback are deliberately unchanged.
      for (const id of ["ordinary", "invalid", "empty"]) {
        expect(geometry(row(a, id), " .twyne-math").box.width).toBe(geometry(row(b, id), " .twyne-math").box.width);
        expect(geometry(row(a, id), " .twyne-math").box.height).toBe(geometry(row(b, id), " .twyne-math").box.height);
      }
    }
  });

  test("both profiles select actual original custom Lora and KaTeX faces", () => {
    for (const profile of profiles) for (const width of [1280, 620]) {
      const suffix = width === 1280 ? "" : `-${width}`;
      const nodes = json(`${profile}-nodes${suffix}.json`);
      for (const id of ids) expect(isFace(geometry(row(nodes, id), " .ProseMirror"), "Lora-Regular")).toBe(true);
      for (const id of ids.slice(0, 6)) expect(isFace(geometry(row(nodes, id), " .mord.mathnormal"), "KaTeX_Math-Italic")).toBe(true);
      const previews = json(`${profile}-previews${suffix}.json`);
      for (const id of ids.slice(0, 6)) {
        const span = geometry(row(previews, id), " .twyne-math-source-preview .mord.mathnormal");
        expect(span.box.height).toBeGreaterThan(0); // Excludes the hidden original NodeView render.
        expect(isFace(span, "KaTeX_Math-Italic")).toBe(true);
      }
    }
  });

  test("eight actual source previews per profile/width stay transient and Cancel preserves canonical data", () => {
    for (const profile of profiles) for (const width of [1280, 620]) {
      const suffix = width === 1280 ? "" : `-${width}`;
      const baseline = json(`${profile}-nodes${suffix}.json`);
      const preview = json(`${profile}-previews${suffix}.json`);
      expect(preview.rows.map((r: any) => r.id)).toEqual(ids);
      sameDocuments(baseline, preview.final);
      for (const id of ids) {
        const value = row(preview, id);
        expect(value.value).toBe(sourceOf(baseline, id));
        expect(value.html).toBe(row(baseline, id).html);
        expect(value.snapshot).toContain("Render equation");
        expect(value.snapshot).toContain("Cancel");
        expect(geometry(value, " .twyne-math-source-input").box.width).toBeGreaterThan(0);
      }
      expect(row(preview, "empty").snapshot).toContain("A live preview of the equation appears here.");
      expect(row(preview, "invalid").snapshot).toContain("Invalid LaTeX");
    }
  });

  test("candidate applies to the visible source preview rather than only its hidden saved render", () => {
    for (const width of [1280, 620]) {
      const suffix = width === 1280 ? "" : `-${width}`;
      const a = json(`original-previews${suffix}.json`);
      const b = json(`candidate-previews${suffix}.json`);
      for (const id of ["fraction", "radical", "scripts"]) {
        expect(geometry(row(a, id), " .twyne-math-source-preview .katex-sizing").styles["font-size"]).toBe("18.392px");
        expect(geometry(row(b, id), " .twyne-math-source-preview .katex-sizing").styles["font-size"]).toBe("12.8744px");
      }
      expect(geometry(row(a, "fraction"), " .twyne-math-source-preview-output").box.width).toBe(48.90625);
      expect(geometry(row(b, "fraction"), " .twyne-math-source-preview-output").box.width).toBe(33.71875);
      for (const id of ids.slice(0, 6)) {
        expect(geometry(row(a, id), " .twyne-math-source-preview").html).toBe(geometry(row(b, id), " .twyne-math-source-preview").html);
      }
    }
  });

  test("real Render/keyboard/Tiptap Undo/Redo and Cancel preserve exact authored strings", () => {
    for (const profile of profiles) {
      const receipt = json(`${profile}-interactions.json`);
      expect(receipt.steps).toHaveLength(30);
      const at = (name: string) => receipt.steps.find((step: any) => step.name === name).receipt;
      expect(sourceOf(at("type a held fraction"), "ordinary")).toBe("x+1");
      expect(sourceOf(at("Render equation commits exact authored whitespace"), "ordinary")).toBe("  \\frac{a}{b}  ");
      expect(sourceOf(at("real keyboard Undo"), "ordinary")).toBe("x+1");
      expect(sourceOf(at("real keyboard Redo"), "ordinary")).toBe("  \\frac{a}{b}  ");
      expect(sourceOf(at("Cancel discards only unsubmitted input"), "fraction")).toBe(sourceOf(receipt.baseline, "fraction"));
      expect(sourceOf(at("Escape cancels without rewriting source"), "ordinary")).toBe("  \\frac{a}{b}  ");
      expect(sourceOf(at("inline Enter commits via source form"), "ordinary")).toBe("x^{n+1}");
      expect(sourceOf(at("plain block Enter adds newline, not submit"), "block")).toBe(sourceOf(receipt.baseline, "block"));
      expect(receipt.heldBlock).toBe("\\frac{1}{x}\n");
      expect(sourceOf(at("Control Enter commits exact held block rope"), "block")).toBe(receipt.heldBlock);
      expect(sourceOf(at("actual Tiptap toolbar Undo block"), "block")).toBe(sourceOf(receipt.baseline, "block"));
      expect(sourceOf(at("actual Tiptap toolbar Redo block"), "block")).toBe(receipt.heldBlock);
      expect(sourceOf(receipt.final, "empty")).toBe("");
      expect(sourceOf(receipt.final, "invalid")).toBe("\\unknownfixturecommand");
      for (const result of receipt.final.rows) expect(result.html).not.toMatch(/katex|source-preview|<form/);
      for (const id of ["fraction", "radical", "scripts", "unicode", "empty"]) expect(row(receipt.final, id).json).toEqual(row(receipt.baseline, id).json);
    }
    sameDocuments(json("original-interactions.json").final, json("candidate-interactions.json").final);
  });

  test("fixture observations use only localhost requests and final runs have no browser errors", () => {
    for (const profile of profiles) for (const width of [1280, 620]) {
      const suffix = width === 1280 ? "" : `-${width}`;
      const nodes = json(`${profile}-nodes${suffix}.json`);
      expect(nodes.requests.length).toBeGreaterThan(4);
      expect(nodes.blocked).toEqual([]);
      for (const request of nodes.requests) expect(new URL(request.url).origin).toBe("http://127.0.0.1:5196");
      expect(nodes.logs).toEqual([]);
      expect(json(`${profile}-previews${suffix}.json`).logs).toEqual([]);
    }
    for (const profile of profiles) for (const step of json(`${profile}-interactions.json`).steps) expect(step.logs).toEqual([]);
  });
});
