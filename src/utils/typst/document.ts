import { typstString } from "./string";
import { typstCodeMatches } from "./syntax";

/** A bounded, non-evaluating bridge. Unknown syntax is an editable opaque atom. */
const MAX_SOURCE = 5_000_000;
const MAX_DEPTH = 128;
const START = "// twyne-document:1";
const END = "// twyne-document:body";
const allowedTags = new Set(
  "p h1 h2 h3 h4 h5 h6 strong b em i u s del strike sup sub span a code pre blockquote ul ol li table thead tbody tfoot tr td th caption figure figcaption img div br hr mark".split(
    " ",
  ),
);
const voidTags = new Set(["img", "br", "hr"]);
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Included in every persisted source file; requires no external Typst package. */
export const TYPST_DOCUMENT_PREAMBLE = `${START}
#let twyne-image(source, width: 100%, alt: "") = image(source, width: width, alt: alt)
#let twyne-math(source, block: false) = raw(source, block: block)
#let twyne-mermaid(source) = raw(source, block: true)
#let twyne-number(value, fallback: 0) = {
  if type(value) == str and value.match(regex("^-?[0-9]+([.][0-9]+)?$")) != none { float(value) } else { fallback }
}
#let twyne-length(value, fallback: 0pt) = {
  let m = value.match(regex("^([0-9]+([.][0-9]+)?)(pt|px|em|rem|%)$"))
  if m == none { fallback } else {
    let n = float(m.captures.at(0))
    let unit = m.captures.at(2)
    if unit == "pt" { n * 1pt } else if unit == "px" { n * 0.75pt } else if unit == "%" { n * 1% } else if unit == "rem" { n * 12pt } else { n * 1em }
  }
}
#let twyne-color(value, fallback: none) = {
  if value.match(regex("^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$")) != none { rgb(value) }
  else if value.starts-with("rgb(") or value.starts-with("rgba(") {
    let values = value.split("(").last().trim(")").split(",").map(x => twyne-number(x.trim()))
    if values.len() >= 3 { rgb(int(values.at(0)), int(values.at(1)), int(values.at(2))) } else { fallback }
  } else { fallback }
}
#let twyne-endnotes = state("twyne-endnotes", ())
#show: body => {
  body
  context {
    let notes = twyne-endnotes.final()
    if notes.len() > 0 { heading(level: 2, [Notes]); enum(..notes) }
  }
}
#let twyne-node(tag, attributes, body) = {
  let a = json.decode(attributes)
  let kind = a.at("data-type", default: "")
  let styles = (:)
  for rule in a.at("style", default: "").split(";") {
    let parts = rule.split(":")
    if parts.len() == 2 { styles.insert(parts.at(0).trim(), parts.at(1).trim()) }
  }
  let alignment = a.at("data-image-align", default: a.at("data-table-alignment", default: styles.at("text-align", default: "")))
  let result = if kind == "page-break" { pagebreak() }
  else if kind == "footnote" { footnote(a.at("data-endnote-text", default: "")) }
  else if kind == "endnote" {
    twyne-endnotes.update(notes => notes + (a.at("data-endnote-text", default: ""),))
    context super(str(twyne-endnotes.get().len()))
  }
  else if tag == "strong" or tag == "b" { strong(body) }
  else if tag == "em" or tag == "i" { emph(body) }
  else if tag == "u" { underline(body) }
  else if tag == "s" or tag == "del" or tag == "strike" { strike(body) }
  else if tag == "sup" { super(body) }
  else if tag == "sub" { sub(body) }
  else if tag == "mark" { highlight(body) }
  else if tag == "a" { link(a.at("href", default: ""), body) }
  else if tag == "br" { linebreak() }
  else if tag == "hr" { line(length: 100%) }
  else if tag == "img" { body }
  else if tag == "h1" { heading(level: 1, body) }
  else if tag == "h2" { heading(level: 2, body) }
  else if tag == "h3" { heading(level: 3, body) }
  else if tag == "h4" { heading(level: 4, body) }
  else if tag == "h5" { heading(level: 5, body) }
  else if tag == "h6" { heading(level: 6, body) }
  else if tag == "blockquote" { quote(block: true, body) }
  else if tag == "pre" { block(fill: luma(96%), inset: 8pt, text(font: "DejaVu Sans Mono", body)) }
  else if tag == "code" { text(font: "DejaVu Sans Mono", body) }
  else if tag == "li" { list.item(if kind == "taskItem" { text(if a.at("data-checked", default: "false") == "true" { "[x] " } else { "[ ] " }) + body } else { body }) }
  else if tag == "ul" { list(marker: if kind == "taskList" { [] } else { [•] }, ..if body.has("children") { body.children } else { (body,) }) }
  else if tag == "ol" { enum(..if body.has("children") { body.children.map(item => item.body) } else { (body.body,) }) }
  else if tag == "td" or tag == "th" {
    let horizontal = a.at("data-cell-horizontal-alignment", default: styles.at("text-align", default: "left"))
    let vertical = a.at("data-cell-vertical-alignment", default: "top")
    let cell-align = (if horizontal == "center" { center } else if horizontal == "right" { right } else { left }) + (if vertical == "middle" { horizon } else if vertical == "bottom" { bottom } else { top })
    let border-style = a.at("data-cell-border-style", default: "solid")
    let border = if border-style == "none" { none } else {
      (paint: twyne-color(a.at("data-cell-border-color", default: ""), fallback: luma(75%)), thickness: twyne-number(a.at("data-cell-border-width", default: "0.67")) * 0.75pt, dash: if border-style == "dashed" { "dashed" } else if border-style == "dotted" { "dotted" } else { "solid" })
    }
    grid.cell(colspan: int(a.at("colspan", default: "1")), rowspan: int(a.at("rowspan", default: "1")), align: cell-align, fill: twyne-color(a.at("data-cell-background", default: styles.at("background-color", default: ""))), stroke: border, if tag == "th" { strong(body) } else { body })
  }
  else if tag == "table" {
    let cells = if body.has("children") { body.children } else { (body,) }
    let widths = a.at("data-twyne-column-widths", default: "")
    let columns = if widths == "" { int(a.at("data-twyne-columns", default: "1")) } else { widths.split(",").map(x => if twyne-number(x) > 0 { twyne-number(x) * 0.75pt } else { auto }) }
    let table-body = grid(columns: columns, inset: 4pt, stroke: 0.5pt + luma(75%), ..cells)
    let caption = a.at("data-table-caption", default: a.at("data-twyne-caption", default: ""))
    block(width: twyne-length(a.at("data-table-width", default: "100%"), fallback: 100%), table-body + if caption != "" { block(text(size: 0.85em, caption)) } else { [] })
  }
  else if tag == "caption" { [] }
  else if tag == "figcaption" { block(text(size: 0.85em, body)) }
  else if tag == "figure" {
    let ratio = twyne-number(a.at("data-image-aspect-ratio", default: "0"))
    block(width: twyne-number(a.at("data-image-width", default: "100"), fallback: 100) * 1%, if ratio > 0 { layout(size => { set image(height: size.width / ratio, fit: "cover"); body }) } else { body })
  }
  else if tag == "p" {
    let leading = twyne-number(styles.at("line-height", default: "1.5"), fallback: 1.5)
    block(above: twyne-number(a.at("data-space-before", default: "0")) * 1pt, below: twyne-number(a.at("data-space-after", default: "8")) * 1pt, sticky: a.at("data-keep-with-next", default: "false") == "true", { set par(leading: calc.max(0, leading - 1) * 1em); body })
  }
  else { body }
  if tag == "td" or tag == "th" { return result }
  let color = twyne-color(styles.at("color", default: ""))
  if color != none { result = text(fill: color, result) }
  let background = twyne-color(styles.at("background-color", default: ""))
  if background != none { result = highlight(fill: background, result) }
  let font = styles.at("font-family", default: "").split(",").first().trim().replace("\\"", "").replace("'", "")
  if font != "" { result = text(font: if font == "monospace" or font == "ui-monospace" { "DejaVu Sans Mono" } else if font == "serif" { "Libertinus Serif" } else if font == "sans-serif" { "DM Sans" } else { font }, result) }
  let font-size = twyne-length(styles.at("font-size", default: ""), fallback: none)
  if font-size != none { result = text(size: font-size, result) }
  if styles.at("font-weight", default: "") == "bold" { result = strong(result) }
  if styles.at("font-style", default: "") == "italic" { result = emph(result) }
  if alignment == "center" { result = align(center, result) }
  if alignment == "right" { result = align(right, result) }
  if alignment == "justify" { result = block({ set par(justify: true); result }) }
  if a.at("data-indent", default: "0") != "0" { result = pad(left: int(a.at("data-indent")) * 18pt, result) }
  result
}
${END}\n`;

