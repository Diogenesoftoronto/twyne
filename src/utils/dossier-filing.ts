export type DossierFilingState = "idle" | "filing" | "filed";

/** Long enough for the filing stamp to register, short enough to keep flow. */
export const DOSSIER_FILED_FEEDBACK_MS = 620;

export async function waitForDossierFiledFeedback(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, DOSSIER_FILED_FEEDBACK_MS);
  });
}
