// Read-only export from the owned original-app fixture after actual UI filing.
// This does not manufacture comments or manipulate manuscript marks.
if (!state.page || !state.page.url().startsWith("http://localhost:5180/")) {
  throw new Error("Export only the owned localhost:5180 parity fixture.");
}
const fs = require("node:fs");
const root = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia";
const dom = await state.page.locator(".tiptap[role=textbox]").evaluate(
  (element) => element.innerHTML,
);
const saved = await state.page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("twyne", 4);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = (store, key) => new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  const content = await read("folio-content", "twyne-gpui-parity");
  const lix = await read("lix-blob", "current");
  if (!content?.html || !lix?.value) throw new Error("Original save not ready.");
  const blob = lix.value instanceof Blob ? lix.value : new Blob([lix.value]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  db.close();
  return { content, lixUpdatedAt: lix.updatedAt, lixBase64: btoa(binary) };
});
fs.writeFileSync(`${root}/browser-manuscript-dom.html`, dom);
fs.writeFileSync(`${root}/browser-manuscript.html`, saved.content.html);
fs.writeFileSync(`${root}/browser-content-snapshot.json`, JSON.stringify(saved.content, null, 2) + "\n");
fs.writeFileSync("/tmp/twyne-marginalia-original.lix", Buffer.from(saved.lixBase64, "base64"));
console.log({
  folioId: saved.content.folioId,
  htmlUpdatedAt: saved.content.updatedAt,
  lixUpdatedAt: saved.lixUpdatedAt,
  sourcePresent: typeof saved.content.typstSource === "string",
  domBytes: Buffer.byteLength(dom),
  savedHtmlBytes: Buffer.byteLength(saved.content.html),
  lixBytes: Buffer.from(saved.lixBase64, "base64").length,
});
