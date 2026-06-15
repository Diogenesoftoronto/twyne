import { Mark } from "@tiptap/core";

export interface PersonaNoteMarkOptions {
  HTMLAttributes: Record<string, any>;
}

export interface PersonaNoteAttributes {
  id: string;
  author: string;
  color: string;
  label: string;
  note: string;
  /** The passage the note is pinned to — rendered as a preview in the popover. */
  quote?: string;
  /** Brief title captured at convene time. */
  briefTitle?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    personaNote: {
      setPersonaNote: (attrs: PersonaNoteAttributes) => ReturnType;
      unsetPersonaNote: () => ReturnType;
    };
  }
}

/**
 * An editor persona's margin note, pinned to the passage it concerns.
 * Stored as a mark so notes travel with the saved folio HTML.
 */
export const PersonaNoteMark = Mark.create<PersonaNoteMarkOptions>({
  name: "personaNote",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    const dataAttr = (name: string, fallback = "") => ({
      default: fallback,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute(`data-persona-note-${name}`) ?? fallback,
      renderHTML: (attributes: Record<string, any>) => {
        if (!attributes[name]) return {};
        return { [`data-persona-note-${name}`]: attributes[name] };
      },
    });

    return {
      id: dataAttr("id"),
      author: dataAttr("author"),
      color: dataAttr("color", "var(--color-vermilion)"),
      label: dataAttr("label"),
      note: dataAttr("note"),
      // quote + briefTitle are read back from the DOM by the
      // popover to render a quote preview and a "filed against"
      // line. They were being silently dropped before because the
      // attribute list didn't declare them — setPersonaNote would
      // pass them in and ProseMirror would discard them.
      quote: dataAttr("quote"),
      // The DOM attribute is `data-persona-note-brief` (legacy
      // name from the popover's getAttribute call) while the
      // mark's API name is `briefTitle`. Wire them by hand.
      // The default is `null` (not `""`) so the renderHTML's
      // "is it set?" check doesn't false-negative on an empty
      // string — `dataAttr`'s `if (!attributes[name])` returns
      // `{}` for `""`, which would silently drop every note's
      // briefTitle from the rendered HTML.
      briefTitle: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-persona-note-brief"),
        renderHTML: (attributes: Record<string, any>) => {
          if (attributes.briefTitle == null) return {};
          return { "data-persona-note-brief": attributes.briefTitle };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-persona-note-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const color =
      HTMLAttributes["data-persona-note-color"] ?? "var(--color-vermilion)";
    return [
      "span",
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        class: "twyne-persona-note",
        style: `--note-color: ${color};`,
      },
      0,
    ];
  },

  addCommands() {
    return {
      setPersonaNote:
        (attrs) =>
        ({ chain }) =>
          chain().setMark("personaNote", attrs).run(),
      unsetPersonaNote:
        () =>
        ({ chain }) =>
          chain().unsetMark("personaNote").run(),
    };
  },
});
