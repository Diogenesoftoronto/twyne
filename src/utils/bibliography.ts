/**
 * The writer's working bibliography — a flat list of sources saved from
 * the Apparatus panel or discovered by the research provider. Persisted
 * at `/bibliography.json` inside the Lix blob (per folio) so it travels
 * with the manuscript and syncs through the existing Convex pipeline.
 */

import { readFileAsJson, writeFileAsJson } from "./lix";

const BIB_PATH = "/bibliography.json";

export type CitationStyle = "mla" | "apa" | "chicago";

export type BibProvenance = "writer" | "background";

export interface BibEntry {
  id: string;
  folioId: string;
  title: string;
  author?: string;
  publisher?: string;
  date?: string;
  /** Year shortcut for citation builders — mirrors the year inside `date`. */
  year?: string;
  /** DOI if the provider surfaced one. */
  doi?: string;
  url: string;
  accessedAt: number;
  /** Writer's working note — never formatted into the citation. */
  note?: string;
  /** Stable, writer-set key for in-text references (e.g. "smith2024"). */
  citationKey?: string;
  style?: CitationStyle;
  /** The display snippet, if the provider returned one. */
  snippet?: string;
  /** Why this source is relevant to the draft. */
  why?: string;
  /** Optional page hint for MLA in-text citations. */
  pageHint?: string;
  /** Who found this — the writer, or a background agent watching the draft. */
  provenance?: BibProvenance;
  /** The query a background agent was working from (when provenance = "background"). */
  backgroundQuery?: string;
  /** Whether the writer has explicitly accepted a background-saved entry. */
  accepted?: boolean;
  /** Free-form creation timestamp (used by AI-generated entries). */
  createdAt?: number;
}

export async function loadBibliography(): Promise<BibEntry[]> {
  if (typeof window === "undefined") return [];
  try {
    const data = await readFileAsJson<BibEntry[]>(BIB_PATH);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function saveBibliography(bib: BibEntry[]): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await writeFileAsJson(BIB_PATH, bib);
  } catch {
    // lix unavailable
  }
}

export async function upsertBibEntry(entry: BibEntry): Promise<BibEntry[]> {
  const all = await loadBibliography();
  const idx = all.findIndex((e) => e.id === entry.id);
  if (idx >= 0) all[idx] = entry;
  else all.push(entry);
  await saveBibliography(all);
  return all;
}

export async function deleteBibEntry(id: string): Promise<BibEntry[]> {
  const all = await loadBibliography();
  const next = all.filter((e) => e.id !== id);
  await saveBibliography(next);
  return next;
}

/* ── Citation formatters (MLA / APA / Chicago) ────────────────── */

function mlaEscape(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

export function formatMla(e: BibEntry): string {
  const parts: string[] = [];
  const author = mlaEscape(e.author);
  if (author) parts.push(`${author}.`);
  parts.push(`"${mlaEscape(e.title)}."`);
  if (e.publisher) parts.push(`${mlaEscape(e.publisher)},`);
  if (e.date) parts.push(`${mlaEscape(e.date)},`);
  parts.push(formatUrlAccessed(e.url, e.accessedAt) + ".");
  return parts.join(" ");
}

export function formatApa(e: BibEntry): string {
  const parts: string[] = [];
  const author = mlaEscape(e.author);
  if (author) parts.push(`${author} (${e.date ?? "n.d."}).`);
  else if (e.date) parts.push(`(${e.date}).`);
  parts.push(`${mlaEscape(e.title)}.`);
  if (e.publisher) parts.push(`${mlaEscape(e.publisher)}.`);
  parts.push("Retrieved from " + e.url);
  return parts.join(" ");
}

export function formatChicago(e: BibEntry): string {
  const parts: string[] = [];
  const author = mlaEscape(e.author);
  if (author) parts.push(`${author}.`);
  parts.push(`"${mlaEscape(e.title)}."`);
  if (e.publisher) parts.push(`${mlaEscape(e.publisher)}.`);
  if (e.date) parts.push(`${mlaEscape(e.date)}.`);
  parts.push(e.url + ".");
  parts.push(`Accessed ${new Date(e.accessedAt).toLocaleDateString()}.`);
  return parts.join(" ");
}

export function formatCitation(e: BibEntry, style: CitationStyle): string {
  switch (style) {
    case "mla":
      return formatMla(e);
    case "apa":
      return formatApa(e);
    case "chicago":
      return formatChicago(e);
  }
}

function formatUrlAccessed(url: string, ts: number): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")} · accessed ${new Date(ts).toLocaleDateString()}`;
  } catch {
    return `${url} · accessed ${new Date(ts).toLocaleDateString()}`;
  }
}

/* ── A one-liner the writer can drop in a footnote ───────────── */

export function footnoteCite(e: BibEntry, style: CitationStyle): string {
  const author = mlaEscape(e.author) || "Anonymous";
  const year = e.date?.match(/\d{4}/)?.[0] ?? "n.d.";
  switch (style) {
    case "apa":
    case "chicago":
      return `(${author.split(",")[0]}, ${year})`;
    case "mla":
      return `(${author.split(",")[0]} ${e.pageHint ?? ""})`.trim();
  }
}

/* ── Dedup helpers ──────────────────────────────────────────────── */


/** Normalize a URL for dedupe — strips trailing slashes, lowercases host. */
export function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.host.toLowerCase().replace(/^www\./, "")}${x.pathname}`.replace(
      /\/+$/,
      "",
    );
  } catch {
    return u.replace(/\/+$/, "").toLowerCase();
  }
}

export async function findBibByUrl(url: string): Promise<BibEntry | undefined> {
  const target = normalizeUrl(url);
  const all = await loadBibliography();
  return all.find((e) => normalizeUrl(e.url) === target);
}

export async function mergeBibEntry(entry: BibEntry): Promise<BibEntry[]> {
  const existing = await findBibByUrl(entry.url);
  if (existing) {
    return upsertBibEntry({ ...existing, ...entry, id: existing.id });
  }
  return upsertBibEntry(entry);
}
