import type { LedgerSource } from "./house-model";
import type {
  DossierAttachment,
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
  saveBriefToIdb,
} from "./idb";
import { archiveBriefEdition } from "./brief-history";

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

/** The name a folio gets when the writer didn't give it one. */
export const UNTITLED_FOLIO_NAME = "Untitled folio";

/** A folio's name as a brief title, or "" when the folio is unnamed. */
export function briefTitleFromFolioName(
  name: string | null | undefined,
): string {
  const title = name?.trim() ?? "";
  return title === UNTITLED_FOLIO_NAME ? "" : title;
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
): ProjectBrief {
  const now = Date.now();
  const carried = probes ?? previous?.probes;
  return {
    answers: normalizeInterviewAnswers(answers),
    attachments: attachments ?? previous?.attachments ?? [],
    // Omitted entirely rather than stored as [] so a brief that never had
    // probes stays byte-identical to one written before they existed.
    ...(carried && carried.length > 0 ? { probes: carried } : {}),
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
  if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) {
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

export function buildStarterDocument(answers: ProjectInterviewAnswers): string {
  const normalized = normalizeInterviewAnswers(answers);
  const title = escapeHtml(normalized.workingTitle);

  return `
    <h1>${title}</h1>
    <p><strong>Anti-tabula rasa brief</strong>: this draft starts with context, not emptiness.</p>
    <h2>Working context</h2>
    <ul>
      <li><strong>Format:</strong> ${escapeHtml(normalized.format)}</li>
      <li><strong>Audience:</strong> ${escapeHtml(normalized.audience)}</li>
      <li><strong>Goal:</strong> ${escapeHtml(normalized.goal)}</li>
      <li><strong>Tone:</strong> ${escapeHtml(normalized.tone)}</li>
      <li><strong>Constraints:</strong> ${escapeHtml(normalized.constraints)}</li>
      <li><strong>Success signal:</strong> ${escapeHtml(normalized.successSignal)}</li>
    </ul>
    <h2>Starter prompt</h2>
    <blockquote>
      <p>${escapeHtml(normalized.goal)}</p>
    </blockquote>
    <p>Begin the draft here. The room will use the brief above as the anchor.</p>
  `.trim();
}

export function buildImportedMaterialDocument(
  answers: ProjectInterviewAnswers,
  raw: string,
  filename?: string,
): string {
  const normalized = normalizeInterviewAnswers(answers);
  const title = escapeHtml(normalized.workingTitle);
  const sourceLabel = filename?.trim()
    ? `Imported from ${escapeHtml(filename.trim())}`
    : "Imported material";
  const paragraphs = raw
    .trim()
    .split(/\n{2,}/)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n");

  return `
    <h1>${title}</h1>
    <p><strong>${sourceLabel}</strong>: this material was brought into the room during onboarding.</p>
    ${paragraphs}
  `.trim();
}

export function summarizeBrief(brief: ProjectBrief | null): string {
  const answers = brief?.answers ?? DEFAULT_INTERVIEW_ANSWERS;
  return `${answers.format} for ${answers.audience}. Goal: ${answers.goal}`;
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|blockquote|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
