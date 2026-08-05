import { basename, extname } from "node:path";
import { marked } from "marked";
import type { TwyneClient } from "./client.js";
import type { CitationEntry, Folio, FolioBundle, FolioType } from "./types.js";

export const TWYNE_ARCHIVE_FORMAT = "twyne-archive" as const;
export const TWYNE_ARCHIVE_VERSION = 2 as const;

export interface TwyneArchiveV2 {
  format: typeof TWYNE_ARCHIVE_FORMAT;
  version: typeof TWYNE_ARCHIVE_VERSION;
  exportedAt: string;
  folios: FolioBundle[];
}

export interface ImportSource {
  name: string;
  content: string;
  type?: FolioType;
}

export interface ParsedImport {
  folios: FolioBundle[];
  sourceFormat: "archive" | "markdown" | "html" | "txt";
}

export type SingleExportFormat = "markdown" | "html" | "txt";
export type ExportFormat = "archive" | SingleExportFormat;

export interface ExportArtifact {
  format: ExportFormat;
  mimeType: string;
  suggestedFilename: string;
  content: string;
}

export interface ImportSummary {
  imported: Folio[];
  citationsSaved: number;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireFolio(value: unknown, index: number): Folio {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) {
    throw new Error(`Archive folio ${index + 1} must contain a non-empty folio.name`);
  }
  if (value.id !== undefined && typeof value.id !== "string") {
    throw new Error(`Archive folio ${index + 1} has an invalid folio.id`);
  }
  return value as Folio;
}

export function createArchive(folios: FolioBundle[], now = new Date()): TwyneArchiveV2 {
  return {
    format: TWYNE_ARCHIVE_FORMAT,
    version: TWYNE_ARCHIVE_VERSION,
    exportedAt: now.toISOString(),
    folios,
  };
}

export function parseArchive(input: string | unknown): TwyneArchiveV2 {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      throw new Error(
        `Twyne archive is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!isRecord(parsed)) throw new Error("Twyne archive must be a JSON object");
  if (parsed.format !== TWYNE_ARCHIVE_FORMAT || parsed.version !== TWYNE_ARCHIVE_VERSION) {
    throw new Error(
      `Expected a ${TWYNE_ARCHIVE_FORMAT} version ${TWYNE_ARCHIVE_VERSION} bundle`,
    );
  }
  if (!Array.isArray(parsed.folios)) throw new Error("Twyne archive folios must be an array");
  const folios = parsed.folios.map((entry, index): FolioBundle => {
    if (!isRecord(entry)) throw new Error(`Archive folio ${index + 1} must be an object`);
    const folio = requireFolio(entry.folio, index);
    if (entry.html !== undefined && typeof entry.html !== "string") {
      throw new Error(`Archive folio ${index + 1} has invalid html`);
    }
    if (entry.citations !== undefined && !Array.isArray(entry.citations)) {
      throw new Error(`Archive folio ${index + 1} has invalid citations`);
    }
    return { ...entry, folio } as FolioBundle;
  });
  return {
    format: TWYNE_ARCHIVE_FORMAT,
    version: TWYNE_ARCHIVE_VERSION,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date(0).toISOString(),
    folios,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'");
}

export function stripHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|h[1-6]|li|blockquote|tr|div)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

export function htmlToMarkdown(html: string): string {
  return decodeHtml(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, body) =>
        `${"#".repeat(Number(level))} ${stripHtml(body)}\n\n`,
      )
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, body) =>
        `[${stripHtml(body)}](${href})`,
      )
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, body) => `- ${stripHtml(body)}\n`)
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|blockquote|pre|div)>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function inferredTitle(name: string, content: string, format: "markdown" | "html" | "txt"): string {
  if (format === "html") {
    const title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (title?.trim()) return decodeHtml(title.trim());
    const heading = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    if (heading?.trim()) return stripHtml(heading);
  }
  if (format === "markdown") {
    const heading = content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading;
  }
  const stem = basename(name, extname(name)).replace(/[-_]+/g, " ").trim();
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
  return stem || firstLine || "Imported piece";
}

export function detectSourceFormat(name: string): ParsedImport["sourceFormat"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".twyne.json") || lower.endsWith(".json")) return "archive";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  throw new Error(`Unsupported import file: ${name}`);
}

export function parseImportSource(source: ImportSource): ParsedImport {
  const sourceFormat = detectSourceFormat(source.name);
  if (sourceFormat === "archive") {
    return { sourceFormat, folios: parseArchive(source.content).folios };
  }
  const title = inferredTitle(source.name, source.content, sourceFormat);
  let html: string;
  if (sourceFormat === "markdown") {
    html = marked.parse(source.content, { async: false, breaks: true, gfm: true }) as string;
  } else if (sourceFormat === "html") {
    html = source.content.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? source.content;
  } else {
    html = source.content
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, "<br />")}</p>`)
      .join("\n");
  }
  return {
    sourceFormat,
    folios: [{ folio: { name: title, type: source.type ?? "draft" }, html }],
  };
}

