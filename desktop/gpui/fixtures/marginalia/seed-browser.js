// Run with the installed Playwriter CLI in an owned, disposable headless
// session. Seeds the actual original app's offline IndexedDB, never a renderer.
if (!state.page || !state.page.url().startsWith("http://localhost:5180/")) {
  throw new Error("Seed only the owned localhost:5180 parity fixture.");
}
await state.page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  // Only public font assets declared by original root.tsx are allowed outside
  // localhost. Auth, provider, sync and analytics traffic remains blocked.
  if (["localhost", "127.0.0.1", "[::1]", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
    await route.continue();
  } else {
    await route.abort();
  }
});
await state.page.routeWebSocket("**/*", (route) => {
  const url = new URL(route.url());
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    route.connectToServer();
  } else {
    route.close();
  }
});
await state.page.setViewportSize({ width: 1280, height: 860 });
state.notebookHtml = require("node:fs").readFileSync(
  "/tmp/The notebook.html",
  "utf8",
);
await state.page.evaluate(async (html) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("twyne", 4);
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of [
        ["folios", "id"],
        ["folio-content", "folioId"],
        ["meta", "key"],
      ]) {
        if (!request.result.objectStoreNames.contains(name)) {
          request.result.createObjectStore(name, { keyPath });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const now = Date.now();
  const transaction = db.transaction(["folios", "folio-content", "meta"], "readwrite");
  transaction.objectStore("folios").put({
    id: "twyne-gpui-parity",
    name: "The notebook",
    type: "draft",
    createdAt: now,
    updatedAt: now,
  });
  transaction.objectStore("folio-content").put({
    folioId: "twyne-gpui-parity",
    html,
    format: "typst",
    updatedAt: now,
  });
  for (const [key, value] of [
    ["active-folio-id", "twyne-gpui-parity"],
    ["signin-toast-dismissed", true],
  ]) {
    transaction.objectStore("meta").put({ key, value, updatedAt: now });
  }
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
  localStorage.setItem("twyne:editor:view:v1", JSON.stringify({
    zenMode: false,
    compositorOpen: true,
  }));
}, state.notebookHtml);
await state.page.goto("http://localhost:5180/editor/", { waitUntil: "domcontentloaded" });
await state.page.getByRole("region", { name: "Manuscript workspace" }).waitFor();
console.log("URL:", state.page.url());
console.log(await snapshot({ page: state.page }));
