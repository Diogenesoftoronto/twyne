import {
  resolveOpeningInitial,
  resolvePageBorder,
  type LayoutSettings,
} from "../types";
import {
  illuminatedInitialArtwork,
  openingInitial,
} from "./illuminated-initials";
import { pageBorderArtwork, pageBorderTileCounts } from "./page-ornaments";

export function printableAssetUrl(path: string): string {
  if (typeof window === "undefined") return path;
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return path;
  }
}

/** Decorate a throwaway print DOM. The stored manuscript is never rewritten. */
export function decoratePrintedOpening(
  html: string,
  layout: LayoutSettings,
): string {
  const settings = resolveOpeningInitial(layout);
  if (settings.mode === "off" || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  // XML-only parsers used by import tools cannot safely rewrite an HTML range.
  if (!doc.body?.children || !doc.createRange) return html;
  const paragraph = Array.from(doc.body.children).find(
    (el) => el.tagName === "P",
  );
  if (!paragraph) return html;
  const textNodes = (): Text[] => {
    const nodes: Text[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === 3) nodes.push(node as Text);
      else for (const child of Array.from(node.childNodes)) walk(child);
    };
    walk(paragraph);
    return nodes;
  };
  const initial = openingInitial(paragraph.textContent ?? "");
  if (!initial) return html;
  let textOffset = 0;
  const initialNode = textNodes().find((node) => {
    textOffset += node.length;
    return textOffset > initial.from;
  });
  if (!initialNode) return html;
  // An atom before the glyph is not a prose opening. The bitmask also catches
  // descendants of an atom without passing undefined to the DOM.
  const atom = paragraph.querySelector(
    "img, br, [data-type='inline-math'], [data-type='footnote'], [data-type='endnote'], [data-type='raw-typst-inline']",
  );
  if (atom && atom.compareDocumentPosition(initialNode) & 4) return html;
  const wrap = (from: number, to: number, className: string) => {
    const range = doc.createRange();
    let offset = 0;
    let started = false;
    for (const node of textNodes()) {
      const end = offset + node.length;
      if (!started && from < end) {
        range.setStart(node, from - offset);
        started = true;
      }
      if (started && to <= end) {
        range.setEnd(node, to - offset);
        const span = doc.createElement("span");
        span.className = className;
        span.append(range.extractContents());
        range.insertNode(span);
        return span;
      }
      offset = end;
    }
    return null;
  };
  if (initial.from) wrap(0, initial.from, "export-initial-prefix");
  const cap = wrap(initial.from, initial.to, "export-initial");
  const artwork =
    settings.mode === "illuminated"
      ? illuminatedInitialArtwork(initial.glyph, settings.collection)
      : null;
  if (cap && artwork) {
    const glyph = doc.createElement("span");
    glyph.className = "export-initial-glyph";
    glyph.append(...Array.from(cap.childNodes));
    cap.append(glyph);
    // Real images print with background graphics disabled. Keep the glyph for
    // accessibility/copy, hiding its ink only once the image decodes.
    const image = doc.createElement("img");
    image.src = printableAssetUrl(artwork);
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.setAttribute("data-twyne-print-ornament", "initial");
    image.className = "export-initial-artwork";
    cap.append(image);
  }
  return doc.body.innerHTML;
}

/** Importing a standalone export restores prose, never its printed artwork. */
export function removePrintedOrnaments(root: Element): void {
  for (const image of Array.from(root.getElementsByTagName("img"))) {
    if (image.hasAttribute("data-twyne-print-ornament"))
      image.parentNode?.removeChild(image);
  }
  for (const span of Array.from(root.getElementsByTagName("span")).reverse()) {
    if (
      !(span.getAttribute("class") ?? "")
        .split(/\s+/)
        .some((name) =>
          [
            "export-initial",
            "export-initial-glyph",
            "export-initial-prefix",
          ].includes(name),
        )
    )
      continue;
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }
}

export function printedInitialStyles(layout: LayoutSettings): string {
  const settings = resolveOpeningInitial(layout);
  const size = { small: "3em", medium: "4.2em", large: "5.5em" }[settings.size];
  const cap = { small: "3.5rem", medium: "5rem", large: "6.5rem" }[
    settings.size
  ];
  return `
  .export-initial { position: relative; float: left; font-size: min(${size}, ${cap}); line-height: .85; font-weight: 700; color: #c1272d; margin: .06em .12em .02em 0; }
  .export-initial-prefix { float: left; font-size: 1.4em; line-height: 1; margin: .16em .08em 0 0; }
  .export-initial-artwork { display: none; position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .export-initial.is-illuminated { width: 1.16em; height: 1.16em; }
  .export-initial.is-illuminated .export-initial-glyph { color: transparent; -webkit-text-fill-color: transparent; }
  .export-initial.is-illuminated .export-initial-artwork { display: block; }
  `;
}

