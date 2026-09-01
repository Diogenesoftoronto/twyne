/**
 * Export and import for the manuscript. Each format is intentionally
 * a small pure function — no I/O, no UI. The UI layer calls these to
 * produce a `Blob` for download, or to turn an uploaded file into HTML
 * the editor can consume.
 *
 * The shapes match the standard.horse / leaflet.pub convention: a
 * plain markdown file is the canonical share format, with a Twyne
 * backup (`.twyne.json`) that round-trips the brief + folios + content
 * for the cases where the user wants everything back.
 */

import { marked } from "marked";
import type {
  Folio,
  LayoutSettings,
  ProjectBrief,
  PersonaFeedback,
  RoomAnalysis,
} from "../types";
import {
  CSS_PX_PER_IN,
  DEFAULT_LAYOUT,
  resolveMargins,
  resolvePageSetup,
} from "../types";
import { remToPx } from "./css-units";
import { htmlToMarkdown } from "./html-to-markdown";
import {
  formatCitation,
  type BibEntry,
  type CitationStyle,
} from "./bibliography";

export type ExportFormat =
  | "markdown"
  | "html"
  | "txt"
  | "docx"
  | "twyne-backup";

/* ── HTML helpers ──────────────────────────────────────────────── */

export function stripHtml(html: string): string {
  return (
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      // A manual page break becomes a form feed — the ASCII character that has
      // meant exactly this since the teletype, and the one thing a plain-text
      // reader might actually act on. Matched before the generic tag strip, or
      // the break would vanish without trace.
      .replace(/<div[^>]*data-page-break[^>]*>\s*<\/div>/gi, "\n\f\n")
      .replace(/<\/(p|h[1-6]|li|blockquote|tr|div)>/gi, "\n")
      .replace(/<br\s*\/?>(?=)/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * HTML → Markdown for the manuscript export.
 *
 * Lives in `html-to-markdown.ts` now. It replaced an implementation that
 * called `stripHtml` on its first line, flattening every inline mark the
 * writer had applied before the conversion even began — bold, italic,
 * strikethrough, links and highlights all arrived in the exported file as
 * plain prose. Re-exported here so the module's public surface is unchanged.
 */
export { htmlToMarkdown };

function wrapStandaloneHtml(
  title: string,
  body: string,
  options: {
    layout?: LayoutSettings;
    header?: string;
    footer?: string;
    brief?: ProjectBrief | null;
  } = {},
): string {
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const widthMap: Record<LayoutSettings["width"], string> = {
    narrow: "36rem",
    normal: "48rem",
    wide: "62rem",
  };
  const m = resolveMargins(layout);
  const setup = resolvePageSetup(layout);
  // Print is paginated unless the document explicitly asked for a continuous
  // sheet. This deliberately does *not* use `setup.pagination`, whose default
  // flipped to continuous when scroll became the editor's default view: a
  // printed page is a physical object, and defaulting a PDF to `size: auto`
  // because the writer happened to be drafting in scroll mode would be the
  // wrong answer for every export.
  const paginated = (layout.pagination ?? "paginated") === "paginated";
  const docWidth = widthMap[layout.width];

  // Margins go to `@page` in inches, converted through the same fixed 96px/in
  // the print engine uses. The document below pins `html { font-size: 16px }`
  // so this conversion is exact rather than dependent on whatever the
  // browser's default text size happens to be.
  const inches = (rem: number) => (remToPx(rem) / CSS_PX_PER_IN).toFixed(3);
  const docPageMargin = `${inches(m.top)}in ${inches(m.right)}in ${inches(m.bottom)}in ${inches(m.left)}in`;
  const pageSize = paginated
    ? `${setup.paper === "a4" ? "A4" : setup.paper} ${setup.orientation}`
    : "auto";

  const running = layout.runningHeader
    ? (options.header && options.header.trim()) ||
      (options.brief
        ? `${options.brief.answers.workingTitle || "Untitled"} · ${new Date().toLocaleDateString()}`
        : title)
    : options.header || "";

  // No `counter(page)` fallback here: it never worked, and printing the
  // literal word "page" once at the end of the manuscript is worse than
  // printing nothing. See the note on exportPdf.
  const footer = options.footer || "";
  const hasLeadingTitle = /^\s*<h1\b/i.test(body);
  const titleBlock = hasLeadingTitle
    ? ""
    : `<header class="export-titleblock">\n  <h1>${escapeHtml(title)}</h1>\n</header>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="Twyne" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Special+Elite&display=swap" />
<style>
  :root { color-scheme: light; }
  *, *::before, *::after { box-sizing: border-box; }
  /* The sheet owns the margins. There is deliberately no margin or padding on
     <body>: setting both stacks them, which silently doubled every printed
     margin for as long as this exporter has existed. */
  @page { size: ${pageSize}; margin: ${docPageMargin}; }
  /* Pin the root size so the rem-denominated margins above convert to inches
     exactly. On screen the editor leaves this alone, so a reader's text
     scaling still works; a printed sheet is a physical object and does not
     get to be 25% larger because of a browser preference. */
  html { font-size: 16px; }
  body {
    font-family: "Lora", Georgia, "Times New Roman", serif;
    min-height: 100vh;
    margin: 0;
    padding: 0;
    line-height: 1.7;
    color: #1a1611;
    background: #e7ded0;
  }
  /* A standalone export should be pleasant to open directly, not just when
     it is sent to a print dialog. The shell gives readers a restrained page
     on screen while @page remains the sole authority for printed margins. */
  .export-document {
    width: min(calc(100% - 2rem), ${docWidth});
    margin: clamp(1rem, 5vw, 4rem) auto;
    padding: clamp(1.5rem, 6vw, 4.5rem);
    background: #fbf6ec;
    box-shadow: 0 0.5rem 1.5rem rgb(37 29 19 / 0.16);
  }
  article { max-width: 70ch; }
  .export-titleblock {
    max-width: 70ch;
    margin: 0 0 clamp(2rem, 5vw, 3.5rem);
    padding-bottom: 1.25rem;
    border-bottom: 1px solid #c7b89c;
  }
  .export-titleblock h1 {
    margin: 0;
    color: #1a1611;
    font-family: "Libre Baskerville", Georgia, serif;
    font-size: clamp(2rem, 6vw, 3.5rem);
    font-weight: 600;
    line-height: 1.08;
    letter-spacing: -0.02em;
  }
  /* Match the editor's own paragraph setting, so the print engine breaks
     lines where the screen did. Without this the two disagree about
     hyphenation and justification and every page drifts by a line. */
  p {
    text-align: justify;
    hyphens: auto;
    -webkit-hyphens: auto;
  }
  /* Mirror the screen engine's atomic-block contract: it never splits these,
     so neither should the printer. The break-after rule on headings is the
     print-side twin of the engine's keepWithNext. */
  table, pre, img, blockquote, figure, .tableWrapper { break-inside: avoid; }
  h1, h2, h3, [data-keep-with-next="true"] {
    break-after: avoid;
    page-break-after: avoid;
  }
  p, li { orphans: 2; widows: 2; }
  /* Highlights. A chosen colour arrives as an inline background-color; this
     is only the fallback for a mark saved before the colour picker existed. */
  mark { background-color: #f6e2a8; padding: 0; }
  /* Match the editor's raised/lowered metrics rather than the browser's, so
     a formula does not reflow between screen and paper. */
  sup, sub { font-size: 0.72em; line-height: 0; position: relative; vertical-align: baseline; }
  sup { top: -0.45em; }
  sub { bottom: -0.22em; }
  /* Alignment chosen on a paragraph beats the justified default above. */
  p[style*="text-align"] { hyphens: manual; -webkit-hyphens: manual; }
  /* A manual page break. The editor's node carries data-page-break so this
     works on a manuscript opened outside Twyne too. */
  [data-page-break], .twyne-page-break {
    break-after: page;
    height: 0;
    margin: 0;
    border: 0;
  }
  @media print {
    /* Chrome repeats a fixed element on every printed page, which is the only
       working way to get a running header. There is no equivalent for the
       page number: counter(page) is readable only inside an @page margin box,
       and Chrome implements neither the box nor the counter outside it. */
    html, body { min-height: 0; background: #fff; }
    .export-document {
      width: auto; margin: 0; padding: 0; background: transparent;
      box-shadow: none;
    }
    article, .export-titleblock { max-width: none; }
    .twyne-chrome:not(.f) { position: fixed; top: 0; left: 0; right: 0; }
    .twyne-page-spacer, .twyne-page-chrome { display: none !important; }
  }
  .twyne-chrome {
    display: flex; justify-content: space-between; align-items: baseline;
    font-family: ui-monospace, "SF Mono", monospace;
    font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase;
    color: #554a3d; padding: 0.5rem 0; border-bottom: 1px solid #c7b89c;
    margin-bottom: 2rem;
  }
  .twyne-chrome.f { border-top: 1px solid #c7b89c; border-bottom: none; margin: 2rem 0 0; }
  h1, h2, h3 { font-family: "Libre Baskerville", Georgia, serif; font-weight: 600; }
  h1 { font-size: 2.1rem; margin-bottom: 1.4rem; }
  h2 { font-size: 1.4rem; margin-top: 2.2rem; }
  p { margin: 0 0 1.1rem; }
  blockquote {
    border-left: 3px solid #b04a3a;
    padding-left: 1rem;
    color: #4a3e30;
    font-style: italic;
  }
  hr { border: none; border-top: 1px solid #c7b89c; margin: 2rem 0; }
  table {
    width: 100%; border-collapse: collapse; margin: 1.25rem 0;
    font-family: "DM Sans", Arial, sans-serif; font-size: 0.92rem;
  }
  table caption {
    caption-side: top; padding: 0.35rem 0 0.6rem; text-align: left;
    font-family: "Lora", Georgia, serif; font-size: 0.82rem;
    font-style: italic; color: #6a5d4a;
  }
  table td, table th {
    border: 1px solid #c7b89c; padding: 0.55em 0.8em;
    text-align: left; vertical-align: top;
  }
  table th { background: #eee5d6; font-weight: 700; }
  table[data-table-style="plain"] td,
  table[data-table-style="plain"] th { border-color: transparent; }
  table[data-table-style="grid"] td,
  table[data-table-style="grid"] th { border: 1px solid #c7b89c; }
  table[data-table-style="banded-rows"] tbody tr:nth-child(even) > td {
    background: #f5ede0;
  }
  table[data-table-style="minimal"] td,
  table[data-table-style="minimal"] th {
    border-width: 0 0 1px; border-color: #c7b89c;
  }
  figure[data-type="image"] { margin: 1.4rem auto; max-width: 100%; }
  figure[data-type="image"] img {
    display: block; width: 100%; height: auto; max-width: 100%;
  }
  figure[data-type="image"] figcaption {
    margin-top: 0.45rem; color: #6a5d4a; font-size: 0.78rem;
    line-height: 1.4; text-align: center;
  }
  [data-math-display="inline"] {
    font-family: "Times New Roman", serif; white-space: nowrap;
  }
  [data-math-display="block"] {
    margin: 1rem 0; text-align: center; font-family: "Times New Roman", serif;
    white-space: pre-wrap; break-inside: avoid;
  }
  /* Match the editor's nesting: markers cycle by depth, and a list
     item's paragraph does not double-space the list. */
  ul, ol { padding-left: 1.6em; margin: 0 0 1.1rem; }
  ul { list-style: disc outside; }
  ul ul { list-style-type: circle; }
  ul ul ul { list-style-type: square; }
  ol { list-style: decimal outside; }
  ol ol { list-style-type: lower-alpha; }
  ol ol ol { list-style-type: lower-roman; }
  li { margin: 0.2rem 0; }
  li > p { margin: 0; }
  li > ul, li > ol { margin: 0.25rem 0; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  .tableWrapper { max-width: 100%; overflow-x: auto; }
  a { color: #75251c; text-decoration-thickness: 0.08em; text-underline-offset: 0.16em; }
  a:focus-visible { outline: 2px solid #75251c; outline-offset: 0.18em; }
  sup.endnote-ref { color: #b04a3a; font-size: 0.75em; }
  sup.footnote-ref { color: #2c4a7c; font-size: 0.75em; }
  .endnotes, .footnotes {
    margin-top: 2.5rem; padding-top: 1rem;
    border-top: 1px solid #c7b89c;
    font-size: 0.9rem; color: #4a3e30;
  }
  .endnotes h2, .footnotes h2 { font-size: 1.05rem; margin: 0 0 0.8rem; }
  .endnotes ol, .footnotes ol { list-style: none; padding: 0; margin: 0; }
  .endnotes li, .footnotes li { margin: 0 0 0.55rem; }
  .endnotes li sup, .footnotes li sup { margin-right: 0.35rem; }
  .endnote-source { font-variant: small-caps; letter-spacing: 0.04em; }
</style>
</head>
<body>
<main class="export-document">
${running ? `<div class="twyne-chrome"><span>${escapeHtml(running)}</span></div>` : ""}
${titleBlock}
<article>
${body}
</article>
${footer ? `<div class="twyne-chrome f"><span>${escapeHtml(footer)}</span></div>` : ""}
</main>
</body>
</html>`;
}

/* ── Endnote / footnote extraction ─────────────────────────────── */

/**
 * Regex to find inline note nodes (endnotes and footnotes) in the
 * editor HTML. The lookahead keeps it independent of attribute order —
 * TipTap serializes `data-endnote-text` before `data-type`.
 */
const NOTE_SUP_RE =
  /<sup\b(?=[^>]*data-type="(?:endnote|footnote)")[^>]*>[\s\S]*?<\/sup>/gi;

export interface InlineNote {
  kind: "endnote" | "footnote";
  text: string;
}

/**
 * Extract inline notes from `<sup data-type="endnote|footnote">` nodes
 * in the editor HTML, returning them in document order.
 */
export function extractInlineNotes(html: string): InlineNote[] {
  const notes: InlineNote[] = [];
  let m: RegExpExecArray | null;
  NOTE_SUP_RE.lastIndex = 0;
  while ((m = NOTE_SUP_RE.exec(html)) !== null) {
    const tag = m[0];
    const kind = /data-type="footnote"/i.test(tag) ? "footnote" : "endnote";
    const text = /data-endnote-text="([^"]*)"/i.exec(tag)?.[1] ?? "";
    notes.push({ kind, text: htmlDecode(text) });
  }
  return notes;
}

/** Extract endnote texts only (kept for callers that predate footnotes). */
export function extractEndnotes(html: string): string[] {
  return extractInlineNotes(html)
    .filter((n) => n.kind === "endnote")
    .map((n) => n.text);
}

/**
 * Replace note `<sup>` nodes in the HTML with numbered superscript
 * references (¹ ² ³ …) so the exported body reads naturally. Endnotes
 * and footnotes number independently, matching their export sections.
 */
function replaceNotesWithSuperscripts(html: string): string {
  let endnoteCount = 0;
  let footnoteCount = 0;
  return html.replace(NOTE_SUP_RE, (tag) => {
    if (/data-type="footnote"/i.test(tag)) {
      footnoteCount++;
      return `<sup class="footnote-ref">${toSuperscript(footnoteCount)}</sup>`;
    }
    endnoteCount++;
    return `<sup class="endnote-ref">${toSuperscript(endnoteCount)}</sup>`;
  });
}

/** Convert a number to Unicode superscript digits. */
function toSuperscript(n: number): string {
  const map: Record<string, string> = {
    "0": "\u2070",
    "1": "\u00b9",
    "2": "\u00b2",
    "3": "\u00b3",
    "4": "\u2074",
    "5": "\u2075",
    "6": "\u2076",
    "7": "\u2077",
    "8": "\u2078",
    "9": "\u2079",
  };
  return String(n)
    .split("")
    .map((d) => map[d] ?? d)
    .join("");
}

/**
 * Strip editor-only marks (persona notes, suggestions, comments) from
 * the HTML so the exported manuscript is clean prose. Endnote `<sup>`
 * nodes are preserved — they are handled separately.
 */
function stripEditorMarks(html: string): string {
  return (
    html
      // Remove persona-note spans but keep the text inside.
      .replace(
        /<span[^>]*class="twyne-persona-note"[^>]*>([\s\S]*?)<\/span>/gi,
        "$1",
      )
      // Remove suggestion spans — keep the original text (not the replacement).
      .replace(
        /<span[^>]*class="twyne-suggestion"[^>]*>([\s\S]*?)<\/span>/gi,
        "$1",
      )
      // Remove comment marks but keep text.
      .replace(
        /<span[^>]*class="twyne-comment-mark"[^>]*>([\s\S]*?)<\/span>/gi,
        "$1",
      )
  );
}

/** Build the endnotes section HTML from marginalia + inline endnotes. */
function buildEndnotesSection(
  inlineNotes: string[],
  marginalia: PersonaFeedback[],
): string {
  const entries: Array<{ source: string; text: string }> = [];

  for (const text of inlineNotes) {
    entries.push({ source: "note", text });
  }

  for (const m of marginalia) {
    const author = m.personaName || "Editor";
    const quote = m.anchor ? `"${m.anchor}" — ` : "";
    entries.push({
      source: author,
      text: `${quote}${m.feedback}`,
    });
  }

  if (entries.length === 0) return "";

  const items = entries
    .map(
      (e, i) =>
        `<li id="endnote-${i + 1}"><sup>${toSuperscript(i + 1)}</sup> ` +
        `<span class="endnote-source">${escapeHtml(e.source)}</span>: ` +
        `${escapeHtml(e.text)}</li>`,
    )
    .join("\n");

  return `<section class="endnotes">\n<h2>Notes</h2>\n<ol>\n${items}\n</ol>\n</section>\n`;
}

/**
 * Build the footnotes section HTML: inline footnotes first (matching
 * the body's numbering), then bibliography entries continuing the count.
 */
function buildFootnotesSection(
  inlineFootnotes: string[],
  bibliography: BibEntry[],
  style: CitationStyle,
): string {
  const bibEntries = bibliography.filter((b) => b.url || b.doi || b.title);
  const lines: string[] = [];

  for (const text of inlineFootnotes) {
    lines.push(escapeHtml(text));
  }
  for (const e of bibEntries) {
    lines.push(escapeHtml(formatCitation(e, style)));
  }
  if (lines.length === 0) return "";

  const items = lines
    .map(
      (body, i) =>
        `<li id="footnote-${i + 1}"><sup>${toSuperscript(i + 1)}</sup> ${body}</li>`,
    )
    .join("\n");

  return `<section class="footnotes">\n<h2>Footnotes</h2>\n<ol>\n${items}\n</ol>\n</section>\n`;
}

function htmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/* ── Public surface ────────────────────────────────────────────── */

export interface ExportPayload {
  title: string;
  html: string;
  brief?: ProjectBrief | null;
  folios?: Folio[];
  /** Layout of the active folio, drives export/print margins + width. */
  layout?: LayoutSettings;
  /** Optional running header / footer text. */
  header?: string;
  footer?: string;
  /** Persona marginalia — appended as endnotes in the exported document. */
  marginalia?: PersonaFeedback[];
  /** Bibliography entries — appended as footnotes in the exported document. */
  bibliography?: BibEntry[];
  /** Citation style for formatting footnotes/endnotes. */
  citationStyle?: CitationStyle;
}

export function exportMarkdown(p: ExportPayload): string {
  const style = p.citationStyle ?? "mla";
  const cleaned = stripEditorMarks(p.html);
  const allNotes = extractInlineNotes(cleaned);
  const inlineNotes = allNotes
    .filter((n) => n.kind === "endnote")
    .map((n) => n.text);
  const inlineFootnotes = allNotes
    .filter((n) => n.kind === "footnote")
    .map((n) => n.text);
  const body = replaceNotesWithSuperscripts(cleaned);
  const parts: string[] = [];
  parts.push(`# ${p.title}`);
  parts.push("");
  if (p.brief) {
    parts.push("> *Project brief — set before the first paragraph.*");
    parts.push("");
    parts.push(`- **Format:** ${p.brief.answers.format}`);
    parts.push(`- **Audience:** ${p.brief.answers.audience}`);
    parts.push(`- **Goal:** ${p.brief.answers.goal}`);
    parts.push(`- **Tone:** ${p.brief.answers.tone}`);
    parts.push(`- **Constraints:** ${p.brief.answers.constraints}`);
    parts.push(`- **Success signal:** ${p.brief.answers.successSignal}`);
    parts.push("");
    parts.push("---");
    parts.push("");
  }
  parts.push(htmlToMarkdown(body));
  parts.push("");

  // Endnotes (inline + marginalia)
  const endEntries: Array<{ source: string; text: string }> = [];
  for (const text of inlineNotes) {
    endEntries.push({ source: "note", text });
  }
  for (const m of p.marginalia ?? []) {
    const author = m.personaName || "Editor";
    const quote = m.anchor ? `"${m.anchor}" — ` : "";
    endEntries.push({ source: author, text: `${quote}${m.feedback}` });
  }
  if (endEntries.length > 0) {
    parts.push("---");
    parts.push("");
    parts.push("## Notes");
    parts.push("");
    endEntries.forEach((e, i) => {
      parts.push(`${i + 1}. **${e.source}**: ${e.text}`);
    });
    parts.push("");
  }

  // Footnotes (inline footnotes first, then bibliography)
  const bibEntries = (p.bibliography ?? []).filter(
    (b) => b.url || b.doi || b.title,
  );
  const footLines = [
    ...inlineFootnotes,
    ...bibEntries.map((e) => formatCitation(e, style)),
  ];
  if (footLines.length > 0) {
    if (endEntries.length === 0) {
      parts.push("---");
      parts.push("");
    }
    parts.push("## Footnotes");
    parts.push("");
    footLines.forEach((line, i) => {
      parts.push(`${i + 1}. ${line}`);
    });
    parts.push("");
  }

  return parts.join("\n");
}

export function exportHtml(p: ExportPayload): string {
  const style = p.citationStyle ?? "mla";
  const cleaned = stripEditorMarks(p.html);
  const allNotes = extractInlineNotes(cleaned);
  const inlineNotes = allNotes
    .filter((n) => n.kind === "endnote")
    .map((n) => n.text);
  const inlineFootnotes = allNotes
    .filter((n) => n.kind === "footnote")
    .map((n) => n.text);
  const body = replaceNotesWithSuperscripts(cleaned);
  const endnotes = buildEndnotesSection(inlineNotes, p.marginalia ?? []);
  const footnotes = buildFootnotesSection(
    inlineFootnotes,
    p.bibliography ?? [],
    style,
  );
  return wrapStandaloneHtml(p.title, body + endnotes + footnotes, {
    layout: p.layout,
    header: p.header,
    footer: p.footer,
    brief: p.brief ?? null,
  });
}

export function exportPlainText(p: ExportPayload): string {
  const body = stripHtml(stripEditorMarks(p.html));
  const marginalia = p.marginalia ?? [];
  if (marginalia.length === 0) return body;
  const notes = marginalia.map((comment, index) => {
    const author = comment.personaName || "Editor";
    const quote = comment.anchor ? `“${comment.anchor}”: ` : "";
    return `${index + 1}. ${author}: ${quote}${comment.feedback}`;
  });
  return `${body}\n\nNotes\n\n${notes.join("\n")}`;
}

export function exportTwyneBackup(p: ExportPayload): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      title: p.title,
      brief: p.brief ?? null,
      folios: p.folios ?? [],
      content: { html: p.html, format: "tiptap-html" },
    },
    null,
    2,
  );
}

