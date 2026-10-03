import { expect, test } from "bun:test";
import { withEditor } from "../test-harness";
import { MarkAnchorWidgets } from "./mark-anchor-widgets";

test("anchor chips end contiguous marked runs, including overlap and repeated thread ids", async () => {
  await withEditor(
    {
      extensions: [MarkAnchorWidgets],
      content:
        '<p><span data-comment-id="one">A<strong>B</strong><span data-comment-id="two">C</span>D</span> gap <span data-comment-id="one">E</span></p><p><span data-comment-id="one">F</span></p>',
    },
    ({ editor, host }) => {
      const chips = () =>
        [...host.querySelectorAll("[data-anchor-id]")].map((chip) => ({
          id: chip.getAttribute("data-anchor-id"),
          before: chip.previousSibling?.textContent,
        }));
      expect(chips()).toEqual([
        { id: "two", before: "C" },
        { id: "one", before: "CD" },
        { id: "one", before: "E" },
        { id: "one", before: "F" },
      ]);
      const original = host.querySelector('[data-anchor-id="two"]');
      editor.commands.insertContentAt(1, "Preface ");
      expect(chips().map((chip) => chip.id)).toEqual([
        "two",
        "one",
        "one",
        "one",
      ]);
      expect(host.querySelector('[data-anchor-id="two"]')).toBe(original);
      editor.commands.setTextSelection({
        from: 1,
        to: editor.state.doc.content.size - 1,
      });
      editor.commands.unsetComment();
      expect(chips()).toEqual([]);
    },
  );
});