export async function importSources(client: TwyneClient, sources: ImportSource[]): Promise<ImportSummary> {
  const imported: Folio[] = [];
  const warnings: string[] = [];
  let citationsSaved = 0;
  for (const source of sources) {
    const parsed = parseImportSource(source);
    for (const bundle of parsed.folios) {
      const folio = await client.putFolio({
        folio: bundle.folio,
        ...(bundle.html !== undefined ? { html: bundle.html } : {}),
        ...(bundle.brief !== undefined ? { brief: bundle.brief } : {}),
      });
      imported.push(folio);
      if (bundle.citations?.length && folio.id) {
        const result = await client.putCitations(folio.id, bundle.citations as CitationEntry[]);
        citationsSaved += result.saved;
      }
      const skipped = ["feedback", "rubric", "suggestions"].filter(
        (field) => bundle[field] !== undefined && bundle[field] !== null,
      );
      if (skipped.length) {
        warnings.push(
          `${folio.name}: ${skipped.join(", ")} are read-only integration data and were not imported`,
        );
      }
    }
  }
  return { imported, citationsSaved, warnings };
}

export async function fetchFolioBundles(client: TwyneClient, ids?: string[]): Promise<FolioBundle[]> {
  const folioIds = ids?.length
    ? ids
    : (await client.listFolios()).flatMap((folio) => (folio.id ? [folio.id] : []));
  const bundles: FolioBundle[] = [];
  for (const id of folioIds) {
    const bundle = await client.getFolio(id);
    if (!bundle) throw new Error(`Folio not found: ${id}`);
    bundles.push(bundle);
  }
  return bundles;
}

export function safeFilename(name: string, extension: string): string {
  const stem =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "untitled";
  return `${stem}.${extension}`;
}

function standaloneHtml(bundle: FolioBundle): string {
  const title = bundle.folio.name;
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n<article>\n${bundle.html ?? ""}\n</article>\n</body>\n</html>\n`;
}

export function exportBundles(bundles: FolioBundle[], format: ExportFormat): ExportArtifact {
  if (format === "archive") {
    return {
      format,
      mimeType: "application/json",
      suggestedFilename: "twyne-archive-v2.twyne.json",
      content: `${JSON.stringify(createArchive(bundles), null, 2)}\n`,
    };
  }
  if (bundles.length !== 1) {
    throw new Error(`${format} export requires exactly one folio; use archive for bulk export`);
  }
  const bundle = bundles[0];
  if (!bundle) throw new Error("No folio was selected for export");
  if (format === "html") {
    return {
      format,
      mimeType: "text/html",
      suggestedFilename: safeFilename(bundle.folio.name, "html"),
      content: standaloneHtml(bundle),
    };
  }
  if (format === "txt") {
    return {
      format,
      mimeType: "text/plain",
      suggestedFilename: safeFilename(bundle.folio.name, "txt"),
      content: `${stripHtml(bundle.html ?? "")}\n`,
    };
  }
  return {
    format,
    mimeType: "text/markdown",
    suggestedFilename: safeFilename(bundle.folio.name, "md"),
    content: `${htmlToMarkdown(bundle.html ?? "")}\n`,
  };
}