/**
 * Export to PDF by printing the standalone HTML.
 *
 * No PDF library. The HTML export carries the writer's page setup as real
 * `@page` rules — paper size, orientation and margins — and a print engine is
 * the one renderer guaranteed to honour them. Bolting on jsPDF or html2canvas
 * would mean re-implementing pagination, and canvas-based approaches rasterise
 * the text, which loses selection, search and accessible structure.
 *
 * What the stylesheet cannot carry is the page number. `counter(page)` is
 * readable only inside an `@page` margin box, and Chrome implements neither
 * the margin-box selector nor the counter outside it — an earlier version of
 * this exporter emitted `@bottom-center { content: counter(page) }` and it
 * printed nothing, for years. A `position: fixed` header does repeat on every
 * printed page, so the running header works; the number does not, and the
 * honest fix is a second pass that runs the screen engine over the export
 * document and writes literal numbers into it.
 *
 * The trade is that the writer passes through the browser's print dialog and
 * picks "Save as PDF" there.
 *
 * Resolves once printing has been dispatched; it cannot observe whether the
 * writer completed or cancelled the save.
 */
export async function exportPdf(payload: ExportPayload): Promise<void> {
  if (typeof document === "undefined") return;

  const html = exportHtml(payload);
  const frame = document.createElement("iframe");
  // Off-screen rather than display:none — a hidden frame has no layout, and
  // print() on a frame that was never laid out yields a blank page.
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;";
  document.body.appendChild(frame);

  const cleanup = () => {
    // Deferred: removing the frame while its print job is still spooling
    // cancels the job in some engines.
    setTimeout(() => frame.remove(), 1000);
  };

  try {
    await new Promise<void>((resolve) => {
      frame.addEventListener("load", () => resolve(), { once: true });
      const doc = frame.contentDocument;
      if (!doc) {
        resolve();
        return;
      }
      doc.open();
      doc.write(html);
      doc.close();
    });

    const win = frame.contentWindow;
    if (!win) return;
    // Fonts must be resolved before pagination, or line breaks land in the
    // wrong places and the page count is wrong.
    try {
      await frame.contentDocument?.fonts?.ready;
    } catch {
      // Font loading is best-effort; print anyway.
    }
    win.focus();
    win.print();
  } finally {
    cleanup();
  }
}

