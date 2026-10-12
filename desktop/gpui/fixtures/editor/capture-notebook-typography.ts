// Exact Notebook/source CSS/extensions and original 3.008 font on an owned browser.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const output=process.env.TWYNE_NOTEBOOK_TYPOGRAPHY_OUTPUT??"/tmp/twyne-notebook-typography";
await mkdir(output,{recursive:true});
const html=await Bun.file(new URL("../marginalia/browser-manuscript.html",import.meta.url)).text();
const source=await Bun.file(new URL("../../../../src/global.css",import.meta.url)).text();
const theme=source.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1];
if(!theme)throw new Error("Source theme missing");
const css=source.replace(/@import\s+[^;]+;/g,"").replace(/@theme\s*\{[\s\S]*?\n\}/,`:root{${theme}}`);
const preflight=await Bun.file(new URL("../../../../node_modules/tailwindcss/preflight.css",import.meta.url)).text();
let fonts="";
for(const [family,name,weight] of [["Lora","lora-Lora-wght.ttf","400 700"],["Libre Baskerville","librebaskerville-LibreBaskerville-Regular.ttf","400"],["Libre Baskerville","librebaskerville-LibreBaskerville-Bold.ttf","700"]] as const){
  const bytes=await Bun.file(new URL(`../../../../src/assets/typst/${name}`,import.meta.url)).bytes();
  fonts+=`@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/ttf;base64,${Buffer.from(bytes).toString("base64")})}`;
}
const bundle=await Bun.build({entrypoints:[new URL("notebook-typography-web-entry.ts",import.meta.url).pathname],target:"browser",format:"iife"});
if(!bundle.success)throw new Error(bundle.logs.join("\n"));
const browser=await chromium.launch({executablePath:process.env.TWYNE_FIXTURE_CHROME??"/usr/bin/google-chrome",headless:true});
try{
for(const width of [704,554]){
  const page=await browser.newPage({viewport:{width:width+80,height:900},deviceScaleFactor:1});
  let localAssetRequests=0,blockedNetworkRequests=0;
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(/^\/assets\/illuminated-initials\/[a-z](?:-alt)?\.avif$/.test(pathname)){
      localAssetRequests++;
      return route.fulfill({body:Buffer.from(await Bun.file(new URL(`../../../../public${pathname}`,import.meta.url)).bytes()),contentType:"image/avif"});
    }
    blockedNetworkRequests++;
    await route.abort();
  });
  await page.goto("about:blank");
  await page.setContent('<html lang=en><head><base href="http://twyne.fixture/"></head><body><div class="twyne-editor" id=fixture></div></body></html>');
  await page.addStyleTag({content:`${preflight}\n${fonts}\n${css}\nbody{margin:0;padding:40px;background:var(--color-paper)}.twyne-editor{padding:0!important;max-width:none!important;width:${width}px}.ProseMirror{padding:0!important;min-height:0!important}`});
  await page.evaluate(html=>{(window as any).twyneNotebookHtml=html},html);
  await page.addScriptTag({content:await bundle.outputs[0].text()});
  await page.evaluate(async()=>{await document.fonts.ready});
  await page.waitForFunction(()=>!!document.querySelector(".twyne-illuminated-initial.is-illuminated"));
  const proof=await page.evaluate(()=>{
    const rect=(value:Element)=>value.getBoundingClientRect().toJSON();
    const blocks=[...document.querySelectorAll(".ProseMirror > h1,.ProseMirror > h2,.ProseMirror > p")].map(block=>{
      const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
      const lines=new Map<number,{text:string,top:number,left:number,right:number}>();
      const scalars:unknown[]=[];
      let node:Node|null,offset=0;
      while((node=walker.nextNode())){
        let utf16=0;
        for(const character of node.textContent!){
          const range=document.createRange();range.setStart(node,utf16);utf16+=character.length;range.setEnd(node,utf16);
          const box=range.getBoundingClientRect();
          if(!node.parentElement?.closest(".twyne-illuminated-initial")){
            const key=Math.round(box.top*64);
            const line=lines.get(key)??{text:"",top:box.top,left:box.left,right:box.right};
            line.text+=character;line.left=Math.min(line.left,box.left);line.right=Math.max(line.right,box.right);lines.set(key,line);
          }
          scalars.push({offset:offset++,char:character,x:box.right,top:box.top,width:box.width,height:box.height});
        }
      }
      const style=getComputedStyle(block);
      return {tag:block.tagName,source:block.textContent,bounds:rect(block),font:style.font,fontSize:style.fontSize,lineHeight:style.lineHeight,lines:[...lines.values()],scalars};
    });
    const canvas=document.createElement("canvas");const ctx=canvas.getContext("2d")!;
    const measures=[];
    for(const [family,size,weight,phrases] of [
      ["Lora",18,400,["November, its corners had softened and the cover had begun to ","November, its corners had softened and the cover had begun to re‐","November, its corners had softened and the cover had begun to remem‐","re‐","remem‐","remember","‐","⋮⋮","Hgjp"]],
      ["Libre Baskerville",24,600,["A note for the next draft","Hgjp"]],
    ] as const){
      ctx.font=`${weight} ${size}px "${family}"`;ctx.fontKerning="normal";
      for(const text of phrases){const m=ctx.measureText(text);measures.push({family,size,text,width:m.width,fontAscent:m.fontBoundingBoxAscent,fontDescent:m.fontBoundingBoxDescent,inkAscent:m.actualBoundingBoxAscent,inkDescent:m.actualBoundingBoxDescent})}
    }
    const initial=document.querySelector(".twyne-illuminated-initial")!;
    const initialStyle=getComputedStyle(initial);
    return {blocks,measures,initial:{bounds:rect(initial),fontSize:initialStyle.fontSize,margin:initialStyle.margin},html:(window as any).twyneNotebookEditor.getHTML()};
  });
  if(errors.length||blockedNetworkRequests)throw new Error(JSON.stringify({errors,blockedNetworkRequests}));
  await page.locator(".ProseMirror").screenshot({path:`${output}/web-${width}.png`});
  await Bun.write(`${output}/web-${width}.json`,JSON.stringify({width,browser:browser.version(),localAssetRequests,blockedNetworkRequests,...proof},null,2)+"\n");
  console.log(JSON.stringify({width,blockedNetworkRequests,initial:proof.initial,lines:proof.blocks.map(block=>block.lines.map(line=>line.text)),measures:proof.measures.slice(0,3)}));
  await page.close();
}
}finally{await browser.close()}
