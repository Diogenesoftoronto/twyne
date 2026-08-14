import type {
  PersonaFeedback,
  PersonaReply,
  RoomAnalysis,
  RubricCriterionSpec,
  RubricHistoryEntry,
  RubricResult,
  Suggestion,
} from "../types";
import type { BibEntry } from "./bibliography";
import {
  loadMetaFromIdb,
  loadRoomAnalysisFromIdb,
  loadRubricResultFromIdb,
  saveMetaToIdb,
  saveRoomAnalysisToIdb,
  saveRubricResultToIdb,
} from "./idb";
import { readFileAsJson, writeFileAsJson } from "./lix";

const MIGRATION_KEY = "folio-editorial-artifacts-migrated";

export function canClaimLegacyEditorialArtifacts(
  folioIds: readonly string[],
  activeFolioId: string,
): boolean {
  return folioIds.length === 1 && folioIds[0] === activeFolioId;
}

function scopedPath(folioId: string, filename: string): string {
  return `/folios/${folioId}/${filename}`;
}

async function moveLegacyArray<T extends { folioId?: string }>(
  folioId: string,
  legacyPath: string,
  filename: string,
): Promise<void> {
  const targetPath = scopedPath(folioId, filename);
  const existing = await readFileAsJson<T[]>(targetPath);
  if (Array.isArray(existing) && existing.length > 0) return;
  const legacy = await readFileAsJson<T[]>(legacyPath);
  if (!Array.isArray(legacy) || legacy.length === 0) return;
  await writeFileAsJson(
    targetPath,
    legacy.map((entry) => ({ ...entry, folioId })),
  );
  await writeFileAsJson(legacyPath, []);
}

/**
 * Attach pre-folio editorial artifacts to exactly one existing folio.
 *
 * This runs once, before a writer creates or switches to another folio. It
 * intentionally moves rather than copies the old singleton records so a new
 * folio can never inherit the previous room by falling back to legacy paths.
 */
export async function migrateLegacyEditorialArtifacts(
  folioId: string,
  claimLegacy: boolean,
): Promise<void> {
  // With multiple possible owners, preserve old unscoped data without showing
  // it in any folio. A later recovery can ask where it belongs.
  if (!folioId || !claimLegacy) return;
  const migrated = await loadMetaFromIdb<string>(MIGRATION_KEY);
  if (migrated) return;

  await Promise.all([
    moveLegacyArray<PersonaFeedback>(
      folioId,
      "/persona-notes.json",
      "persona-notes.json",
    ),
    moveLegacyArray<PersonaReply>(
      folioId,
      "/persona-replies.json",
      "persona-replies.json",
    ),
    moveLegacyArray<Suggestion>(
      folioId,
      "/suggestions.json",
      "suggestions.json",
    ),
  ]);

  const [
    legacyRubric,
    legacyLixRubric,
    legacyAnalysis,
    criteria,
    history,
  ] = await Promise.all([
    loadRubricResultFromIdb(),
    readFileAsJson<RubricResult>("/rubric-result.json"),
    loadRoomAnalysisFromIdb(),
    loadMetaFromIdb<RubricCriterionSpec[]>("rubric-criteria"),
    loadMetaFromIdb<RubricHistoryEntry[]>("rubric-history"),
  ]);
  const rubric = legacyRubric ?? legacyLixRubric;
  if (rubric) {
    await saveRubricResultToIdb(
      { ...rubric, folioId } as RubricResult,
      folioId,
    );
    await writeFileAsJson(scopedPath(folioId, "rubric-result.json"), {
      ...rubric,
      folioId,
    });
    if (legacyLixRubric) {
      await writeFileAsJson("/rubric-result.json", null);
    }
  }
  if (legacyAnalysis) {
    await saveRoomAnalysisToIdb(
      { ...legacyAnalysis, folioId } as RoomAnalysis,
      folioId,
    );
  }
  if (Array.isArray(criteria) && criteria.length > 0) {
    await saveMetaToIdb(`rubric-criteria:${folioId}`, criteria);
  }
  if (Array.isArray(history) && history.length > 0) {
    await saveMetaToIdb(
      `rubric-history:${folioId}`,
      history.map((entry) => ({ ...entry, folioId })),
    );
  }

  const comments =
    (await readFileAsJson<Array<{ folioId?: string }>>(
      "/user-comments.json",
    )) ?? [];
  if (comments.length > 0) {
    await writeFileAsJson(
      "/user-comments.json",
      comments.map((comment) =>
        comment.folioId ? comment : { ...comment, folioId },
      ),
    );
  }

  const bibliography =
    (await readFileAsJson<BibEntry[]>("/bibliography.json")) ?? [];
  if (bibliography.length > 0) {
    await writeFileAsJson(
      "/bibliography.json",
      bibliography.map((entry) =>
        entry.folioId ? entry : { ...entry, folioId },
      ),
    );
  }

  await saveMetaToIdb(MIGRATION_KEY, folioId);
}
