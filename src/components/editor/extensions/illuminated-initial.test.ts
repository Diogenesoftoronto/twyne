import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { DOMSerializer } from "@tiptap/pm/model";
import { withEditor } from "../test-harness";
import {
  ILLUMINATED_INITIAL_ARTWORK,
  illuminatedInitialArtwork,
  openingInitial,
} from "../../../utils/illuminated-initials";
import {
  DEFAULT_OPENING_INITIAL,
  resolveOpeningInitial,
  resolvePageBorder,
  resolveColumns,
  resolveColumnGap,
} from "../../../types";
import {
  IlluminatedInitial,
  illuminatedInitialPluginKey,
} from "./illuminated-initial";

const extensions = [IlluminatedInitial];
const cap = (editor: Editor) =>
  editor.view.dom.querySelector<HTMLElement>(".twyne-illuminated-initial");

describe("automatic illuminated initials", () => {
  test("registers 52 distinct artwork assets", () => {
    expect(ILLUMINATED_INITIAL_ARTWORK).toHaveLength(52);
    expect(new Set(ILLUMINATED_INITIAL_ARTWORK).size).toBe(52);
  });

  test("resolves legacy folio settings and bounds column gaps", () => {
    expect(resolveOpeningInitial({})).toEqual(DEFAULT_OPENING_INITIAL);
    expect(resolvePageBorder({})).toBe("plain");
    expect(resolveColumns({})).toBe(1);
    expect(resolveColumnGap({})).toBe(1.5);
    expect(resolveColumnGap({ columnGap: 99 })).toBe(3);
    expect(resolveColumnGap({ columnGap: -2 })).toBe(0.75);
    expect(resolveColumnGap({ columnGap: Number.NaN })).toBe(1.5);
    expect(resolveColumns({ columns: 3 })).toBe(3);
    expect(resolvePageBorder({ pageBorder: "none" })).toBe("none");
  });

  test("alternate collection has a distinct illustration for every ASCII letter", () => {
    const changed = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      .split("")
      .filter(
        (letter) =>
          illuminatedInitialArtwork(letter, "alternate") !==
          illuminatedInitialArtwork(letter),
      );
    expect(changed).toEqual("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    expect(illuminatedInitialArtwork("a", "alternate")).toEndWith(
      "/a-alt.avif",
    );
    expect(illuminatedInitialArtwork("É", "alternate")).toBeNull();
  });

  test("updates mode, collection and size without changing the manuscript or undo", async () => {
    await withEditor(
      {
        content: "<p>Apple trees.</p>",
        extensions: [
          IlluminatedInitial.configure({
            settings: { ...DEFAULT_OPENING_INITIAL, mode: "off" },
          }),
        ],
      },
      ({ editor, html }) => {
        const before = html();
        expect(cap(editor)).toBeNull();
        expect(editor.view.dom.dataset.openingInitialMode).toBe("off");
        editor.commands.setOpeningInitial({
          ...DEFAULT_OPENING_INITIAL,
          mode: "plain",
          size: "small",
        });
        expect(cap(editor)?.textContent).toBe("A");
        expect(
          illuminatedInitialPluginKey.getState(editor.state)?.initial?.artwork,
        ).toBeNull();
        expect(editor.view.dom.dataset.openingInitialMode).toBe("plain");
        expect(editor.view.dom.dataset.openingInitialSize).toBe("small");
        editor.commands.setOpeningInitial({
          mode: "illuminated",
          collection: "alternate",
          size: "large",
        });
        expect(
          illuminatedInitialPluginKey.getState(editor.state)?.initial?.artwork,
        ).toEndWith("/a-alt.avif");
        expect(editor.view.dom.dataset.openingInitialSize).toBe("large");
        editor.commands.setOpeningInitial({
          ...DEFAULT_OPENING_INITIAL,
          mode: "off",
        });
        expect(cap(editor)).toBeNull();
        expect(
          editor.view.dom.querySelector(".twyne-illuminated-paragraph"),
        ).toBeNull();
        expect(html()).toBe(before);
        expect(editor.commands.undo()).toBe(false);
      },
    );
  });

  test("off also disables the ordinary Unicode fallback", async () => {
    await withEditor(
      { content: "<p>Écrire.</p>", extensions },
      ({ editor }) => {
        expect(cap(editor)).toBeNull();
        expect(editor.view.dom.dataset.openingInitialMode).toBe("illuminated");
        editor.commands.setOpeningInitial({
          ...DEFAULT_OPENING_INITIAL,
          mode: "off",
        });
        expect(editor.view.dom.dataset.openingInitialMode).toBe("off");
        expect(editor.getText()).toBe("Écrire.");
      },
    );
  });

  test("skips opening quotes and spaces, preserving grapheme boundaries", () => {
    expect(openingInitial("  “Apple")).toEqual({
      from: 3,
      to: 4,
      glyph: "A",
      artwork: "/assets/illuminated-initials/a.avif",
    });
    for (const text of ["Élan", "E\u0301lan", "İstanbul", "中文", "123"]) {
      expect(openingInitial(text)?.artwork).toBeNull();
    }
    expect(openingInitial("E\u0301lan")?.to).toBe(2);
    expect(openingInitial("👩‍💻 writes")).toBeNull();
  });

  test("decorates the first top-level paragraph across inline formatting", async () => {
    await withEditor(
      {
        content:
          '<h1>A heading</h1><blockquote><p>Nested</p></blockquote><p>“<a href="https://example.com"><strong>Apple</strong></a> trees.</p><p>Another.</p>',
        extensions,
      },
      ({ editor, html }) => {
        const before = html();
        expect(cap(editor)?.textContent).toBe("A");
        expect(cap(editor)?.closest("a")).not.toBeNull();
        expect(
          editor.view.dom.querySelector(".twyne-illuminated-prefix")
            ?.textContent,
        ).toBe("“");
        expect(
          editor.view.dom.querySelectorAll(".twyne-illuminated-initial"),
        ).toHaveLength(1);
        expect(editor.getText()).toContain("“Apple trees.");
        expect(html()).toBe(before);
        expect(html()).not.toContain("illuminated");
        expect(editor.commands.undo()).toBe(false);
      },
    );
  });

  test("keeps opening punctuation as its own editable decoration through removal and undo", async () => {
    await withEditor(
      {
        content:
          '<p><strong>“</strong><a href="https://example.com">At</a> home.</p>',
        extensions,
      },
      ({ editor, html }) => {
        const before = html();
        const prefix = () =>
          editor.view.dom.querySelector(".twyne-illuminated-prefix");
        expect(prefix()?.textContent).toBe("“");
        expect(prefix()?.closest("strong")).not.toBeNull();
        expect(editor.getText()).toBe("“At home.");
        editor.commands.deleteRange({ from: 1, to: 2 });
        expect(prefix()).toBeNull();
        expect(cap(editor)?.textContent).toBe("A");
        editor.commands.undo();
        expect(prefix()?.textContent).toBe("“");
        expect(html()).toBe(before);
        expect(html()).not.toContain("illuminated");
      },
    );
  });

  test("updates the artwork when the opening letter changes and after undo", async () => {
    await withEditor(
      { content: "<p>Apple trees.</p>", extensions },
      ({ editor, html }) => {
        editor.commands.setTextSelection({ from: 1, to: 2 });
        editor.commands.insertContent("B");
        expect(cap(editor)?.textContent).toBe("B");
        expect(
          illuminatedInitialPluginKey.getState(editor.state)?.initial?.artwork,
        ).toEndWith("/b.avif");
        expect(editor.state.selection.from).toBe(2);
        expect(editor.commands.undo()).toBe(true);
        expect(cap(editor)?.textContent).toBe("A");
        expect(html()).toBe("<p>Apple trees.</p>");
      },
    );
  });

  test("does not jump from an empty opening paragraph to a later paragraph", async () => {
    await withEditor(
      { content: "<p></p><p>Apple trees.</p>", extensions },
      ({ editor }) => expect(cap(editor)).toBeNull(),
    );
  });

  test("follows typing and deleting in an initially empty paragraph", async () => {
    await withEditor({ content: "<p></p>", extensions }, ({ editor }) => {
      expect(cap(editor)).toBeNull();
      editor.commands.insertContent("An opening.");
      expect(cap(editor)?.textContent).toBe("A");
      editor.commands.clearContent();
      expect(cap(editor)).toBeNull();
    });
  });

  test("does not cross an opening line break to illuminate later text", async () => {
    await withEditor(
      { content: "<p><br>Apple trees.</p>", extensions },
      ({ editor }) => expect(cap(editor)).toBeNull(),
    );
  });

  test("retains the complete accented glyph instead of substituting an ASCII initial", async () => {
    await withEditor(
      { content: "<p>E\u0301lan.</p>", extensions },
      ({ editor }) => {
        expect(cap(editor)).toBeNull();
        expect(editor.getText()).toBe("E\u0301lan.");
        expect(editor.getHTML()).toBe("<p>E\u0301lan.</p>");
      },
    );
  });

  test("image load changes only the view; copy and undo retain real text", async () => {
    await withEditor({}, ({ dom }) => {
      const images: HTMLImageElement[] = [];
      const createElement = dom.window.document.createElement.bind(
        dom.window.document,
      );
      dom.window.document.createElement = (name: string, options: unknown) => {
        const element = createElement(name, options);
        if (name === "img") images.push(element);
        return element;
      };
      const editor = new Editor({
        extensions: [StarterKit, IlluminatedInitial],
        content: "<p>Apple trees.</p>",
      });
      try {
        expect(images).toHaveLength(1);
        expect(cap(editor)?.classList.contains("is-illuminated")).toBe(false);
        editor.commands.setOpeningInitial({
          ...DEFAULT_OPENING_INITIAL,
          mode: "off",
        });
        Object.defineProperty(images[0], "naturalWidth", { value: 1024 });
        images[0].dispatchEvent(new dom.window.Event("load"));
        expect(cap(editor)).toBeNull();
        editor.commands.setOpeningInitial({ ...DEFAULT_OPENING_INITIAL });
        expect(cap(editor)?.classList.contains("is-illuminated")).toBe(true);
        expect(editor.getHTML()).toBe("<p>Apple trees.</p>");
        editor.commands.setTextSelection({ from: 1, to: 6 });
        const selection = editor.state.selection.content().content;
        expect(selection.textBetween(0, selection.size)).toBe("Apple");
        const fragment = DOMSerializer.fromSchema(
          editor.schema,
        ).serializeFragment(selection);
        const copied = createElement("div");
        copied.append(fragment);
        expect(copied.innerHTML).toBe("<p>Apple</p>");
        expect(editor.commands.undo()).toBe(false);
      } finally {
        editor.destroy();
        dom.window.document.createElement = createElement;
      }
    });
  });

  test("missing artwork leaves a visible plain cap and does not retry on every edit", async () => {
    await withEditor({}, ({ dom }) => {
      const images: HTMLImageElement[] = [];
      const createElement = dom.window.document.createElement.bind(
        dom.window.document,
      );
      dom.window.document.createElement = (name: string, options: unknown) => {
        const element = createElement(name, options);
        if (name === "img") images.push(element);
        return element;
      };
      const editor = new Editor({
        extensions: [StarterKit, IlluminatedInitial],
        content: "<p>Apple trees.</p>",
      });
      try {
        images[0].dispatchEvent(new dom.window.Event("error"));
        editor.commands.setTextSelection(6);
        editor.commands.insertContent("s");
        expect(images).toHaveLength(1);
        expect(cap(editor)?.textContent).toBe("A");
        expect(cap(editor)?.classList.contains("is-illuminated")).toBe(false);
        expect(cap(editor)?.style.backgroundImage).toBe("");
      } finally {
        editor.destroy();
        dom.window.document.createElement = createElement;
      }
    });
  });
});