/** Build a genuine OOXML Word document. The heavy DOCX runtime is loaded only
 * when requested so ordinary writing sessions do not pay for it. */
export async function exportDocx(payload: ExportPayload): Promise<Blob> {
  if (typeof DOMParser === "undefined") {
    throw new Error("Word export requires a browser document parser.");
  }
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import(
    "docx"
  );
  const parsed = new DOMParser().parseFromString(
    `<html><body>${stripEditorMarks(payload.html)}</body></html>`,
    "text/html",
  );

  const runsFor = (element: Element): InstanceType<typeof TextRun>[] => {
    const runs: InstanceType<typeof TextRun>[] = [];
    const walk = (
      node: Node,
      marks: {
        bold?: boolean;
        italics?: boolean;
        underline?: boolean;
        strike?: boolean;
        superScript?: boolean;
        subScript?: boolean;
      } = {},
    ) => {
      if (node.nodeType === 3) {
        const text = node.textContent ?? "";
        if (text) {
          const { underline, ...otherMarks } = marks;
          runs.push(
            new TextRun({
              text,
              ...otherMarks,
              ...(underline ? { underline: {} } : {}),
            }),
          );
        }
        return;
      }
      if (node.nodeType !== 1) return;
      const nodeElement = node as Element;
      if (nodeElement.tagName === "BR") {
        runs.push(new TextRun({ break: 1 }));
        return;
      }
      const tag = nodeElement.tagName.toLowerCase();
      const next = {
        ...marks,
        bold: marks.bold || tag === "strong" || tag === "b",
        italics: marks.italics || tag === "em" || tag === "i",
        underline: marks.underline || tag === "u",
        strike: marks.strike || tag === "s" || tag === "del",
        superScript: marks.superScript || tag === "sup",
        subScript: marks.subScript || tag === "sub",
      };
      for (const child of Array.from(nodeElement.childNodes)) walk(child, next);
    };
    for (const child of Array.from(element.childNodes)) walk(child);
    return runs;
  };

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      text: payload.title,
      heading: HeadingLevel.TITLE,
    }),
  ];
  const parsedBody =
    parsed.body ?? (parsed.getElementsByTagName("body")[0] as HTMLElement);
  const bodyElements = Array.from(
    parsedBody.children ?? parsedBody.childNodes,
  ).filter((node): node is Element => node.nodeType === 1);
  for (const element of bodyElements) {
    const tag = element.tagName.toLowerCase();
    const heading =
      tag === "h1"
        ? HeadingLevel.HEADING_1
        : tag === "h2"
          ? HeadingLevel.HEADING_2
          : tag === "h3"
            ? HeadingLevel.HEADING_3
            : undefined;
    if (tag === "ul" || tag === "ol") {
      const items = Array.from(element.children ?? element.childNodes).filter(
        (node): node is Element =>
          node.nodeType === 1 &&
          (node as Element).tagName.toLowerCase() === "li",
      );
      for (const [index, item] of items.entries()) {
        const itemRuns = runsFor(item);
        children.push(
          new Paragraph({
            children:
              tag === "ol"
                ? [new TextRun(`${index + 1}. `), ...itemRuns]
                : itemRuns,
            bullet: tag === "ul" ? { level: 0 } : undefined,
          }),
        );
      }
      continue;
    }
    if (tag === "div" && element.hasAttribute("data-page-break")) {
      children.push(new Paragraph({ pageBreakBefore: true }));
      continue;
    }
    children.push(
      new Paragraph({
        children: runsFor(element),
        heading,
        style: tag === "blockquote" ? "Quote" : undefined,
      }),
    );
  }

  const marginalia = payload.marginalia ?? [];
  if (marginalia.length > 0) {
    children.push(
      new Paragraph({
        text: "Notes",
        heading: HeadingLevel.HEADING_2,
      }),
    );
    for (const [index, comment] of marginalia.entries()) {
      const author = comment.personaName || "Editor";
      const quote = comment.anchor ? `“${comment.anchor}”: ` : "";
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${index + 1}. ${author}: `, bold: true }),
            new TextRun(`${quote}${comment.feedback}`),
          ],
        }),
      );
    }
  }

  const document = new Document({ sections: [{ children }] });
  return new Blob([await Packer.toBlob(document)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export function exportAs(format: ExportFormat, payload: ExportPayload): Blob {
  if (format === "docx") {
    throw new Error("Use exportDocx() for the asynchronous Word export.");
  }
  const mime =
    format === "markdown"
      ? "text/markdown"
      : format === "html"
        ? "text/html"
        : format === "txt"
          ? "text/plain"
          : "application/json";
  const body =
    format === "markdown"
      ? exportMarkdown(payload)
      : format === "html"
        ? exportHtml(payload)
        : format === "txt"
          ? exportPlainText(payload)
          : exportTwyneBackup(payload);
  return new Blob([body], { type: `${mime};charset=utf-8` });
}

/** Renders a room analysis (synthesis + per-editor memos) as a standalone Markdown document. */
export function exportRoomAnalysisMarkdown(analysis: RoomAnalysis): string {
  const parts: string[] = [];
  const title = analysis.briefTitle || "Untitled";
  parts.push(`# The Full Analysis — ${title}`);
  parts.push("");
  parts.push(`*Filed ${new Date(analysis.timestamp).toLocaleString()}*`);
  parts.push("");

  if (analysis.synthesis) {
    parts.push("## The Room's Verdict");
    parts.push("");
    parts.push(analysis.synthesis.trim());
    parts.push("");
  }

  for (const memo of analysis.memos) {
    parts.push(`## ${memo.personaName}`);
    parts.push("");
    parts.push(memo.text.trim());
    parts.push("");
  }

  return parts.join("\n");
}

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function safeFilename(title: string, ext: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "untitled";
  return `${base}.${ext}`;
}

/* ── Import ────────────────────────────────────────────────────── */

export interface ImportResult {
  title: string;
  html: string;
  brief?: ProjectBrief | null;
  folios?: Folio[];
}

export function detectFormatFromFilename(filename: string): ExportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".twyne.json") || lower.endsWith(".json")) {
    return "twyne-backup";
  }
  return "markdown";
}

