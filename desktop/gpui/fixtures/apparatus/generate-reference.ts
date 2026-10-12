/** Execute the original bibliography functions against an isolated in-memory
 * Lix adapter. No browser, persisted manuscript, formatter/provider or research
 * call is used. Entries are synthetic retained DTO fixtures, not discoveries.
 */
import { mock } from "bun:test";
import type { BibEntry } from "../../../../src/utils/bibliography";
import type { DetectedCitation } from "../../../../src/types";

let saved: unknown[] = [];
const portable = <T>(value: T): T => JSON.parse(JSON.stringify(value));
mock.module("../../../../src/utils/lix", () => ({
  readFileAsJson: async () => structuredClone(saved),
  writeFileAsJson: async (_path: string, value: unknown[]) => {
    saved = portable(value);
  },
}));
Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
const {
  bibliographyForFolio, buildBibEntryFromFormattedCitation,
  findBibliographyEntryByUrl, mergeBibEntry, upsertBibEntry, deleteBibEntry,
  normalizeUrl,
} = await import("../../../../src/utils/bibliography");

const scope = "original/path/folio:café";
const foreign = "unmounted/foreign";
const now = 1770000000000;
const writer = {
  id: "source-existing", folioId: scope, title: "Retained source title",
  author: "An older attribution", publisher: "A retained publisher", date: "2022", year: "2022",
  doi: "10.1000/retained", url: "https://EXAMPLE.org/report/?old=1#retained", accessedAt: now - 10,
  note: null, citationKey: "writer-key", style: "chicago", formattedCitation: "Cached original fixture citation.",
  snippet: "Retained snippet", why: "Retained relevance", pageHint: "27", provenance: "writer",
  accepted: null, target: null, createdAt: now - 20, citationInsertedAt: now - 5,
  futureSource: { retained: [null, true, "opaque"] },
};
const background = {
  id: "background-retained", folioId: scope, title: "Retained background source",
  url: "https://example.net/claim", accessedAt: now - 12, provenance: "background",
  accepted: false, backgroundQuery: "retained query", date: null,
  target: { kind: "future-kind", anchor: "Verbatim supporting passage.", query: "retained query", reason: null, futureTarget: true },
  futureSource: null,
};
const foreignWriter = { ...writer, folioId: foreign, title: "Foreign source with the same ID and URL", foreignOnly: true };
const unscoped = { ...writer, id: "unscoped", folioId: "", title: "Explicitly unscoped" };
const missingScope = { id: "legacy-missing-scope", title: "Missing owner", url: "https://legacy.invalid", accessedAt: now, legacy: true };
const aliasOnly = { ...missingScope, id: "alias-only", folio_id: scope };
const foreignAlias = { ...foreignWriter, id: "foreign-alias", folio_id: scope };
const malformed = { id: "bad-title", folioId: scope, title: 23, url: "https://bad.invalid", accessedAt: now, rawFuture: null };
const bibliography = [writer, background, foreignWriter, unscoped, missingScope, aliasOnly, foreignAlias, null, "legacy raw row", malformed];
const settings = {
  defaultCitationStyle: "chicago", aiEnhanceCitations: false, flagMissingSources: true,
  autoInsertFootnotes: true, researchProvider: "future-provider", maxResults: 19,
  searchBackend: { id: "custom", apiKey: "fixture-only-not-a-secret", baseUrl: "https://fixture.invalid/search", resultsPath: "data.rows", futureBackend: null },
  mcpServers: [{ id: "fixture-server", label: "Retained fixture", url: "https://fixture.invalid/mcp", transport: "future-transport", enabled: false, futureServer: [null, 5] }],
  tinyfishApiKey: null, futureSettings: { unchanged: true },
};
await Bun.write(`${import.meta.dir}/retained-native.json`, JSON.stringify({
  format: "twyne-gpui-apparatus", version: 1, generation: 0, bibliography, settings,
  futureEnvelope: { kept: [null, 17] },
}, null, 2) + "\n");

