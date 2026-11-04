import { expect, test } from "bun:test";
import { withEditor } from "../test-harness";
import { MarkAnchorWidgets } from "./mark-anchor-widgets";

test("Enter and Space activate the anchor without editing the manuscript", async () => {
  await withEditor(
    {
      extensions: [MarkAnchorWidgets],
      content: '<p><span data-comment-id="keyboard">Marked passage</span></p>',
    },
    ({ dom, host, html }) => {
      const chip = host.querySelector<HTMLButtonElement>(
        '[data-anchor-id="keyboard"]',
      )!;
      const before = html();
      let activations = 0;
      host.addEventListener("click", () => {
        activations++;
      });
      for (const key of ["Enter", " "]) {
        const event = new dom.window.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        });
        chip.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
      expect(activations).toBe(2);
      expect(html()).toBe(before);
    },
  );
});

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

test("anchors show the matching face and color without adding identity text to the manuscript", async () => {
  let writerImage = "/writer.webp";
  await withEditor(
    {
      extensions: [
        MarkAnchorWidgets.configure({
          writer: () => ({
            personaId: "writer",
            name: "Sam Writer",
            imageUrl: writerImage,
          }),
        }),
      ],
      content:
        '<p><span data-persona-note-id="persona" data-persona-note-author="Mlle. Sceptique" data-persona-note-color="var(--color-persona-devil)">Persona passage</span> <span data-comment-id="writer" data-comment-author="You">My passage</span></p>',
    },
    ({ editor, host, dom, html }) => {
      const note = host.querySelector<HTMLButtonElement>(
        '[data-anchor-id="persona"]',
      )!;
      expect(note.querySelector("img")?.getAttribute("src")).toBe(
        "/assets/manual/editors/devil-transparent-480.webp",
      );
      expect(note.style.getPropertyValue("--anchor-color")).toBe(
        "var(--color-persona-devil)",
      );
      expect(note.getAttribute("aria-label")).toContain("Mlle. Sceptique");
      const writer = () =>
        host.querySelector<HTMLButtonElement>('[data-anchor-id="writer"]')!;
      expect(writer().querySelector("img")?.getAttribute("src")).toBe(
        "/writer.webp",
      );
      expect(writer().style.getPropertyValue("--anchor-color")).toBe(
        "var(--color-writer-note)",
      );
      expect(writer().textContent).toBe("");
      const before = html();
      writerImage = "/new-writer.webp";
      editor.view.dispatch(
        editor.state.tr.setMeta("twyneAnchorIdentity", true),
      );
      expect(writer().querySelector("img")?.getAttribute("src")).toBe(
        writerImage,
      );
      writer()
        .querySelector("img")!
        .dispatchEvent(new dom.window.Event("error"));
      expect(writer().querySelector("img")).toBeNull();
      expect(
        writer()
          .querySelector("[data-initials]")
          ?.getAttribute("data-initials"),
      ).toBe("SW");
      expect(html()).toBe(before);
    },
  );
});
