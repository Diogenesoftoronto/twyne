// Execute in Root's owned blank Playwriter session. Each run loads the exact
// bundled face. No original editor, application storage or network is accessed.
const urlFs = require("node:fs");
const urlCrypto = require("node:crypto");
const urlRoot = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/host-apparatus";
const urlBoard = JSON.parse(urlFs.readFileSync(urlRoot + "/browser-url-wrap-observations.json", "utf8"));
if (state.page.url() !== "about:blank") throw new Error("Use the owned blank probe page");
const urlFontBytes = urlFs.readFileSync(urlBoard.fontFile);
const urlRows = await state.page.evaluate(async ({rows,fontBytes}) => {
  const face = await new FontFace("Twyne Page URL Probe",new Uint8Array(fontBytes).buffer,{weight:"400",style:"normal"}).load();
  document.fonts.add(face);
  await document.fonts.ready;
  if (face.status !== "loaded") throw new Error("The bundled probe face is missing");
  document.body.replaceChildren();
  const observations = [];
  for (const row of rows) {
    const element = document.createElement("div");
    element.style.cssText = "font:400 10.4px/15.6px 'Twyne Page URL Probe';letter-spacing:normal;white-space:normal;overflow-wrap:normal;word-break:break-all";
    element.style.width = row.width + "px";
    element.textContent = row.label;
    document.body.append(element);
    const text = element.firstChild;
    const lines = [];
    let previousY;
    for (let index = 0; index < row.label.length; index++) {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      const rect = range.getBoundingClientRect();
      if (previousY === undefined || Math.abs(rect.y - previousY) > 0.2) {
        lines.push("");
        previousY = rect.y;
      }
      lines[lines.length - 1] += row.label[index];
    }
    observations.push({label:row.label,width:row.width,height:element.getBoundingClientRect().height,lines});
    element.remove();
  }
  return observations;
}, {rows:urlBoard.rows,fontBytes:Array.from(urlFontBytes)});
const urlReceipt = {
  provenance:"Authored ASCII URLs in an owned blank Chrome150 page with exact bundled Noto Sans Mono2.014, using the original full-page URL computed CSS; no application editor, storage or network requests.",
  originalStyleObservations:"../apparatus-view/browser-page-1280.json and browser-page-620.json",
  fontFile:urlBoard.fontFile,
  fontSha256:urlCrypto.createHash("sha256").update(urlFontBytes).digest("hex"),
  css:{fontSize:10.4,lineHeight:15.6,letterSpacing:0,whiteSpace:"normal",overflowWrap:"normal",wordBreak:"break-all"},
  rows:urlRows
};
if (urlReceipt.fontSha256 !== urlBoard.fontSha256) throw new Error("The probe font changed");
urlFs.writeFileSync(urlRoot + "/browser-page-url-wrap-observations.json",JSON.stringify(urlReceipt,null,2)+"\n");
console.log(JSON.stringify({output:"browser-page-url-wrap-observations.json",cases:urlRows.length,fontSha256:urlReceipt.fontSha256}));
