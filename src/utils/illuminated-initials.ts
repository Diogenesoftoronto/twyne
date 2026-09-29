import type { OpeningInitialCollection } from "../types";

/** Locally generated, transparent artwork. The manuscript always retains its text. */
const INITIAL_ASSET_ROOT = "/assets/illuminated-initials";

export const ILLUMINATED_INITIALS = Object.freeze(
  Object.fromEntries(
    "abcdefghijklmnopqrstuvwxyz"
      .split("")
      .map((letter) => [
        letter.toUpperCase(),
        `${INITIAL_ASSET_ROOT}/${letter}.webp`,
      ]),
  ) as Readonly<Record<string, string>>,
);

/** Two complete alphabets: 26 original and 26 alternate engravings. */
export const ILLUMINATED_INITIAL_ARTWORK = Object.freeze([
  ...Object.values(ILLUMINATED_INITIALS),
  ..."abcdefghijklmnopqrstuvwxyz"
    .split("")
    .map((letter) => `${INITIAL_ASSET_ROOT}/${letter}-alt.webp`),
]);

export function illuminatedInitialArtwork(
  glyph: string,
  collection: OpeningInitialCollection = "botanical",
): string | null {
  if (!/^[a-z]$/i.test(glyph)) return null;
  const letter = glyph.toLowerCase();
  if (collection === "alternate")
    return `${INITIAL_ASSET_ROOT}/${letter}-alt.webp`;
  return ILLUMINATED_INITIALS[glyph.toUpperCase()] ?? null;
}

export interface OpeningInitial {
  /** UTF-16 offsets, matching DOM and ProseMirror text positions. */
  from: number;
  to: number;
  glyph: string;
  artwork: string | null;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const openingPunctuation = /^[\s“‘"'«‹「『([{¿¡]+$/u;

/** Only an actual ASCII letter has matching artwork: É and E◌́ remain É/E◌́. */
export function openingInitial(text: string): OpeningInitial | null {
  for (const { segment, index } of segmenter.segment(text)) {
    if (openingPunctuation.test(segment)) continue;
    if (!/^[\p{L}\p{N}]/u.test(segment)) return null;
    return {
      from: index,
      to: index + segment.length,
      glyph: segment,
      artwork: illuminatedInitialArtwork(segment),
    };
  }
  return null;
}
