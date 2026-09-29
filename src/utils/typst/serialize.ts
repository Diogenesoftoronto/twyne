import { DEFAULT_LAYOUT, resolveMargins, resolvePageSetup } from "../../types";
import type { ExportPayload } from "../exchange";
import { formatCitation } from "../bibliography";

/** Outbound bridge only. HTML remains authoritative until source editing can round-trip. */
export interface TypstDocument {
  source: string;
  assets: { path: string; url: string }[];
}

/** Typst strings are not JSON strings: control characters use \u{...}. */
export { typstString } from "./string";
import { typstString } from "./string";

const text = (value: string) => (value ? `#text(${typstString(value)})` : "");
const number = (
  raw: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function color(raw: string): string | null {
  if (/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(raw))
    return `rgb(${typstString(raw)})`;
  const rgb =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      raw,
    );
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map((n) => Math.min(255, Number(n)));
  if (rgb[4] != null)
    channels.push(Math.round(Math.min(1, Number(rgb[4])) * 255));
  return `rgb(${channels.join(", ")})`;
}

/** Never interpolate manuscript text as executable Typst markup. */
export function serializeTypst(payload: ExportPayload): TypstDocument {
  const dom = new DOMParser().parseFromString(payload.html, "text/html");
  const assets: TypstDocument["assets"] = [];
  const endnotes: string[] = [];
  const layout = payload.layout ?? DEFAULT_LAYOUT;
  const margins = resolveMargins(layout);
  const page = resolvePageSetup(layout);
  const children = (element: Node): string =>
    Array.from(element.childNodes).map(visit).join("");

  function inlineStyle(el: HTMLElement, body: string): string {
    const args: string[] = [];
    if (el.style.fontFamily)
      args.push(
        `font: ${typstString(el.style.fontFamily.includes("monospace") ? "DejaVu Sans Mono" : el.style.fontFamily.split(",")[0].replace(/['"]/g, "").trim())}`,
      );
    const fill = color(el.style.color);
    if (fill) args.push(`fill: ${fill}`);
    const size = /^(\d+(?:\.\d+)?)(px|pt|rem|em)$/.exec(el.style.fontSize);
    if (size) {
      const n = Math.min(200, Math.max(1, Number(size[1])));
      args.push(
        `size: ${size[2] === "px" ? n * 0.75 + "pt" : size[2] === "rem" ? n * 12 + "pt" : n + size[2]}`,
      );
    }
    if (el.style.fontWeight === "bold" || Number(el.style.fontWeight) >= 600)
      args.push('weight: "bold"');
    if (el.style.fontStyle === "italic") args.push('style: "italic"');
    if (args.length) body = `#text(${args.join(", ")})[${body}]`;
    const fillBackground = color(el.style.backgroundColor);
    if (fillBackground) body = `#highlight(fill: ${fillBackground})[${body}]`;
    return body;
  }

  function paragraph(el: HTMLElement, body: string): string {
    const align = el.style.textAlign;
    const settings: string[] = [];
    if (align === "justify") settings.push("#set par(justify: true)");
    const leading = el.style.lineHeight;
    if (/^[\d.]+$/.test(leading)) {
      settings.push(
        `#set par(leading: ${Math.max(0, number(leading, 1.5, 1, 3) - 1)}em)`,
      );
    }
    if (settings.length) body = `${settings.join("\n")}\n${body}`;
    if (["left", "center", "right"].includes(align))
      body = `#align(${align})[${body}]`;
    const indent = number(el.getAttribute("data-indent"), 0, 0, 8);
    if (indent) body = `#pad(left: ${indent * 18}pt)[${body}]`;
    const options: string[] = [];
    for (const [attr, key] of [
      ["data-space-before", "above"],
      ["data-space-after", "below"],
    ]) {
      if (el.hasAttribute(attr))
        options.push(`${key}: ${number(el.getAttribute(attr), 0, 0, 144)}pt`);
    }
    if (el.getAttribute("data-keep-with-next") === "true")
      options.push("sticky: true");
    return `#block(${options.join(", ")})[${body || "#v(1em)"}]\n`;
  }

  function table(el: HTMLTableElement): string {
    const rows = Array.from(el.rows);
    if (!rows.length) return "";
    // Explicit coordinates keep merged cells from shifting subsequent rows.
    const occupied: boolean[][] = [];
    const cells: string[] = [];
    let columns = 1;
    rows.forEach((row, y) => {
      occupied[y] ??= [];
      let x = 0;
      for (const cell of Array.from(row.cells)) {
        while (occupied[y][x]) x++;
        const colspan = Math.round(
          number(cell.getAttribute("colspan"), 1, 1, 100),
        );
        const rowspan = Math.min(
          rows.length - y,
          Math.round(number(cell.getAttribute("rowspan"), 1, 1, 100)),
        );
        const options = [
          `x: ${x}`,
          `y: ${y}`,
          `colspan: ${colspan}`,
          `rowspan: ${rowspan}`,
        ];
        const fill = color(
          cell.getAttribute("data-cell-background") ||
            cell.style.backgroundColor,
        );
        if (fill) options.push(`fill: ${fill}`);
        const align =
          cell.getAttribute("data-cell-horizontal-alignment") ||
          cell.style.textAlign;
        if (["left", "center", "right"].includes(align))
          options.push(`align: ${align}`);
        let body = children(cell);
        if (cell.tagName === "TH") body = `#strong[${body}]`;
        cells.push(`table.cell(${options.join(", ")})[${body}]`);
        for (let yy = y; yy < y + rowspan; yy++) {
          occupied[yy] ??= [];
          for (let xx = x; xx < x + colspan; xx++) occupied[yy][xx] = true;
        }
        x += colspan;
        columns = Math.max(columns, x);
      }
    });
    const caption =
      el.caption?.textContent || el.getAttribute("data-table-caption");
    const body = `#table(columns: ${columns}, inset: 6pt, stroke: 0.5pt + rgb("#bbb"),\n${cells.join(",\n")},\n)`;
    return (
      body + (caption ? `\n#align(center)[#emph[${text(caption)}]]` : "") + "\n"
    );
  }

  function visit(node: Node): string {
    if (node.nodeType === 3)
      return text((node.textContent ?? "").replace(/[\t\n\r ]+/g, " "));
    if (node.nodeType !== 1) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (
      ["script", "style", "template", "input", "button", "label"].includes(tag)
    )
      return "";
    const kind = el.getAttribute("data-type");
    if (kind === "page-break" || el.hasAttribute("data-page-break"))
      return "#pagebreak()\n";
    if (kind === "inline-math" || kind === "block-math")
      return `#twyne-math(${typstString(el.getAttribute("data-latex") ?? el.textContent ?? "")}, block: ${kind === "block-math"})`;
    if (kind === "mermaid-diagram")
      return `#twyne-mermaid(${typstString(el.getAttribute("data-mermaid-source") ?? el.textContent ?? "")})`;
    if (kind === "footnote")
      return `#footnote[${text(el.getAttribute("data-endnote-text") ?? "")}]`;
    if (kind === "endnote") {
      endnotes.push(el.getAttribute("data-endnote-text") ?? "");
      return `#super[${text(String(endnotes.length))}]`;
    }
    if (tag === "img") {
      const url = el.getAttribute("src");
      if (!url)
        throw new Error(
          "An image has no saved source. Finish uploading it before exporting.",
        );
      const path =
        assets.find((asset) => asset.url === url)?.path ??
        `/images/image-${assets.length + 1}`;
      if (!assets.some((asset) => asset.path === path))
        assets.push({ path, url });
      const figure = el.closest("figure");
      const width = number(
        figure?.getAttribute("data-image-width"),
        100,
        10,
        100,
      );
      return `#image(${typstString(path)}, width: ${width}%, alt: ${typstString(el.getAttribute("alt") ?? "")})`;
    }
    if (tag === "table") return table(el as HTMLTableElement);
    if (tag === "pre")
      return `#raw(${typstString(el.textContent ?? "")}, block: true)\n`;
    if (tag === "code") return `#raw(${typstString(el.textContent ?? "")})`;
    if (tag === "br") return "#linebreak()";
    if (tag === "hr")
      return '#line(length: 100%, stroke: 0.5pt + rgb("#bbb"))\n';
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(el.children)
        .filter((c) => c.tagName === "LI")
        .map((li) => {
          const checkbox =
            li.getAttribute("data-type") === "taskItem"
              ? text(
                  li.getAttribute("data-checked") === "true" ? "[x] " : "[ ] ",
                )
              : "";
          return `[${checkbox}${children(li)}]`;
        });
      if (!items.length) return "";
      const start =
        tag === "ol"
          ? `start: ${Math.round(number(el.getAttribute("start"), 1, 1, 1000000))}, `
          : "";
      return `#${tag === "ol" ? "enum" : "list"}(${start}${items.join(",\n")})\n`;
    }
    const body = inlineStyle(el, children(el));
    if (/^h[1-6]$/.test(tag))
      return paragraph(el, `#heading(level: ${tag[1]})[${body}]`);
    if (tag === "p") return paragraph(el, body);
    if (tag === "blockquote") return `#quote(block: true)[${body}]\n`;
    const marks: Record<string, string> = {
      strong: "strong",
      b: "strong",
      em: "emph",
      i: "emph",
      u: "underline",
      s: "strike",
      del: "strike",
      strike: "strike",
      sup: "super",
      sub: "sub",
    };
    if (marks[tag]) return `#${marks[tag]}[${body}]`;
    if (tag === "mark") {
      const fill =
        color(el.getAttribute("data-color") || el.style.backgroundColor) ??
        'rgb("#fff0a6")';
      return `#highlight(fill: ${fill})[${body}]`;
    }
    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (/^(https?:\/\/|mailto:|tel:)/i.test(href))
        return `#link(${typstString(href)})[${body}]`;
      return body;
    }
    if (tag === "figure") {
      const align = el.getAttribute("data-image-align") || "center";
      return `#block[#align(${["left", "right", "center"].includes(align) ? align : "center"})[${body}]]\n`;
    }
    if (tag === "figcaption") return `\n#block[#emph[${body}]]\n`;
    if (["div", "section", "article"].includes(tag)) return `#block[${body}]\n`;
    // Editor annotations are transparent wrappers; their private attributes never leave the draft.
    if (["span", "li", "small", "abbr"].includes(tag)) return body;
    throw new Error(
      `Typst export does not yet support <${tag}> content. Use PDF… for this folio.`,
    );
  }

  const body = children(dom.body);
  const notes = [
    ...endnotes,
    ...(payload.marginalia ?? []).map(
      (m) =>
        `${m.personaName || "Editor"}: ${m.anchor ? `“${m.anchor}” — ` : ""}${m.feedback}`,
    ),
  ];
  const bibliography = (payload.bibliography ?? [])
    .filter((b) => b.url || b.doi || b.title)
    .map((b) => formatCitation(b, payload.citationStyle ?? "mla"));
  const section = (title: string, entries: string[]) =>
    entries.length
      ? `\n#heading(level: 2)[${text(title)}]\n#enum(${entries.map((entry) => `[${text(entry)}]`).join(",\n")})\n`
      : "";
  const header = payload.header || (layout.runningHeader ? payload.title : "");
  const footer = [
    text(payload.footer ?? ""),
    layout.pageNumbers ? '#context counter(page).display("1")' : "",
  ]
    .filter(Boolean)
    .join(" #h(1fr) ");
  const margin = Object.entries(margins)
    .map(
      ([key, value]) =>
        `${key}: ${Math.min(8, Math.max(0, Number.isFinite(value) ? value : 0)) * 12}pt`,
    )
    .join(", ");
  const title =
    dom.body.firstElementChild?.tagName === "H1"
      ? ""
      : `#heading(level: 1)[${text(payload.title)}]\n`;
  return {
    source: [
      "// Exported from Twyne. Editing this file does not change your saved folio.",
      `#set document(title: ${typstString(payload.title)})`,
      '#set text(font: ("Lora", "Libertinus Serif"), size: 13.5pt)',
      '#show raw: set text(font: "DejaVu Sans Mono")',
      '#show math.equation: set text(font: "Libertinus Math")',
      "#set par(leading: 0.65em, spacing: 0.8em)",
      "#set heading(numbering: none)",
      `#set page(width: ${page.widthIn}in, height: ${page.heightIn}in, margin: (${margin}), header: [${text(header)}], footer: [${footer}])`,
      title +
        body +
        section("Notes", notes) +
        section("Bibliography", bibliography),
    ].join("\n\n"),
    assets,
  };
}
