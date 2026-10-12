// Real original UI interaction proof. No note, mark or provider fabrication.
if (!state.page?.url().startsWith("http://localhost:5180/")) {
  throw new Error("Use the owned local original reference only.");
}
const fs = require("node:fs");
const root = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia";
const id = "ee1a4fcc-a91b-4be9-8063-116e211e4496";
const card = state.page.locator(`[data-flow-card="comment:${id}"]`);
const close = card.getByRole("button", { name: "Set this aside", exact: true });
const settle = async () => state.page.evaluate(async () => {
  // Deliver real event/render frames before awaiting the finite CSS effects.
  for (let frame = 0; frame < 3; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  await Promise.all(document.getAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .map((animation) => animation.finished.catch(() => undefined)));
});
const styles = async (locator) => locator.evaluate((element) => {
  const style = getComputedStyle(element);
  return { opacity: style.opacity, transform: style.transform,
    borderTopColor: style.borderTopColor };
});
const proof = { folioId: "twyne-gpui-parity", id, viewport: state.page.viewportSize() };
await card.waitFor({ state: "visible" });
await state.page.locator(".tiptap[role=textbox] h1").first().hover();
await settle();
proof.baseline = { card: await card.boundingBox(), close: await styles(close) };
if (proof.baseline.close.opacity !== "0") throw new Error("The baseline preview is still hovered.");
await card.hover();
await settle();
proof.hover = { card: await card.boundingBox(), close: await styles(close) };
if (proof.hover.close.opacity !== "1" || Math.abs(proof.baseline.card.y - proof.hover.card.y - 1) > 0.05) {
  throw new Error("The real source hover lift/close behavior did not settle.");
}
await close.click();
await card.waitFor({ state: "detached" });
proof.setAside = { previewAbsent: await card.count() === 0 };
// Dock has no active rail handshake. Mark recall/reservation is covered by the
// separately mounted native Rail tests and Root's real editor integration.

const saved = await state.page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("twyne", 4);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = (store, key) => new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const content = await read("folio-content", "twyne-gpui-parity");
  const lix = await read("lix-blob", "current");
  db.close();
  const bytes = new Uint8Array(await new Blob([lix.value]).arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return { html: content.html, lixBase64: btoa(binary) };
});
proof.savedHtmlUnchanged = saved.html === fs.readFileSync(`${root}/browser-manuscript.html`, "utf8");
if (!proof.savedHtmlUnchanged) throw new Error("Preview interactions changed the saved manuscript.");
fs.writeFileSync("/tmp/twyne-rail-after-ui.lix", Buffer.from(saved.lixBase64, "base64"));
fs.writeFileSync(`${root}/browser-rail-interaction.json`, JSON.stringify(proof, null, 2) + "\n");
await ghostCursor.hide({ page: state.page });
console.log(proof);
