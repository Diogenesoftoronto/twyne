import type {
  DossierAttachment,
  DossierProbe,
  ProjectInterviewAnswers,
} from "../types";

export const BRIEF_DRAFT_PREFIX = "twyne:brief-form:v1:";
const ACTIVE_DRAFT = "twyne:brief-form:active";
const MAX_AGE = 24 * 60 * 60 * 1000;
export const FLUSH_BRIEF_DRAFT = "twyne:flush-brief-form";

export interface BriefFormDraft {
  answers: ProjectInterviewAnswers;
  attachments: DossierAttachment[];
  probes: DossierProbe[];
  existingMaterial: string;
  importedFilename: string;
  step: number;
}
interface SavedDraft {
  version: 1;
  owner: string | null;
  base: string;
  updatedAt: number;
  revision: string;
  draft: BriefFormDraft;
}
export interface BriefDraftHandoff {
  key: string;
  revision: string;
}
export function briefDraftKey(scope: string, owner: string | null): string {
  return BRIEF_DRAFT_PREFIX + JSON.stringify([scope, owner]);
}
function read(
  storage: Pick<Storage, "getItem">,
  key: string,
): SavedDraft | null {
  try {
    const saved = JSON.parse(
      storage.getItem(key) ?? "null",
    ) as SavedDraft | null;
    const draft = saved?.draft;
    if (
      !saved ||
      saved.version !== 1 ||
      !(saved.owner === null || typeof saved.owner === "string") ||
      typeof saved.base !== "string" ||
      typeof saved.revision !== "string" ||
      !Number.isFinite(saved.updatedAt) ||
      saved.updatedAt > Date.now() ||
      Date.now() - saved.updatedAt > MAX_AGE ||
      !draft ||
      !draft.answers ||
      ![
        "workingTitle",
        "format",
        "audience",
        "goal",
        "tone",
        "constraints",
        "successSignal",
      ].every(
        (field) =>
          typeof draft.answers[field as keyof ProjectInterviewAnswers] ===
          "string",
      ) ||
      !Array.isArray(draft.attachments) ||
      !Array.isArray(draft.probes) ||
      typeof draft.existingMaterial !== "string" ||
      typeof draft.importedFilename !== "string" ||
      !Number.isInteger(draft.step) ||
      draft.step < 0 ||
      draft.step > 9
    )
      return null;
    return saved;
  } catch {
    return null;
  }
}
export function loadBriefFormDraft(
  storage: Pick<Storage, "getItem">,
  scope: string,
  owner: string | null,
  base: string,
): BriefFormDraft | null {
  const saved = read(storage, briefDraftKey(scope, owner));
  // A changed canonical brief (including Start over) invalidates the pending form.
  return saved?.owner === owner && saved.base === base ? saved.draft : null;
}
export function saveBriefFormDraft(
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  owner: string | null,
  base: string,
  draft: BriefFormDraft,
): void {
  const key = briefDraftKey(scope, owner);
  const previous = read(storage, key);
  // Departure can flush twice. Only meaningful edits change the handoff revision.
  if (
    previous?.owner === owner &&
    previous.base === base &&
    JSON.stringify(previous.draft) === JSON.stringify(draft)
  ) {
    storage.setItem(ACTIVE_DRAFT, key);
    return;
  }
  const updatedAt = Date.now();
  storage.setItem(
    key,
    JSON.stringify({
      version: 1,
      owner,
      base,
      updatedAt,
      revision: crypto.randomUUID(),
      draft,
    }),
  );
  storage.setItem(ACTIVE_DRAFT, key);
}
export function clearBriefFormDraft(
  storage: Pick<Storage, "getItem" | "removeItem">,
  scope: string,
  owner: string | null,
): void {
  const key = briefDraftKey(scope, owner);
  storage.removeItem(key);
  if (storage.getItem(ACTIVE_DRAFT) === key) storage.removeItem(ACTIVE_DRAFT);
}
export function prepareBriefDraftHandoff(
  storage: Pick<Storage, "getItem">,
): BriefDraftHandoff | undefined {
  try {
    const key = storage.getItem(ACTIVE_DRAFT);
    if (!key?.startsWith(BRIEF_DRAFT_PREFIX)) return;
    const saved = read(storage, key);
    if (saved?.owner === null) return { key, revision: saved.revision };
  } catch {
    /* signing in remains available */
  }
}
export function claimBriefDraftHandoff(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  handoff: BriefDraftHandoff | undefined,
  owner: string,
): void {
  if (!handoff?.key?.startsWith(BRIEF_DRAFT_PREFIX)) return;
  try {
    const saved = read(storage, handoff.key);
    if (!saved || saved.owner !== null || saved.revision !== handoff.revision)
      return;
    const [scope, oldOwner] = JSON.parse(
      handoff.key.slice(BRIEF_DRAFT_PREFIX.length),
    );
    if (typeof scope !== "string" || oldOwner !== null) return;
    const key = briefDraftKey(scope, owner);
    // Never replace newer edits already belonging to the signed-in account.
    const current = read(storage, key);
    if (!current || current.updatedAt < saved.updatedAt)
      storage.setItem(key, JSON.stringify({ ...saved, owner }));
    storage.removeItem(handoff.key);
    if (storage.getItem(ACTIVE_DRAFT) === handoff.key)
      storage.setItem(ACTIVE_DRAFT, key);
  } catch {
    /* retain the guest copy if storage is unavailable */
  }
}

/** Keep recovery attached to the folio allocated by a submission that may fail. */
export function moveBriefFormDraft(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  fromScope: string,
  toScope: string,
  owner: string | null,
): void {
  if (fromScope === toScope) return;
  const oldKey = briefDraftKey(fromScope, owner);
  const saved = read(storage, oldKey);
  if (!saved || saved.owner !== owner) return;
  const key = briefDraftKey(toScope, owner);
  storage.setItem(key, JSON.stringify(saved));
  storage.removeItem(oldKey);
  if (storage.getItem(ACTIVE_DRAFT) === oldKey)
    storage.setItem(ACTIVE_DRAFT, key);
}
