/**
 * HTML → Markdown for the manuscript export.
 *
 * The implementation this replaces called `stripHtml` on its first line and
 * then ran regexes over the resulting plain text. Every inline mark the writer
 * had applied — bold, italic, strikethrough, links, inline code, highlights —
 * was gone before the conversion began, and the only structure that survived
 * was whatever happened to look like a heading or a bullet once the tags were
 * removed. A writer who struck a sentence through and exported to Markdown got
 * the sentence back unmarked, which is what made strikethrough look like a
 * feature that had never been built.
 *
 * Written as a small recursive tokenizer over the tag stream rather than as
 * regex passes, because the two things regexes cannot do here are nesting
 * (a list inside a list inside a blockquote) and context (a `<p>` inside a
 * table cell must not become a paragraph break). No DOM: this runs under
 * `bun test` and in the browser, and pulling in a parser for one export path
 * is not worth the dependency.
 */

interface Token {
  kind: "open" | "close" | "text";
  /** Lower-cased tag name, for open/close. */
  name?: string;
  attrs?: Record<string, string>;
  /** Decoded text, for text tokens. */
  text?: string;
  /** Self-closing or void element. */
  void?: boolean;
}

const VOID_TAGS = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "col",
  "area",
  "base",
  "wbr",
]);

/** Tags whose contents are dropped wholesale. */
const DISCARD_TAGS = new Set(["style", "script", "head", "title"]);

export function decodeEntities(text: string): string {
  return (
    text
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&hellip;/g, "…")
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–")
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
        String.fromCodePoint(parseInt(h, 16)),
      )
      // Ampersand last, or a doubly-encoded entity decodes twice.
      .replace(/&amp;/g, "&")
  );
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re =
    /([a-zA-Z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<(\/)?([a-zA-Z][-\w:]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/)?>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html))) {
    if (m.index > last) {
      tokens.push({ kind: "text", text: html.slice(last, m.index) });
    }
    last = re.lastIndex;
    const name = m[2].toLowerCase();
    if (m[1]) {
      tokens.push({ kind: "close", name });
    } else {
      tokens.push({
        kind: "open",
        name,
        attrs: parseAttrs(m[3] ?? ""),
        void: Boolean(m[4]) || VOID_TAGS.has(name),
      });
    }
  }
  if (last < html.length) tokens.push({ kind: "text", text: html.slice(last) });
  return tokens;
}

/** Characters that would otherwise start a Markdown construct. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

interface Ctx {
  /** Inside a table cell: block elements must not emit newlines. */
  inCell: boolean;
  /** Inside a code block or inline code: no escaping, no marks. */
  inCode: boolean;
}

interface ListFrame {
  ordered: boolean;
  index: number;
  /** Task list items render as `- [ ]` / `- [x]`. */
  task: boolean;
}

/**
 * Convert an HTML fragment to Markdown.
 *
 * GFM is the target: strikethrough, task lists and pipe tables all assume it.
 * Constructs with no Markdown spelling — superscript, subscript, the endnote
 * markers — are passed through as inline HTML, which GFM permits and which is
 * strictly better than dropping them.
 */
