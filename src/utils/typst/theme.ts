import {
  DEFAULT_LAYOUT,
  resolveColumnGap,
  resolveColumns,
  resolveMargins,
  resolvePageSetup,
} from "../../types";
import type { ExportPayload } from "../exchange";
import { typstString } from "./string";
import { typstDecorations } from "./decorative-assets";
import { pageBorderTileCounts } from "../page-ornaments";

/** Matches the writing surface in global.css, including the exported paper colour. */
export const TYPST_EDITORIAL_STYLES = `
#set text(font: ("Lora", "Libertinus Serif"), size: 13.5pt, fill: rgb("#1f1b16"), lang: "en", number-type: "old-style")
#set par(leading: 0.8em, spacing: 0.45em, justify: true)
#set heading(numbering: none)
#show heading: set text(font: ("Libre Baskerville", "Libertinus Serif"), weight: 700)
#show heading: set par(justify: false, leading: 0.4em)
#show heading.where(level: 1): set text(size: 30pt, tracking: -0.01em)
#show heading.where(level: 1): it => block(sticky: true, width: 100%, above: 48pt, below: 24pt)[
  #set align(center)
  #block(above: 0pt, below: 0pt, it.body)
  #block(above: 9pt, below: 0pt, text(font: "DejaVu Sans Mono", size: 12pt, fill: rgb("#c1272d"), "✦"))
]
#show heading.where(level: 2): set text(size: 18pt)
#show heading.where(level: 2): set block(sticky: true, above: 36pt, below: 16pt)
#show heading.where(level: 3): set text(font: ("DM Sans", "DM Sans 9pt"), size: 9pt, tracking: 0.32em, fill: rgb("#c1272d"))
#show heading.where(level: 3): it => block(sticky: true, above: 28pt, below: 12pt, upper(it.body))
#show heading.where(level: 4): set block(sticky: true, above: 24pt, below: 10pt)
#show heading.where(level: 5): set block(sticky: true, above: 20pt, below: 9pt)
#show heading.where(level: 6): set block(sticky: true, above: 18pt, below: 8pt)
#show link: set text(fill: rgb("#2c4a7c"))
#show link: underline.with(stroke: 0.75pt, offset: 2pt)
#show quote.where(block: true): it => block(width: 100%, inset: (x: 1.25em, y: 0.4em), stroke: (left: 2.25pt + rgb("#c1272d")), above: 1.2em, below: 1.2em)[
  #set text(font: ("Libre Baskerville", "Libertinus Serif"), size: 1.25em, fill: rgb("#4a3f33"), style: "italic")
  #set par(leading: 0.55em, justify: false)
  #it.body
  #if it.attribution != none { align(right, [— #it.attribution]) }
]
#show raw: set text(font: "DejaVu Sans Mono", size: 0.88em)
#show raw.where(block: true): set text(fill: rgb("#f4ecd8"), size: 10.5pt)
#show raw.where(block: true): set block(width: 100%, fill: rgb("#1f1b16"), inset: (x: 1.25em, y: 1em), radius: 2pt, above: 1em, below: 1em)
#show math.equation: set text(font: "Libertinus Math")
#set list(indent: 1.2em, body-indent: 0.4em)
#set enum(indent: 1.2em, body-indent: 0.4em)
#set table(inset: (x: 0.8em, y: 0.55em), stroke: 0.75pt + rgb("#ddd0b1"))
#show table: set text(font: ("DM Sans", "DM Sans 9pt"), size: 11.4pt)
#show table: set par(justify: false)
#show table: it => { show par: it => it; it }
#show figure.caption: set text(font: ("DM Sans", "DM Sans 9pt"), size: 9.36pt, fill: rgb("#4a3f33"))
#show footnote.entry: set text(size: 0.85em, fill: rgb("#4a3f33"))
#set footnote.entry(separator: line(length: 30%, stroke: 0.6pt + rgb("#ddd0b1")))
#set line(stroke: 0.6pt + rgb("#ddd0b1"))
#let twyne-opening-seen = state("twyne-editorial-opening", false)
#let twyne-opening-depth = state("twyne-editorial-depth", 0)
#let twyne-nested(body) = {
  twyne-opening-depth.update(n => n + 1)
  body
  twyne-opening-depth.update(n => n - 1)
}
#let twyne-initial-parts(body) = {
  if body.func() == smartquote or body.func() == metadata or ("space", "tag").contains(repr(body.func())) {
    (initial: none, prefix: body, rest: [], skip: true)
  } else if body.func() == text and body.has("text") {
    let letters = body.text.clusters()
    let offset = 0
    while offset < letters.len() and (letters.at(offset).trim() == "" or ("“", "‘", "\\"", "'", "«", "‹", "「", "『", "(", "[", "{", "¿", "¡").contains(letters.at(offset))) { offset += 1 }
    if offset == letters.len() { return (initial: none, prefix: body, rest: [], skip: true) }
    if letters.at(offset).match(regex("^[\\\\p{L}\\\\p{N}]")) == none { return (initial: none, prefix: [], rest: body, skip: false) }
    (initial: letters.at(offset), prefix: text(letters.slice(0, offset).join()), rest: text(letters.slice(offset + 1).join()), skip: false)
  } else if body.has("children") and body.children.len() > 0 {
    let prefix = []
    for (index, child) in body.children.enumerate() {
      let first = twyne-initial-parts(child)
      if first.initial != none { return (initial: first.initial, prefix: prefix + first.prefix, rest: first.rest + body.children.slice(index + 1).join(), skip: false) }
      if not first.skip { return (initial: none, prefix: [], rest: body, skip: false) }
      prefix += child
    }
    (initial: none, prefix: body, rest: [], skip: true)
  } else if body.has("child") and body.has("styles") {
    let first = twyne-initial-parts(body.child)
    (initial: first.initial, prefix: body.func()(first.prefix, body.styles), rest: body.func()(first.rest, body.styles), skip: first.skip)
  } else if (strong, emph, underline, strike, super, sub, link).contains(body.func()) {
    let first = twyne-initial-parts(body.body)
    let fields = body.fields()
    let discarded = fields.remove("body")
    let wrap(content) = if body.func() == link { link(fields.dest, content) } else { body.func()(content, ..fields) }
    (initial: first.initial, prefix: wrap(first.prefix), rest: wrap(first.rest), skip: first.skip)
  } else { (initial: none, prefix: [], rest: body, skip: false) }
}
#let twyne-opening(body) = context {
  show par: it => it
  if twyne-opening-depth.get() > 0 or twyne-initial-mode == "off" { body } else {
  let seen = twyne-opening-seen.get()
  twyne-opening-seen.update(true)
  let parts = if seen { (initial: none, prefix: [], rest: body) } else { twyne-initial-parts(body) }
  if parts.initial == none { body } else {
    // Typst has no native side float. A raised initial occupies only the first
    // line and keeps the remaining rich paragraph at the full column width.
    let initial = if twyne-initial-mode == "illuminated" and upper(parts.initial) == twyne-initial-letter {
      box(baseline: 10%, twyne-initial-artwork(parts.initial, twyne-initial-size))
    } else { text(size: twyne-initial-size, weight: 700, fill: rgb("#c1272d"), parts.initial) }
    parts.prefix + initial + h(2pt) + parts.rest
  }
  }
}
`.trim();

