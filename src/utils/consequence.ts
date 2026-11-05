import { hasConfiguredAiProvider } from "./ai-client";
import type { AiSettings, ApparatusSettings } from "../types";

/**
 * Where an action's words or data end up. Shared by every control that can
 * send something somewhere, so a writer learns one set of inks and words:
 *
 *   local     stays on this device
 *   synced    copied to the writer's own account
 *   provider  read by the writer's own model provider (BYOK)
 *   credit    read by a hosted model, and spends hosted credit
 *   public    readable by anyone with the link, or published to a PDS
 *   erase     removed, and cannot be brought back from here
 *
 * The inks live in src/styles/motion.css (`--ink-*`), the rules in
 * docs/design/living-press.md.
 */
export type Consequence =
  | "local"
  | "synced"
  | "provider"
  | "credit"
  | "public"
  | "erase";

export const CONSEQUENCE_LABELS: Record<
  Consequence,
  { short: string; long: string }
> = {
  local: { short: "device", long: "Stays on this device" },
  synced: { short: "account", long: "Saved to your account" },
  provider: { short: "model", long: "Read by your model provider" },
  credit: { short: "credit", long: "Read by a hosted model; spends credit" },
  public: { short: "public", long: "Visible to anyone with the link" },
  erase: { short: "erases", long: "Removed; this cannot be undone" },
};

/** Which AI destination a request takes with these settings. */
export function aiConsequenceFor(
  settings: Partial<AiSettings> | AiSettings | null | undefined,
): Extract<Consequence, "provider" | "credit"> {
  return hasConfiguredAiProvider(settings) ? "provider" : "credit";
}

/**
 * The AI destination for the writer's saved settings. Resolves to `credit`
 * when nothing is configured (or storage is unavailable), because that is
 * where an unconfigured request goes.
 */
export async function loadAiConsequence(): Promise<
  Extract<Consequence, "provider" | "credit">
> {
  try {
    const { loadAiSettingsFromIdb } = await import("./idb");
    return aiConsequenceFor(await loadAiSettingsFromIdb());
  } catch {
    return "credit";
  }
}

/**
 * Where "Find sources" sends a passage: the writer's own search provider when
 * one is chosen in the Apparatus settings, otherwise the hosted service.
 */
export function researchConsequenceFor(
  settings: Pick<ApparatusSettings, "researchProvider"> | null | undefined,
): Extract<Consequence, "provider" | "credit"> {
  return settings && settings.researchProvider !== "hosted"
    ? "provider"
    : "credit";
}

/** Both AI routes the selection toolbar offers, read once from storage. */
export async function loadSelectionConsequences(): Promise<{
  ai: Extract<Consequence, "provider" | "credit">;
  research: Extract<Consequence, "provider" | "credit">;
}> {
  try {
    const { loadAiSettingsFromIdb, loadApparatusSettingsFromIdb } =
      await import("./idb");
    const [ai, apparatus] = await Promise.all([
      loadAiSettingsFromIdb(),
      loadApparatusSettingsFromIdb(),
    ]);
    return {
      ai: aiConsequenceFor(ai),
      research: researchConsequenceFor(apparatus),
    };
  } catch {
    return { ai: "credit", research: "credit" };
  }
}