const HTML_IMPORT_NON_CONTENT_TAGS = [
  "script",
  "style",
  "noscript",
  "template",
  "link",
  "meta",
  "base",
  "iframe",
  "object",
  "embed",
] as const;

/**
 * Let the browser repair an HTML document instead of trying to recognize its
 * envelope with a regular expression. A missing `</body>` used to make the
 * importer return the entire standalone file, including its print stylesheet,
 * as manuscript content.
 *
 * Adding only missing envelope closers before parsing also keeps this helper
 * deterministic under stricter DOMParser implementations used by tests. The
 * browser parser remains responsible for the actual HTML tree construction.
 */
function normalizeHtmlEnvelope(html: string): string {
  let normalized = html;
  if (/<body(?:\s|>)/i.test(normalized) && !/<\/body\s*>/i.test(normalized)) {
    const htmlClose = normalized.search(/<\/html\s*>/i);
    normalized =
      htmlClose === -1
        ? `${normalized}</body>`
        : `${normalized.slice(0, htmlClose)}</body>${normalized.slice(htmlClose)}`;
  }
  if (/<html(?:\s|>)/i.test(normalized) && !/<\/html\s*>/i.test(normalized)) {
    normalized += "</html>";
  }
  return normalized;
}

function hasClass(element: Element, className: string): boolean {
  return (element.getAttribute("class") ?? "").split(/\s+/).includes(className);
}

