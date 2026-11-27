export interface JudgementQuestion {
  type: "noul" | "choice" | "score";
  instructions: string;
  criteria?: string[];
}

/** Local development means a loopback Convex runtime, never a hosted deployment. */
export function directJudgementKey(
  env: Record<string, string | undefined>,
): string | null {
  const key = env.TYPESAFE_API_KEY?.trim();
  if (!key) return null;
  try {
    const url = new URL(env.CONVEX_CLOUD_URL || env.CONVEX_SITE_URL || "");
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ? key
      : null;
  } catch {
    return null;
  }
}

/**
 * Convex field names must be printable ASCII and may not start with "$", but
 * Choice and Score answers are keyed by the writer-facing labels (a persona
 * named "Ally — already agrees"). Such answers cross the function boundary as
 * JSON instead; {@link unpackAnswers} restores them on the other side.
 */
export function packAnswers(answers: Record<string, unknown>): {
  answers?: Record<string, unknown>;
  answersJson?: string;
} {
  return hasUnsafeKey(answers)
    ? { answersJson: JSON.stringify(answers) }
    : { answers };
}

export function unpackAnswers<
  T extends { answers?: Record<string, unknown>; answersJson?: string },
>(result: T): Omit<T, "answersJson"> {
  const { answersJson, ...rest } = result;
  if (answersJson === undefined) return rest;
  try {
    return { ...rest, answers: JSON.parse(answersJson) };
  } catch {
    return rest;
  }
}

function hasUnsafeKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasUnsafeKey);
  return Object.entries(value).some(
    ([key, inner]) =>
      key.startsWith("$") || !/^[\x20-\x7e]*$/.test(key) || hasUnsafeKey(inner),
  );
}

/** Keep the app's ordered labels, emit the current HTTP Choice map contract. */
export function judgementQuestions(
  questions: Record<string, JudgementQuestion>,
) {
  const entries = Object.entries(questions);
  if (!entries.length || entries.length > 64) throw new Error("question limit");
  const normalized = Object.fromEntries(
    entries.map(([id, q]) => {
      if (!q.instructions.trim()) throw new Error("missing instructions");
      if (q.type === "noul")
        return [id, { type: q.type, instructions: q.instructions }];
      const options = q.criteria ?? [];
      if (
        options.length < 2 ||
        options.length > 64 ||
        options.some((value) => !value.trim()) ||
        new Set(options).size !== options.length
      ) {
        throw new Error("invalid criteria");
      }
      return [
        id,
        {
          type: q.type,
          instructions: q.instructions,
          criteria:
            q.type === "choice"
              ? Object.fromEntries(options.map((value) => [value, null]))
              : options,
        },
      ];
    }),
  );
  if (JSON.stringify(normalized).length > 96_000)
    throw new Error("question limit");
  return normalized;
}

export function validJudgementResponse(
  value: unknown,
  questions: Record<string, JudgementQuestion>,
): value is {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
} {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (
    typeof p.model !== "string" ||
    !p.answers ||
    typeof p.answers !== "object" ||
    Array.isArray(p.answers)
  )
    return false;
  const usage = p.usage as Record<string, unknown> | undefined;
  if (
    !usage ||
    ![usage.input_tokens, usage.output_tokens].every(
      (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
    )
  )
    return false;
  return Object.entries(questions).every(([id, q]) => {
    const a = (p.answers as Record<string, Record<string, unknown>>)[id];
    if (!a || a.type !== q.type) return false;
    if (q.type === "noul")
      return typeof a.noul === "number" && a.noul >= 0 && a.noul <= 1;
    if (
      typeof a.confidence !== "number" ||
      !Number.isFinite(a.confidence) ||
      a.confidence < 0 ||
      a.confidence > 1 ||
      !a.probabilities ||
      typeof a.probabilities !== "object" ||
      Array.isArray(a.probabilities)
    )
      return false;
    const probabilities = Object.values(a.probabilities);
    if (
      !probabilities.length ||
      !probabilities.every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
      )
    )
      return false;
    if (q.type === "choice")
      return (
        typeof a.choice === "string" && Boolean(q.criteria?.includes(a.choice))
      );
    return (
      typeof a.score === "number" &&
      Number.isFinite(a.score) &&
      a.score >= 0 &&
      a.score <= (q.criteria?.length ?? 0) - 1 &&
      a.legend !== null &&
      typeof a.legend === "object" &&
      !Array.isArray(a.legend) &&
      JSON.stringify(Object.values(a.legend)) === JSON.stringify(q.criteria)
    );
  });
}
