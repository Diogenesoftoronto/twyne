/**
 * Assemble the full export payload for a folio.
 *
 * Both places a writer can export from — the File menu and the page-layout
 * tool — need the same set of parts: the manuscript, the brief, the
 * bibliography scoped to this folio, the editors' marginalia, the citation
 * style, and the page setup. Gathering them in one place is what stops the two
 * paths from drifting into producing different documents from the same folio.
 */

import type { ExportPayload } from "./exchange";
import type { LayoutSettings, ProjectBrief } from "../types";
import {
  loadFoliosFromIdb,
  loadFolioContentFromIdb,
  loadApparatusSettingsFromIdb,
} from "./idb";
import { loadBibliography } from "./bibliography";
import { loadPersonaNotesLocally } from "./convex-sync";

export interface FolioExportRequest {
  folioId: string | null | undefined;
  folioName: string;
  brief?: ProjectBrief | null;
  layout?: LayoutSettings;
  header?: string;
  footer?: string;
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
      loadBibliography(),
      loadApparatusSettingsFromIdb(),
      loadPersonaNotesLocally(req.folioId ?? undefined),
    ]);

  // Entries with no folio are the writer's general library and belong in
  // every document; the rest are scoped to the folio that collected them.
  const activeBibliography = bibliography.filter(
    (entry) => entry.folioId === req.folioId || !entry.folioId,
  );

  return {
    title: req.folioName || "Untitled",
    html,
    brief: req.brief ?? undefined,
    folios,
    bibliography: activeBibliography,
    marginalia,
    citationStyle: apparatusSettings.defaultCitationStyle,
    layout: req.layout,
    header: req.header,
    footer: req.footer,
  };
}