function directChildByTag(element: Element, tagName: string): Element | null {
  const wanted = tagName.toLowerCase();
  for (const child of Array.from(element.childNodes)) {
    if (
      child.nodeType === 1 &&
      (child as Element).tagName.toLowerCase() === wanted
    ) {
      return child as Element;
    }
  }
  return null;
}

function removeHtmlImportNonContent(root: Element): void {
  for (const tag of HTML_IMPORT_NON_CONTENT_TAGS) {
    for (const node of Array.from(root.getElementsByTagName(tag))) {
      node.parentNode?.removeChild(node);
    }
  }
}

function serializeChildren(element: Element): string {
  if (typeof (element as HTMLElement).innerHTML === "string") {
    return (element as HTMLElement).innerHTML;
  }

  // XMLSerializer is available alongside DOMParser in browsers. The fallback
  // keeps alternate DOM implementations usable without changing production
  // behavior.
  const serializer =
    typeof XMLSerializer === "undefined" ? null : new XMLSerializer();
  return Array.from(element.childNodes)
    .map((child) =>
      serializer
        ? serializer.serializeToString(child)
        : ((child as Node & { outerHTML?: string }).outerHTML ??
          child.textContent ??
          ""),
    )
    .join("");
}

function parseHtmlImport(text: string, filename: string): ImportResult {
  if (typeof DOMParser === "undefined") {
    throw new Error("HTML import requires a browser document parser.");
  }

  const document = new DOMParser().parseFromString(
    normalizeHtmlEnvelope(text),
    "text/html",
  );
  const titleElement = document.getElementsByTagName("title")[0];
  const firstHeading = document.getElementsByTagName("h1")[0];
  const filenameTitle = filename.replace(/\.html?$/i, "").trim();
  const title =
    titleElement?.textContent?.trim() ||
    firstHeading?.textContent?.trim() ||
    filenameTitle ||
    "Imported piece";

  const allElements = Array.from(document.getElementsByTagName("*"));
  const exportDocument = allElements.find((element) =>
    hasClass(element, "export-document"),
  );
  const twyneArticle = exportDocument
    ? directChildByTag(exportDocument, "article")
    : null;
  const body =
    document.body ?? document.getElementsByTagName("body")[0] ?? null;
  const source = twyneArticle ?? body;

  if (!source) {
    return { title, html: "" };
  }

  const content = source.cloneNode(true) as Element;
  removeHtmlImportNonContent(content);
  return { title, html: serializeChildren(content).trim() };
}

