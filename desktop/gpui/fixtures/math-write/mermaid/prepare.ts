import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

// Fixture-only CSS transformation. Never writes Source, dist, or app metadata.
const root = path.resolve(import.meta.dir, "../../../../..");
const directory = import.meta.dir;
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(read("dist/q-manifest.json"));
const originBundle = (fragment: string) => {
  const found = Object.entries<any>(manifest.bundles).find(([, bundle]) =>
    bundle.origins?.some((origin: string) => origin.includes(fragment)),
  )?.[0];
  if (!found) throw new Error(`Actual built Source module missing: ${fragment}`);
  return found;
};
const build = {
  theme: originBundle("src/components/editor/mermaid-theme.ts"),
  core: originBundle("mermaid/dist/mermaid.core.mjs"),
  math: originBundle("katex@0.18.1/"),
  mermaidMath: originBundle("mermaid/node_modules/katex/dist/katex.mjs"),
  css: fs.readdirSync(path.join(root, "dist/assets")).find((name) => name.endsWith("-style.css"))!,
};
const sourceCss = read(`dist/assets/${build.css}`);
const originalVendor = read("src/components/editor/math/katex.min.css");
const replacementVendor = read("node_modules/katex/dist/katex.min.css");
const originalAst = postcss.parse(sourceCss);
const faces = originalAst.nodes.filter((node) =>
  node.type === "atrule" && node.name === "font-face" &&
  node.nodes?.some((entry) => entry.type === "decl" && entry.prop === "font-family" && entry.value.startsWith("KaTeX_")),
);
if (faces.length !== 20) throw new Error(`Expected exactly 20 Source KaTeX font faces, got ${faces.length}`);
const start = originalAst.nodes.indexOf(faces[0]);
const end = originalAst.nodes.findIndex((node, index) => index > start && node.type === "rule" && node.selector === ".twyne-math");
if (end < 0) throw new Error("Supplied vendor rules must precede the original .twyne-math wrapper.");
const oldNodes = originalAst.nodes.slice(start, end);
const oldFaces = oldNodes.filter((node) => node.type === "atrule");
if (oldFaces.length !== 20 || !oldNodes.some((node) => node.type === "rule" && node.selector === ".katex .katex-version:after" && node.toString().includes("0.16.47"))) {
  throw new Error("Actual published Source CSS is not the audited 0.16.47 vendor block.");
}
const urls = new Map<string, string>();
const identity = (face: any) => ["font-family", "font-style", "font-weight"].map((property) =>
  face.nodes.find((entry: any) => entry.type === "decl" && entry.prop === property)?.value.replace(/^['"]|['"]$/g, ""),
).join("|");
const sourceVendorFaces = postcss.parse(originalVendor).nodes.filter((node) => node.type === "atrule" && node.name === "font-face");
for (const face of faces) {
  const originalFace = sourceVendorFaces.find((candidate) => identity(candidate) === identity(face));
  if (!originalFace) throw new Error("Published Source font face has no original vendor identity.");
  const srcUrls = (value: any) => [...value.nodes.find((entry: any) => entry.type === "decl" && entry.prop === "src").value.matchAll(/url\(([^)]+)\)/g)].map((match: RegExpMatchArray) => match[1].replace(/^['"]|['"]$/g, ""));
  const authored = srcUrls(originalFace);
  const served = srcUrls(face);
  if (authored.length !== 3 || served.length !== 3) throw new Error("Unexpected Source font format/order.");
  for (let index = 0; index < 3; index++) urls.set(authored[index], served[index]);
}
if (urls.size !== 60) throw new Error(`Expected 60 already served Source font assets, got ${urls.size}`);
const replacementWithServedFonts = replacementVendor.replace(/url\(([^)]+)\)/g, (_, value: string) => {
  const name = value.replace(/^['"]|['"]$/g, "");
  const served = urls.get(name);
  if (!served) throw new Error(`Replacement uses a font absent from the actual Source build: ${name}`);
  return `url(${served})`;
});
const replacementAst = postcss.parse(replacementWithServedFonts);
const replacement = originalAst.clone();
for (const node of replacement.nodes.slice(start, end)) node.remove();
const marker = replacement.nodes[start];
for (const node of replacementAst.nodes) replacement.insertBefore(marker, node.clone());
const scoped = originalAst.clone();
const proposedVendor = postcss.parse(originalVendor);
for (const node of replacementAst.nodes) {
  // Identical font bytes/families are already supplied by the retained Source block.
  if (node.type === "atrule" && node.name === "font-face") continue;
  const copy = node.clone();
  if (copy.type !== "rule") throw new Error(`Unaudited scoped vendor rule: ${copy.type}`);
  copy.selector = selectorParser((selectors) => {
    selectors.each((selector) => {
      selector.prepend(selectorParser.combinator({ value: " " }));
      selector.prepend(selectorParser.className({ value: "twyne-math" }));
    });
  }).processSync(copy.selector);
  scoped.append(copy);
}
// Proposed single-file patch, kept strictly as a review artifact. The extra
// preview scope is required by actual math-source-editor.ts DOM ownership;
// the real editor preview must still be checked after a parent's fresh build.
const candidateRules = postcss.parse(replacementVendor);
const sourceScope = selectorParser().astSync(":is(.twyne-math,.twyne-math-source-preview)").first!.nodes[0];
for (const node of candidateRules.nodes) {
  if (node.type === "atrule" && node.name === "font-face") continue;
  const copy = node.clone();
  if (copy.type !== "rule") throw new Error(`Unaudited candidate rule: ${copy.type}`);
  copy.selector = selectorParser((selectors) => {
    selectors.each((selector) => {
      selector.prepend(selectorParser.combinator({ value: " " }));
      selector.prepend(sourceScope.clone());
    });
  }).processSync(copy.selector);
  proposedVendor.append(copy);
}
const candidateCss = proposedVendor.toString();
fs.writeFileSync(path.join(directory, "scoped-vendor-candidate.css"), candidateCss);
const styles = {
  original: sourceCss,
  replacement: replacement.toString(),
  scoped: scoped.toString(),
};
for (const [profile, css] of Object.entries(styles)) fs.writeFileSync(path.join(directory, `${profile}.css`), css);
const corpus = [
  {
    id: "flow-default", branch: "default-modern-MathML", diagram: "flowchart", legacy: false,
    source: String.raw`flowchart TB
  fraction["$$\frac{1}{1+x^2}$$"] --> radical["$$\sqrt{x^2+y^2}$$"]
  matrix["$$\begin{pmatrix}a&b\\\\c&d\end{pmatrix}$$"] --> text["$$\text{rate}=\frac{\Delta x}{\Delta t}$$"]
  scripts["$$x^{n+1}_{i}$$"] --> delimiter["$$\left\langle\frac{a}{b},\sqrt{c}\right\rangle$$"]
  delimiter --> plain["Source diagram"]`,
  },
  {
    id: "sequence-default", branch: "default-modern-MathML", diagram: "sequenceDiagram", legacy: false,
    source: String.raw`sequenceDiagram
  participant A as Writer
  participant B as Reader
  A->>B: $$\frac{1}{1+x^2}$$
  B-->>A: $$\sqrt{x^2+y^2}$$
  Note over A,B: $$x^{n+1}_{i}$$`,
  },
];
for (const row of [...corpus]) corpus.push({
  ...row, id: row.id.replace("default", "legacy"), branch: "authored-forceLegacyMathML", legacy: true,
  source: "---\nconfig:\n  forceLegacyMathML: true\n---\n" + row.source,
});
fs.writeFileSync(path.join(directory, "corpus.json"), JSON.stringify(corpus, null, 2) + "\n");
const manifestOutput = {
  provenance: "Fixture-only exact published Source stylesheet with its contiguous vendor block replaced, or exact 0.18.1 vendor rules scoped to .twyne-math; original wrappers/nonvendor CSS retained. Source/dist files are never modified.",
  build,
  originalSourceHashes: {
    theme: sha(read("src/components/editor/mermaid-theme.ts")),
    originalVendor: sha(originalVendor),
    replacementVendor: sha(replacementVendor),
    mathWrapper: sha(read("src/components/editor/math/math.css")),
    builtCss: sha(sourceCss),
  },
  moduleHashes: Object.fromEntries(Object.entries(build).filter(([key]) => key !== "css").map(([key, file]) => [key, sha(read(`dist/build/${file}`))])),
  styles: Object.fromEntries(Object.entries(styles).map(([profile, value]) => [profile, { sha256: sha(value), bytes: Buffer.byteLength(value) }])),
  vendorNodeRange: { start, end, count: end - start, faces: faces.length, assetUrls: urls.size },
  vendorRuleCounts: { old: oldNodes.filter((node) => node.type === "rule").length, replacement: replacementAst.nodes.filter((node) => node.type === "rule").length },
  versions: { mermaid: JSON.parse(read("node_modules/mermaid/package.json")).version, directKatex: JSON.parse(read("node_modules/katex/package.json")).version, mermaidKatex: JSON.parse(read("node_modules/.bun/katex@0.16.47/node_modules/katex/package.json")).version },
  proposedSourceVendor: { sha256:sha(candidateCss),bytes:Buffer.byteLength(candidateCss),scopes:[".twyne-math",".twyne-math-source-preview"],applied:false,previewMeasured:false },
};
fs.writeFileSync(path.join(directory, "provenance.json"), JSON.stringify(manifestOutput, null, 2) + "\n");
console.log({ build, styles: manifestOutput.styles, nodes: manifestOutput.vendorNodeRange, cases: corpus.length });
