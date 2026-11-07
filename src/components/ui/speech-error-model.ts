import type { AppError } from "../../types/application-errors";

export interface SpeechErrorView {
  title: string;
  message: string;
  retry: boolean;
  retryAfterSeconds?: number;
  recovery?: { label: string; href: string };
  /** Hint to switch voice or provider when the failure is provider-side. */
  suggestVoiceChange: boolean;
  /** Settings is the primary recovery; render it ahead of secondary actions. */
  primaryRecovery: boolean;
}

const TITLES: Partial<Record<AppError["code"], string>> = {
  AUTHENTICATION_REQUIRED: "Sign in to read aloud",
  AUTHENTICATION_FAILED: "Sign-in could not be verified",
  PERMISSION_DENIED: "Read aloud is unavailable",
  RATE_LIMITED: "The voice needs a moment",
  TIMEOUT: "The voice took too long",
  NETWORK_UNAVAILABLE: "Connection interrupted",
  CONFIGURATION_ERROR: "Voice setup needs attention",
  PROVIDER_ERROR: "The voice could not be prepared",
  MALFORMED_RESPONSE: "The audio could not be read",
};

/** Reviewed copy: hosted provider detail is never shown to the reader. */
export const HOSTED_NARRATION_FAILURE =
  "Hosted narration could not finish. Please try again later.";

/** Maps a structured error onto honest, actionable player copy. */
export function describeSpeechError(error: AppError | null): SpeechErrorView {
  if (!error) {
    return {
      title: "Read aloud stopped",
      message: "Narration failed.",
      retry: true,
      suggestVoiceChange: false,
      primaryRecovery: false,
    };
  }
  const hosted =
    error.source === "convex" &&
    error.metadata?.provider === "notorganic" &&
    error.metadata?.operation === "speech";
  // Use reviewed copy selected by structured evidence; never display a raw
  // gateway body or tell a signed-in writer to repair our provider route.
  if (hosted && error.status === 402) {
    return {
      title: "Narration needs wallet credit",
      message:
        "Add credit to your Not Organic wallet, then read this passage again.",
      recovery: { label: "Add credit", href: "/pricing/" },
      retry: false,
      primaryRecovery: true,
      suggestVoiceChange: false,
    };
  }
  if (hosted && (error.status === 400 || error.status === 404)) {
    return {
      title: "Hosted narration is unavailable",
      message:
        "Twyne couldn't prepare this voice. Contact support with the reference below so we can check the hosted route.",
      retry: false,
      primaryRecovery: false,
      suggestVoiceChange: false,
    };
  }
  const downloadRequired = error.recovery.action === "download-required";
  let recovery: SpeechErrorView["recovery"];
  switch (error.recovery.action) {
    case "sign-in":
      recovery = { label: "Sign in", href: "/editor?auth=1" };
      break;
    case "check-configuration":
    case "choose-provider":
      recovery = { label: "Open voice settings", href: "/settings/" };
      break;
    case "download-required":
      recovery = { label: "Download in Settings", href: "/settings/" };
      break;
    default:
      break;
  }
  const hostedNarrationFailure =
    error.code === "PROVIDER_ERROR" && error.source === "convex";
  return {
    title: downloadRequired
      ? "Browser voice not downloaded"
      : (TITLES[error.code] ?? "Read aloud stopped"),
    message: downloadRequired
      ? "The browser voice isn't on this device yet. Download it in Settings (a few hundred MB), or pick a different voice. Nothing is downloaded automatically."
      : hostedNarrationFailure
        ? HOSTED_NARRATION_FAILURE
        : error.message.trim() || "Narration failed.",
    // Retrying cannot succeed until the voice has been downloaded.
    retry: error.recovery.canRetry && !downloadRequired,
    retryAfterSeconds:
      error.recovery.retryAfterMs === undefined
        ? undefined
        : Math.max(1, Math.ceil(error.recovery.retryAfterMs / 1000)),
    recovery,
    primaryRecovery: downloadRequired,
    // Provider failures are upstream: never imply the user's setup or key is
    // at fault. Only an unreadable audio response hints at trying another voice.
    suggestVoiceChange: error.code === "MALFORMED_RESPONSE",
  };
}

export type CopyStatus = "idle" | "copied" | "failed";

export function copyStatusMessage(status: CopyStatus): string {
  if (status === "copied") return "Reference copied.";
  if (status === "failed")
    return "Couldn't copy automatically. Select the reference and copy it.";
  return "";
}
