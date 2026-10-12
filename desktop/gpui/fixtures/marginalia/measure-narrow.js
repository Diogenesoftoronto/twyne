// Source app's narrow, Zen-off chrome with the exact saved Notebook fixture.
if (!state.page?.url().startsWith("http://localhost:5180/") ||
    state.page.viewportSize()?.width !== 620) {
  throw new Error("Use the owned original reference at 620×860 first.");
}
const fs = require("node:fs");
const dir = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia";
await state.page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .map((animation) => animation.finished.catch(() => undefined)));
});
const nodes = {
  header: state.page.locator(".editor-workspace-main > header"),
  headerMain: state.page.locator(".editor-workspace-main > header > div").first(),
  drawer: state.page.getByRole("button", { name: "Toggle the drawer sidebar", exact: true }),
  department: state.page.getByText("An Anti-Tabula-Rasa Quarterly", { exact: true }),
  wordmark: state.page.getByRole("link", { name: "TWYNE", exact: true }),
  dossier: state.page.locator("button[title=\"Create dossier\"]"),
  file: state.page.getByRole("button", { name: "File", exact: true }),
  account: state.page.getByRole("button", { name: "Open the editor's office (account)", exact: true }),
  board: state.page.getByRole("button", { name: "Toggle the editorial board panel", exact: true }),
  controls: state.page.locator("[aria-label=\"Writing desk controls\"]"),
  footer: state.page.locator("footer[aria-label=\"Manuscript status\"]"),
  words: state.page.locator("footer[aria-label=\"Manuscript status\"] > span").first(),
  pages: state.page.getByRole("combobox", { name: "Go to page", exact: true }),
  flow: state.page.locator("footer[aria-label=\"Manuscript status\"] [data-mode][role=status]"),
  zen: state.page.getByRole("button", { name: "Toggle Zen mode", exact: true }),
};
const measurements = { viewport: state.page.viewportSize(), nodes: {} };
for (const [name, locator] of Object.entries(nodes)) {
  if (await locator.count() === 0 && name === "dossier") {
    measurements.nodes[name] = { rect: null, hiddenAtThisWidth: true };
    continue;
  }
  if (await locator.count() !== 1) throw new Error(`Expected one original ${name} node.`);
  measurements.nodes[name] = {
    rect: await locator.boundingBox(),
    styles: await inspect({ locator, properties: [
      "display", "font-family", "font-size", "font-weight", "line-height",
      "letter-spacing", "padding", "margin", "gap", "flex-wrap", "min-width",
    ] }),
  };
}
measurements.footerHtml = await getCleanHTML({ locator: nodes.footer, showDiffSinceLastCall: false });
measurements.headerHtml = await getCleanHTML({ locator: nodes.header, showDiffSinceLastCall: false });
measurements.footerChildren = await nodes.footer.evaluate((footer) =>
  Array.from(footer.children, (element) => {
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return { tag: element.tagName, class: element.className,
      text: element.textContent, ariaLabel: element.getAttribute("aria-label"),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: styles.display, font: styles.font, padding: styles.padding,
      gap: styles.gap, margin: styles.margin };
  }));
fs.writeFileSync(`${dir}/browser-narrow-chrome.json`,
  JSON.stringify(measurements, null, 2) + "\n");
await ghostCursor.hide({ page: state.page });
await state.page.screenshot({ path: "/tmp/twyne-reference-writing-620.png", scale: "css" });
console.log(measurements);