export async function importAs(file: File): Promise<ImportResult> {
  const format = detectFormatFromFilename(file.name);

  if (format === "docx") {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.convertToHtml({
      arrayBuffer: await file.arrayBuffer(),
    });
    const html = result.value;
    const title =
      html
        .match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1]
        ?.replace(/<[^>]+>/g, "")
        .trim() ||
      file.name.replace(/\.docx$/i, "") ||
      "Imported piece";
    return { title, html };
  }

  const text = await file.text();

  if (format === "twyne-backup") {
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `That file doesn't look like a Twyne backup (JSON parse failed: ${(err as Error).message}).`,
      );
    }
    if (!parsed || typeof parsed !== "object" || !parsed.content?.html) {
      throw new Error(
        "That JSON file isn't a Twyne backup. Expected { content: { html }, title, brief }.",
      );
    }
    return {
      title: parsed.title ?? "Imported piece",
      html: parsed.content.html,
      brief: parsed.brief ?? null,
      folios: parsed.folios ?? undefined,
    };
  }

  if (format === "html") {
    return parseHtmlImport(text, file.name);
  }

  if (format === "txt") {
    const escaped = escapeHtml(text);
    const html = escaped
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, "<br />")}</p>`)
      .join("\n");
    const title = firstLine(text) || "Imported piece";
    return { title, html };
  }

  // markdown
  marked.setOptions({ async: false, breaks: true, gfm: true });
  const html = marked.parse(text) as string;
  const title = firstLine(text) || "Imported piece";
  return { title, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstLine(text: string): string | null {
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  const first = text.split(/\n/).find((l) => l.trim());
  return first ? first.trim() : null;
}
