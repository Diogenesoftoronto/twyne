import { describe, expect, test } from "bun:test";

describe("Room of Editors Markdown wiring", () => {
  test("renders filed notes and reply threads through the safe Markdown renderer", async () => {
    const source = await Bun.file(
      "src/components/personas/personas-panel.tsx",
    ).text();

    expect(source).toContain(
      "dangerouslySetInnerHTML={renderMarkdown(\n                      feedback.feedback,",
    );
    expect(source).toContain(
      "dangerouslySetInnerHTML={renderMarkdown(r.text)}",
    );
    expect(source).toContain(
      "store.streamingReplies[feedback.noteId],",
    );
    expect(source).not.toContain(
      "<p\n                    class={`text-[14px] leading-6",
    );
    expect(source).not.toContain('<p class="mt-0.5">{r.text}</p>');
  });
});
