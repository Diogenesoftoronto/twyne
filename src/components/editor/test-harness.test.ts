import { describe, expect, test } from "bun:test";
import { withEditor, projectExtensions } from "./test-harness";

describe("test-harness", () => {
  test("mounts a Tiptap editor with the project extensions", async () => {
    await withEditor({ content: "<p>hello</p>" }, ({ editor }) => {
      expect(editor.getText()).toBe("hello");
    });
  });

  test("renders comment, persona-note, and suggestion marks", async () => {
    await withEditor(
      {
        content: `<p>
          <span data-comment-id="c1">a comment</span>
          <span data-persona-note-id="n1">a note</span>
          <span data-suggestion-id="s1" data-suggestion-versionId="v1" data-suggestion-author="A" data-suggestion-color="red" data-suggestion-replacement="rep" data-suggestion-rationale="because">a suggestion</span>
        </p>`,
      },
      ({ editor }) => {
        const html = editor.getHTML();
        expect(html).toContain("data-comment-id=\"c1\"");
        expect(html).toContain("data-persona-note-id=\"n1\"");
        expect(html).toContain("data-suggestion-id=\"s1\"");
      },
    );
  });

  test("extension list is non-empty", () => {
    expect(projectExtensions.length).toBeGreaterThan(0);
  });
});
