import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Resvg } from "@resvg/resvg-js";
import { renderLatex } from "../../../../src/components/editor/math/math-renderer";
import { renderMathWrite, provenance, type MathWriteInput, type MathWriteOutput } from "../../tools/math-write";

const directory=import.meta.dir;
const repository=resolve(directory,"../../../..");
const corpus:{id:string;source:string;display:"inline"|"block"}[]=await Bun.file(`${directory}/corpus.json`).json();
const originals=await Bun.file(`${directory}/original-results.json`).json();
const diagnostic:({id:string}&MathWriteOutput)[]=await Bun.file(`${directory}/diagnostic-results.json`).json();
const observed=await Bun.file(`${directory}/browser-engine-matched-diagnostic.json`).json();
const sourceBrowser=await Bun.file(`${directory}/browser-source.json`).json();
const fonts=await Bun.file(`${directory}/browser-fonts-engineMatchedDiagnostic.json`).json();
const native=await Bun.file(`${directory}/native-comparison.json`).json();
const request=(source:string,display:"inline"|"block"="inline"):MathWriteInput=>({source,display,fontSizePx:18,color:0x302922,widthPx:600,profile:"engineMatchedDiagnostic"});

test("original wrapper HTML/errors and raw authored whitespace survive every corpus request",async()=>{
  for(const row of corpus) {
    const actual=await renderLatex(row.source,row.display);
    const original=originals.find((candidate:{id:string})=>candidate.id===row.id);
    expect(actual).toEqual({html:original.html,error:original.error});
    const output=await renderMathWrite(request(row.source,row.display));
    expect(output.source).toBe(row.source);
    expect(output.originalHtml).toBe(actual.html);
    expect(output.originalError).toBe(actual.error);
  }
});

test("current Source profile refuses the observed CSS mismatch, with original errors taking precedence",async()=>{
  expect(provenance.engineVersion).toBe("0.18.1");expect(provenance.sourceCssVersion).toBe("0.16.47");
  expect(sourceBrowser.rows.find((row:{id:string})=>row.id==="fraction").sizing).toContain("font-size=21.78px");
  expect(observed.rows.find((row:{id:string})=>row.id==="fraction").sizing).toContain("font-size=15.246px");
  for(const row of corpus) {
    const output=await renderMathWrite({...request(row.source,row.display),profile:"currentSource"});
    expect(output.vector).toBeUndefined();expect(output.fidelity).toBe("refused");
    expect(output.issues[0].kind).toBe(output.originalError?"source":"css-version-mismatch");
  }
});

test("the accepted diagnostic corpus matches measured Chrome natural advances and strut metrics",()=>{
  const vectors=diagnostic.filter(row=>row.vector);
  expect(vectors).toHaveLength(21);
  for(const row of vectors) {
    const browser=observed.rows.find((candidate:{id:string})=>candidate.id===row.id);
    const width=browser.bases.reduce((sum:number,base:string)=>sum+Number(base.match(/(?:^|\s)width=([\d.]+)px/)![1]),0);
    expect(Math.abs(row.vector!.widthPx-width)).toBeLessThan(0.16);
    const struts=fonts.geometry.find((candidate:{id:string})=>candidate.id===row.id).struts;
    const descent=(strut:{styles:Record<string,string>})=>strut.styles["vertical-align"]==="baseline"?0:-parseFloat(strut.styles["vertical-align"]);
    const ascent=Math.max(...struts.map((strut:{styles:Record<string,string>})=>parseFloat(strut.styles.height)-descent(strut)));
    const depth=Math.max(0,...struts.map(descent));
    expect(Math.abs(row.vector!.ascentPx-ascent)).toBeLessThan(0.025);
    expect(Math.abs(row.vector!.descentPx-depth)).toBeLessThan(0.002);
  }
});

