// Generated from src/utils/bibliography.ts by build-helper.ts.
import type { BibEntry, CitationStyle, FormattedCitationFields } from "../../../src/utils/bibliography";
import type { DetectedCitation } from "../../../src/types";
export function bibliographyForFolio(
  bibliography: readonly BibEntry[],
  folioId: string | null | undefined,
): BibEntry[] {
  if (!folioId) return [];
  return bibliography.filter((entry) => entry.folioId === folioId);
}

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
    (entry) => entry.folioId === folioId && normalizeUrl(entry.url) === target,
  );
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
