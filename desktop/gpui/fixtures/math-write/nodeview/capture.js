// Run only in our new session5/owned fixture tab. No page.evaluate DOM/styles.
const fs=require("node:fs");
const dir="/home/diogenes/Projects/twyne/desktop/gpui/fixtures/math-write/nodeview";
const profile=new URL(state.page.url()).searchParams.get("profile");
const viewport=state.page.viewportSize();
const width=viewport.width;
if(!["original","candidate"].includes(profile)||!state.page.url().startsWith("http://127.0.0.1:5196/"))throw new Error("Not our fixture.");
await state.page.waitForFunction(()=>window.nodeviewFixture?.ready===true);
await state.page.evaluate(()=>window.nodeviewFixture.settleFonts());
console.log(await getLatestLogs({page:state.page,sinceLastCall:true}));
console.log(await snapshot({page:state.page,search:/Actual Source|ready|Invalid/}));
const cdp=await getCDPSession({page:state.page});await cdp.send("DOM.enable");await cdp.send("CSS.enable");
let next=Promise.resolve();
function metric(selector){
 const work=next.then(async()=>{
  const {root}=await cdp.send("DOM.getDocument",{depth:0});
  const {nodeId}=await cdp.send("DOM.querySelector",{nodeId:root.nodeId,selector});
  if(!nodeId)return{selector,missing:true};
  const {computedStyle}=await cdp.send("CSS.getComputedStyleForNode",{nodeId});
  const properties=["display","font-family","font-size","font-weight","font-style","line-height","vertical-align","height","width","padding","margin","overflow","position","align-items"];
  const styles=Object.fromEntries(computedStyle.filter(value=>properties.includes(value.name)).map(value=>[value.name,value.value]));
  let box;try{const {model}=await cdp.send("DOM.getBoxModel",{nodeId});const q=model.border;box={x:Math.min(q[0],q[2],q[4],q[6]),y:Math.min(q[1],q[3],q[5],q[7]),width:Math.max(q[0],q[2],q[4],q[6])-Math.min(q[0],q[2],q[4],q[6]),height:Math.max(q[1],q[3],q[5],q[7])-Math.min(q[1],q[3],q[5],q[7]),quad:q};}catch(error){box={unavailable:String(error)};}
  let fonts;try{fonts=await cdp.send("CSS.getPlatformFontsForNode",{nodeId});}catch(error){fonts={unavailable:String(error)};}
  const html=selector.endsWith(" .twyne-math")||selector.endsWith(" .twyne-math-source-preview")?(await cdp.send("DOM.getOuterHTML",{nodeId})).outerHTML:undefined;
  return{selector,box,styles,fonts,html};
 });
 next=work.catch(()=>{});
 return work;
}
state.nodeviewMetric=metric;
const data=await state.page.evaluate(()=>window.nodeviewFixture.data());
const rows=[];
for(const row of data.rows){
  const prefix=`[data-case="${row.id}"]`;
  rows.push({...row,inspected:await inspect({locator:state.page.locator(`${prefix} .twyne-math`),properties:["display","font-family","font-size","line-height","vertical-align"]}),geometry:await Promise.all([" .ProseMirror"," .twyne-math"," .twyne-math-render"," .katex"," .katex-html"," .katex-base"," .katex-strut"," .katex-sizing"," .mord.mathnormal"].map(suffix=>metric(prefix+suffix)))});
}
await state.page.screenshot({path:`${dir}/${profile}-nodes-${width}.png`,scale:"css",fullPage:true});
fs.writeFileSync(`${dir}/${profile}-nodes${width===1280?"":`-${width}`}.json`,JSON.stringify({profile,url:state.page.url(),viewport,browser:await cdp.send("Browser.getVersion"),rows,requests:state.requests.filter(row=>row.url.startsWith("http")),blocked:state.blocked,logs:await getLatestLogs({page:state.page,sinceLastCall:true}),provenance:"Actual imported Source math NodeViews inside installed Tiptap. Geometry/selected fonts from inspect/CDP; canonical HTML/JSON from Editor API. No DOM/style evaluation, app/storage/provider/device activity."},null,2)+"\n");
console.log({profile,rows:rows.length,fraction:rows.find(row=>row.id==="fraction").geometry.filter(row=>row.selector.endsWith(".twyne-math")||row.selector.endsWith(".katex-strut"))});
