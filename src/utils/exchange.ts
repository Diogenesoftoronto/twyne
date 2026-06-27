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
import type { Folio, LayoutSettings, ProjectBrief } from "../types";
import { DEFAULT_LAYOUT, resolveMargins } from "../types";

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
}

export function exportMarkdown(p: ExportPayload): string {
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
  parts.push(htmlToMarkdown(p.html));
  parts.push("");
  return parts.join("\n");
}

export function exportHtml(p: ExportPayload): string {
  return wrapStandaloneHtml(p.title, p.html, {
    layout: p.layout,
    header: p.header,
    footer: p.footer,
    brief: p.brief ?? null,
  });
}

export function exportPlainText(p: ExportPayload): string {
  return stripHtml(p.html);
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
