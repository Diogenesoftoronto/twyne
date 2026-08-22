/**
 * Assemble the full export payload for a folio.
 *
 * Both places a writer can export from — the File menu and the page-layout
 * tool — need the same set of parts: the manuscript, the brief, the
 * bibliography scoped to this folio, optionally the editors' marginalia, the
 * citation style, and the page setup. Gathering them in one place is what
 * stops the two paths from drifting into producing different documents from
 * the same folio.
 */

import type { ExportPayload } from "./exchange";
import type { LayoutSettings, ProjectBrief } from "../types";
import {
  loadFoliosFromIdb,
  loadFolioContentFromIdb,
  loadApparatusSettingsFromIdb,
} from "./idb";
import { loadBibliographyForFolio } from "./bibliography";
import { loadPersonaNotesLocally } from "./convex-sync";

export interface FolioExportRequest {
  folioId: string | null | undefined;
  folioName: string;
  brief?: ProjectBrief | null;
  layout?: LayoutSettings;
  header?: string;
  footer?: string;
  /** Persona feedback is private working context unless the writer opts in. */
  includePersonaComments?: boolean;
}

export function shouldIncludePersonaComments(
  request: Pick<FolioExportRequest, "includePersonaComments">,
): boolean {
  return request.includePersonaComments === true;
}

/**
 * The freshest manuscript available.
 *
 * The open editor answers a synchronous event with its current HTML, which is
 * ahead of IndexedDB by however long the save debounce has left to run — so an
 * export never omits the last sentence the writer typed before reaching for
 * the menu. Falls back to the stored copy when no editor is mounted.
 */
export async function readActiveFolioHtml(
  activeFolioId: string | null | undefined,
): Promise<string> {
  if (typeof window !== "undefined") {
    let html = "";
    const receive = (e: Event) => {
      html = (e as CustomEvent).detail as string;
    };
    window.addEventListener("twyne:draft-html", receive);
    window.dispatchEvent(new CustomEvent("twyne:request-draft-html"));
    window.removeEventListener("twyne:draft-html", receive);
    if (html) return html;
  }
  if (activeFolioId) return await loadFolioContentFromIdb(activeFolioId);
  return "";
}

export async function buildFolioExportPayload(
  req: FolioExportRequest,
): Promise<ExportPayload> {
  const [html, folios, bibliography, apparatusSettings, marginalia] =
    await Promise.all([
      readActiveFolioHtml(req.folioId),
      loadFoliosFromIdb(),
      loadBibliographyForFolio(req.folioId),
      loadApparatusSettingsFromIdb(),
      shouldIncludePersonaComments(req)
        ? loadPersonaNotesLocally(req.folioId ?? undefined)
        : Promise.resolve([]),
    ]);

  return {
    title: req.folioName || "Untitled",
    html,
    brief: req.brief ?? undefined,
    folios,
    bibliography,
    marginalia,
    citationStyle: apparatusSettings.defaultCitationStyle,
    layout: req.layout,
    header: req.header,
    footer: req.footer,
  };
}
