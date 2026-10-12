// Read only task-owned rendered module nodes through the documented CDP seam.
const fs = require("node:fs");
const directory = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/math-write";
console.log(await snapshot({page:state.mathWritePage,search:/ordinary|fraction|font-roster/}));
const cdp = await getCDPSession({page:state.mathWritePage});
await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
const {root} = await cdp.send("DOM.getDocument");
const selections = [
  ["main", '[data-math-case="ordinary"] .katex-html .mbin'],
  ["mathItalic", '[data-math-case="ordinary"] .katex-html .mathnormal'],
  ["size2", '[data-math-case="integral"] .katex-html .op-symbol'],
  ["ams", '[data-math-case="font-roster"] .katex-html .mathbb'],
  ["caligraphic", '[data-math-case="font-roster"] .katex-html .mathcal'],
  ["fraktur", '[data-math-case="font-roster"] .katex-html .mathfrak'],
  ["typewriter", '[data-math-case="font-roster"] .katex-html .mathtt'],
  ["sans", '[data-math-case="font-roster"] .katex-html .mathsf'],
];
const fonts = [];
for(const [label,selector] of selections) {
  const {nodeId} = await cdp.send("DOM.querySelector",{nodeId:root.nodeId,selector});
  if(!nodeId) {fonts.push({label,selector,missing:true});continue;}
  fonts.push({label,selector,...await cdp.send("CSS.getPlatformFontsForNode",{nodeId})});
}
const geometry = [];
const rows=await state.mathWritePage.evaluate(()=>window.mathReferenceRows.map(row=>({id:row.id,error:row.error})));
for(const row of rows.filter(row=>!row.error)) {
  const {nodeIds}=await cdp.send("DOM.querySelectorAll",{nodeId:root.nodeId,selector:`[data-math-case="${row.id}"] .katex-html .katex-base > .katex-strut`});
  const struts=[];
  for(const nodeId of nodeIds) {
    const {computedStyle}=await cdp.send("CSS.getComputedStyleForNode",{nodeId});
    const styles=Object.fromEntries(computedStyle.filter(prop=>["font-size","height","vertical-align","display"].includes(prop.name)).map(prop=>[prop.name,prop.value]));
    const {model}=await cdp.send("DOM.getBoxModel",{nodeId});
    struts.push({styles,borderQuad:model.border,width:model.width,height:model.height});
  }
  geometry.push({id:row.id,struts});
}
const profile=state.mathWriteDiagnostic===true?"engineMatchedDiagnostic":"currentSource";
fs.writeFileSync(`${directory}/browser-fonts-${profile}.json`,JSON.stringify({profile,
  provenance:"Actual Chrome selected fonts and strut box/style observations on task-owned original module fixture; no application metadata or manuscript changes",fonts,geometry},null,2)+"\n");
console.log({profile,fonts});
console.log(await getLatestLogs({page:state.mathWritePage,sinceLastCall:true}));
