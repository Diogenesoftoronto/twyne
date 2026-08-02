import { Extension, type CommandProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** Blocks whose paragraph geometry a writer can control. */
const PARAGRAPH_BLOCKS = ["paragraph", "heading"];

export interface ParagraphFormatAttributes {
  /** Unitless line-height multiplier. Null means theme default. */
  lineHeight: string | null;
  /** Space before the block, in typographic points. Null means theme default. */
  spaceBefore: number | null;
  /** Space after the block, in typographic points. Null means theme default. */
  spaceAfter: number | null;
  /** Keep this block on the same page as the block following it. */
  keepWithNext: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setSpaceBefore: (points: number | null) => ReturnType;
      setSpaceAfter: (points: number | null) => ReturnType;
      setParagraphLineHeight: (value: string | null) => ReturnType;
      setKeepWithNext: (enabled: boolean) => ReturnType;
      unsetParagraphFormat: () => ReturnType;
    };
  }
}

function parsePoints(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const points = Number(raw);
  if (!Number.isFinite(points)) return null;
  return Math.max(0, Math.min(points, 144));
}

/**
 * Word-style paragraph geometry.
 *
 * These are node attributes, not text marks: selecting three words and asking
 * for 12 pt after means the paragraph containing those words. The values are
 * serialized as data attributes as well as CSS so importing the HTML does not
 * have to reverse-engineer a computed pixel margin back into typographic
 * points.
 */
export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",

  addGlobalAttributes() {
    return [
      {
        types: [...PARAGRAPH_BLOCKS],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => {
              const value = element.style.lineHeight.trim();
              return /^(?:1(?:\.\d+)?|2(?:\.0+)?)$/.test(value) ? value : null;
            },
            renderHTML: (attributes) => {
              const value =
                typeof attributes.lineHeight === "string"
                  ? attributes.lineHeight
                  : null;
              if (!value || !/^(?:1(?:\.\d+)?|2(?:\.0+)?)$/.test(value)) {
                return {};
              }
              return { style: `line-height: ${value}` };
            },
          },
          spaceBefore: {
            default: null,
            parseHTML: (element) =>
              parsePoints(element.getAttribute("data-space-before")),
            renderHTML: (attributes) => {
              const value = parsePoints(
                attributes.spaceBefore == null
                  ? null
                  : String(attributes.spaceBefore),
              );
              if (value == null) return {};
              return {
                "data-space-before": String(value),
                style: `margin-top: ${value}pt`,
              };
            },
          },
          spaceAfter: {
            default: null,
            parseHTML: (element) =>
              parsePoints(element.getAttribute("data-space-after")),
            renderHTML: (attributes) => {
              const value = parsePoints(
                attributes.spaceAfter == null
                  ? null
                  : String(attributes.spaceAfter),
              );
              if (value == null) return {};
              return {
                "data-space-after": String(value),
                style: `margin-bottom: ${value}pt`,
              };
            },
          },
          keepWithNext: {
            default: false,
            parseHTML: (element) =>
              element.getAttribute("data-keep-with-next") === "true",
            renderHTML: (attributes) => {
              if (attributes.keepWithNext !== true) return {};
              return {
                "data-keep-with-next": "true",
                style: "break-after: avoid; page-break-after: avoid",
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const updateBlocks =
      (patch: Partial<ParagraphFormatAttributes>) =>
      ({ state, tr, dispatch }: CommandProps) => {
        const { from, to } = state.selection;
        let changed = false;

        state.doc.nodesBetween(
          from,
          to,
          (node: ProseMirrorNode, pos: number) => {
            if (!PARAGRAPH_BLOCKS.includes(node.type.name)) return;
            const attrs = { ...node.attrs, ...patch };
            if (
              Object.entries(patch).every(
                ([key, value]) => node.attrs[key] === value,
              )
            ) {
              return;
            }
            tr.setNodeMarkup(pos, undefined, attrs);
            changed = true;
          },
        );

        if (changed && dispatch) dispatch(tr);
        return changed;
      };

    const normalizedPoints = (points: number | null): number | null =>
      points == null ? null : parsePoints(String(points));
    const normalizedLineHeight = (value: string | null): string | null => {
      if (value == null) return null;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      return String(Math.max(1, Math.min(numeric, 2)));
    };

    return {
      setParagraphLineHeight: (value) =>
        updateBlocks({ lineHeight: normalizedLineHeight(value) }),
      setSpaceBefore: (points) =>
        updateBlocks({ spaceBefore: normalizedPoints(points) }),
      setSpaceAfter: (points) =>
        updateBlocks({ spaceAfter: normalizedPoints(points) }),
      setKeepWithNext: (enabled) =>
        updateBlocks({ keepWithNext: Boolean(enabled) }),
      unsetParagraphFormat: () =>
        updateBlocks({
          lineHeight: null,
          spaceBefore: null,
          spaceAfter: null,
          keepWithNext: false,
        }),
    };
  },
});
