import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
const root=path.resolve(import.meta.dir,"../../../../..");
const own=import.meta.dir;
if(!fs.existsSync(path.join(own,"original-fonts.css")))throw new Error("Prepare the cached original Source font replay first.");
const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const read=(file:string)=>fs.readFileSync(path.join(root,file),"utf8");
const cssNames=fs.readdirSync(path.join(root,"dist/assets")).filter(name=>name.endsWith("-style.css"));
if(cssNames.length!==1)throw new Error("Published Source stylesheet is ambiguous.");
const sourceCss=read(`dist/assets/${cssNames[0]}`);
const installed=read("node_modules/katex/dist/katex.min.css");
const sourceVendor=read("src/components/editor/math/katex.min.css");
if(!sourceVendor.includes("0.16.47")||!installed.includes("0.18.1"))throw new Error("Audited engine/styles versions changed.");
const scope=selectorParser().astSync(":is(.twyne-math,.twyne-math-source-preview)").first!.nodes[0];
const overlay=postcss.parse(installed);
let skippedFaces=0;
for(const node of [...overlay.nodes]){
  if(node.type==="atrule"&&node.name==="font-face"){node.remove();skippedFaces++;continue;}
  if(node.type!=="rule")throw new Error(`Unaudited non-font candidate node: ${node.type}`);
  node.selector=selectorParser(selectors=>selectors.each(selector=>{selector.prepend(selectorParser.combinator({value:" "}));selector.prepend(scope.clone());})).processSync(node.selector);
}
if(skippedFaces!==20)throw new Error("Original retained font face count changed.");
const overlayCss=overlay.toString();
fs.writeFileSync(path.join(own,"original.css"),sourceCss);
fs.writeFileSync(path.join(own,"candidate-overlay.css"),overlayCss);
const outdir=path.join(own,"build");
const build=await Bun.build({entrypoints:[path.join(own,"client.ts")],outdir,target:"browser",format:"esm",splitting:true,plugins:[{name:"published-source-css-is-served-once",setup(api){api.onLoad({filter:/\.css$/},()=>({loader:"css",contents:""}));}}]});
if(!build.success)throw new Error(build.logs.map(log=>log.toString()).join("\n"));
const sourceFiles=["src/root.tsx","src/components/editor/extensions/math.ts","src/components/editor/math/math-source-editor.ts","src/components/editor/math/math-renderer.ts","src/components/editor/math/math.css","src/components/editor/math/katex.min.css",`dist/assets/${cssNames[0]}`,"node_modules/katex/dist/katex.min.css"];
const fontFiles=[...sourceCss.matchAll(/url\(["']?(\/assets\/[^)'"\s]+\.(?:woff2|woff|ttf))["']?\)/g)].map(match=>match[1]);
const originalFonts=Object.fromEntries([...new Set(fontFiles)].map(url=>{const file=path.join(root,"dist",url);return[url,fs.existsSync(file)?hash(fs.readFileSync(file)):null];}));
fs.writeFileSync(path.join(own,"provenance.json"),JSON.stringify({scope:"Isolated Tiptap fixture; actual unmodified Source math NodeViews and source-editor, current published CSS and original local assets. No app route/storage/provider/native raster acceptance.",versions:{tiptap:JSON.parse(read("node_modules/@tiptap/core/package.json")).version,katex:JSON.parse(read("node_modules/katex/package.json")).version,globalVendor:"0.16.47",scopedCandidate:"0.18.1"},sourceHashes:Object.fromEntries(sourceFiles.map(file=>[file,hash(read(file))])),stylesheet:{file:cssNames[0],originalHash:hash(sourceCss),overlayHash:hash(overlayCss),overlayFontFaces:0,retainedVendorFaces:skippedFaces,scopes:[".twyne-math",".twyne-math-source-preview"]},originalFonts,bodyFontReplay:JSON.parse(fs.readFileSync(path.join(own,"font-replay.json"),"utf8")),bundleHashes:Object.fromEntries(build.outputs.map(output=>[path.basename(output.path),hash(fs.readFileSync(output.path))]))},null,2)+"\n");
const mime=(file:string)=>file.endsWith(".css")?"text/css":file.endsWith(".js")?"text/javascript":file.endsWith(".woff2")?"font/woff2":file.endsWith(".woff")?"font/woff":file.endsWith(".ttf")?"font/ttf":"application/octet-stream";
const server=Bun.serve({hostname:"127.0.0.1",port:Number(process.env.NODEVIEW_FIXTURE_PORT??5196),fetch(request){
  const url=new URL(request.url);let file:string|undefined;
  if(url.pathname==="/"){
    const profile=url.searchParams.get("profile")??"original";if(!["original","candidate"].includes(profile))return new Response("Unknown profile",{status:400});
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual Source Math NodeViews / ${profile}</title><link rel="stylesheet" href="/original-fonts.css"><link rel="stylesheet" href="/original.css">${profile==="candidate"?'<link rel="stylesheet" href="/candidate-overlay.css">':''}<style>body{margin:0}.fixture-root{max-width:1024px;padding:24px;margin:auto}.fixture-caption,.fixture-controls{font:14px/20px monospace;margin:0 0 12px}.fixture-case{padding:16px;margin:12px 0;border:1px solid #cbbb96}.fixture-case .ProseMirror{min-height:0}.fixture-controls{display:flex;gap:12px}.fixture-controls button{padding:6px 12px}</style></head><body><main class="fixture-root"><h1 class="fixture-caption">Actual Source Math NodeViews / ${profile}</h1><p class="fixture-caption">Isolated editor fixture, original NodeViews and assets. No storage, accounts or providers.</p><div class="fixture-controls"><button data-testid="fixture-undo">Fixture Undo</button><button data-testid="fixture-redo">Fixture Redo</button><span id="fixture-status">Loading actual NodeViews…</span></div><div id="cases"></div></main><script type="module" src="/build/client.js"></script></body></html>`,{headers:{"content-type":"text/html","Content-Security-Policy":"default-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'none'; img-src 'self' data:; media-src 'none'; frame-src 'none'"}});
  }
  if(url.pathname==="/original.css"||url.pathname==="/candidate-overlay.css"||url.pathname==="/original-fonts.css")file=path.join(own,path.basename(url.pathname));
  else if(url.pathname.startsWith("/build/")&&!url.pathname.includes(".."))file=path.join(outdir,path.basename(url.pathname));
  else if(url.pathname.startsWith("/fonts/")&&!url.pathname.includes(".."))file=path.join(own,"fonts",path.basename(url.pathname));
  else if(url.pathname.startsWith("/assets/")&&!url.pathname.includes(".."))file=path.join(root,"dist/assets",path.basename(url.pathname));
  if(!file||!fs.existsSync(file))return new Response("Not found",{status:404});
  return new Response(Bun.file(file),{headers:{"content-type":mime(file)}});
}});
console.log(`NodeView fixture ready http://127.0.0.1:${server.port}/?profile=original`);
