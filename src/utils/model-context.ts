/** Read-only model context. Never save this projection as a folio dossier. */
import type { ProjectBrief } from "../types";
import { loadBriefFromIdb } from "./idb";
import { DEFAULT_INTERVIEW_ANSWERS } from "./anti-tabula-rasa";
import { assembleContextStack, effectiveBrief } from "./house-model";
import { loadHouseState } from "./house-store";

export async function loadModelBriefForFolio(
  folioId: string | null | undefined,
  fallback: ProjectBrief | null = null,
): Promise<ProjectBrief | null> {
  if (!folioId) return fallback;
  const [saved, house] = await Promise.all([
    loadBriefFromIdb(folioId),
    loadHouseState(),
  ]);
  const brief = saved ?? fallback;
  const stack = assembleContextStack(
    house,
    folioId,
    brief,
    DEFAULT_INTERVIEW_ANSWERS,
  );
  if (
    !brief &&
    !stack.charter.length &&
    !Object.values(stack.fields).some((f) => f.value)
  )
    return null;
  return effectiveBrief(stack, brief);
}
