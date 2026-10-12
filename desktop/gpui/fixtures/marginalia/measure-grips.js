// Read-only original section-grip font/geometry proof for the Rich owner.
if (!state.page?.url().startsWith("http://localhost:5180/")) {
  throw new Error("Use the owned local original reference only.");
}
const fs = require("node:fs");
const proof = { folioId: "twyne-gpui-parity", contexts: [] };
state.fontCdp ??= await getCDPSession({ page: state.page });
await state.fontCdp.send("DOM.enable");
await state.fontCdp.send("CSS.enable");
for (const width of [1280, 620]) {
  await state.page.setViewportSize({ width, height: 860 });
  await state.page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations()
      .filter((animation) => animation instanceof CSSTransition)
      .map((animation) => animation.finished.catch(() => undefined)));
  });
  const context = { viewport: state.page.viewportSize(), nodes: [] };
  const { root } = await state.fontCdp.send("DOM.getDocument", { depth: -1 });
  for (const section of ["the-notebook", "a-note-for-the-next-draft"]) {
    const selector = `[data-section-drag-handle="${section}"]`;
    const locator = state.page.locator(selector);
    const { nodeId } = await state.fontCdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`Source grip ${section} is missing.`);
    const measurement = {
      section,
      rect: await locator.boundingBox(),
      styles: await inspect({ locator, properties: ["font-family", "font-size", "font-weight", "line-height", "opacity", "transform", "white-space", "overflow"] }),
      dom: await locator.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = range.getBoundingClientRect();
        const heading = element.nextElementSibling;
        const previous = element.previousElementSibling;
        const box = (node) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return { tag: node.tagName, text: node.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height, margin: style.margin, font: style.font };
        };
        return { text: element.textContent, html: element.outerHTML,
          glyphRange: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          heading: box(heading), previous: box(previous) };
      }),
      platformFonts: (await state.fontCdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts,
    };
    context.nodes.push(measurement);
  }
  proof.contexts.push(context);
}
await state.page.setViewportSize({ width: 1280, height: 860 });
fs.writeFileSync("/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia/browser-grip-font-proof.json", JSON.stringify(proof, null, 2) + "\n");
console.log(proof);
