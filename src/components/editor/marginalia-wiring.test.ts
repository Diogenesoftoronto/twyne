import { describe, expect, test } from "bun:test";

describe("marginalia interaction wiring", () => {
  test("uses one manuscript-edge composer instead of a compositor input bar", async () => {
    const [insertPanels, compositor, comments, editor] = await Promise.all([
      Bun.file("src/components/editor/insert-panels.tsx").text(),
      Bun.file("src/components/editor/compositor-panel.tsx").text(),
      Bun.file("src/components/comments/comments-panel.tsx").text(),
      Bun.file("src/components/editor/twyne-editor.tsx").text(),
    ]);

    expect(insertPanels).not.toContain("commentOpen");
    expect(insertPanels).not.toContain("editor-comment-composer");
    expect(compositor).toContain('runCommand("addComment")');
    expect(comments).not.toContain('aria-label="New margin note"');
    expect(comments).not.toContain("Pencil it in");
    expect(editor).toContain("openWriterMarginComposer");
  });

  test("writer and persona notes share the manuscript-edge card grammar", async () => {
    const [writer, persona] = await Promise.all([
      Bun.file("src/components/editor/user-comment-panel.tsx").text(),
      Bun.file("src/components/editor/persona-note-panel.tsx").text(),
    ]);

    expect(writer).toContain("manuscript-comment-card");
    expect(persona).toContain("manuscript-comment-card");
    expect(writer).toContain('"--comment-color": "var(--color-writer-note)"');
    expect(persona).toContain('"--comment-color": note.color');
  });

  test("Marginalia deletion removes the stored thread and manuscript mark", async () => {
    const [comments, editor] = await Promise.all([
      Bun.file("src/components/comments/comments-panel.tsx").text(),
      Bun.file("src/components/editor/twyne-editor.tsx").text(),
    ]);

    expect(comments).toContain('new CustomEvent("twyne:delete-user-comment"');
    expect(editor).toContain('"twyne:delete-user-comment"');
    expect(editor).toContain("onDeleteUserComment");
    expect(editor).toContain("removeCommentMarkById(store.editor, commentId)");
  });

  test("deleting an anchored passage removes its marginalia thread", async () => {
    const editor = await Bun.file(
      "src/components/editor/twyne-editor.tsx",
    ).text();

    expect(editor).toContain(
      "const result = reconcileCommentAnchors(threads, markIds)",
    );
    expect(editor).toContain("await deleteUserComments(deletedIds)");
    expect(editor).toContain("api.userComments.deleteComment");
  });

  test("rail-side strikes sync through the editor-owned Convex client", async () => {
    const [comments, editor] = await Promise.all([
      Bun.file("src/components/comments/comments-panel.tsx").text(),
      Bun.file("src/components/editor/twyne-editor.tsx").text(),
    ]);

    expect(comments).toContain('"twyne:toggle-user-comment-resolved"');
    expect(editor).toContain("onToggleUserCommentResolved");
    expect(editor).toContain("api.userComments.setCommentResolved");
    expect(editor).toContain("resolved: detail.resolved");
    expect(editor).toContain(
      'reportCommentSyncError("resolve-comment-from-rail", err)',
    );
  });

  test("selection actions preserve the active manuscript range before clicks", async () => {
    const actions = await Bun.file(
      "src/components/editor/selection-actions.tsx",
    ).text();

    expect(actions).toContain("preventdefault:mousedown");
    expect(actions).not.toContain("onMouseDown$={(event)");
  });

  test("selection actions settle after a manuscript pointer release", async () => {
    const editor = await Bun.file(
      "src/components/editor/twyne-editor.tsx",
    ).text();

    expect(editor).toContain("const finishSelectionPointer = () =>");
    expect(editor).toContain("requestAnimationFrame(refreshSelectionAction)");
    expect(editor).toContain('editor.view.dom.addEventListener("pointerdown"');
    expect(editor).toContain('document.addEventListener("pointerup"');
  });

  test("writer margins use the same hover-preview path as persona notes", async () => {
    const editor = await Bun.file(
      "src/components/editor/twyne-editor.tsx",
    ).text();

    expect(editor).toContain(
      'target.closest(\n            ".twyne-comment-mark"',
    );
    expect(editor).toContain(
      "void openUserCommentPopover(commentId, writerCommentSpan)",
    );
  });

  test("manuscript-side persona mentions request and display a thread reply", async () => {
    const [comments, editor] = await Promise.all([
      Bun.file("src/components/comments/comments-panel.tsx").text(),
      Bun.file("src/components/editor/twyne-editor.tsx").text(),
    ]);

    expect(editor.match(/"twyne:user-comment-mentions"/g)).toHaveLength(2);
    expect(comments).toContain('"twyne:user-comment-mentions"');
    expect(comments).toContain("void triggerMentions(detail.commentId!");
    expect(comments).toContain("void askEditor(commentId, m.id)");
    expect(editor).toContain("const onUserCommentsChanged = () =>");
    expect(editor).toContain("replies: latest.replies");
  });
});