export function printedPageFrame(layout: LayoutSettings): string {
  const border = resolvePageBorder(layout);
  if (border === "none") return "";
  const artwork = pageBorderArtwork(layout);
  const source =
    artwork && printableAssetUrl(artwork.replace(/\.webp$/, ".png"));
  // Paths are fixed application assets; escaping also covers an unusual origin.
  const escaped = source?.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const tileCounts = pageBorderTileCounts(layout);
  const pieces = source
    ? ["tl", "t", "tr", "l", "r", "bl", "b", "br"]
        .map((piece) => {
          const count =
            piece === "t" || piece === "b"
              ? tileCounts.horizontal
              : piece === "l" || piece === "r"
                ? tileCounts.vertical
                : 1;
          const tile = `<span class="export-frame-tile"><img src="${escaped}" alt="" data-twyne-print-ornament="border"></span>`;
          return `<span class="export-frame-piece ${piece}">${tile.repeat(count)}</span>`;
        })
        .join("")
    : "";
  return `<div class="export-page-frame${source ? " is-ornate" : ""}" aria-hidden="true">${pieces}</div>`;
}

/** Real image crops implement the same 320px nine-slice used by editor/PDF. */
export function printedFrameStyles(): string {
  return `
  .export-document { position: relative; }
  .export-page-frame { --frame-size: 3rem; position: absolute; inset: 1.5rem; pointer-events: none; border: 1px solid #cabb9d; }
  .export-page-frame.is-ornate { border: 0; }
  .export-frame-piece { position: absolute; display: flex; overflow: hidden; }
  .export-frame-tile { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; }
  .export-frame-piece img { position: absolute; display: block; max-width: none; width: 320%; height: 480%; }
  .export-frame-piece.tl, .export-frame-piece.tr, .export-frame-piece.bl, .export-frame-piece.br { width: var(--frame-size); height: var(--frame-size); }
  .export-frame-piece.tl { top: 0; left: 0; }
  .export-frame-piece.tr { top: 0; right: 0; }
  .export-frame-piece.bl { bottom: 0; left: 0; }
  .export-frame-piece.br { bottom: 0; right: 0; }
  .export-frame-piece.tr img, .export-frame-piece.br img { left: -220%; }
  .export-frame-piece.bl img, .export-frame-piece.br img { top: -380%; }
  .export-frame-piece.t, .export-frame-piece.b { left: var(--frame-size); right: var(--frame-size); height: var(--frame-size); }
  .export-frame-piece.t { top: 0; }
  .export-frame-piece.b { bottom: 0; }
  .export-frame-piece.t img, .export-frame-piece.b img { width: 266.666667%; left: -83.333333%; }
  .export-frame-piece.b img { top: -380%; }
  .export-frame-piece.l, .export-frame-piece.r { top: var(--frame-size); bottom: var(--frame-size); width: var(--frame-size); flex-direction: column; }
  .export-frame-piece.l { left: 0; }
  .export-frame-piece.r { right: 0; }
  .export-frame-piece.l img, .export-frame-piece.r img { height: 171.428571%; top: -35.714286%; }
  .export-frame-piece.r img { left: -220%; }
  @media screen and (max-width: 640px) {
    .export-page-frame { --frame-size: 1.8rem; inset: .75rem; }
  }
  @media print {
    .export-page-frame {
      position: fixed;
      inset: 18pt;
    }
  }
  `;
}

/** Also used in downloaded HTML, which has no application runtime. */
export const PRINT_ORNAMENT_LOAD_SCRIPT = `
document.querySelectorAll('img[data-twyne-print-ornament]').forEach(function(image) {
  function ready() { if (image.naturalWidth > 0 && image.classList.contains('export-initial-artwork')) image.parentElement.classList.add('is-illuminated'); }
  image.addEventListener('error', function() {
    image.style.display = 'none';
    image.parentElement.classList.remove('is-illuminated');
    var frame = image.closest('.export-page-frame');
    if (frame) frame.classList.remove('is-ornate');
  }, { once: true });
  if (image.complete) ready(); else image.addEventListener('load', ready, { once: true });
});
`;

/** Embed trusted local artwork before printing, then settle every image's layout. */
export async function preparePrintedImages(doc: Document): Promise<void> {
  const embedded = new Map<string, Promise<string>>();
  const dataUrl = (src: string) => {
    let pending = embedded.get(src);
    if (!pending) {
      pending = (async () => {
        const response = await fetch(src, { credentials: "same-origin" });
        if (!response.ok) throw new Error("Print artwork could not be loaded.");
        const blob = await response.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192)
          binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 8192),
          );
        return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
      })();
      embedded.set(src, pending);
    }
    return pending;
  };
  await Promise.all(
    Array.from(doc.images).map(async (image) => {
      try {
        if (
          image.hasAttribute("data-twyne-print-ornament") &&
          !image.src.startsWith("data:")
        )
          image.src = await dataUrl(image.src);
        if (typeof image.decode === "function") await image.decode();
        else if (!image.complete)
          await new Promise<void>((resolve, reject) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener(
              "error",
              () => reject(new Error("Image could not be decoded.")),
              { once: true },
            );
          });
        if (!image.naturalWidth) throw new Error("Image could not be decoded.");
        if (image.classList.contains("export-initial-artwork"))
          image.parentElement?.classList.add("is-illuminated");
      } catch {
        if (image.hasAttribute("data-twyne-print-ornament")) {
          image.hidden = true;
          image.style.display = "none";
          image.parentElement?.classList.remove("is-illuminated");
          image.closest(".export-page-frame")?.classList.remove("is-ornate");
        }
      }
    }),
  );
}
