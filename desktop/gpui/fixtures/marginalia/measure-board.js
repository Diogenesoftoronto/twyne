// The source-written fixture note is observed in the real Board, without edits.
if (!state.page?.url().startsWith("http://localhost:5180/")) {
  throw new Error("Use the owned local original reference only.");
}
const card = state.page.locator(
  "div[data-comment-id=ee1a4fcc-a91b-4be9-8063-116e211e4496]",
);
const firstRow = card.locator(":scope > div").first();
const content = firstRow.locator(":scope > div").first();
const authorRow = content.locator(":scope > div").first();
const note = content.locator(":scope > div").last();
const replies = card.locator(":scope > div").nth(1);
const reply = replies.locator(":scope > div").first();
const replyAuthorRow = reply.locator(":scope > div").first();
const actions = card.locator(":scope > div").last();
const controls = {
  card, firstRow, content, authorRow,
  author: authorRow.locator("span").first(),
  date: authorRow.locator("span").last(),
  quote: content.locator(":scope > p"),
  note,
  noteFirstParagraph: note.locator("p").first(),
  noteSecondParagraph: note.locator("p").last(),
  replies, reply, replyAuthorRow,
  replyAuthor: replyAuthorRow.locator("span").first(),
  replyDate: replyAuthorRow.locator("span").last(),
  replyText: replies.locator("p"),
  actions,
  annotate: actions.getByRole("button", { name: "+ Annotate", exact: true }),
};
const measurements = {};
for (const [name, locator] of Object.entries(controls)) {
  measurements[name] = {
    rect: await locator.boundingBox(),
    styles: await inspect({ locator, properties: [
      "display", "font-family", "font-size", "font-weight", "line-height",
      "letter-spacing", "padding", "margin", "border-width", "gap",
    ] }),
  };
  console.log(name, measurements[name]);
}
require("node:fs").writeFileSync(
  "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia/browser-board-metrics.json",
  JSON.stringify(measurements, null, 2) + "\n",
);
