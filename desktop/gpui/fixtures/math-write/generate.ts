/** Executed original output + real vector/native replay; never an app mutation. */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { renderLatex } from "../../../../src/components/editor/math/math-renderer";
import { renderMathWrite, provenance, type MathWriteInput } from "../../tools/math-write";

const directory = import.meta.dir;
const corpus: {id:string;source:string;display:"inline"|"block"}[] = await Bun.file(`${directory}/corpus.json`).json();
const original = [];
const diagnostic = [];
const currentSource = [];
const native = [];
const browser = await Bun.file(`${directory}/browser-engine-matched-diagnostic.json`).json();
const widthOf = (observed:string) => {
  const width=observed.match(/(?:^|\s)width=([\d.]+)px/);
  if(!width) throw new Error("Missing observed CSS width.");
  return Number(width[1]);
};
await mkdir(`${directory}/native`,{recursive:true});
function padded(svg:string,width:number,height:number,padding:number) {
  return svg.replace(/^<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${width+padding*2}" height="${height+padding*2}" viewBox="${-padding} ${-padding} ${width+padding*2} ${height+padding*2}">`);
}
function inkBounds(image:ReturnType<Resvg["render"]>) {
  const data=image.pixels;
  let left=image.width,top=image.height,right=-1,bottom=-1,pixels=0;
  for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
    if(data[(y*image.width+x)*4+3]>16) { left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);pixels++; }
  }
  return {left,top,right,bottom,pixels,width:image.width,height:image.height};
}
for(const row of corpus) {
  const source=await renderLatex(row.source,row.display);
  original.push({...row,...source});
  const input:MathWriteInput={source:row.source,display:row.display,fontSizePx:18,color:0x302922,widthPx:600,profile:"engineMatchedDiagnostic"};
  const output=await renderMathWrite(input);
  currentSource.push({id:row.id,...await renderMathWrite({...input,profile:"currentSource"})});
  diagnostic.push({id:row.id,...output});
  const vector=output.vector;
  if(!vector) {native.push({id:row.id,fidelity:output.fidelity,issues:output.issues});continue;}
  const png=new Resvg(vector.svg,{font:{loadSystemFonts:false}}).render().asPng();
  await Bun.write(`${directory}/native/${row.id}.svg`,vector.svg);
  await Bun.write(`${directory}/native/${row.id}.png`,png);
  const padding=16;
  const expanded=new Resvg(padded(vector.svg,vector.paintWidthPx,vector.paintHeightPx,padding),{font:{loadSystemFonts:false}}).render();
  const bounds=inkBounds(expanded);
  const observed=browser.rows.find((candidate:{id:string})=>candidate.id===row.id);
  const browserWidth=observed.bases.reduce((total:number,base:string)=>total+widthOf(base),0);
  native.push({id:row.id,fidelity:output.fidelity,geometry:{widthPx:vector.widthPx,heightPx:vector.heightPx,baselinePx:vector.baselinePx,
    paintWidthPx:vector.paintWidthPx,paintHeightPx:vector.paintHeightPx,paintOffsetXPx:vector.paintOffsetXPx,paintOffsetYPx:vector.paintOffsetYPx,paintBaselinePx:vector.paintBaselinePx},
    browserNaturalWidthPx:browserWidth,naturalWidthDeltaPx:vector.widthPx-browserWidth,
    nativeReplay:{backend:"@resvg/resvg-js 2.6.2, actual native binding; no font database",pngSha256:createHash("sha256").update(png).digest("hex"),ink:bounds,padding,
      outsidePaintFrame:bounds.left<padding-1||bounds.top<padding-1||bounds.right>=padding+Math.ceil(vector.paintWidthPx)||bounds.bottom>=padding+Math.ceil(vector.paintHeightPx)}});
}
await Bun.write(`${directory}/original-results.json`,JSON.stringify(original,null,2)+"\n");
await Bun.write(`${directory}/diagnostic-results.json`,JSON.stringify(diagnostic,null,2)+"\n");
await Bun.write(`${directory}/current-source-results.json`,JSON.stringify(currentSource,null,2)+"\n");
await Bun.write(`${directory}/native-comparison.json`,JSON.stringify({provenance,...provenance,
  comparison:"Native resvg replay of self-contained engine-derived vectors and measured matching-CSS Chrome natural content widths. NOT current Source parity, full line-box/GPUI/GPU/pixel equality proof.",rows:native},null,2)+"\n");
console.log({cases:corpus.length,vectors:diagnostic.filter(row=>row.vector).length,refused:diagnostic.filter(row=>!row.vector).map(row=>({id:row.id,issues:row.issues})),
  maxNaturalWidthDifferencePx:Math.max(...native.flatMap(row=>"naturalWidthDeltaPx"in row?[Math.abs(row.naturalWidthDeltaPx)]:[])),
  overflow:native.filter(row=>"nativeReplay"in row&&row.nativeReplay.outsidePaintFrame).map(row=>({id:row.id,ink:row.nativeReplay.ink,geometry:row.geometry}))});