function bounded(source: string) {
  if (source.length > MAX_SOURCE)
    throw new Error("Typst document exceeds the 5 MB editing limit.");
}
function raw(source: string, inline = false): string {
  return `<${inline ? "span" : "div"} data-type="${inline ? "raw-typst-inline" : "raw-typst"}" data-typst-source="${escapeHtml(source)}"></${inline ? "span" : "div"}>`;
}
function attrsHtml(attrs: Record<string, unknown>): string {
  return Object.entries(attrs)
    .filter(
      ([k, v]) =>
        /^[a-zA-Z][\w:.-]*$/.test(k) &&
        !/^on/i.test(k) &&
        typeof v === "string" &&
        (!/^(href|src)$/i.test(k) || !/^\s*(javascript|vbscript):/i.test(v)),
    )
    .map(([k, v]) => ` ${k}="${escapeHtml(String(v))}"`)
    .join("");
}
function element(
  tag: string,
  attrs: Record<string, unknown>,
  body: string,
): string {
  if (!allowedTags.has(tag)) throw new Error("Unsupported HTML node");
  return `<${tag}${attrsHtml(attrs)}>${voidTags.has(tag) ? "" : body + `</${tag}>`}`;
}

/** Each wrapper preserves only structure/attributes. All text lives in its editable body. */
export function htmlToTypst(html: string): string {
  bounded(html);
  const dom = new DOMParser().parseFromString(html, "text/html");
  function visit(node: Node, depth = 0): string {
    if (depth > MAX_DEPTH)
      throw new Error("Typst document nesting exceeds the editing limit.");
    if (node.nodeType === 3)
      return node.textContent ? `#text(${typstString(node.textContent)})` : "";
    if (node.nodeType !== 1) return "";
    const el = node as HTMLElement;
    if (el.hasAttribute("data-typst-source"))
      return el.getAttribute("data-typst-source") ?? "";
    const tag = el.tagName.toLowerCase();
    if (!allowedTags.has(tag)) return "";
    const attrs = Object.fromEntries(
      Array.from(el.attributes).map((a) => [a.name, a.value]),
    );
    if (tag === "table") {
      const firstRow = el.querySelector("tr");
      const widths = firstRow
        ? Array.from(firstRow.children).flatMap((cell) => {
            const span = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
            const raw = (cell.getAttribute("colwidth") ?? "").split(",");
            return Array.from({ length: span }, (_, i) =>
              Math.max(0, Number(raw[i]) || 0),
            );
          })
        : [];
      if (widths.some(Boolean))
        attrs["data-twyne-column-widths"] = widths.join(",");
      const row = el.querySelector("tr");
      if (el.querySelector("caption"))
        attrs["data-twyne-caption"] =
          el.querySelector("caption")?.textContent ?? "";
      attrs["data-twyne-columns"] = String(
        row
          ? Array.from(row.children).reduce(
              (n, cell) =>
                n + Math.max(1, Number(cell.getAttribute("colspan")) || 1),
              0,
            )
          : 1,
      );
    }
    let body = Array.from(el.childNodes)
      .map((n) => visit(n, depth + 1))
      .join("");
    if (tag === "img")
      body = `#twyne-image(${typstString(el.getAttribute("src") ?? "")}, width: 100%, alt: ${typstString(el.getAttribute("alt") ?? "")})`;
    if (el.hasAttribute("data-latex"))
      body = `#twyne-math(${typstString(el.getAttribute("data-latex") ?? "")}, block: ${el.getAttribute("data-type") === "block-math"})`;
    if (el.getAttribute("data-type") === "mermaid-diagram")
      body = `#twyne-mermaid(${typstString(el.getAttribute("data-mermaid-source") ?? "")})`;
    return `#twyne-node(${typstString(tag)}, ${typstString(JSON.stringify(attrs))})[${body}]`;
  }
  return (
    TYPST_DOCUMENT_PREAMBLE +
    Array.from(dom.body.childNodes)
      .map((n) => visit(n))
      .join("\n\n")
  );
}

