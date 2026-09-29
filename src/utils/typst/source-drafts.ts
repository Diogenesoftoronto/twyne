import { loadMetaFromIdb, saveMetaToIdb } from "../idb";

export interface TypstSourceDraft {
  folioId: string;
  source: string;
  baseSource: string;
  updatedAt: number;
}

const key = (folioId: string) => `typst-source-draft:${folioId}`;
const queues = new Map<string, Promise<void>>();

export async function loadTypstSourceDraft(
  folioId: string,
): Promise<TypstSourceDraft | null> {
  const saved = await loadMetaFromIdb<TypstSourceDraft>(key(folioId));
  let mirror: TypstSourceDraft | null = null;
  try {
    mirror = JSON.parse(localStorage.getItem(key(folioId)) || "null");
  } catch {
    /* IDB remains available. */
  }
  const valid = (value: TypstSourceDraft | null): value is TypstSourceDraft =>
    Boolean(
      value &&
        value.folioId === folioId &&
        typeof value.source === "string" &&
        typeof value.baseSource === "string" &&
        Number.isFinite(value.updatedAt),
    );
  if (valid(mirror) && (!valid(saved) || mirror.updatedAt >= saved.updatedAt))
    return mirror;
  return valid(saved) ? saved : null;
}

/** Keep incomplete source locally, separate from the last valid manuscript. */
export function saveTypstSourceDraft(draft: TypstSourceDraft): Promise<void> {
  let mirrored = false;
  try {
    localStorage.setItem(key(draft.folioId), JSON.stringify(draft));
    mirrored = true;
  } catch {
    /* Try IDB. */
  }
  const previous = queues.get(draft.folioId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await saveMetaToIdb(key(draft.folioId), draft);
      const saved = await loadMetaFromIdb<TypstSourceDraft>(key(draft.folioId));
      if (saved?.source !== draft.source && !mirrored)
        throw new Error(
          "Source could not be saved on this device. Download a source copy before leaving.",
        );
    });
  queues.set(draft.folioId, next);
  void next
    .finally(() => {
      if (queues.get(draft.folioId) === next) queues.delete(draft.folioId);
    })
    .catch(() => undefined);
  return next;
}

export async function clearTypstSourceDraft(folioId: string): Promise<void> {
  await queues.get(folioId)?.catch(() => undefined);
  await saveMetaToIdb(key(folioId), null);
  try {
    localStorage.removeItem(key(folioId));
  } catch {
    /* Nothing to remove. */
  }
}
