/** Stable loopback address shared with desktop/decision/server.py. */
export const LOCAL_DECISION_URL = "http://127.0.0.1:8010";
export const LOCAL_DECISION_MODEL = "LiquidAI/d1-2B";

export interface LocalDecisionStatus {
  model: string;
  phase:
    | "not_downloaded"
    | "downloading"
    | "downloaded"
    | "loading"
    | "ready"
    | "error";
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
}

export function isLocalDecision(settings: {
  source: string;
  endpointUrl?: string;
  endpointModel?: string;
}): boolean {
  return (
    settings.source === "endpoint" &&
    settings.endpointUrl === LOCAL_DECISION_URL &&
    settings.endpointModel === LOCAL_DECISION_MODEL
  );
}

export async function localDecisionStatus(
  download = false,
): Promise<LocalDecisionStatus> {
  const response = await fetch(
    `${LOCAL_DECISION_URL}/${download ? "download" : "status"}`,
    {
      ...(download
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }
        : {}),
      signal: AbortSignal.timeout(5000),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Local decisions could not be reached.");
  if (data.model !== LOCAL_DECISION_MODEL)
    throw new Error(
      "An unexpected service is using the local decision address.",
    );
  return data;
}
