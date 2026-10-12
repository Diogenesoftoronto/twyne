/** Source-derived UI fixture only. No provider, account, network, discovery or
 * persistent browser state. Scans, formatting and builders execute original TS.
 */
import { mock } from "bun:test";
import type { BibEntry, CitationStyle } from "../../../../src/utils/bibliography";
mock.module("../../../../src/utils/lix", () => ({
  readFileAsJson: async () => [], writeFileAsJson: async () => {},
}));
const { formatCitation, footnoteCite, normalizeUrl, buildBibEntryFromFormattedCitation } =
  await import("../../../../src/utils/bibliography");
const { detectCitations } = await import("../../../../src/utils/citations");
const { targetKindLabel } = await import("../../../../src/utils/research-targets");

const record = await Bun.file(`${import.meta.dir}/../apparatus/retained-native.json`).json();
const scope = "original/path/folio:café";
const text = "A retained example cites https://example.org/new-paper/ and DOI 10.1000/182. Another source is (Doe, 2024).";
const detected = detectCitations(text);
const styles: CitationStyle[] = ["mla", "apa", "chicago"];
const formatted: Record<string, unknown[]> = {};
const copyAll: Record<string, string> = {};
for (const style of styles) {
  formatted[style] = record.bibliography.flatMap((entry: BibEntry, index: number) => {
    if (!entry || typeof entry.folioId !== "string" || typeof entry.title !== "string" || typeof entry.url !== "string") return [];
    return [{ index, id: entry.id, folioId: entry.folioId, citation: formatCitation(entry, style),
      footnote: footnoteCite(entry, style), normalizedUrl: normalizeUrl(entry.url) }];
  });
  copyAll[style] = record.bibliography.filter((row: BibEntry) => row?.folioId === scope && typeof row.title === "string")
    .map((entry: BibEntry) => formatCitation(entry, style)).join("\n\n");
}
const built = detected.map(citation => ({ detectedId: citation.id,
  entry: buildBibEntryFromFormattedCitation(citation, { title: citation.text, url: citation.lookupUrl }, scope, 1770000000000),
}));
const panel = await Bun.file(`${import.meta.dir}/../../../../src/components/citations/citations-panel.tsx`).text();
// Verify the literal retained Source event rule before executing its expression.
const appendRule = panel.match(/const existingIds = new Set\(store\.citations\.map\(\(c\) => c\.id\)\);\s*const newCitations = detail\.filter\(\(c\) => !existingIds\.has\(c\.id\)\);/);
if (!appendRule) throw new Error("Source accumulation changed; inspect its current event contract.");
const incoming = [detected[0], detected[1], detected[1]];
const sourceAppend = new Function("store", "detail", `${appendRule[0]} return newCitations;`);
const appended = [detected[0], ...sourceAppend({citations: [detected[0]]}, incoming)];
await Bun.write(`${import.meta.dir}/source-presentation.json`, JSON.stringify({
  provenance: "Executed original TS detectCitations/formatCitation/footnoteCite/buildBibEntryFromFormattedCitation/targetKindLabel with isolated fixture data; no provider or browser.",
  sourceSha256: new Bun.CryptoHasher("sha256").update(panel).digest("hex"),
  scope, text, detected, formatted, copyAll, built,
  boardAppend: { existing: [detected[0]], incoming, expectedIds: appended.map(c => c.id), originalSource: appendRule[0] },
  targetLabels: ["quote", "work", "person", "statistic", "claim", "event", "future-kind"].map(kind => ({kind, label: targetKindLabel(kind)})),
}, null, 2) + "\n");
await Bun.write(`${import.meta.dir}/visual-native.json`, JSON.stringify({
  ...record,
  bibliography: record.bibliography.slice(0, 3),
  settings: { ...record.settings, flagMissingSources: false, autoInsertFootnotes: false },
  fixturePurpose: "Synthetic source-rendering fixture, not discovered sources. Two owned valid rows and one retained foreign row; malformed import recovery is tested separately.",
}, null, 2) + "\n");
console.log(`Wrote ${detected.length} original detections and all three original citation styles.`);