/** Applied only while typesetting our exact generated helpers, never persisted
 * into the author's source. Local attributes continue to control paragraph style.
 */
export const TYPST_MANUSCRIPT_STYLES = `
#let twyne-grid-cells(body) = {
  if body.func() == grid.cell { (body,) }
  else if body.has("children") { body.children.fold((), (cells, child) => cells + twyne-grid-cells(child)) }
  else { () }
}
#let twyne-unstyled-node = twyne-node
#let twyne-node(tag, attributes, body) = {
  if tag == "p" {
    let a = json.decode(attributes)
    let styles = a.at("style", default: "")
    if not styles.contains("line-height") { a.insert("style", styles + ";line-height:1.8") }
    if not a.keys().contains("data-space-after") { a.insert("data-space-after", "6.075") }
    twyne-unstyled-node(tag, json.encode(a), twyne-opening(body))
  } else if tag == "pre" {
    block(width: 100%, fill: rgb("#1f1b16"), inset: (x: 1.25em, y: 1em), radius: 2pt,
      text(font: "DejaVu Sans Mono", size: 10.5pt, fill: rgb("#f4ecd8"), body))
  } else if tag == "th" or tag == "td" {
    let a = json.decode(attributes)
    if not a.keys().contains("data-cell-border-color") { a.insert("data-cell-border-color", "#ddd0b1") }
    if tag == "th" and not a.keys().contains("data-cell-background") and not a.at("style", default: "").contains("background-color") { a.insert("data-cell-background", "#ebe1c9") }
    twyne-unstyled-node(tag, json.encode(a), twyne-nested(body))
  } else if tag == "table" {
    set text(font: ("DM Sans", "DM Sans 9pt"), size: 11.4pt)
    set par(justify: false)
    twyne-unstyled-node(tag, attributes, twyne-grid-cells(body).join())
  } else if tag == "li" or tag == "blockquote" {
    twyne-unstyled-node(tag, attributes, twyne-nested(body))
  } else { twyne-unstyled-node(tag, attributes, body) }
}
`.trim();

