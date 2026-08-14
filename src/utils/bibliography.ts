/**
 * The writer's working bibliography — a flat list of sources saved from
 * the Apparatus panel or discovered by the research provider. Persisted
 * at `/bibliography.json` inside the Lix blob (per folio) so it travels
 * with the manuscript and syncs through the existing Convex pipeline.
 */

import { readFileAsJson, writeFileAsJson } from "./lix";
import type { DetectedCitation, ResearchTargetRef } from "../types";

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
  /** Provider-formatted citation text for `style`, when AI formatted the entry. */
  formattedCitation?: string;
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
  /** The claim/quote/work this source was found for (auto-research). */
  target?: ResearchTargetRef;
  /** Free-form creation timestamp (used by AI-generated entries). */
  createdAt?: number;
  /** Set after the editor confirms this source was placed as a footnote. */
  citationInsertedAt?: number;
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

/** Return only sources owned by one folio; never guess an owner for legacy data. */
export function bibliographyForFolio(
  bibliography: readonly BibEntry[],
  folioId: string | null | undefined,
): BibEntry[] {
  if (!folioId) return [];
  return bibliography.filter((entry) => entry.folioId === folioId);
}

export async function loadBibliographyForFolio(
  folioId: string | null | undefined,
): Promise<BibEntry[]> {
  return bibliographyForFolio(await loadBibliography(), folioId);
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
  const idx = all.findIndex(
    (e) => e.id === entry.id && e.folioId === entry.folioId,
  );
  if (idx >= 0) all[idx] = entry;
  else all.push(entry);
  await saveBibliography(all);
  return all;
}

export async function deleteBibEntry(
  id: string,
  folioId?: string,
): Promise<BibEntry[]> {
  const all = await loadBibliography();
  const next = all.filter(
    (e) => e.id !== id || (folioId !== undefined && e.folioId !== folioId),
  );
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
  if (hasResolvableUrl(e.url)) {
    parts.push(formatUrlAccessed(e.url, e.accessedAt) + ".");
  }
  return parts.join(" ");
}

export function formatApa(e: BibEntry): string {
  const parts: string[] = [];
  const author = mlaEscape(e.author);
  const date = e.date ?? e.year;
  if (author) parts.push(`${author} (${date ?? "n.d."}).`);
  else if (date) parts.push(`(${date}).`);
  parts.push(`${mlaEscape(e.title)}.`);
  if (e.publisher) parts.push(`${mlaEscape(e.publisher)}.`);
  if (e.url) parts.push("Retrieved from " + e.url);
  return parts.join(" ");
}

export function formatChicago(e: BibEntry): string {
  const parts: string[] = [];
  const author = mlaEscape(e.author);
  if (author) parts.push(`${author}.`);
  parts.push(`"${mlaEscape(e.title)}."`);
  if (e.publisher) parts.push(`${mlaEscape(e.publisher)}.`);
  if (e.date ?? e.year) parts.push(`${mlaEscape(e.date ?? e.year)}.`);
  if (e.url) parts.push(e.url + ".");
  parts.push(`Accessed ${new Date(e.accessedAt).toLocaleDateString()}.`);
  return parts.join(" ");
}

export function formatCitation(e: BibEntry, style: CitationStyle): string {
  if (e.formattedCitation && e.style === style) {
    return e.formattedCitation;
  }
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
  const year = e.year ?? e.date?.match(/\d{4}/)?.[0] ?? "n.d.";
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

export function hasResolvableUrl(url: string | undefined | null): boolean {
  return typeof url === "string" && url.trim().length > 0;
}

export function findBibliographyEntryByUrl(
  bibliography: readonly BibEntry[],
  url: string,
  folioId: string,
): BibEntry | undefined {
  if (!hasResolvableUrl(url)) return undefined;
  const target = normalizeUrl(url);
  return bibliography.find(
    (entry) =>
      entry.folioId === folioId && normalizeUrl(entry.url) === target,
  );
}

export async function findBibByUrl(
  url: string,
  folioId: string,
): Promise<BibEntry | undefined> {
  return findBibliographyEntryByUrl(await loadBibliography(), url, folioId);
}

export async function mergeBibEntry(entry: BibEntry): Promise<BibEntry[]> {
  if (!hasResolvableUrl(entry.url)) {
    return upsertBibEntry(entry);
  }
  const existing = await findBibByUrl(entry.url, entry.folioId);
  if (existing) {
    return upsertBibEntry({ ...existing, ...entry, id: existing.id });
  }
  return upsertBibEntry(entry);
}

export interface FormattedCitationFields {
  title: string;
  author?: string;
  year?: string;
  date?: string;
  url?: string;
  doi?: string;
  publisher?: string;
  formatted?: string;
  style?: CitationStyle;
}

function stableCitationId(folioId: string, citation: DetectedCitation): string {
  return `ai-fmt-${folioId || "global"}-${citation.id}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
}

export function buildBibEntryFromFormattedCitation(
  citation: DetectedCitation,
  result: FormattedCitationFields,
  folioId: string,
  now = Date.now(),
): BibEntry {
  const date = result.date ?? result.year;
  return {
    id: stableCitationId(folioId, citation),
    title: result.title,
    author: result.author,
    year: result.year ?? date?.match(/\d{4}/)?.[0],
    date,
    url: result.url ?? citation.lookupUrl ?? "",
    doi: result.doi,
    publisher: result.publisher,
    folioId,
    provenance: "writer",
    accessedAt: now,
    createdAt: now,
    style: result.style,
    formattedCitation: result.formatted,
  };
}
