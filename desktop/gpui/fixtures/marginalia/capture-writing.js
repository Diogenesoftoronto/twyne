// Distinct original writing/Zen references, using actual loaded source fonts.
if (!state.page?.url().startsWith("http://localhost:5180/") ||
    !["writing", "zen"].includes(state.captureContext)) {
  throw new Error("Select an owned original writing/Zen context first.");
}
const fs = require("node:fs");
const fixtureDir = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia";
const fixture = fs.readFileSync(`${fixtureDir}/browser-manuscript.html`, "utf8");
const savedHtml = await state.page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("twyne", 4);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const content = await new Promise((resolve, reject) => {
    const request = db.transaction("folio-content")
      .objectStore("folio-content").get("twyne-gpui-parity");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!content?.html) throw new Error("Original Notebook save is missing.");
  return content.html;
});
if (savedHtml !== fixture) {
  throw new Error("The current original saved manuscript differs from the exported fixture.");
}
await state.page.evaluate(async () => {
  await Promise.all(document.getAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .map((animation) => animation.finished.catch(() => undefined)));
  await document.fonts.ready;
});
const header = state.page.locator(".editor-workspace-main > header");
const headerRect = await header.boundingBox();
if (state.captureContext === "writing" &&
    (!headerRect || Math.abs(headerRect.width - 1278) > 0.1)) {
  throw new Error("Close both sidebars before the original writing reference.");
}
if (await state.page.getByRole("toolbar", {
  name: "Document compositor", exact: true,
}).isVisible()) {
  throw new Error("Close the compositor before writing/Zen reference capture.");
}
const editor = state.page.locator(".tiptap[role=textbox]");
const heading = editor.locator("h1").first();
const paragraph = editor.locator("p").first();
const measure = async (locator) => ({
  rect: await locator.boundingBox(),
  styles: await inspect({ locator, properties: [
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
    "padding", "margin", "text-align",
  ] }),
});
state.fontCdp ??= await getCDPSession({ page: state.page });
await state.fontCdp.send("DOM.enable");
await state.fontCdp.send("CSS.enable");
const { root } = await state.fontCdp.send("DOM.getDocument", { depth: -1 });
const platformFonts = {};
for (const [name, selector] of [
  ["heading", ".tiptap[role=textbox] h1"],
  ["paragraph", ".tiptap[role=textbox] p"],
]) {
  const { nodeId } = await state.fontCdp.send("DOM.querySelector", {
    nodeId: root.nodeId, selector,
  });
  if (!nodeId) throw new Error(`Original ${name} DOM node is missing.`);
  platformFonts[name] = (await state.fontCdp.send("CSS.getPlatformFontsForNode", {
    nodeId,
  })).fonts;
}
if (!platformFonts.heading.some((font) => font.isCustomFont &&
      font.familyName.includes("Libre Baskerville")) ||
    !platformFonts.paragraph.some((font) => font.isCustomFont &&
      font.familyName.includes("Lora"))) {
  throw new Error("Original source web fonts have not actually resolved.");
}
const proof = {
  context: state.captureContext,
  viewport: state.page.viewportSize(),
  folioId: "twyne-gpui-parity",
  exactSavedHtmlMatchesFixture: true,
  savedHtmlBytes: Buffer.byteLength(savedHtml),
  header: headerRect,
  editor: await measure(editor),
  heading: await measure(heading),
  paragraph: await measure(paragraph),
  headingHtml: await heading.evaluate((element) => element.outerHTML),
  platformFonts,
  fontFaces: await state.page.evaluate(() => Array.from(document.fonts,
    (font) => ({ family: font.family, weight: font.weight,
      style: font.style, status: font.status }))),
  sourceFontVersions: "browser-font-proof.json",
};
fs.writeFileSync(`${fixtureDir}/browser-${state.captureContext}-font-proof.json`,
  JSON.stringify(proof, null, 2) + "\n");
await ghostCursor.hide({ page: state.page });
const path = state.captureContext === "writing"
  ? "/tmp/twyne-reference-quiet-original-fonts.png"
  : "/tmp/twyne-reference-zen-original-fonts.png";
await state.page.screenshot({ path, scale: "css" });
console.log({ path, context: proof.context, savedHtmlBytes: proof.savedHtmlBytes,
  header: proof.header, heading: proof.heading.rect, platformFonts });
