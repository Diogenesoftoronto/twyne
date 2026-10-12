// Read only the real post-interaction Lix copy exported by check-rail-browser.js.
// Preview hover/dismissal must not become a durable comment mutation.
import { openLixInMemory, closeLix } from "@lix-js/sdk";
import { plugin } from "@lix-js/plugin-json";
const dir = new URL("./", import.meta.url);
const lix = await openLixInMemory({
  blob: new Blob([await Bun.file("/tmp/twyne-rail-after-ui.lix").arrayBuffer()]),
  providePlugins: [plugin as unknown as any],
  keyValues: [{ key: "lix_sync", value: "false" }],
});
try {
  const row = await lix.db.selectFrom("file").where("path", "=", "/user-comments.json")
    .select("data").executeTakeFirst();
  if (!row) throw new Error("Original unified comment file is missing.");
  const actual = JSON.parse(new TextDecoder().decode(row.data));
  const before = await Bun.file(new URL("browser-comments.json", dir)).json();
  if (JSON.stringify(actual) !== JSON.stringify(before)) {
    throw new Error("Original preview interactions changed durable comment/reply metadata.");
  }
  const proofPath = new URL("browser-rail-interaction.json", dir);
  const proof = await Bun.file(proofPath).json();
  proof.originalFlatCommentsUnchanged = true;
  proof.comments = actual.length;
  await Bun.write(proofPath, JSON.stringify(proof, null, 2) + "\n");
  console.log({ originalFlatCommentsUnchanged: true, comments: actual.length });
} finally {
  await closeLix({ lix });
}
