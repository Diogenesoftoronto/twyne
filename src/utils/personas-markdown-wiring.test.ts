import { describe, expect, test } from "bun:test";

describe("Room of Editors Markdown wiring", () => {
  test("renders filed notes and reply threads through the safe Markdown renderer", async () => {
    const source = await Bun.file(
      "src/components/personas/personas-panel.tsx",
    ).text();

    expect(source).toContain(
      "dangerouslySetInnerHTML={renderGroundedMarkdown(\n                        feedback.feedback,",
    );
    expect(source).toContain(
      "dangerouslySetInnerHTML={renderMarkdown(\n                      store.streamingNotes[persona.id].text,",
    );
    expect(source).toContain(
      "dangerouslySetInnerHTML={renderGroundedMarkdown(\n                                r.text,",
    );
    // Grounded notes still go through the safe renderer first.
    const grounding = await Bun.file("src/utils/quote-grounding.ts").text();
    expect(grounding).toContain("const html = renderMarkdown(text);");
    expect(source).toContain("store.streamingReplies[feedback.noteId]?.text");
    expect(source).not.toContain(
      "<p\n                    class={`text-[14px] leading-6",
    );
    expect(source).not.toContain('<p class="mt-0.5">{r.text}</p>');
  });
});
