/**
 * Warm the dossier route before the writer gets there.
 *
 * Hovering or focusing "Create dossier" starts the IndexedDB reads the
 * create route needs; the route then takes the in-flight promise instead of
 * starting its own. SPA navigation keeps this module alive between routes.
 */
import type { Folio, ProjectBrief, WriterSettings } from "../types";
import { loadProjectBriefForFolio } from "./anti-tabula-rasa";
import {
  loadActiveFolioIdFromIdb,
  loadFoliosFromIdb,
  loadWriterSettingsFromIdb,
} from "./idb";

export interface DossierCreateData {
  writer: WriterSettings;
  folios: Folio[];
  activeFolioId: string | null;
  folio: Folio | null;
  brief: ProjectBrief | null;
}

/** Older than this, a warm read may have missed an edit; read again. */
const FRESH_MS = 15_000;
const INTERVIEW_STYLE_KEY = "twyne:interview-style";

let warm: {
  folioId: string | null;
  at: number;
  data: Promise<DossierCreateData>;
} | null = null;

async function read(requested: string | null): Promise<DossierCreateData> {
  const [writer, folios, activeFolioId] = await Promise.all([
    loadWriterSettingsFromIdb(),
    loadFoliosFromIdb(),
    loadActiveFolioIdFromIdb(),
  ]);
  const folio =
    folios.find((candidate) => candidate.id === requested) ??
    folios.find((candidate) => candidate.id === activeFolioId) ??
    null;
  const brief = await loadProjectBriefForFolio(folio?.id ?? null);
  rememberInterviewStyle(writer.interviewStyle);
  return { writer, folios, activeFolioId, folio, brief };
}

export function warmDossierCreate(folioId: string | null): void {
  if (typeof window === "undefined") return;
  if (warm && warm.folioId === folioId && Date.now() - warm.at < FRESH_MS)
    return;
  const data = read(folioId);
  data.catch(() => {
    if (warm?.data === data) warm = null;
  });
  warm = { folioId, at: Date.now(), data };
}

/** The warmed read for this folio if it is fresh, else a new one. */
export function takeDossierCreate(
  folioId: string | null,
): Promise<DossierCreateData> {
  const hit =
    warm && warm.folioId === folioId && Date.now() - warm.at < FRESH_MS
      ? warm.data
      : null;
  warm = null;
  return hit ?? read(folioId);
}

/**
 * The last interview surface, read synchronously so the skeleton matches the
 * surface that is about to arrive. The writer's settings stay authoritative.
 */
export function interviewStyleHint(): "form" | "conversational" {
  try {
    return localStorage.getItem(INTERVIEW_STYLE_KEY) === "conversational"
      ? "conversational"
      : "form";
  } catch {
    return "form";
  }
}

export function rememberInterviewStyle(style: "form" | "conversational"): void {
  try {
    localStorage.setItem(INTERVIEW_STYLE_KEY, style);
  } catch {
    /* a hint only */
  }
}

/* ── Filed on arrival ──────────────────────────────────────────── */

const FILED_KEY = "twyne:dossier-filed";

/** Set just before navigating to the desk, so the stamp plays there. */
export function markDossierFiledForDesk(kind: "filed" | "revised"): void {
  try {
    sessionStorage.setItem(FILED_KEY, JSON.stringify({ kind, at: Date.now() }));
  } catch {
    /* the stamp is a courtesy */
  }
}

/** Read once by the desk; null when nothing was just filed. */
export function takeDossierFiledForDesk(): "filed" | "revised" | null {
  try {
    const raw = sessionStorage.getItem(FILED_KEY);
    sessionStorage.removeItem(FILED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: string; at?: number };
    if (!parsed.at || Date.now() - parsed.at > 10_000) return null;
    return parsed.kind === "revised" ? "revised" : "filed";
  } catch {
    return null;
  }
}
