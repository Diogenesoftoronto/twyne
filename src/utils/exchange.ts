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
import { DEFAULT_LAYOUT, resolveMargins } from "../types";
import {
  formatCitation,
  type BibEntry,
  type CitationStyle,
} from "./bibliography";

export type ExportFormat = "markdown" | "html" | "txt" | "twyne-backup";

/* ── HTML helpers ──────────────────────────────────────────────── */

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
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
    .trim();
}

export function htmlToMarkdown(html: string): string {
  // marked can render HTML too; we just need a stable conversion. We
  // use a two-step dance: strip to text first, then run a small set of
  // regex passes that pick out the headings, blockquotes, and lists.
  const text = stripHtml(html);
  const lines = text.split(/\n/);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) {
        inList = false;
      }
      out.push("");
      continue;
    }
    // Headings — matched on the cleaned text by length and case.
    if (/^#{1,6}\s+/.test(line)) {
      out.push(line);
      continue;
    }
    // List items the editor might have written as a paragraph starting
    // with "•" or "-".
    if (/^[-•*]\s+/.test(line)) {
      inList = true;
      out.push(line.replace(/^[-•*]\s+/, "- "));
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      inList = true;
      out.push(line);
      continue;
    }
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
  const docWidth = widthMap[layout.width];
  const docPadX = `${m.x}rem`;
  const docPageMargin = `${m.top}rem ${m.x}rem ${m.bottom}rem`;

  const running = layout.runningHeader
    ? (options.header && options.header.trim()) ||
      (options.brief
        ? `${options.brief.answers.workingTitle || "Untitled"} · ${new Date().toLocaleDateString()}`
        : title)
    : options.header || "";

  const footer = options.footer || (layout.pageNumbers ? "page" : "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  @page { size: auto; margin: ${docPageMargin}; ${layout.pageNumbers ? "@bottom-center { content: counter(page); font-family: ui-monospace, monospace; font-size: 0.75rem; color: #6a5d4a; }" : ""} }
  body {
    font-family: ui-serif, Georgia, "Times New Roman", serif;
    max-width: ${docWidth};
    margin: ${m.top}rem auto ${m.bottom}rem;
    padding: 0 ${docPadX};
    line-height: 1.7;
    color: #1a1611;
    background: #fbf6ec;
  }
  .twyne-chrome {
    display: flex; justify-content: space-between; align-items: baseline;
    font-family: ui-monospace, "SF Mono", monospace;
    font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase;
    color: #6a5d4a; padding: 0.5rem 0; border-bottom: 1px solid #c7b89c;
    margin-bottom: 2rem;
  }
  .twyne-chrome.f { border-top: 1px solid #c7b89c; border-bottom: none; margin: 2rem 0 0; }
  h1, h2, h3 { font-family: ui-serif, Georgia, serif; font-weight: 600; }
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
  footer { margin-top: 3rem; font-size: 0.85rem; color: #6a5d4a; }
  a { color: #8b2f24; }
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
${running ? `<div class="twyne-chrome"><span>${escapeHtml(running)}</span></div>` : ""}
<article>
${body}
</article>
<div class="twyne-chrome f"><span>${escapeHtml(footer)}</span></div>
<footer>
  <p>Set in editorial vermilion · Twyne</p>
</footer>
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
  return html
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
  return stripHtml(stripEditorMarks(p.html));
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

export function exportAs(format: ExportFormat, payload: ExportPayload): Blob {
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
  if (lower.endsWith(".twyne.json") || lower.endsWith(".json")) {
    return "twyne-backup";
  }
  return "markdown";
}

export async function importAs(file: File): Promise<ImportResult> {
  const text = await file.text();
  const format = detectFormatFromFilename(file.name);

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
    // Tiptap's schema expects well-formed HTML. We trust the user here;
    // a more paranoid parser would sanitize, but the editor will
    // gracefully drop unknown nodes.
    const titleMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || "Imported piece";
    // Strip the surrounding <html>/<head> envelope if present so the
    // body lands inside the editor.
    const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const html = bodyMatch ? bodyMatch[1] : text;
    return { title, html };
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
