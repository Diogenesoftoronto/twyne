// Render the actual Source editor in a fresh, offline browser context.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const output = process.argv[2];
const captureControls = process.argv.includes("--controls");
if (!output) throw new Error("A new owned output directory is required");
await mkdir(output, {recursive:false});
const origin = process.env.TWYNE_GENUI_SOURCE_URL ?? "http://127.0.0.1:5207";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("Local Source origin required");
const html = await readFile("desktop/gpui/fixtures/gen-ui/manuscript.html","utf8");
const inputPaths = ["src/global.css","src/components/in-flow/tool-renderer.tsx","src/components/in-flow/margin-rail.tsx","src/components/ui/numeric-stepper.tsx","src/components/editor/extensions/struggle-tracker.ts","src/utils/in-flow-tools.ts","desktop/gpui/fixtures/gen-ui/manuscript.html","desktop/gpui/fixtures/gen-ui/capture-source.ts"];
const hashes = Object.fromEntries(await Promise.all(inputPaths.map(async path=>[path,createHash("sha256").update(await readFile(path)).digest("hex")])));
const receipt:any = {status:"running",origin,viewport:{width:1280,height:860},deviceScaleFactor:1,hashes,cases:[],errors:[],scope:"Actual Source editor with isolated IDB, no signed-in account or configured model; browser renderer rather than Electrobun host"};
await writeFile(resolve(output,"receipt.json"),JSON.stringify(receipt,null,2)+"\n");
const browser=await chromium.launch({executablePath:process.env.TWYNE_FIXTURE_CHROME??"/usr/bin/google-chrome",headless:true});
try {
  const context=await browser.newContext({viewport:receipt.viewport,deviceScaleFactor:1});
  await context.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin) return route.continue();
    if(["fonts.googleapis.com","fonts.gstatic.com"].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  const page=await context.newPage();
  page.on("pageerror",error=>receipt.errors.push(error.message));
  await page.route(/\/api\/auth\//,route=>route.fulfill({contentType:"application/json",body:"null"}));
  await page.route("**/__genui-seed",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><title>Writing tools seed</title>"}));
  await page.goto(origin+"/__genui-seed");
  await page.evaluate(async html=>{
    const idb=await import(/* @vite-ignore */ "/src/utils/idb.ts");
    const now=Date.now();
    await idb.saveFoliosToIdb([{id:"native-genui-fixture",name:"Writing tools",type:"draft",createdAt:now,updatedAt:now}]);
    await idb.saveFolioContentToIdb("native-genui-fixture",html);
    await idb.saveActiveFolioIdToIdb("native-genui-fixture");
    await idb.saveMetaToIdb("signin-toast-dismissed",true);
  },html);
  await page.goto(origin+"/editor/?platform=desktop");
  await expect(page.locator(".ProseMirror")).toContainText("First😀",{timeout:90_000});
  const zen=page.getByRole("button",{name:"Toggle Zen mode",exact:true});
  if(await zen.getAttribute("aria-pressed")==="true") await zen.click();
  await page.evaluate(()=>document.fonts.ready);
  for(const kind of ["sentence-lab","rhythm-strip","claim-check","reader-questions"]) {
    await page.evaluate(kind=>window.dispatchEvent(new CustomEvent("twyne:in-flow-open",{detail:{kind}})),kind);
    const card=page.locator(".in-flow-card");
    await expect(card).toBeVisible({timeout:30_000});
    await expect(card).toContainText(kind==="sentence-lab"?"Sentence Lab":kind==="rhythm-strip"?"Rhythm Strip":kind==="claim-check"?"Claim Check":"Reader Questions");
    await page.mouse.move(0,0);
    await page.evaluate(()=>document.fonts.ready);
    await card.screenshot({path:resolve(output,kind+"-card.png"),animations:"disabled"});
    await page.screenshot({path:resolve(output,kind+"-full.png"),animations:"disabled"});
    const observed=await card.evaluate(element=>{
      const rect=(node:Element)=>{const b=node.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}};
      const selectors=[".in-flow-card__head",".in-flow-card__title",".in-flow-card__close",".in-flow-card__reason",".in-flow-label",".in-flow-mini",".in-flow-slot",".in-flow-slot input",".in-flow-input",".in-flow-textarea",".in-flow-actions",".in-flow-card__notice",".in-flow-card__foot",".in-flow-link",".in-flow-band",".numeric-stepper",".numeric-stepper input",".numeric-stepper button"];
      const nodes=selectors.flatMap(selector=>Array.from(element.querySelectorAll(selector)).map(node=>{
        const style=getComputedStyle(node);
        return {selector,text:node.textContent,rect:rect(node),fontFamily:style.fontFamily,fontWeight:style.fontWeight,fontSize:style.fontSize,lineHeight:style.lineHeight,color:style.color,background:style.backgroundColor,border:style.border,display:style.display,gap:style.gap};
      }));
      const style=getComputedStyle(element);
      return {rect:rect(element),text:element.textContent,fontFamily:style.fontFamily,fontSize:style.fontSize,lineHeight:style.lineHeight,nodes};
    });
    const fontFaces=await page.evaluate(()=>Array.from(document.fonts).map(face=>({family:face.family,weight:face.weight,style:face.style,status:face.status})));
    const controls:any[] = [];
    if(captureControls && kind === "rhythm-strip") {
      const minimum = card.getByRole("spinbutton",{name:"Shortest comfortable sentence, in words",exact:true});
      const maximum = card.getByRole("spinbutton",{name:"Longest comfortable sentence, in words",exact:true});
      const record = async (action:string) => controls.push({action,min:await minimum.inputValue(),max:await maximum.inputValue()});
      await record("initial");
      const initialMin = Number(await minimum.inputValue());
      await minimum.focus();
      await minimum.press("ArrowUp");
      await expect(minimum).toHaveValue(String(initialMin + 1));
      await record("minimum ArrowUp");
      await minimum.press("ArrowDown");
      await expect(minimum).toHaveValue(String(initialMin));
      await record("minimum ArrowDown");
      await minimum.fill("79");
      await expect(minimum).toHaveValue("79");
      await expect(maximum).toHaveValue("80");
      await record("minimum typed 79");
      await maximum.fill("200");
      await expect(maximum).toHaveValue("120");
      await record("maximum typed 200");
      await minimum.fill("");
      await maximum.focus();
      await expect(minimum).toHaveValue("");
      await record("minimum cleared and blurred");
      await minimum.focus();
      await minimum.press("ArrowUp");
      await record("empty minimum ArrowUp");
      await page.mouse.move(0,0);
      await card.screenshot({path:resolve(output,kind+"-controls-card.png"),animations:"disabled"});
    }
    receipt.cases.push({kind,observed,fontFaces,controls});
    await card.getByRole("button",{name:"Dismiss this tool",exact:true}).click();
    await expect(card).toHaveCount(0);
  }
  receipt.status="captured";
  await context.close();
} catch(error) {
  receipt.status="failed";
  receipt.failure=error instanceof Error?error.message:String(error);
  throw error;
} finally {
  await writeFile(resolve(output,"receipt.json"),JSON.stringify(receipt,null,2)+"\n");
  await browser.close();
}
console.log(JSON.stringify({output,status:receipt.status,cases:receipt.cases.length,pageErrors:receipt.errors.length}));
