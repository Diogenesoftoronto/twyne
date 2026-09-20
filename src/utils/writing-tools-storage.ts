import { loadMetaFromIdb, saveMetaToIdb } from "./idb";

export interface SavedWritingPassage {
  id: string;
  text: string;
}
export interface SavedResearchPair {
  id: string;
  claim: string;
  source: string;
  previousClaim?: string;
}
export interface WritingToolsNotebook {
  audience: string;
  voiceSamples: SavedWritingPassage[];
  scraps: SavedWritingPassage[];
  sources: SavedResearchPair[];
  intentionalPromises: string[];
}

let storage = { load: loadMetaFromIdb, save: saveMetaToIdb };
export function __setWritingToolsStorageForTests(
  adapter: typeof storage | null,
) {
  storage = adapter ?? { load: loadMetaFromIdb, save: saveMetaToIdb };
}

export function emptyWritingToolsNotebook(): WritingToolsNotebook {
  return {
    audience: "",
    voiceSamples: [],
    scraps: [],
    sources: [],
    intentionalPromises: [],
  };
}

function passages(value: unknown): SavedWritingPassage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) =>
      item && typeof item.id === "string" && typeof item.text === "string",
  );
}

export async function loadWritingToolsNotebook(
  folioId: string,
): Promise<WritingToolsNotebook> {
  if (!folioId) return emptyWritingToolsNotebook();
  const value = await storage.load<Partial<WritingToolsNotebook>>(
    `writing-tools:${folioId}`,
  );
  if (!value || typeof value !== "object") return emptyWritingToolsNotebook();
  return {
    audience: typeof value.audience === "string" ? value.audience : "",
    voiceSamples: passages(value.voiceSamples),
    scraps: passages(value.scraps),
    sources: Array.isArray(value.sources)
      ? value.sources.filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.claim === "string" &&
            typeof item.source === "string" &&
            (item.previousClaim === undefined ||
              typeof item.previousClaim === "string"),
        )
      : [],
    intentionalPromises: Array.isArray(value.intentionalPromises)
      ? value.intentionalPromises.filter((id) => typeof id === "string")
      : [],
  };
}

/** Verify the write: the shared IDB helper deliberately absorbs storage failures. */
export async function saveWritingToolsNotebook(
  folioId: string,
  notebook: WritingToolsNotebook,
): Promise<void> {
  if (!folioId) throw new Error("No folio selected");
  const snapshot = JSON.parse(JSON.stringify(notebook)) as WritingToolsNotebook;
  await storage.save(`writing-tools:${folioId}`, snapshot);
  const saved = await loadWritingToolsNotebook(folioId);
  if (JSON.stringify(saved) !== JSON.stringify(snapshot))
    throw new Error("Local save failed");
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("twyne:writing-material-changed", {
        detail: { folioId },
      }),
    );
}
