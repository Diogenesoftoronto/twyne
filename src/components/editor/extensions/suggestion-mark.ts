import { Mark } from "@tiptap/core";

export interface SuggestionMarkOptions {
  HTMLAttributes: Record<string, any>;
}

export interface SuggestionAttributes {
  /** Proposal id (matches the Suggestion + Convex row). */
  id: string;
  /** Lix branch holding the proposed block edit. */
  versionId: string;
  author: string;
  color: string;
  /** Proposed replacement text (shown in the popover / accept). */
  replacement: string;
  rationale: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestion: {
      setSuggestion: (attrs: SuggestionAttributes) => ReturnType;
      unsetSuggestion: () => ReturnType;
    };
  }
}

/**
 * An editor's proposed rewrite, pinned to the original passage as a tracked
 * change (struck-through original; the replacement lives in the popover until
 * accepted). Stored as a mark so an open proposal survives a reload, carrying
 * the Lix `versionId` so Accept/Strike can drive the branch merge.
 */
export const SuggestionMark = Mark.create<SuggestionMarkOptions>({
  name: "suggestion",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    const dataAttr = (name: string, fallback = "") => ({
      default: fallback,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute(`data-suggestion-${name}`) ?? fallback,
      renderHTML: (attributes: Record<string, any>) => {
        if (!attributes[name]) return {};
        return { [`data-suggestion-${name}`]: attributes[name] };
      },
    });

    return {
      id: dataAttr("id"),
      versionId: dataAttr("versionId"),
      author: dataAttr("author"),
      color: dataAttr("color", "var(--color-vermilion)"),
      replacement: dataAttr("replacement"),
      rationale: dataAttr("rationale"),
    };
  },

  parseHTML() {
    return [{ tag: "span[data-suggestion-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const color =
      HTMLAttributes["data-suggestion-color"] ?? "var(--color-vermilion)";
    return [
      "span",
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        class: "twyne-suggestion",
        style: `--suggestion-color: ${color};`,
      },
      0,
    ];
  },

  addCommands() {
    return {
      setSuggestion:
        (attrs) =>
        ({ chain }) =>
          chain().setMark("suggestion", attrs).run(),
      unsetSuggestion:
        () =>
        ({ chain }) =>
          chain().unsetMark("suggestion").run(),
    };
  },
});
