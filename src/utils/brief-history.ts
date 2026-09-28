import type { ProjectBrief } from "../types";
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";

export interface BriefEdition {
  id: string;
  savedAt: number;
  brief: ProjectBrief;
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
): Promise<void> {
  if (!folioId) return;
  const editions = await loadBriefEditions(folioId);
  const latest = editions[0];
  if (latest && JSON.stringify(latest.brief) === JSON.stringify(brief)) {
    return;
  }
  const edition: BriefEdition = {
    id: `${brief.updatedAt}-${crypto.randomUUID()}`,
    savedAt: brief.updatedAt || Date.now(),
    brief,
  };
  await saveMetaToIdb(
    editionsKey(folioId),
    [edition, ...editions].slice(0, MAX_BRIEF_EDITIONS),
  );
}
