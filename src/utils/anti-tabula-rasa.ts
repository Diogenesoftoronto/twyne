import type { LedgerSource } from "./house-model";
import type {
  ConstraintTriage,
  DossierAttachment,
  Folio,
  DossierProbe,
  ProjectBrief,
  ProjectInterviewAnswers,
} from "../types";
import { markDirty as markSyncDirty } from "./convex-sync";
import { BRIEF_PATH, writeFileAsJson } from "./lix";
import {
  loadActiveFolioIdFromIdb,
  loadBriefFromIdb,
  loadFolioContentFromIdb,
  loadFoliosFromIdb,
  saveBriefToIdb,
  saveFoliosToIdb,
} from "./idb";
import { archiveBriefEdition } from "./brief-history";
import { htmlToPlainText } from "./html-to-plain-text";

// The conversion moved to a dependency-free module so the server can share
// it; re-exported here so existing imports keep working.
export { htmlToPlainText };

export const BRIEF_STORAGE_KEY = "twyne-project-brief";
export const DRAFT_STORAGE_KEY = "twyne-document";
/**
 * One-shot slot for the manuscript text that should travel with a writer
 * when they hit "Start over" on the dossier refinery. The refine route
 * stashes the current folio content here before routing to /dossier/create,
 * and the create route reads it on hydration to seed the next interview's
 * starting-material field. Either side clears it once consumed.
 */
export const STARTING_MATERIAL_KEY = "twyne-starting-material";

export const DEFAULT_INTERVIEW_ANSWERS: ProjectInterviewAnswers = {
  workingTitle: "Untitled project",
  format: "Essay",
  audience: "A thoughtful reader who needs the point made clearly",
  goal: "Make the central argument feel inevitable and worth caring about",
  tone: "Clear, exact, and generous",
  constraints: "Keep the piece grounded in evidence and avoid generic filler",
  successSignal:
    "A reader should know what this is, who it is for, and why it matters",
};

/**
 * The name a folio carries until the piece has a working title. It is a
 * stand-in, not a title: the first working title (from the dossier or a
 * rename in the drawer) replaces it.
 */
export const UNTITLED_FOLIO_NAME = "Current draft";

/** Stand-ins earlier versions wrote; still read as "no title yet". */
const PLACEHOLDER_FOLIO_NAMES = new Set([
  UNTITLED_FOLIO_NAME,
  "Untitled folio",
]);

export function isPlaceholderFolioName(
  name: string | null | undefined,
): boolean {
  const title = name?.trim() ?? "";
  return !title || PLACEHOLDER_FOLIO_NAMES.has(title);
}

/** A folio's name as a brief title, or "" when the folio is unnamed. */
export function briefTitleFromFolioName(
  name: string | null | undefined,
): string {
  return isPlaceholderFolioName(name) ? "" : (name?.trim() ?? "");
}

/**
 * Keep the folio's name and its dossier's working title one name.
 *
 * Called whenever a brief is saved: a new, real working title renames the
 * folio. Renaming from the drawer goes the other way through
 * `renameFolioEverywhere`.
 */
async function syncFolioNameToTitle(
  folioId: string,
  workingTitle: string,
): Promise<void> {
  const title = workingTitle.trim();
  if (!title || title === DEFAULT_INTERVIEW_ANSWERS.workingTitle) return;
  const folios = await loadFoliosFromIdb();
  const folio = folios.find((candidate) => candidate.id === folioId);
  if (!folio || folio.name === title) return;
  await saveFoliosToIdb(
    folios.map((candidate) =>
      candidate.id === folioId
        ? { ...candidate, name: title, updatedAt: Date.now() }
        : candidate,
    ),
  );
  window.dispatchEvent(
    new CustomEvent(FOLIO_RENAMED_EVENT, { detail: { folioId, name: title } }),
  );
}

export const FOLIO_RENAMED_EVENT = "twyne:folio-renamed";

/**
 * Rename a folio and, when it has a dossier, its working title with it, so
 * the drawer, the masthead and the brief never show two names for one piece.
 * Returns the updated folio list.
 */
export async function renameFolioEverywhere(
  folioId: string,
  requested: string,
): Promise<Folio[]> {
  const name = requested.trim() || UNTITLED_FOLIO_NAME;
  const folios = (await loadFoliosFromIdb()).map((folio) =>
    folio.id === folioId ? { ...folio, name, updatedAt: Date.now() } : folio,
  );
  await saveFoliosToIdb(folios);
  const stored = await loadBriefFromIdb(folioId);
  if (stored && !isPlaceholderFolioName(name)) {
    const brief = normalizeProjectBrief(stored);
    if (brief.answers.workingTitle.trim() !== name) {
      await saveProjectBriefForFolio(
        folioId,
        {
          ...brief,
          answers: { ...brief.answers, workingTitle: name },
          updatedAt: Date.now(),
        },
        { source: "manual", reason: "Renamed in the drawer" },
      );
    }
  }
  markSyncDirty();
  return folios;
}

