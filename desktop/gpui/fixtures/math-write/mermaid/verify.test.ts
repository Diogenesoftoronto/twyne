import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

const directory = import.meta.dir;
const root = path.resolve(directory, "../../../../..");
const read = (file: string) => fs.readFileSync(path.join(directory, file), "utf8");
const json = (file: string) => JSON.parse(read(file));
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const original = json("browser-original.json");
const replacement = json("browser-replacement.json");
const scoped = json("browser-scoped.json");
const provenance = json("provenance.json");
const cases = ["flow-default", "sequence-default", "flow-legacy", "sequence-legacy"];
const row = (capture: any, id: string) => capture.rows.find((value: any) => value.id === id);

describe("actual Source Mermaid KaTeX CSS isolation", () => {
  test("Source/build/module hashes and original versions remain unchanged", () => {
    expect(original.versions).toEqual({directKatex:"0.18.1",mermaidKatex:"0.16.47",mathMLSupported:true});
    expect(provenance.versions.mermaid).toBe("11.15.0");
    expect(hash(fs.readFileSync(path.join(root,"src/components/editor/math/katex.min.css")))).toBe(provenance.originalSourceHashes.originalVendor);
    expect(hash(fs.readFileSync(path.join(root,"src/components/editor/mermaid-theme.ts")))).toBe(provenance.originalSourceHashes.theme);
    expect(hash(fs.readFileSync(path.join(root,"src/components/editor/math/math.css")))).toBe(provenance.originalSourceHashes.mathWrapper);
    for (const [key,file] of Object.entries<string>(provenance.build)) {
      if (key !== "css") expect(hash(fs.readFileSync(path.join(root,"dist/build",file)))).toBe(provenance.moduleHashes[key]);
    }
    expect(hash(read("original.css"))).toBe(provenance.originalSourceHashes.builtCss);
  });

  test("default MathML is byte/pixel unchanged by a true global replacement", () => {
    for (const id of cases.filter((value)=>value.endsWith("default"))) {
      expect(row(original,id).hasHtmlMath).toBe(false);
      expect(row(replacement,id).svg).toBe(row(original,id).svg);
      expect(hash(fs.readFileSync(path.join(directory,`replacement-${id}.png`)))).toBe(hash(fs.readFileSync(path.join(directory,`original-${id}.png`))));
    }
    expect(original.editorRun.hasHtmlMath).toBe(false);
    expect(replacement.editorRun.hasHtmlMath).toBe(false);
    expect(original.editorRun.svg.attributes.viewBox).toBe(replacement.editorRun.svg.attributes.viewBox);
  });

  test("legacy HTML really regresses under replacement, independently of font timing", () => {
    for (const id of cases.filter((value)=>value.endsWith("legacy"))) {
      const before = row(original,id), after = row(replacement,id);
      expect(before.hasHtmlMath).toBe(true);
      expect(after.hasHtmlMath).toBe(true);
      expect(before.base.styles.display).toBe("inline-block");
      expect(after.base.styles.display).toBe("inline");
      expect(after.svg).not.toBe(before.svg);
      expect(after.inlineSvg.attributes.viewBox).not.toBe(before.inlineSvg.attributes.viewBox);
      expect(hash(fs.readFileSync(path.join(directory,`replacement-${id}.png`)))).not.toBe(hash(fs.readFileSync(path.join(directory,`original-${id}.png`))));
    }
    expect(row(original,"flow-legacy").inlineSvg.attributes.viewBox).toBe("0 0 553.0859375 380.0625");
    expect(row(replacement,"flow-legacy").inlineSvg.attributes.viewBox).toBe("0 0 558.8984375 392.484375");
    expect(row(original,"sequence-legacy").inlineSvg.attributes.viewBox).toBe("-50 -10 450 407");
    expect(row(replacement,"sequence-legacy").inlineSvg.attributes.viewBox).toBe("-50 -10 450 422");
  });

  test("scoped replacement fixes direct math while retaining every Mermaid SVG and PNG", () => {
    for (const id of cases) {
      expect(row(scoped,id).svg).toBe(row(original,id).svg);
      expect(hash(fs.readFileSync(path.join(directory,`scoped-${id}.png`)))).toBe(hash(fs.readFileSync(path.join(directory,`original-${id}.png`))));
    }
    expect(original.direct.strut.styles.display).toBe("inline");
    expect(scoped.direct.strut.styles.display).toBe("inline-block");
    expect(original.direct.sizing.styles["font-size"]).toBe("21.78px");
    expect(scoped.direct.sizing.styles["font-size"]).toBe("15.246px");
  });

  test("returned SVG embeds no KaTeX font faces or HTML layout rules", () => {
    for (const value of original.rows) {
      expect(value.embeddedStyles.length).toBeGreaterThan(0);
      for (const styles of value.embeddedStyles) {
        expect(styles.includes("@font-face")).toBe(false);
        expect(styles.includes(".katex-html")).toBe(false);
        expect(styles.includes(".vlist")).toBe(false);
        expect(styles.includes(".base")).toBe(false);
      }
      expect(value.imageDecoded).toBe(true);
    }
    expect(row(original,"flow-legacy").embeddedStyles[0]).toContain(".node .katex path");
  });

  test("loaded faces relevant to the corpus are exact custom KaTeX, without external requests", () => {
    for (const capture of [original,replacement,scoped]) {
      expect(capture.blockedOrigins).toEqual([]);
      for (const family of ["KaTeX_Main","KaTeX_Math","KaTeX_Size1","KaTeX_Size2","KaTeX_Size3"]) {
        expect(capture.faces.some((face:any)=>face.family===family && face.weight==="400" && face.status==="loaded")).toBe(true);
      }
      expect(row(capture,"flow-legacy").glyph.selectedFonts).toEqual([{familyName:"KaTeX_Math",postScriptName:"KaTeX_Math-Italic",isCustomFont:true,glyphCount:1}]);
    }
  });

  test("proposal keeps original fonts/global vendor rules and scopes both actual Source consumers", () => {
    const candidate = read("scoped-vendor-candidate.css");
    const current = fs.readFileSync(path.join(root,"src/components/editor/math/katex.min.css"),"utf8");
    const source = postcss.parse(current), proposal = postcss.parse(candidate);
    expect(proposal.nodes.slice(0,source.nodes.length).map(node=>node.toString())).toEqual(source.nodes.map(node=>node.toString()));
    const extra = proposal.nodes.slice(source.nodes.length);
    expect(extra.length).toBeGreaterThan(150);
    for (const node of extra) {
      expect(node.type).toBe("rule");
      if (node.type === "rule") expect(node.selector.startsWith(":is(.twyne-math,.twyne-math-source-preview) ")).toBe(true);
    }
    expect(proposal.nodes.filter(node=>node.type==="atrule"&&node.name==="font-face").length).toBe(20);
    expect(provenance.proposedSourceVendor.previewMeasured).toBe(false);
  });
});
