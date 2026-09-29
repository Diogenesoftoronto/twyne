import {
  DEFAULT_LAYOUT,
  resolveOpeningInitial,
  resolvePageBorder,
} from "../../types";
import type { ExportPayload } from "../exchange";
import {
  illuminatedInitialArtwork,
  openingInitial,
} from "../illuminated-initials";
import { typstToHtml } from "./document";

export interface TypstDecorationAsset {
  path: string;
  url: string;
}

/** Derive decoration from the authoritative source, never its possibly stale HTML projection. */
export function typstDecorations(
  payload: ExportPayload,
  source = payload.typstSource,
) {
  const layout = payload.layout ?? DEFAULT_LAYOUT;
  const settings = resolveOpeningInitial(layout);
  const border = resolvePageBorder(layout);
  const assets: TypstDecorationAsset[] = [];
  let initial: { glyph: string; path: string } | null = null;
  if (settings.mode === "illuminated") {
    const html = source === undefined ? payload.html : typstToHtml(source);
    const document = new DOMParser().parseFromString(html, "text/html");
    const paragraph = Array.from(document.body.children).find(
      (child) => child.tagName === "P",
    );
    const prose = (node: Node): string => {
      if (node.nodeType === 3) return node.textContent ?? "";
      if (node.nodeType !== 1) return "";
      const element = node as Element;
      if (element.matches("img, br, [data-type], [data-typst-source]"))
        return "\ufffc";
      return Array.from(node.childNodes).map(prose).join("");
    };
    const opening = paragraph ? openingInitial(prose(paragraph)) : null;
    const url = opening
      ? illuminatedInitialArtwork(opening.glyph, settings.collection)
      : null;
    if (opening && url) {
      const path = `/twyne-decoration/initial-${url.split("/").at(-1)}`;
      initial = { glyph: opening.glyph.toUpperCase(), path };
      assets.push({ path, url });
    }
  }
  const frame =
    border === "none" || border === "plain"
      ? null
      : {
          path: `/twyne-decoration/frame-${border}.png`,
          url: `/assets/page-borders/${border}.png`,
          slices: Object.fromEntries(
            ["nw", "n", "ne", "w", "e", "sw", "s", "se"].map((part) => [
              part,
              {
                path: `/twyne-decoration/frame-${border}-${part}.png`,
                url: `/assets/page-borders/slices/${border}-${part}.png`,
              },
            ]),
          ) as Record<string, TypstDecorationAsset>,
        };
  if (frame) assets.push(...Object.values(frame.slices));
  return { settings, border, initial, frame, assets };
}
