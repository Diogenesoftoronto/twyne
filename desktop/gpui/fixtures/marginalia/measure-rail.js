// Read-only original writer-note preview measurements. Never searches quotes
// to invent mark identity; this is the source-written pending fixture thread.
if (!state.page?.url().startsWith("http://localhost:5180/")) {
  throw new Error("Use the owned local original reference only.");
}
const fs = require("node:fs");
const dir = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia";
const target = "ee1a4fcc-a91b-4be9-8063-116e211e4496";
const card = state.page.locator(`[data-flow-card="comment:${target}"]`);
if (!await card.isVisible()) throw new Error("Show the actual pending preview first.");
await state.page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .map((animation) => animation.finished.catch(() => undefined)));
});
const nodes = {
  surface: state.page.locator(".flow-surface"),
  canvas: state.page.locator(".page-canvas"),
  scroller: state.page.locator(".page-canvas").locator(".."),
  editor: state.page.locator(".tiptap[role=textbox]"),
  dock: state.page.getByRole("complementary", { name: "From the margin", exact: true }),
  card,
  head: card.locator(".flow-card__head"),
  kicker: card.locator(".flow-card__kicker"),
  close: card.getByRole("button", { name: "Set this aside", exact: true }),
  body: card.locator(".flow-card__body"),
  title: card.locator(".flow-card__title"),
  text: card.locator(".flow-card__text"),
  reply: card.locator(".flow-card__reply"),
  replyBy: card.locator(".flow-card__reply-by"),
  foot: card.locator(".flow-card__foot"),
};
const measurements = { viewport: state.page.viewportSize(), target, nodes: {} };
for (const [name, locator] of Object.entries(nodes)) {
  measurements.nodes[name] = {
    rect: await locator.boundingBox(),
    styles: await inspect({ locator, properties: [
      "display", "position", "font-family", "font-size", "font-weight",
      "font-style", "line-height", "letter-spacing", "white-space",
      "padding", "margin", "gap", "border-width", "opacity",
    ] }),
  };
}
fs.writeFileSync(`${dir}/browser-rail-metrics.json`,
  JSON.stringify(measurements, null, 2) + "\n");
await ghostCursor.hide({ page: state.page });
await state.page.screenshot({ path: "/tmp/twyne-reference-margin-preview.png", scale: "css" });
console.log(measurements);
