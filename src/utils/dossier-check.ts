import type {
  DossierCheckResult,
  DossierObservation,
  ProjectInterviewAnswers,
} from "../types";

const DOSSIER_FIELDS = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
] as const satisfies ReadonlyArray<keyof ProjectInterviewAnswers>;

const DOSSIER_FIELD_SET = new Set<string>(DOSSIER_FIELDS);

const PROVIDER_FAILURE_MESSAGE =
  "The configured language provider could not complete a readable draft review. Check its connection and model settings, then try again.";
const PROVIDER_REQUIRED_MESSAGE =
  "Reading the draft needs either a signed-in shared room or a configured language provider in AI settings.";

export function dossierCheckUnavailableMessage(
  hasConfiguredProvider: boolean,
): string {
  return hasConfiguredProvider
    ? PROVIDER_FAILURE_MESSAGE
    : PROVIDER_REQUIRED_MESSAGE;
}

interface DossierCheckFallbackOptions {
  runClient: (() => Promise<DossierCheckResult | null>) | null;
  runHosted: (() => Promise<DossierCheckResult>) | null;
}

/** Try the writer's provider first, then the signed-in hosted room on null. */
export async function runDossierCheckWithHostedFallback({
  runClient,
  runHosted,
}: DossierCheckFallbackOptions): Promise<DossierCheckResult | null> {
  const clientResult = runClient ? await runClient() : null;
  if (clientResult) return clientResult;
  return runHosted ? await runHosted() : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsedObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function jsonObjectFrom(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = parsedObject(fenced.trim());
    if (parsed) return parsed;
  }

  // Find the first balanced object that actually parses. This tolerates brief
  // prose before or after the JSON and ignores brace-shaped examples in that
  // prose without greedily swallowing the real report.
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < text.length; end++) {
      const char = text[end]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth !== 0) continue;
      const parsed = parsedObject(text.slice(start, end + 1));
      if (parsed) return parsed;
      break;
    }
  }
  return null;
}

/**
 * Parse and narrow the model's drift report.
 *
 * The report is writer-facing and directly mutates dossier fields, so loose
 * `JSON.parse` output is not enough. Invalid fields are dropped, observations
 * are de-duplicated by field in first-seen order, missing `current` values come
 * from the brief, and a malformed top-level response is distinguishable from a
 * valid empty report.
 */
export function parseDossierCheckResult(
  text: string,
  provider: string,
  answers: ProjectInterviewAnswers,
): DossierCheckResult | null {
  const parsed = jsonObjectFrom(text);
  if (!parsed || !Array.isArray(parsed.observations)) return null;

  const seen = new Set<keyof ProjectInterviewAnswers>();
  const observations: DossierObservation[] = [];
  for (const item of parsed.observations) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const field = stringValue(record.field);
    if (!DOSSIER_FIELD_SET.has(field)) continue;
    const typedField = field as keyof ProjectInterviewAnswers;
    if (seen.has(typedField)) continue;

    const suggested = stringValue(record.suggested);
    const reason = stringValue(record.reason);
    // A report without an actionable replacement or an explanation cannot be
    // meaningfully applied or assessed by the writer.
    if (!suggested || !reason) continue;

    observations.push({
      field: typedField,
      current: stringValue(record.current) || answers[typedField],
      suggested,
      reason,
    });
    seen.add(typedField);
  }

  return {
    observations: observations.slice(0, DOSSIER_FIELDS.length),
    provider,
  };
}
