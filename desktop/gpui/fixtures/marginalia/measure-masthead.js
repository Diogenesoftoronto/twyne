// Read actual original header geometry in the owned local reference session.
if (!state.page?.url().startsWith("http://localhost:5180/") ||
    !["full-width", "two-sidebars"].includes(state.measureContext)) {
  throw new Error("Set an explicit owned local reference context first.");
}
const header = state.page.locator(".editor-workspace-main > header");
// A sidebar toggle can still be transitioning after its click resolves.
// Reject an intermediate frame instead of labelling it as a settled context.
await state.page.evaluate(async () => {
  await Promise.all(document.getAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .map((animation) => animation.finished.catch(() => undefined)));
});
const headerRect = await header.boundingBox();
const expectedWidth = state.measureContext === "full-width" ? 1278 : 528;
if (!headerRect || Math.abs(headerRect.width - expectedWidth) > 0.1) {
  throw new Error(`Original sidebar context is not settled: ${JSON.stringify(headerRect)}`);
}
const row = header.locator(":scope > div").first();
const center = row.locator(":scope > div.flex-1");
const controls = {
  header,
  row,
  center,
  dept: center.locator("p").first(),
  wordmark: center.getByRole("link", { name: "TWYNE", exact: true }),
  dateline: center.locator("p").last(),
  actions: row.locator(":scope > div.flex.items-center.gap-2"),
  drawerToggle: header.getByRole("button", {
    name: "Toggle the drawer sidebar", exact: true,
  }),
  createDossier: header.getByRole("button", { name: "Create dossier", exact: true }),
  file: header.getByRole("button", { name: "File", exact: true }),
  account: header.getByRole("button", {
    name: "Open the editor's office (account)", exact: true,
  }),
  boardToggle: header.getByRole("button", {
    name: "Toggle the editorial board panel", exact: true,
  }),
};
const result = {};
for (const [name, locator] of Object.entries(controls)) {
  result[name] = {
    rect: await locator.boundingBox(),
    styles: await inspect({ locator, properties: [
      "display", "flex", "flex-direction", "align-items", "gap",
      "font-family", "font-size", "font-weight", "line-height",
      "letter-spacing", "text-align", "white-space", "padding", "margin",
      "border-width", "min-width", "min-height",
    ] }),
  };
  console.log(name, result[name]);
}
require("node:fs").writeFileSync(
  `/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia/browser-masthead-${state.measureContext}.json`,
  JSON.stringify(result, null, 2) + "\n",
);
