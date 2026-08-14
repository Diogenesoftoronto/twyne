/**
 * The choices the formatting controls offer.
 *
 * Kept out of the editor component because they are data, not markup, and
 * because the export path needs the same font stacks — a manuscript set in
 * Special Elite has to print in Special Elite.
 */

export interface FontChoice {
  id: string;
  label: string;
  /** Full CSS stack. Written into the document, so it must stand alone. */
  stack: string;
}

/**
 * Only the families the app actually loads, plus the three generics.
 *
 * `root.tsx` pulls Fraunces, Lora, DM Sans and Special Elite from Google
 * Fonts. Offering anything else would be a lie: the writer would pick it, see
 * it locally because their machine happens to have it, and their reader would
 * get a fallback. A font menu is a promise about what the document will look
 * like somewhere else.
 */
export const FONT_CHOICES: readonly FontChoice[] = [
  { id: "serif", label: "Lora (serif)", stack: '"Lora", Georgia, serif' },
  {
    id: "display",
    label: "Fraunces (display)",
    stack: '"Fraunces", Georgia, serif',
  },
  {
    id: "sans",
    label: "DM Sans",
    stack: '"DM Sans", system-ui, sans-serif',
  },
  {
    id: "typewriter",
    label: "Special Elite",
    stack: '"Special Elite", Courier, monospace',
  },
  {
    id: "mono",
    label: "Monospace",
    stack: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
  },
];

/** The manuscript CSS uses Lora at 1.125rem, which resolves to 13.5 points. */
export const DEFAULT_MANUSCRIPT_FONT_LABEL = "Lora (default)";
export const DEFAULT_MANUSCRIPT_FONT_SIZE_LABEL = "13.5";

/**
 * Point sizes, in the sequence a word processor offers.
 *
 * Stored as real CSS points rather than rem: 12 pt means 12 pt in the PDF and
 * in another word processor. The old draft mapped 12 pt to 0.75 rem (12 CSS
 * pixels), making every advertised size 25% smaller than its label.
 */
export const FONT_SIZES: readonly { label: string; value: string }[] = [
  { label: "9", value: "9pt" },
  { label: "10", value: "10pt" },
  { label: "11", value: "11pt" },
  { label: "12", value: "12pt" },
  { label: "14", value: "14pt" },
  { label: "16", value: "16pt" },
  { label: "18", value: "18pt" },
  { label: "24", value: "24pt" },
  { label: "30", value: "30pt" },
  { label: "36", value: "36pt" },
  { label: "48", value: "48pt" },
];

/** The line-spacing presets Word and Docs both settled on. */
export const LINE_SPACINGS: readonly { label: string; value: string }[] = [
  { label: "Single", value: "1" },
  { label: "1.15", value: "1.15" },
  { label: "1.5", value: "1.5" },
  { label: "Double", value: "2" },
];

/**
 * Space above and below a paragraph, in points. Points make the setting
 * portable to print and match the unit writers see in Word.
 */
export const PARAGRAPH_SPACINGS: readonly { label: string; value: number }[] = [
  { label: "None", value: 0 },
  { label: "6 pt", value: 6 },
  { label: "12 pt", value: 12 },
  { label: "18 pt", value: 18 },
  { label: "24 pt", value: 24 },
];

/** Title Case that leaves the small words alone, the way a copy desk would. */
const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "nor",
  "of",
  "on",
  "onto",
  "or",
  "over",
  "per",
  "the",
  "to",
  "up",
  "via",
  "with",
]);

export type TextCase = "upper" | "lower" | "title" | "sentence";

/**
 * Recase a run of text.
 *
 * Title case keeps minor words lowercase unless they open or close the string,
 * which is the rule every style guide agrees on and the one a naive
 * capitalise-every-word implementation gets wrong.
 */
export function recase(text: string, mode: TextCase): string {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();

  if (mode === "sentence") {
    const lower = text.toLowerCase();
    return lower.replace(/(^\s*\p{L})|([.!?]\s+\p{L})/gu, (m) =>
      m.toUpperCase(),
    );
  }

  // Title case. Split on whitespace but keep it, so the original spacing
  // survives — a writer selecting a line with a double space did not ask for
  // it to be tidied.
  const parts = text.split(/(\s+)/);
  const wordIndexes = parts
    .map((p, i) => (/\S/.test(p) ? i : -1))
    .filter((i) => i >= 0);
  const first = wordIndexes[0];
  const last = wordIndexes[wordIndexes.length - 1];

  return parts
    .map((part, i) => {
      if (!/\S/.test(part)) return part;
      const lower = part.toLowerCase();
      const bare = lower.replace(/[^\p{L}\p{N}]/gu, "");
      if (i !== first && i !== last && MINOR_WORDS.has(bare)) return lower;
      return lower.replace(/\p{L}/u, (c) => c.toUpperCase());
    })
    .join("");
}

/**
 * Recase every text node touched by a ProseMirror selection without replacing
 * the range itself.
 *
 * A whole-range `insertContentAt` turns the selection into one plain text node
 * and silently drops bold, links, comments, and every other mark. Returning
 * per-node edits lets the editor replace only the characters while retaining
 * the marks already carried by each node.
 */
export function recaseTextSegments(
  segments: readonly { from: number; to: number; text: string }[],
  mode: TextCase,
): Array<{ from: number; to: number; text: string }> {
  if (mode !== "title" && mode !== "sentence") {
    return segments.map((segment) => ({
      ...segment,
      text: recase(segment.text, mode),
    }));
  }

  // Title/sentence rules depend on neighbouring words and punctuation. Join
  // with a sentinel that can never occur in valid Unicode text, recase once,
  // then split back into edits with the original document positions.
  const separator = "\u0000";
  const joined = segments.map((segment) => segment.text).join(separator);
  const transformed = recase(joined, mode).split(separator);
  return segments.map((segment, index) => ({
    ...segment,
    text: transformed[index] ?? segment.text,
  }));
}