export function typstPageSetup(
  payload: ExportPayload,
  source?: string,
): string {
  const layout = payload.layout ?? DEFAULT_LAYOUT;
  const page = resolvePageSetup(layout);
  const decoration = typstDecorations(payload, source);
  const size = { small: 40.5, medium: 56.7, large: 74.25 }[
    decoration.settings.size
  ];
  const initialStyles = [
    `#let twyne-initial-mode = ${typstString(decoration.settings.mode)}`,
    `#let twyne-initial-size = ${size}pt`,
    `#let twyne-initial-letter = ${decoration.initial ? typstString(decoration.initial.glyph) : "none"}`,
    `#let twyne-initial-artwork(glyph, size) = ${decoration.initial ? `image(${typstString(decoration.initial.path)}, width: size, height: size, alt: glyph)` : "text(glyph)"}`,
  ].join("\n");
  const frameWidth = page.widthIn * 72 - 36;
  const frameHeight = page.heightIn * 72 - 36;
  const middleWidth = frameWidth - 72;
  const middleHeight = frameHeight - 72;
  const frameImage = (part: string, width: number, height: number) =>
    `image(${typstString(decoration.frame!.slices[part].path)}, width: ${width}pt, height: ${height}pt, fit: "stretch", alt: none)`;
  const tileCounts = pageBorderTileCounts(layout);
  const frameEdge = (part: string, horizontal: boolean) => {
    const count = horizontal ? tileCounts.horizontal : tileCounts.vertical;
    const width = horizontal ? middleWidth / count : 36;
    const height = horizontal ? 36 : middleHeight / count;
    return `stack(dir: ${horizontal ? "ltr" : "ttb"}, spacing: 0pt, ${Array.from({ length: count }, () => frameImage(part, width, height)).join(", ")})`;
  };
  const frameStyles = decoration.frame
    ? `
#let twyne-page-frame = box(width: ${frameWidth}pt, height: ${frameHeight}pt,
  grid(columns: (36pt, ${middleWidth}pt, 36pt), rows: (36pt, ${middleHeight}pt, 36pt), gutter: 0pt,
    ${frameImage("nw", 36, 36)}, ${frameEdge("n", true)}, ${frameImage("ne", 36, 36)},
    ${frameEdge("w", false)}, [], ${frameEdge("e", false)},
    ${frameImage("sw", 36, 36)}, ${frameEdge("s", true)}, ${frameImage("se", 36, 36)}))
`.trim()
    : "";
  const background = decoration.frame
    ? "align(center + horizon, twyne-page-frame)"
    : decoration.border === "none"
      ? "none"
      : 'align(center + horizon, rect(width: 100% - 36pt, height: 100% - 36pt, stroke: 0.6pt + rgb("#cabb9d")))';
  const margin = Object.entries(resolveMargins(layout))
    .map(
      ([key, value]) =>
        // The editor's small screen gutters are not enough for a framed page.
        // Reserve room for the frame and running furniture; larger chosen
        // margins still apply unchanged.
        `${key}: ${Math.max(decoration.frame ? 60 : key === "top" || key === "bottom" ? 54 : 36, Math.min(8, Math.max(0, Number.isFinite(value) ? value : 0)) * 12)}pt`,
    )
    .join(", ");
  const header = payload.header || (layout.runningHeader ? payload.title : "");
  // Clear the frame behind running furniture, like labels printed into a rule.
  const furniture = (body: string) =>
    `#box(fill: rgb("#fbf6e7"), inset: (x: 3pt))[${body}]`;
  const footer = [
    payload.footer ? furniture(`#text(${typstString(payload.footer)})`) : "",
    layout.pageNumbers
      ? `#h(1fr)${furniture('#context counter(page).display("1")')}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [
    `#set document(title: ${typstString(payload.title)})`,
    initialStyles,
    TYPST_EDITORIAL_STYLES,
    frameStyles,
    `#set columns(gutter: ${resolveColumnGap(layout) * 12}pt)`,
    `#set page(width: ${page.widthIn}in, height: ${page.heightIn}in, columns: ${resolveColumns(layout)}, margin: (${margin}), fill: rgb("#fbf6e7"), background: ${background}, header-ascent: 20%, footer-descent: 20%, header: [${header ? `#set text(font: "Special Elite", size: 8pt, fill: rgb("#4a3f33"))\n#set par(justify: false)\n${furniture(`#text(${typstString(header)})`)}` : ""}], footer: [${footer ? `#set text(font: "Special Elite", size: 8pt, fill: rgb("#4a3f33"))\n#set par(justify: false)\n${footer}` : ""}])`,
  ].join("\n\n");
}