/**
 * Carry a named folio's title into the brief when the writer left the
 * working title blank or at the form's placeholder.
 */
export function withFolioTitle(
  answers: ProjectInterviewAnswers,
  folioName: string | null | undefined,
): ProjectInterviewAnswers {
  const folioTitle = briefTitleFromFolioName(folioName);
  const current = answers.workingTitle.trim();
  if (!folioTitle) return answers;
  if (current && current !== DEFAULT_INTERVIEW_ANSWERS.workingTitle) {
    return answers;
  }
  return { ...answers, workingTitle: folioTitle };
}

export function createProjectBrief(
  answers: ProjectInterviewAnswers,
  previous?: ProjectBrief | null,
  attachments?: DossierAttachment[],
  probes?: DossierProbe[],
  /**
   * The form's reading of each constraint line. Without one, the previous
   * brief's reading is kept while the constraints it read are unchanged.
   */
  constraintTriage?: ConstraintTriage | null,
): ProjectBrief {
  const now = Date.now();
  const carried = probes ?? previous?.probes;
  const normalized = normalizeInterviewAnswers(answers);
  const triage = [constraintTriage, previous?.constraintTriage].find(
    (reading) =>
      !!reading && reading.source.trim() === normalized.constraints.trim(),
  );
  return {
    answers: normalized,
    attachments: attachments ?? previous?.attachments ?? [],
    // Omitted entirely rather than stored as [] so a brief that never had
    // probes stays byte-identical to one written before they existed.
    ...(carried && carried.length > 0 ? { probes: carried } : {}),
    ...(triage ? { constraintTriage: triage } : {}),
    completedAt: previous?.completedAt ?? now,
    updatedAt: now,
  };
}

export function loadProjectBrief(): ProjectBrief | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BRIEF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProjectBrief> & {
      answers?: ProjectInterviewAnswers;
    };
    if (!parsed.answers) return null;
    return normalizeProjectBrief(parsed);
  } catch {
    return null;
  }
}

export async function loadProjectBriefForFolio(
  folioId: string | null | undefined,
): Promise<ProjectBrief | null> {
  if (!folioId) return null;
  const brief = await loadBriefFromIdb(folioId);
  return brief ? normalizeProjectBrief(brief) : null;
}

export function saveProjectBrief(brief: ProjectBrief): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BRIEF_STORAGE_KEY, JSON.stringify(brief));
    void writeFileAsJson(BRIEF_PATH, brief).then(() => {
      markSyncDirty();
    });
  } catch {
    // storage unavailable
  }
}

export async function saveProjectBriefForFolio(
  folioId: string,
  brief: ProjectBrief,
  provenance?: { source: LedgerSource; reason?: string },
): Promise<void> {
  const normalized = normalizeProjectBrief(brief);
  const previous = await loadBriefFromIdb(folioId);
  if (
    previous &&
    JSON.stringify(withoutTriage(previous)) !==
      JSON.stringify(withoutTriage(normalized))
  ) {
    await archiveBriefEdition(
      folioId,
      normalizeProjectBrief(previous),
      provenance,
      normalized,
    );
  }
  await saveBriefToIdb(folioId, normalized);
  // The IDB helper absorbs storage failures; verify the write so a lost
  // dossier surfaces as an error instead of a silent "filed" stamp.
  const saved = await loadBriefFromIdb(folioId);
  if (saved?.updatedAt !== normalized.updatedAt) {
    throw new Error("The dossier could not be saved on this device.");
  }

  // Keep the legacy mirrors current during the per-folio migration. They are
  // no longer authoritative, but older routes and existing Lix histories can
  // still open the most recently filed dossier.
  saveProjectBrief(normalized);
  await writeFileAsJson(`/folios/${folioId}/brief.json`, normalized);
  if (
    normalized.answers.workingTitle.trim() !==
    (previous?.answers?.workingTitle ?? "").trim()
  )
    await syncFolioNameToTitle(folioId, normalized.answers.workingTitle);
  markSyncDirty();
}

/** Triage is derived from the brief; a new reading is not a new edition. */
function withoutTriage(brief: Partial<ProjectBrief>): Partial<ProjectBrief> {
  const rest = { ...brief };
  delete rest.constraintTriage;
  return rest;
}

function isConstraintTriage(value: unknown): value is ConstraintTriage {
  const t = value as ConstraintTriage | undefined;
  return (
    !!t &&
    typeof t.source === "string" &&
    typeof t.at === "number" &&
    Array.isArray(t.lines) &&
    t.lines.every(
      (line) =>
        typeof line?.text === "string" &&
        typeof line.confidence === "number" &&
        ["hard", "editorial", "preference", "uncheckable"].includes(line.kind),
    )
  );
}