export function htmlToMarkdown(html: string): string {
  const tokens = tokenize(html);
  const out: string[] = [];

  const listStack: ListFrame[] = [];
  const quoteDepth = { value: 0 };
  const ctx: Ctx = { inCell: false, inCode: false };

  let discardDepth = 0;
  let mathDepth = 0;
  let pendingLinkText: string[] | null = null;
  let pendingLinkHref = "";
  // Table state. Buffered because a GFM table cannot be streamed: the
  // alignment row has to be emitted after the header row is complete.
  let table: { rows: string[][]; header: boolean; caption: string } | null =
    null;
  let cell: string[] | null = null;
  let caption: string[] | null = null;

  /** Where text currently goes: a link label, a table cell, or the output. */
  const emit = (s: string) => {
    if (!s) return;
    if (pendingLinkText) pendingLinkText.push(s);
    else if (cell) cell.push(s);
    else if (caption) caption.push(s);
    else out.push(s);
  };

  const blockBreak = () => {
    if (cell || pendingLinkText) return;
    // Collapse runs of blank lines rather than tracking whether one is due.
    while (out.length && /^\s*$/.test(out[out.length - 1] ?? "")) out.pop();
    if (out.length) out.push("\n\n");
  };

  const linePrefix = () => {
    const quote = "> ".repeat(quoteDepth.value);
    if (listStack.length === 0) return quote;
    // Nested list items indent by two spaces per level above the first.
    return quote + "  ".repeat(listStack.length - 1);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.kind === "open" && DISCARD_TAGS.has(t.name!)) {
      discardDepth++;
      continue;
    }
    if (t.kind === "close" && DISCARD_TAGS.has(t.name!)) {
      if (discardDepth > 0) discardDepth--;
      continue;
    }
    if (discardDepth > 0) continue;

    if (mathDepth > 0) {
      if (t.kind === "open" && !t.void) mathDepth++;
      if (t.kind === "close") mathDepth--;
      continue;
    }

    if (t.kind === "text") {
      const raw = decodeEntities(t.text ?? "");
      if (ctx.inCode) {
        emit(raw);
        continue;
      }
      // Collapse whitespace the way HTML does, so source indentation in the
      // stored document does not become Markdown indentation (which is code).
      const collapsed = raw.replace(/\s+/g, " ");
      if (collapsed.trim() === "" && !/\S/.test(collapsed)) {
        // Keep a single separating space between inline elements.
        if (collapsed.length > 0) emit(" ");
        continue;
      }
      emit(escapeInline(collapsed));
      continue;
    }

    const name = t.name!;

    if (t.kind === "open") {
      const mathDisplay =
        t.attrs?.["data-math-display"] ??
        (t.attrs?.["data-type"] === "block-math"
          ? "block"
          : t.attrs?.["data-type"] === "inline-math"
            ? "inline"
            : null);
      if ((name === "span" || name === "div") && mathDisplay) {
        const source = t.attrs?.["data-latex"] ?? "";
        if (mathDisplay === "block") {
          blockBreak();
          out.push(`${linePrefix()}$$\n${source}\n${linePrefix()}$$`);
          blockBreak();
        } else {
          emit(`$${source}$`);
        }
        if (!t.void) mathDepth = 1;
        continue;
      }

      switch (name) {
        case "br":
          // Two trailing spaces is the only hard break Markdown has.
          emit(cell ? "<br>" : "  \n" + linePrefix());
          break;

        case "hr":
          blockBreak();
          out.push(`${linePrefix()}---`);
          break;

        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          blockBreak();
          out.push(`${linePrefix()}${"#".repeat(Number(name[1]))} `);
          break;

        case "p":
          if (cell) break; // a paragraph inside a cell is just its text
          if (listStack.length > 0) break; // list items own their spacing
          // A blockquote has already opened the line with its own prefix; the
          // first paragraph inside it must continue that line rather than
          // break to a new one and emit the prefix twice.
          if (out.length && out[out.length - 1] === linePrefix()) break;
          blockBreak();
          out.push(linePrefix());
          break;

        case "blockquote":
          blockBreak();
          quoteDepth.value++;
          out.push(linePrefix());
          break;

        case "ul":
        case "ol":
          if (listStack.length === 0) blockBreak();
          listStack.push({
            ordered: name === "ol",
            index: Number(t.attrs?.start ?? 1),
            task: (t.attrs?.["data-type"] ?? "") === "taskList",
          });
          break;

        case "li": {
          const frame = listStack[listStack.length - 1];
          if (!frame) break;
          if (out.length) out.push("\n");
          const marker = frame.ordered ? `${frame.index++}. ` : "- ";
          let box = "";
          if (frame.task) {
            const checked = (t.attrs?.["data-checked"] ?? "") === "true";
            box = checked ? "[x] " : "[ ] ";
          }
          out.push(`${linePrefix()}${marker}${box}`);
          break;
        }

        case "pre":
          blockBreak();
          ctx.inCode = true;
          out.push(`${linePrefix()}\`\`\`\n`);
          break;

        case "code":
          // Inside <pre> the fence already opened; a bare <code> is inline.
          if (!ctx.inCode) {
            ctx.inCode = true;
            emit("`");
          }
          break;

        case "strong":
        case "b":
          emit("**");
          break;
        case "em":
        case "i":
          emit("*");
          break;
        case "s":
        case "del":
        case "strike":
          emit("~~");
          break;
        case "mark":
          // GFM has no highlight delimiter. `==text==` is a non-standard
          // Obsidian/Markdown-it convention and importing it through `marked`
          // produces literal equals signs. Inline HTML is portable GFM and
          // round-trips through the app's existing Markdown importer.
          emit("<mark>");
          break;

        case "a":
          pendingLinkText = [];
          pendingLinkHref = t.attrs?.href ?? "";
          break;

        case "img": {
          const alt = t.attrs?.alt ?? "";
          const src = t.attrs?.src ?? "";
          // A base64 data URI is megabytes of noise in a text file; name it
          // rather than paste it.
          const href = src.startsWith("data:") ? "embedded-image" : src;
          emit(`![${alt}](${href})`);
          break;
        }

        case "table":
          blockBreak();
          table = { rows: [], header: false, caption: "" };
          break;

        case "caption":
          if (table) caption = [];
          break;

        case "figcaption":
          blockBreak();
          out.push("*");
          break;

        case "tr":
          table?.rows.push([]);
          break;

        case "th":
          if (table) table.header = true;
          cell = [];
          break;
        case "td":
          cell = [];
          break;

        case "sup":
        case "sub":
          // No Markdown spelling. GFM allows inline HTML, and keeping the tag
          // is strictly better than silently dropping the character.
          emit(`<${name}>`);
          break;

        case "div":
          if (t.attrs?.["data-page-break"] !== undefined) {
            // A page break has no Markdown meaning; `---` would be a lie,
            // since that is a horizontal rule and the schema already has one.
            break;
          }
          if (!cell && listStack.length === 0) blockBreak();
          break;

        default:
          break;
      }
      continue;
    }

    // close
    switch (name) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        blockBreak();
        break;

      case "p":
        if (!cell && listStack.length === 0) blockBreak();
        break;

      case "blockquote":
        if (quoteDepth.value > 0) quoteDepth.value--;
        blockBreak();
        break;

      case "ul":
      case "ol":
        listStack.pop();
        if (listStack.length === 0) blockBreak();
        break;

      case "pre":
        ctx.inCode = false;
        out.push(`\n${linePrefix()}\`\`\``);
        blockBreak();
        break;

      case "code":
        if (ctx.inCode && !out.join("").endsWith("```\n")) {
          // Inline code only; the <pre> case is handled above.
          const insidePre = tokens
            .slice(0, i)
            .some((x) => x.kind === "open" && x.name === "pre");
          if (!insidePre) {
            ctx.inCode = false;
            emit("`");
          }
        }
        break;

      case "strong":
      case "b":
        emit("**");
        break;
      case "em":
      case "i":
        emit("*");
        break;
      case "s":
      case "del":
      case "strike":
        emit("~~");
        break;
      case "mark":
        emit("</mark>");
        break;

      case "a": {
        const label = (pendingLinkText ?? []).join("").trim();
        pendingLinkText = null;
        if (!label) break;
        emit(pendingLinkHref ? `[${label}](${pendingLinkHref})` : label);
        pendingLinkHref = "";
        break;
      }

      case "th":
      case "td": {
        const text = (cell ?? []).join("").trim().replace(/\|/g, "\\|");
        cell = null;
        const row = table?.rows[table.rows.length - 1];
        row?.push(text);
        break;
      }

      case "table": {
        if (table && table.rows.length) {
          const rows = table.rows.filter((r) => r.length > 0);
          const width = Math.max(...rows.map((r) => r.length));
          const pad = (r: string[]) =>
            `| ${Array.from({ length: width }, (_, c) => r[c] ?? "").join(" | ")} |`;
          const lines = [pad(rows[0])];
          lines.push(`| ${Array(width).fill("---").join(" | ")} |`);
          for (const r of rows.slice(1)) lines.push(pad(r));
          if (table.caption) {
            out.push(`${linePrefix()}*${table.caption}*\n\n`);
          }
          out.push(linePrefix() + lines.join(`\n${linePrefix()}`));
          blockBreak();
        }
        table = null;
        break;
      }

      case "caption":
        if (table) table.caption = (caption ?? []).join("").trim();
        caption = null;
        break;

      case "figcaption":
        out.push("*");
        blockBreak();
        break;

      case "sup":
      case "sub":
        emit(`</${name}>`);
        break;

      default:
        break;
    }
  }

  return out
    .join("")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
