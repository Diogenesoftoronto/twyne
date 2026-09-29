import {
  resolvePageBorder,
  resolvePageSetup,
  type LayoutSettings,
} from "../types";

export function pageBorderArtwork(layout: LayoutSettings): string | null {
  const border = resolvePageBorder(layout);
  return border === "none" || border === "plain"
    ? null
    : `/assets/page-borders/${border}.avif`;
}

export function hasOrnateBorder(layout: LayoutSettings): boolean {
  return pageBorderArtwork(layout) !== null;
}

/** Match CSS border-image-repeat: round without stretching an entire edge motif. */
export function pageBorderTileCounts(layout: LayoutSettings) {
  const page = resolvePageSetup(layout);
  const frame = 36;
  const inset = 18;
  return {
    horizontal: Math.max(
      1,
      Math.round(
        (page.widthIn * 72 - 2 * (inset + frame)) / ((frame * 384) / 320),
      ),
    ),
    vertical: Math.max(
      1,
      Math.round(
        (page.heightIn * 72 - 2 * (inset + frame)) / ((frame * 896) / 320),
      ),
    ),
  };
}
