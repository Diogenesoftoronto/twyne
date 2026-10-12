// Read the real, unplaced original composer; never file a fixture-only note.
if (!state.page?.url().startsWith("http://localhost:5180/")) {
  throw new Error("Use the owned local original reference only.");
}
const card = state.page.getByRole("dialog", {
  name: "Write a margin note", exact: true,
});
const head = card.locator(":scope > div").first();
const body = card.locator(":scope > div").last();
const composer = body.locator(":scope > div");
const controls = {
  card,
  head,
  author: head.locator("p").first(),
  label: head.locator("p").last(),
  body,
  quote: body.locator("blockquote"),
  composer,
  textarea: composer.getByRole("textbox", {
    name: "What belongs in the margin here?", exact: true,
  }),
  actions: composer.locator(":scope > div"),
  hint: composer.locator("span"),
  discard: composer.getByRole("button", { name: "Discard", exact: true }),
  place: composer.getByRole("button", { name: "Place note", exact: true }),
};
const rects = {};
const metrics = {};
for (const [name, locator] of Object.entries(controls)) {
  rects[name] = await locator.boundingBox();
  metrics[name] = await inspect({ locator, properties: [
    "display", "flex", "flex-direction", "align-items", "gap",
    "font-family", "font-size", "font-weight", "line-height",
    "letter-spacing", "text-align", "text-transform", "white-space",
    "padding", "margin", "border-width", "box-sizing", "vertical-align",
    "overflow", "max-height", "opacity",
  ] });
  console.log(name, { rect: rects[name], styles: metrics[name] });
}
const fs = require("node:fs");
const fixtureDir = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia";
fs.writeFileSync(`${fixtureDir}/browser-composer-rects.json`,
  JSON.stringify(rects, null, 2) + "\n");
fs.writeFileSync(`${fixtureDir}/browser-composer-metrics.json`,
  JSON.stringify(metrics, null, 2) + "\n");
await ghostCursor.hide({ page: state.page });
await state.page.screenshot({
  path: "/tmp/twyne-reference-margin-composer.png", scale: "css",
});
