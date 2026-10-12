// Execute only in the isolated original Twyne app after opening its Board.
// The owning session must restore Board afterward; this script does not mutate UI.
const fs = require("node:fs");
const cdp = await getCDPSession({ page: state.page });
await cdp.send("DOM.enable");
await cdp.send("CSS.enable");
const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ".cast-icon" });
if (nodeIds.length !== 5) throw new Error("Expected the five actual original Cast glyphs");
const properties = ["font-family", "font-size", "font-weight", "font-style", "line-height", "font-feature-settings", "font-optical-sizing", "font-synthesis", "width", "height", "border-top-width", "border-radius", "color", "background-color"];
const glyphs = [];
for (const nodeId of nodeIds) {
  const fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  const styles = await cdp.send("CSS.getComputedStyleForNode", { nodeId });
  const style = Object.fromEntries(styles.computedStyle.filter((entry) => properties.includes(entry.name)).map((entry) => [entry.name, entry.value]));
  const { object } = await cdp.send("DOM.resolveNode", { nodeId });
  const measured = await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    returnByValue: true,
    functionDeclaration: `function() {
      const range = document.createRange(); range.selectNodeContents(this);
      const rect = range.getBoundingClientRect(), circle = this.getBoundingClientRect();
      const style = getComputedStyle(this);
      const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
      context.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
      const metric = context.measureText(this.textContent);
      return { text:this.textContent, ariaLabel:this.getAttribute("aria-label"), advancePx:rect.width,
        glyphRange:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
        circle:{x:circle.x,y:circle.y,width:circle.width,height:circle.height},
        canvasAdvancePx:metric.width,
        canvasInk:{left:metric.actualBoundingBoxLeft,right:metric.actualBoundingBoxRight,
          ascent:metric.actualBoundingBoxAscent,descent:metric.actualBoundingBoxDescent} };
    }`
  });
  glyphs.push({ ...measured.result.value, style, fonts:fonts.fonts });
  await cdp.send("Runtime.releaseObject", {objectId:object.objectId});
}
const result = { browser: await cdp.send("Browser.getVersion"), url:state.page.url(),
  original:"Actual unmodified original Twyne Board .cast-icon controls with its original Google DM Sans CSS/responses",
  viewport:state.page.viewportSize(), glyphs,
  boundary:"Native font/raster evidence is separate. No probe nodes, source edits, font substitutions or downloads." };
fs.writeFileSync("/tmp/twyne-cast-actual-fonts.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
