import { describe, expect, test } from "bun:test";
import { withEditor } from "./test-harness";

/**
 * The CommentMark is the bridge between a passage of text and a
 * thread in `/user-comments.json`. It needs to round-trip its data
 * attributes (id, author, color) through Tiptap's render → parse
 * cycle, and the setComment / unsetComment commands have to be
 * idempotent. These tests pin the contract; the comment lifecycle
 * (open, reply, delete) is covered separately in
 * `user-comments.test.ts`.
 */
describe("CommentMark", () => {
  test("setComment applies the mark with the supplied id", async () => {
    await withEditor(
      { content: "<p>highlighted passage</p>" },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 1, to: 11 });
        editor.commands.setComment({ id: "c-1" });
        const html = editor.getHTML();
        expect(html).toContain("data-comment-id=\"c-1\"");
        expect(html).toContain("twyne-comment-mark");
      },
    );
  });

  test("setComment defaults author to You and color to mustard when omitted", async () => {
    await withEditor(
      { content: "<p>highlighted passage</p>" },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 1, to: 11 });
        editor.commands.setComment({ id: "c-1" });
        const html = editor.getHTML();
        expect(html).toContain("data-comment-author=\"You\"");
        expect(html).toContain("data-comment-color=\"var(--color-mustard)\"");
      },
    );
  });

  test("setComment accepts a custom author and color", async () => {
    await withEditor(
      { content: "<p>highlighted passage</p>" },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 1, to: 11 });
        editor.commands.setComment({
          id: "c-1",
          author: "Editor A",
          color: "red",
        });
        const html = editor.getHTML();
        expect(html).toContain("data-comment-author=\"Editor A\"");
        expect(html).toContain("data-comment-color=\"red\"");
      },
    );
  });

  test("unsetComment removes the mark but keeps the text", async () => {
    await withEditor(
      { content: "<p>highlighted passage</p>" },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 1, to: 11 });
        editor.commands.setComment({ id: "c-1" });
        expect(editor.getHTML()).toContain("data-comment-id=\"c-1\"");
        editor.commands.setTextSelection({ from: 1, to: 11 });
        editor.commands.unsetComment();
        expect(editor.getHTML()).not.toContain("data-comment-id");
        expect(editor.getText()).toBe("highlighted passage");
      },
    );
  });

  test("the mark survives a non-overlapping edit (anchor stability)", async () => {
    // The writer types after a marked passage. The mark's id must
    // stay attached to the same text — that anchor is what the
    // thread is bound to.
    await withEditor(
      { content: "<p>marked trailing</p>" },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 1, to: 7 });
        editor.commands.setComment({ id: "c-1" });
        // Move caret to end and type.
        editor.commands.focus("end");
        editor.commands.insertContent(" more");
        const html = editor.getHTML();
        expect(html).toContain("data-comment-id=\"c-1\"");
        // The mark still covers the original 6 characters.
        expect(html).toMatch(/<span data-comment-id="c-1"[^>]*>marked<\/span>/);
      },
    );
  });

  test("deleting the marked passage leaves no mark behind", async () => {
    // This is the orphaning path. The mark is gone, but if the
    // thread in Lix is still pointing at this id, the Marginalia
    // panel has a ghost. The reconciliation primitive (Phase 2)
    // surfaces that; the mark's disappearance is the trigger.
    await withEditor(
      { content: "<p>kill me</p>" },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 1, to: 8 });
        editor.commands.setComment({ id: "c-1" });
        expect(editor.getHTML()).toContain("data-comment-id=\"c-1\"");
        editor.commands.deleteSelection();
        expect(editor.getHTML()).not.toContain("data-comment-id");
      },
    );
  });

  test("parseHTML round-trips the data attributes", async () => {
    await withEditor(
      {
        content:
          '<p><span data-comment-id="c-9" data-comment-author="Editor" data-comment-color="red">note body</span></p>',
      },
      ({ editor }) => {
        // Re-render the content through Tiptap. If parseHTML /
        // renderHTML disagree on attribute names, the second pass
        // would drop the id.
        const html = editor.getHTML();
        expect(html).toContain("data-comment-id=\"c-9\"");
        expect(html).toContain("data-comment-author=\"Editor\"");
        expect(html).toContain("data-comment-color=\"red\"");
      },
    );
  });

  test("two non-adjacent comments get distinct ids", async () => {
    await withEditor(
      { content: "<p>first second third</p>" },
      ({ editor }) => {
        editor.commands.setTextSelection({ from: 1, to: 6 });
        editor.commands.setComment({ id: "c-1" });
        editor.commands.setTextSelection({ from: 13, to: 18 });
        editor.commands.setComment({ id: "c-2" });
        const html = editor.getHTML();
        expect(html).toContain("data-comment-id=\"c-1\"");
        expect(html).toContain("data-comment-id=\"c-2\"");
      },
    );
  });
});
