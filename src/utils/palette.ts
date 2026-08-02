/**
 * The editorial palette, in one place.
 *
 * Three lists, because these are three different jobs with incompatible
 * requirements, and one list trying to serve all of them is how a palette goes
 * wrong:
 *
 *   - **Ink** — identity and accent. Persona colours, annotation chips,
 *     underlines. Read as a small area of colour against paper, so mustard and
 *     blush belong here even though neither is legible as body text.
 *   - **Text** — colour applied to prose. Every entry clears WCAG AA (4.5:1)
 *     against the manuscript's paper, which rules out the light half of the
 *     ink list; the amber and sage here are deliberately darkened cousins of
 *     the accent colours rather than the accents themselves.
 *   - **Highlight** — pale tints that sit *behind* text which must stay
 *     readable. A saturated highlighter turns a sentence into a smear. Word
 *     and Docs make the same split for the same reason.
 *
 * `palette.test.ts` checks the contrast rather than trusting the eye, because
 * "is this readable" is exactly the kind of judgement that drifts.
 *
 * Every swatch carries both a `cssVar` and a `hex`, and which one a caller
 * uses is not a matter of taste:
 *
 *   - **The editor writes `hex` into marks.** A mark styled
 *     `background-color: var(--color-mustard)` renders correctly in the app
 *     and renders *nothing* in an exported standalone HTML file, which has no
 *     such custom property defined. Colour that survives leaving the app has
 *     to be a literal.
 *   - **Chrome uses `cssVar`**, so a future theme can move it.
 *
 * Server-side rasterisers (`og-image.ts`) can only ever use `hex`; they run in
 * Node with no stylesheet at all.
 */

export interface Swatch {
  /** Stable identifier, safe to persist. */
  id: string;
  /** Human label, used for the accessible name. */
  label: string;
  /** Literal colour. What gets written into a document. */
  hex: string;
  /** Theme reference. What gets used for app chrome. */
  cssVar: string;
}

/**
 * Saturated inks — text colour, persona identity, annotation accents.
 *
 * The list this replaced had six entries but only four distinct colours:
 * "wine" pointed at `--color-persona-editor`, which is mustard, and "indigo"
 * at `--color-accent-blue`, which is cobalt. Two of the six swatches were
 * silently the same paint as two others.
 */
export const INK_SWATCHES: readonly Swatch[] = [
  { id: "vermilion", label: "Vermilion", hex: "#c1272d", cssVar: "var(--color-vermilion)" },
  { id: "mustard", label: "Mustard", hex: "#d4a017", cssVar: "var(--color-mustard)" },
  { id: "cobalt", label: "Cobalt", hex: "#2c4a7c", cssVar: "var(--color-cobalt)" },
  { id: "forest", label: "Forest", hex: "#5b7a3a", cssVar: "var(--color-accent-green)" },
  { id: "periwinkle", label: "Periwinkle", hex: "#5c6bc0", cssVar: "var(--color-periwinkle)" },
  { id: "sage", label: "Sage", hex: "#8a9a5b", cssVar: "var(--color-sage)" },
  { id: "blush", label: "Blush", hex: "#e8a598", cssVar: "var(--color-blush)" },
  { id: "ink", label: "Ink", hex: "#1f1b16", cssVar: "var(--color-ink)" },
];

/**
 * Colours offered for prose.
 *
 * Darkened cousins of the accent hues rather than the accents themselves:
 * mustard at #d4a017 scores 2.0:1 against paper and is simply not text, however
 * good it looks as a badge. Everything here clears 4.5:1.
 */
export const TEXT_SWATCHES: readonly Swatch[] = [
  { id: "ink", label: "Ink", hex: "#1f1b16", cssVar: "var(--color-ink)" },
  { id: "vermilion", label: "Vermilion", hex: "#c1272d", cssVar: "var(--color-vermilion)" },
  { id: "cobalt", label: "Cobalt", hex: "#2c4a7c", cssVar: "var(--color-cobalt)" },
  // No "forest" here: #5b7a3a scores 4.16 against paper, just under AA, and
  // it is the same hue as olive below. One green, dark enough to read.
  { id: "olive", label: "Olive", hex: "#556134", cssVar: "var(--color-text-olive)" },
  { id: "periwinkle", label: "Periwinkle", hex: "#454f9e", cssVar: "var(--color-text-periwinkle)" },
  { id: "amber", label: "Amber", hex: "#7a5a07", cssVar: "var(--color-text-amber)" },
  { id: "sienna", label: "Sienna", hex: "#964f40", cssVar: "var(--color-text-sienna)" },
];

/**
 * Pale tints for highlighting, one per ink hue so the palettes read as the
 * same family. Each is light enough that the manuscript's ink (#1f1b16) still
 * clears WCAG AA on top of it.
 */
export const HIGHLIGHT_SWATCHES: readonly Swatch[] = [
  { id: "butter", label: "Butter", hex: "#fbeaa8", cssVar: "var(--color-highlight-butter)" },
  { id: "rose", label: "Rose", hex: "#f8d3d4", cssVar: "var(--color-highlight-rose)" },
  { id: "sky", label: "Sky", hex: "#cfe0f2", cssVar: "var(--color-highlight-sky)" },
  { id: "mint", label: "Mint", hex: "#d5e6c4", cssVar: "var(--color-highlight-mint)" },
  { id: "lilac", label: "Lilac", hex: "#dcdff4", cssVar: "var(--color-highlight-lilac)" },
  { id: "peach", label: "Peach", hex: "#fadfd5", cssVar: "var(--color-highlight-peach)" },
];

/** The manuscript's body ink, for contrast checks against a highlight. */
export const MANUSCRIPT_INK = "#1f1b16";

export type PaletteKind = "ink" | "text" | "highlight";

export function swatchesFor(kind: PaletteKind): readonly Swatch[] {
  if (kind === "highlight") return HIGHLIGHT_SWATCHES;
  if (kind === "text") return TEXT_SWATCHES;
  return INK_SWATCHES;
}

/** Look a swatch up by the literal colour stored in a document. */
export function swatchByHex(
  hex: string,
  kind: PaletteKind,
): Swatch | undefined {
  const want = hex.trim().toLowerCase();
  return swatchesFor(kind).find((s) => s.hex.toLowerCase() === want);
}

/* ── Contrast, so a colour choice cannot quietly break readability ── */

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let body = m[1];
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/** Relative luminance, per WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick black or white for text sitting on an arbitrary background.
 *
 * Needed because the picker accepts any colour the writer likes, including
 * one dark enough that the manuscript's own ink disappears into it.
 */
export function readableInkOn(background: string): string {
  return contrastRatio(background, MANUSCRIPT_INK) >= 4.5
    ? MANUSCRIPT_INK
    : "#ffffff";
}

/** Normalise anything the colour input might hand back to `#rrggbb`. */
export function normalizeHex(value: string): string | null {
  const rgb = parseHex(value);
  if (!rgb) return null;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
}
