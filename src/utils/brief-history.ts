import { DOSSIER_FIELDS, type LedgerSource } from "./house-model";
import { appendLedger } from "./house-store";
import type { ProjectBrief } from "../types";
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";

export interface BriefEdition {
  id: string;
  savedAt: number;
  brief: ProjectBrief;
  source?: LedgerSource;
  reason?: string;
}

const MAX_BRIEF_EDITIONS = 20;

function editionsKey(folioId: string): string {
  return `brief-editions:${folioId}`;
}

export async function loadBriefEditions(
  folioId: string | null | undefined,
): Promise<BriefEdition[]> {
  if (!folioId) return [];
  const editions = await loadMetaFromIdb<BriefEdition[]>(editionsKey(folioId));
  if (!Array.isArray(editions)) return [];
  return editions
    .filter(
      (edition) =>
        edition &&
        typeof edition.id === "string" &&
        typeof edition.savedAt === "number" &&
        edition.brief?.answers,
    )
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_BRIEF_EDITIONS);
}

/** Keep each superseded brief available for inspection, without changing the
 * active brief or the manuscript's separate revision history. */
export async function archiveBriefEdition(
  folioId: string,
  brief: ProjectBrief,
  provenance: { source: LedgerSource; reason?: string } = { source: "refine" },
  nextBrief?: ProjectBrief,
): Promise<void> {
  if (!folioId) return;
  const editions = await loadBriefEditions(folioId);
  const latest = editions[0];
  if (latest && JSON.stringify(latest.brief) === JSON.stringify(brief)) {
    if (nextBrief)
      await recordBriefChanges(folioId, brief, nextBrief, provenance);
    return;
  }
  const edition: BriefEdition = {
    id: `${brief.updatedAt}-${crypto.randomUUID()}`,
    savedAt: brief.updatedAt || Date.now(),
    brief,
    ...provenance,
  };
  await saveMetaToIdb(
    editionsKey(folioId),
    [edition, ...editions].slice(0, MAX_BRIEF_EDITIONS),
  );
  if (nextBrief)
    await recordBriefChanges(folioId, brief, nextBrief, provenance);
}

async function recordBriefChanges(
  folioId: string,
  previous: ProjectBrief,
  next: ProjectBrief,
  provenance: { source: LedgerSource; reason?: string },
): Promise<void> {
  const changes = DOSSIER_FIELDS.filter(
    (field) => previous.answers[field] !== next.answers[field],
  );
  if (!changes.length) return;
  await appendLedger(
    changes.map((field) => ({
      layer: "folio",
      ownerRef: folioId,
      field,
      from: previous.answers[field] ?? "",
      to: next.answers[field] ?? "",
      ...provenance,
    })),
  );
}