test("native resvg renders original glyph outlines without font lookup or paint-frame clipping",()=>{
  for(const row of diagnostic.filter(row=>row.vector)) {
    const vector=row.vector!;
    expect(vector.svg).not.toMatch(/<(?:image|foreignObject|script|text|use)(?:\s|>)|(?:href|src)=|url\(/i);
    const image=new Resvg(vector.svg,{font:{loadSystemFonts:false}}).render();
    expect(image.pixels.some((byte,index)=>index%4===3&&byte>16)).toBe(true);
    const result=native.rows.find((candidate:{id:string})=>candidate.id===row.id).nativeReplay;
    expect(result.outsidePaintFrame).toBe(false);
    expect(result.pngSha256).toBe(createHash("sha256").update(image.asPng()).digest("hex"));
    for(const glyph of vector.glyphs) {
      expect(glyph.glyphId).toBeGreaterThan(0);
      expect(vector.fonts.some(font=>font.name===glyph.font)).toBe(true);
    }
  }
  const integral=diagnostic.find(row=>row.id==="integral")!.vector!;
  expect(integral.paintHeightPx).toBeGreaterThan(integral.heightPx);
  expect(integral.paintBaselinePx+integral.paintOffsetYPx).toBeCloseTo(integral.baselinePx,6);
  const link=diagnostic.find(row=>row.id==="untrusted-link")!.vector!;
  expect(link.paintWidthPx).toBeGreaterThan(link.widthPx);
});

test("all 20 Source TTFs match installed engine bytes; Chrome selected the intended custom faces",async()=>{
  const source=join(repository,"src/components/editor/math/fonts");
  const paths=(await readdir(source)).filter(file=>file.endsWith(".ttf"));
  expect(paths).toHaveLength(20);
  for(const file of paths) {
    const a=await Bun.file(join(source,file)).bytes(),b=await Bun.file(join(repository,"node_modules/katex/dist/fonts",file)).bytes();
    expect(createHash("sha256").update(a).digest("hex")).toBe(createHash("sha256").update(b).digest("hex"));
  }
  expect(fonts.fonts).toHaveLength(8);
  for(const sample of fonts.fonts) {
    expect(sample.missing).toBeUndefined();
    expect(sample.fonts[0].isCustomFont).toBe(true);
    expect(sample.fonts[0].familyName).toStartWith("KaTeX_");
  }
});

test("unsupported overlap/tag/arrow and CJK fallback produce explicit path refusals",async()=>{
  const refused=["accent","unsupported-lap","unsupported-tag","unsupported-unicode-fallback"];
  for(const id of refused) {
    const row=corpus.find(row=>row.id===id)!;
    const output=await renderMathWrite(request(row.source,row.display));
    expect(output.originalError).toBeNull();expect(output.originalHtml.length).toBeGreaterThan(0);
    expect(output.fidelity).toBe("refused");expect(output.vector).toBeUndefined();
    expect(output.issues[0].kind).toBe("unsupported-structure");
    expect(output.issues[0].path).toStartWith("root");
  }
});

test("strict/trust options stay original: remote commands become red source, never network objects",async()=>{
  for(const id of ["untrusted-link","untrusted-image"]) {
    const row=corpus.find(row=>row.id===id)!;
    const output=await renderMathWrite(request(row.source,row.display));
    expect(output.originalError).toBeNull();expect(output.vector).toBeDefined();
    expect(output.originalHtml).toContain("color:#cc0000");
    expect(output.vector!.svg).toContain('fill="#cc0000"');
    expect(output.vector!.svg).not.toMatch(/(?:href|src)=|<image/);
  }
  const strict=await renderMathWrite(request("\\unicodeNotSupported{x}"));
  expect(strict.originalError).not.toContain("KaTeX parse error:");
  expect(strict.originalError).toContain("Undefined control sequence");
});

test("natural inline/block metrics scale from engine data and preserve self-contained SVG path paint",async()=>{
  const source="\\frac{a}{b}";
  const small=await renderMathWrite(request(source));
  const large=await renderMathWrite({...request(source),fontSizePx:36});
  expect(large.vector!.widthPx).toBeCloseTo(small.vector!.widthPx*2,6);
  expect(large.vector!.ascentPx).toBeCloseTo(small.vector!.ascentPx*2,6);
  const block=await renderMathWrite(request(source,"block"));
  expect(block.vector!.heightPx).toBeGreaterThan(small.vector!.heightPx);
  const radical=await renderMathWrite(request("\\sqrt{x}"));
  expect(radical.vector!.svg).toContain('<path stroke="none"');
  expect(radical.vector!.svg).toContain('preserveAspectRatio="xMinYMin slice"');
});

test("invalid requests and oversized authored source remain bounded before engine work",async()=>{
  const tooLarge=await renderMathWrite(request("x".repeat(64*1024+1)));
  expect(tooLarge.issues[0].kind).toBe("budget");expect(tooLarge.originalHtml).toBe("");
  for(const patch of [{fontSizePx:Number.NaN},{fontSizePx:3},{widthPx:4097},{color:0x1000000}]) {
    const output=await renderMathWrite({...request("x"),...patch});
    expect(output.issues[0].kind).toBe("input");expect(output.vector).toBeUndefined();
  }
});

const temporary=await mkdtemp(join(tmpdir(),"twyne-math-write-package-"));
afterAll(()=>rm(temporary,{recursive:true,force:true}));
test("compiled Bun helper embeds engine/CSS/font assets and works from an empty directory",async()=>{
  const executable=join(temporary,"twyne-math-write");
  const empty=join(temporary,"empty");await mkdir(empty);
  const build=Bun.spawn(["rtk","proxy",process.execPath,"build",join(repository,"desktop/gpui/tools/math-write.ts"),"--compile","--outfile",executable],{stdout:"pipe",stderr:"pipe"});
  const [exit,stdout,stderr]=await Promise.all([build.exited,new Response(build.stdout).text(),new Response(build.stderr).text()]);
  if(exit!==0) throw new Error(`Bun compile failed: ${stdout}\n${stderr}`);
  for(const input of [request("\\frac{a+b}{c-d}"),request("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}","block"),request("\\mathbb{R}+\\mathcal{F}+\\mathfrak{g}+\\mathtt{x}+\\mathsf{A}"),{...request("  x+y  "),profile:"currentSource"as const}]) {
    const process=Bun.spawn([executable],{cwd:empty,env:{PATH:""},stdin:Buffer.from(JSON.stringify(input)),stdout:"pipe",stderr:"pipe"});
    const [code,result,error]=await Promise.all([process.exited,new Response(process.stdout).text(),new Response(process.stderr).text()]);
    if(code!==0) throw new Error(`Packaged helper failed: ${error}`);
    expect(JSON.parse(result)).toEqual(await renderMathWrite(input));
  }
},30_000);
