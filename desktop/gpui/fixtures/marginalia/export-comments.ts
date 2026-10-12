// Extract the original flat array from the actual UI-written Lix blob exported
// by export-browser.js. Opens a read-only copy; never substitutes expected data.
import { openLixInMemory, closeLix } from "@lix-js/sdk";
import { plugin } from "@lix-js/plugin-json";

const lix = await openLixInMemory({
  blob: new Blob([await Bun.file("/tmp/twyne-marginalia-original.lix").arrayBuffer()]),
  providePlugins: [plugin as unknown as any],
  keyValues: [{ key: "lix_sync", value: "false" }],
});
try {
  const row = await lix.db.selectFrom("file").where("path", "=", "/user-comments.json")
    .select("data").executeTakeFirst();
  if (!row) throw new Error("The original unified comment file is missing.");
  const comments = JSON.parse(new TextDecoder().decode(row.data));
  if (!Array.isArray(comments)) throw new Error("Original file is not a flat array.");
  await Bun.write(new URL("browser-comments.json", import.meta.url), JSON.stringify(comments, null, 2) + "\n");
  console.log(comments.map(({ id, folioId, anchor, resolved, replies }) => ({
    id, folioId, anchor, resolved, replies: replies.length,
  })));
} finally {
  await closeLix({ lix });
}
