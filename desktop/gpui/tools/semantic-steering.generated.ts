// Generated from original background-research guards and editor text normalization.
// No runtime imports, research implementation, or provider access.
export interface ResearchCommandResult {
  ok: boolean;
  message?: string;
}

const MIN_DRAFT_CHARS = 120;
const passInFlight = false;
async function loadAiSettingsFromIdb(): Promise<null> {
  return null;
}
function hasConfiguredAiProvider(_settings: never): never {
  throw new Error("Offline steering cannot inspect a provider.");
}

export async function apparatusSteerOffline(
  instructions: string,
  folioId: string | null,
  text: string,
): Promise<ResearchCommandResult & { ok: false; message: string }> {
  const activeFolioId = folioId;
  const lastDraftText = text.replace(/\s+/g, " ").trim();
  // Begin unchanged original steering guards.

  const direction = instructions.trim();
  if (!direction) return { ok: false, message: "Write a direction first." };
  if (!activeFolioId || !lastDraftText) {
    return { ok: false, message: "Open a folio with draft text first." };
  }
  if (lastDraftText.trim().length < MIN_DRAFT_CHARS) {
    return {
      ok: false,
      message:
        "The folio needs a little more draft text before it can be steered.",
    };
  }
  if (passInFlight) {
    return { ok: false, message: "Let the current search settle first." };
  }
  const aiSettings = await loadAiSettingsFromIdb();
  if (!aiSettings || !hasConfiguredAiProvider(aiSettings)) {
    return {
      ok: false,
      message:
        "Choose an AI provider in Settings before steering a draft-wide pass.",
    };
  }
  // End unchanged original steering guards.
  throw new Error("Offline steering cannot cross the research boundary.");
}