/**
 * Store Jev's constraint reading on the folio's brief without filing a new
 * edition. The triage's `source` is the effective constraints text (folio
 * answers plus house standards); the note gate checks it against the same
 * effective text, so a stale reading is ignored rather than trusted.
 */
export async function saveConstraintTriageForFolio(
  folioId: string,
  triage: ConstraintTriage,
): Promise<void> {
  const stored = await loadBriefFromIdb(folioId);
  if (!stored) return;
  const brief = normalizeProjectBrief(stored);
  if (
    JSON.stringify(brief.constraintTriage?.lines) ===
    JSON.stringify(triage.lines)
  )
    return;
  await saveBriefToIdb(folioId, { ...brief, constraintTriage: triage });
  markSyncDirty();
}

export function normalizeProjectBrief(
  parsed: Partial<ProjectBrief> & {
    answers?: ProjectInterviewAnswers;
  },
): ProjectBrief {
  const probes = Array.isArray(parsed.probes) ? parsed.probes : [];
  return {
    answers: normalizeInterviewAnswers(
      parsed.answers ?? DEFAULT_INTERVIEW_ANSWERS,
    ),
    attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
    ...(probes.length > 0 ? { probes } : {}),
    ...(isConstraintTriage(parsed.constraintTriage)
      ? { constraintTriage: parsed.constraintTriage }
      : {}),
    completedAt:
      typeof parsed.completedAt === "number" ? parsed.completedAt : Date.now(),
    updatedAt:
      typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
  };
}

/**
 * Read the live draft.
 *
 * The store of record is folio-scoped IndexedDB. There used to be a parallel
 * mirror in a single global `localStorage` key, written synchronously on a
 * timer while the writer typed — it blocked the main thread, carried the whole
 * manuscript, and because it was one key for all folios it held whichever
 * folio happened to save last. It is gone; this reads the active folio.
 */
export async function loadDraftHtml(): Promise<string> {
  if (typeof window === "undefined") return "";
  const folioId = await loadActiveFolioIdFromIdb();
  if (!folioId) return "";
  return (await loadFolioContentFromIdb(folioId)) || "";
}

export async function loadDraftText(): Promise<string> {
  return htmlToPlainText(await loadDraftHtml());
}

/**
 * The pre-folio draft key. Read once by the editor's migration path to seed
 * "Folio I" for writers who last opened Twyne before folios existed. Nothing
 * writes this key any more.
 */
export function loadLegacyDraftHtml(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(DRAFT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export {
  writeCrashMirror,
  readCrashMirror,
  clearCrashMirror,
} from "./crash-mirror";

export function loadStartingMaterial(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(STARTING_MATERIAL_KEY) || "";
  } catch {
    return "";
  }
}

export function saveStartingMaterial(material: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STARTING_MATERIAL_KEY, material);
  } catch {
    // storage unavailable
  }
}

export function clearStartingMaterial(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STARTING_MATERIAL_KEY);
  } catch {
    // storage unavailable
  }
}

/**
 * The first page of a fresh folio. The brief lives in the dossier, where the
 * room reads it; the manuscript only receives the writer's title so the page
 * is theirs from the first keystroke.
 */
export function buildStarterDocument(answers: ProjectInterviewAnswers): string {
  return titleHeading(answers);
}

export function buildImportedMaterialDocument(
  answers: ProjectInterviewAnswers,
  raw: string,
  filename?: string,
): string {
  void filename;
  const paragraphs = raw
    .trim()
    .split(/\n{2,}/)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n");

  return `${titleHeading(answers)}\n${paragraphs}`.trim();
}

function titleHeading(answers: ProjectInterviewAnswers): string {
  const title = answers.workingTitle.trim();
  if (!title || title === DEFAULT_INTERVIEW_ANSWERS.workingTitle) {
    return "<p></p>";
  }
  return `<h1>${escapeHtml(title)}</h1><p></p>`;
}

export function summarizeBrief(brief: ProjectBrief | null): string {
  const answers = brief?.answers ?? DEFAULT_INTERVIEW_ANSWERS;
  return `${answers.format} for ${answers.audience}. Goal: ${answers.goal}`;
}

function normalizeInterviewAnswers(
  answers: ProjectInterviewAnswers,
): ProjectInterviewAnswers {
  return {
    workingTitle:
      answers.workingTitle.trim() || DEFAULT_INTERVIEW_ANSWERS.workingTitle,
    format: answers.format.trim() || DEFAULT_INTERVIEW_ANSWERS.format,
    audience: answers.audience.trim() || DEFAULT_INTERVIEW_ANSWERS.audience,
    goal: answers.goal.trim() || DEFAULT_INTERVIEW_ANSWERS.goal,
    tone: answers.tone.trim() || DEFAULT_INTERVIEW_ANSWERS.tone,
    constraints:
      answers.constraints.trim() || DEFAULT_INTERVIEW_ANSWERS.constraints,
    successSignal:
      answers.successSignal.trim() || DEFAULT_INTERVIEW_ANSWERS.successSignal,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
