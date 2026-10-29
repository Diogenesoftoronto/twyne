import { describe, expect, test } from "bun:test";

describe("Room of Editors Markdown wiring", () => {
  test("renders filed notes and reply threads through the safe Markdown renderer", async () => {
    const source = await Bun.file(
      "src/components/personas/personas-panel.tsx",
    ).text();

    expect(source).toContain("text={feedback.feedback}");
    expect(source).toContain(
      "dangerouslySetInnerHTML={renderMarkdown(\n                      store.streamingNotes[persona.id].text,",
    );
    expect(source).toContain("text={r.text}");
    // Grounded notes still go through the safe renderer first.
    const grounding = await Bun.file("src/utils/quote-grounding.ts").text();
    expect(grounding).toContain("const html = renderMarkdown(text);");
    expect(source).toContain("store.streamingReplies[feedback.noteId]?.text");
    expect(source).not.toContain(
      "<p\n                    class={`text-[14px] leading-6",
    );
    expect(source).not.toContain('<p class="mt-0.5">{r.text}</p>');
  });

  test("both note kinds open into one accessible full-note sheet", async () => {
    const source = await Bun.file(
      "src/components/personas/personas-panel.tsx",
    ).text();

    // Filed and in-passing notes share the card and its open control.
    expect(source).toContain(
      'isPassing ? "note-card--passing" : "note-card--filed"',
    );
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain("data-note-open={noteKey}");
    // A native modal dialog, labelled by the editor's name, with the full
    // note rendered through the same grounded Markdown path.
    expect(source).toContain('aria-labelledby="note-sheet-title"');
    expect(source).toContain("el.showModal()");
    expect(source).toContain("text={sheetNote.feedback}");
    // Escape is consumed so the board behind the sheet stays open.
    expect(source).toContain("event.preventDefault();\n        el.close();");
  });
});