// String and bracket scanning deliberately does not execute code, import packages or fetch URLs.
function quoted(source: string, start: number): { value: string; end: number } {
  if (source[start] !== '"') throw new Error("Expected a string");
  let value = "";
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (c === '"') return { value, end: i + 1 };
    if (c !== "\\") {
      value += c;
      continue;
    }
    const next = source[++i];
    if (next === "u" && source[i + 1] === "{") {
      const end = source.indexOf("}", i + 2);
      const hex = source.slice(i + 2, end);
      if (
        end < 0 ||
        !/^[\da-f]{1,6}$/i.test(hex) ||
        parseInt(hex, 16) > 0x10ffff
      )
        throw new Error("Invalid string escape");
      value += String.fromCodePoint(parseInt(hex, 16));
      i = end;
    } else if (next === "n") value += "\n";
    else if (next === "r") value += "\r";
    else if (next === "t") value += "\t";
    else if (next === '"' || next === "\\") value += next;
    else throw new Error("Invalid string escape");
  }
  throw new Error("Unterminated string");
}
function space(s: string, i: number) {
  while (/\s/.test(s[i] ?? "") && i < s.length) i++;
  return i;
}

/** Strip draft-only attributes from an exported copy without rewriting authored source. */
export function stripTypstAnnotationMetadata(source: string): string {
  bounded(source);
  const wrappers = typstCodeMatches(
    source,
    /#twyne-node\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\)/g,
  );
  for (const match of wrappers.reverse()) {
    const attributes: unknown = JSON.parse(quoted(match[2], 0).value);
    if (
      !attributes ||
      typeof attributes !== "object" ||
      Array.isArray(attributes)
    )
      throw new Error("Invalid Typst node attributes in export.");
    const clean = { ...attributes } as Record<string, unknown>;
    for (const name of Object.keys(clean)) {
      if (
        /^data-(persona-note|suggestion|comment)(-|$)/i.test(name) ||
        /^data-(replacement|rationale|feedback|persona)(-|$)/i.test(name)
      )
        delete clean[name];
    }
    if (typeof clean.class === "string") {
      const classes = clean.class
        .split(/\s+/)
        .filter(
          (c) => !/^twyne-(persona-note|suggestion|comment-mark)$/.test(c),
        );
      if (classes.length) clean.class = classes.join(" ");
      else delete clean.class;
    }
    if (JSON.stringify(clean) === JSON.stringify(attributes)) continue;
    const original = match[0];
    const at = original.indexOf(
      match[2],
      original.indexOf(match[1]) + match[1].length,
    );
    const replacement =
      original.slice(0, at) +
      typstString(JSON.stringify(clean)) +
      original.slice(at + match[2].length);
    source =
      source.slice(0, match.index) +
      replacement +
      source.slice(match.index! + original.length);
  }
  return source;
}
function balanced(s: string, start: number): number {
  const pairs: Record<string, string> = { "[": "]", "(": ")", "{": "}" };
  const stack = [pairs[s[start]]];
  if (!stack[0]) throw new Error("Expected delimiter");
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '"') {
      i = quoted(s, i).end - 1;
      continue;
    }
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s.startsWith("//", i)) {
      const end = s.indexOf("\n", i);
      i = end < 0 ? s.length : end;
      continue;
    }
    if (s.startsWith("/*", i)) {
      let count = 1;
      i += 2;
      for (; i < s.length && count; i++) {
        if (s.startsWith("/*", i)) {
          count++;
          i++;
        } else if (s.startsWith("*/", i)) {
          count--;
          i++;
        }
      }
      if (count) throw new Error("Unterminated comment");
      i--;
      continue;
    }
    if (pairs[s[i]]) {
      stack.push(pairs[s[i]]);
      if (stack.length > MAX_DEPTH) throw new Error("Nesting limit");
    } else if (s[i] === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i + 1;
    }
  }
  throw new Error("Unterminated delimiter");
}
interface Piece {
  source: string;
  html: string;
}
function parseWrapper(
  s: string,
  offset: number,
  depth: number,
): { html: string; end: number } {
  if (depth > MAX_DEPTH) throw new Error("Nesting limit");
  let i = offset + "#twyne-node(".length;
  const tag = quoted(s, space(s, i));
  i = space(s, tag.end);
  if (s[i++] !== ",") throw new Error("Expected comma");
  const attrs = quoted(s, space(s, i));
  i = space(s, attrs.end);
  if (s[i++] !== ")") throw new Error("Expected closing parenthesis");
  i = space(s, i);
  if (s[i] !== "[") throw new Error("Expected content");
  const end = balanced(s, i);
  const attributes: unknown = JSON.parse(attrs.value);
  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  )
    throw new Error("Invalid attributes");
  const tagName = tag.value;
  const block = /^(p|h[1-6]|pre|li|td|th|figcaption|caption)$/.test(tagName);
  const contentSource = s.slice(i + 1, end - 1);
  let body: string;
  const atom = /^#twyne-(math|mermaid|image)\(/.exec(contentSource);
  if (atom) {
    const value = quoted(contentSource, atom[0].length);
    const record = attributes as Record<string, unknown>;
    if (atom[1] === "image") {
      const tail = contentSource.slice(value.end);
      const imageOptions = /^,\s*width:\s*[\d.]+%,\s*alt:\s*/.exec(tail);
      if (!imageOptions) throw new Error("Unsupported image arguments");
      const alt = quoted(tail, imageOptions[0].length);
      if (tail.slice(alt.end) !== ")")
        throw new Error("Unsupported image arguments");
      record["src"] = value.value;
      if (alt.value || "alt" in record) record["alt"] = alt.value;
      body = "";
    } else if (
      atom[1] === "math" &&
      /^,\s*block:\s*(true|false)\)$/.test(contentSource.slice(value.end))
    ) {
      record["data-latex"] = value.value;
      body = escapeHtml(value.value);
    } else if (
      atom[1] === "mermaid" &&
      contentSource.slice(value.end) === ")"
    ) {
      record["data-mermaid-source"] = value.value;
      body = escapeHtml(value.value);
    } else body = parseInline(contentSource, depth + 1, !block);
  } else body = parseInline(contentSource, depth + 1, !block);
  delete (attributes as Record<string, unknown>)["data-twyne-columns"];
  delete (attributes as Record<string, unknown>)["data-twyne-column-widths"];
  delete (attributes as Record<string, unknown>)["data-twyne-caption"];
  return {
    html: element(tagName, attributes as Record<string, unknown>, body),
    end,
  };
}
function parseInline(s: string, depth = 0, blockChildren = false): string {
  if (depth > MAX_DEPTH) return raw(s, !blockChildren);
  let html = "";
  for (let i = 0; i < s.length; ) {
    if (s.startsWith("#twyne-node(", i)) {
      const parsed = parseWrapper(s, i, depth + 1);
      html += parsed.html;
      i = parsed.end;
      continue;
    }
    if (s.startsWith("#text(", i)) {
      try {
        const str = quoted(s, space(s, i + 6));
        const end = space(s, str.end);
        if (s[end] !== ")") throw new Error("Unsupported text arguments");
        html += escapeHtml(str.value);
        i = end + 1;
        continue;
      } catch {
        /* preserve unsupported text calls as source */
      }
    }
    const formatting =
      /^#(strong|emph|underline|strike|super|sub|highlight)\[/.exec(s.slice(i));
    if (formatting) {
      const open = i + formatting[0].length - 1;
      const end = balanced(s, open);
      const tags: Record<string, string> = {
        strong: "strong",
        emph: "em",
        underline: "u",
        strike: "s",
        super: "sup",
        sub: "sub",
        highlight: "mark",
      };
      html += element(
        tags[formatting[1]],
        {},
        parseInline(s.slice(open + 1, end - 1), depth + 1),
      );
      i = end;
      continue;
    }
    if (s[i] === "*" || s[i] === "_") {
      const end = s.indexOf(s[i], i + 1);
      if (end > i + 1) {
        html += element(
          s[i] === "*" ? "strong" : "em",
          {},
          parseInline(s.slice(i + 1, end), depth + 1),
        );
        i = end + 1;
        continue;
      }
    }
    if (s[i] === "\\" && i + 1 < s.length) {
      html += escapeHtml(s[i + 1]);
      i += 2;
      continue;
    }
    if (
      s[i] === "#" ||
      s[i] === "$" ||
      s[i] === "`" ||
      s.startsWith("//", i) ||
      s.startsWith("/*", i) ||
      s[i] === "@" ||
      s[i] === "<"
    ) {
      // Consume an unsupported expression as one atom, keeping following prose editable.
      let end = i + 1;
      if (s[i] === "$" || s[i] === "`") {
        const close = s.indexOf(s[i], i + 1);
        end = close < 0 ? s.length : close + 1;
      } else if (s.startsWith("//", i)) {
        const close = s.indexOf("\n", i);
        end = close < 0 ? s.length : close;
      } else if (s.startsWith("/*", i)) {
        const close = s.indexOf("*/", i + 2);
        end = close < 0 ? s.length : close + 2;
      } else {
        while (end < s.length && /[\w.-]/.test(s[end])) end++;
        while (s[end] === "(" || s[end] === "[" || s[end] === "{")
          end = balanced(s, end);
        if (end === i + 1 || s[i] === "<") {
          while (end < s.length && !/\s/.test(s[end])) end++;
        }
      }
      html += raw(s.slice(i, end), !blockChildren);
      i = end;
      continue;
    }
    html += escapeHtml(s[i]);
    i++;
  }
  return html;
}
function bodyOf(source: string): string {
  if (source.startsWith(TYPST_DOCUMENT_PREAMBLE))
    return source.slice(TYPST_DOCUMENT_PREAMBLE.length);
  // Only our exact preamble is elided. A changed preamble is user source and must survive.
  return source;
}
function paragraphEnd(source: string, start: number): number {
  for (let i = start; i < source.length; i++) {
    if (source.startsWith("\n\n", i)) return i;
    if (source.startsWith("/*", i)) {
      let nesting = 1;
      i += 2;
      for (; i < source.length && nesting; i++) {
        if (source.startsWith("/*", i)) {
          nesting++;
          i++;
        } else if (source.startsWith("*/", i)) {
          nesting--;
          i++;
        }
      }
      i--;
      continue;
    }
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end - 1;
      continue;
    }
    if (source[i] === "#") {
      let end = i + 1;
      while (end < source.length && /[\w.-]/.test(source[end])) end++;
      // Declarations may have spaces before their blocks; retaining the whole
      // balanced block keeps internal blank lines out of the rich editor.
      for (; end < source.length && source[end] !== "\n"; end++) {
        if (source[end] === '"') {
          end = quoted(source, end).end - 1;
          continue;
        }
        if ("([{ ".includes(source[end]) && source[end] !== " ")
          end = balanced(source, end) - 1;
      }
      i = end - 1;
    }
  }
  return source.length;
}
function pieces(source: string): Piece[] {
  const body = bodyOf(source);
  const result: Piece[] = [];
  let i = 0;
  while (i < body.length) {
    const begin = i;
    i = space(body, i);
    if (i >= body.length) {
      if (result.length) result[result.length - 1].source += body.slice(begin);
      break;
    }
    if (body.startsWith("#twyne-node(", i)) {
      try {
        const p = parseWrapper(body, i, 0);
        result.push({ source: body.slice(begin, p.end), html: p.html });
        i = p.end;
        continue;
      } catch {
        result.push({
          source: body.slice(begin),
          html: raw(body.slice(begin)),
        });
        break;
      }
    }
    // Native top-level paragraphs, headings and list items; code remains opaque.
    let end: number;
    try {
      end = paragraphEnd(body, i);
    } catch {
      end = body.length;
    }
    const s = body.slice(i, end);
    let html: string;
    try {
      const heading = /^(={1,6})\s+([\s\S]*)$/.exec(s);
      if (heading)
        html = `<h${heading[1].length}>${parseInline(heading[2])}</h${heading[1].length}>`;
      else if (
        /^[-+]\s/.test(s) &&
        s.split("\n").every((line) => /^[-+]\s/.test(line))
      ) {
        const tag = s[0] === "+" ? "ol" : "ul";
        html = `<${tag}>${s
          .split("\n")
          .map((line) => `<li><p>${parseInline(line.slice(2))}</p></li>`)
          .join("")}</${tag}>`;
      } else if (
        /^(#(?:let|set|show|import|include|for|if|while)\b|\/\/|\/\*)/.test(s)
      )
        html = raw(s);
      else html = `<p>${parseInline(s)}</p>`;
    } catch {
      html = raw(s);
    }
    result.push({ source: body.slice(begin, end), html });
    i = end;
  }
  return result;
}
export function typstToHtml(source: string): string {
  bounded(source);
  return (
    pieces(source)
      .map((p) => p.html)
      .join("") || "<p></p>"
  );
}

/** Reuse exact authored blocks when unchanged, including their comments and whitespace. */
export function reconcileTypstSource(
  previousSource: string,
  newHtml: string,
): string {
  bounded(previousSource);
  bounded(newHtml);
  const canonical = (html: string) => {
    const dom = new DOMParser().parseFromString(html, "text/html");
    return dom.body.innerHTML;
  };
  if (canonical(typstToHtml(previousSource)) === canonical(newHtml))
    return previousSource;
  const old = pieces(previousSource);
  const available = new Map<string, string[]>();
  for (const p of old) {
    const key = canonical(p.html);
    const list = available.get(key) ?? [];
    list.push(p.source);
    available.set(key, list);
  }
  const generated = pieces(htmlToTypst(newHtml));
  return (
    TYPST_DOCUMENT_PREAMBLE +
    generated
      .map((p) => available.get(canonical(p.html))?.shift() ?? p.source)
      .join("\n\n")
  );
}