function citation(id: string, url: string): DetectedCitation {
  return { id, text: url || "(Fixture, 2024)", from: 12, to: 12 + (url || "(Fixture, 2024)").length,
    type: url ? "url" : "author-year", ...(url ? { lookupUrl: url } : {}) };
}
const url = "http://www.EXAMPLE.org/report/?new=2#new";
const incoming = buildBibEntryFromFormattedCitation(citation("url-12", url), {
  title: "Exact source builder replacement", url, style: "mla", formatted: "Synthetic cached fixture text.",
}, scope, now);
const emptyIncoming = buildBibEntryFromFormattedCitation(citation("empty-12", ""), { title: "No URL fixture" }, scope, now);
const fallbackIncoming = buildBibEntryFromFormattedCitation(citation("fallback", "BOOK/PATH///"), {
  title: "Original fallback normalization", url: "BOOK/PATH///",
}, scope, now);

async function mergeCase(name: string, before: unknown[], entry: BibEntry) {
  saved = portable(before);
  const existing = findBibliographyEntryByUrl(saved as BibEntry[], entry.url, scope);
  const mergeTarget = existing ? { index: saved.indexOf(existing), expectedRawRow: portable(existing) } : null;
  const after = portable(await mergeBibEntry(entry));
  const candidateId = existing?.id ?? entry.id;
  const candidate = after.find(row => row.id === candidateId && row.folioId === scope);
  if (!candidate || JSON.stringify(after) !== JSON.stringify(saved)) throw new Error("Original merge did not persist its full expected array.");
  return { name, before: portable(before), incoming: portable(entry), mergeTarget, candidate, after };
}
const duplicateFirst = { ...writer, id: "duplicate", url: "https://other.invalid/path", title: "First ID match" };
const duplicateUrl = { ...writer, id: "duplicate", title: "Second row is the URL match" };
const cases = [
  await mergeCase("same scoped URL spreads before JSON", [writer, foreignWriter, background], incoming),
  await mergeCase("same foreign URL cannot supply owner", [foreignWriter], incoming),
  await mergeCase("empty URLs never deduplicate", [{ ...writer, id: "empty-existing", url: "" }, { ...foreignWriter, url: "" }], emptyIncoming),
  await mergeCase("lookup row and first ID replacement differ", [duplicateFirst, duplicateUrl, foreignWriter], incoming),
  await mergeCase("original invalid URL fallback remains outside Rust", [{ ...writer, url: "book/path" }], fallbackIncoming),
];

const dropBefore = [writer, { ...writer, title: "Duplicate ID in the same folio" }, foreignWriter, unscoped, missingScope, aliasOnly, foreignAlias, malformed];
saved = portable(dropBefore);
const dropAfter = portable(await deleteBibEntry(writer.id, scope));
saved = portable(dropBefore);
const upsert = { ...writer, title: "Complete upsert is a replacement", futureSource: { changedExplicitly: true } };
const upsertAfter = portable(await upsertBibEntry(upsert as unknown as BibEntry));
const originalText = await Bun.file(`${import.meta.dir}/../../../../src/utils/bibliography.ts`).text();
await Bun.write(`${import.meta.dir}/source-reference.json`, JSON.stringify({
  provenance: "Executed original bibliography.ts functions against isolated in-memory Lix. No provider, formatter, browser or manuscript mutation. Retained entries are synthetic DTO fixtures.",
  sourceSha256: new Bun.CryptoHasher("sha256").update(originalText).digest("hex"),
  scope, foreign, now,
  scopedIds: bibliographyForFolio(bibliography.filter(row => row && typeof row === "object") as BibEntry[], scope).map(row => row.id),
  foreignIds: bibliographyForFolio(bibliography.filter(row => row && typeof row === "object") as BibEntry[], foreign).map(row => row.id),
  noScopeIds: bibliographyForFolio([writer, unscoped] as unknown as BibEntry[], null).map(row => row.id),
  normalizedUrls: [url, writer.url, "https://example.org/report?x=1", "https://example.org/REPORT", "BOOK/PATH///"].map(input => ({ input, value: normalizeUrl(input) })),
  builder: portable(incoming), cases,
  drop: { before: dropBefore, after: dropAfter, id: writer.id },
  upsert: { before: dropBefore, candidate: upsert, after: upsertAfter },
}, null, 2) + "\n");
console.log(`Wrote Apparatus retained fixture and ${cases.length} executed original URL-merge cases.`);
