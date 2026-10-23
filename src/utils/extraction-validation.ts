import type {
  ExtractionAnswer,
  ExtractionField,
  ExtractionRequest,
} from "./extraction";

/** Clairic response contract v1. Mirrored in Twyne and the Not Organic gateway.
 * Both copies run extraction-contract-v1.json; no cross-checkout imports.
 * Provider reference: https://developers.cloudflare.com/workers-ai/models/clairic/
 */
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const probability = (value: unknown) =>
  finite(value) && value >= 0 && value <= 1;
function invalid(): never {
  throw new Error("Invalid extraction answer");
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function time(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(
      value,
    )
  );
}
function scalar(value: unknown, type: string, field: ExtractionField): boolean {
  if (type === "text") return typeof value === "string";
  if (type === "date") return date(value);
  if (type === "time") return time(value);
  if (type === "datetime")
    return (
      typeof value === "string" &&
      date(value.slice(0, 10)) &&
      value[10] === "T" &&
      time(value.slice(11))
    );
  return finite(value) && (!field.integer || Number.isInteger(value));
}
function validSpan(value: unknown, length: number): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => Number.isSafeInteger(n) && n >= 0) &&
    value[0] <= value[1] &&
    value[1] <= length
  );
}
function boundary(state: string, offset: number): boolean {
  return !(
    offset > 0 &&
    offset < state.length &&
    /[\uD800-\uDBFF]/.test(state[offset - 1]!) &&
    /[\uDC00-\uDFFF]/.test(state[offset]!)
  );
}
/** Character offsets are underspecified upstream. Accept either convention only
 * when it reconstructs the exact supplied text, then expose UTF-16 everywhere.
 * Never search for a matching occurrence: that would discard source provenance.
 */
function textSpan(
  source: string | undefined,
  raw: unknown,
  value: unknown,
  encoding: "detect" | "utf16",
): [number, number] {
  if (
    source === undefined ||
    typeof value !== "string" ||
    !validSpan(raw, source.length)
  )
    return invalid();
  const [start, end] = raw;
  const utf16Match =
    boundary(source, start) &&
    boundary(source, end) &&
    source.slice(start, end) === value;
  if (encoding === "utf16") return utf16Match ? [start, end] : invalid();
  const characters = Array.from(source);
  if (
    end <= characters.length &&
    characters.slice(start, end).join("") === value
  ) {
    const converted: [number, number] = [
      characters.slice(0, start).join("").length,
      characters.slice(0, end).join("").length,
    ];
    // Repeated source text can make both conventions match different occurrences.
    // Without an upstream encoding guarantee, neither occurrence is established.
    if (utf16Match && (converted[0] !== start || converted[1] !== end))
      invalid();
    return converted;
  }
  return utf16Match ? [start, end] : invalid();
}
function probabilities(answer: Record<string, unknown>): void {
  for (const key of ["p_null", "confidence", "p_below", "p_above"]) {
    if (answer[key] !== undefined && !probability(answer[key])) invalid();
  }
  if (answer.unit !== undefined && typeof answer.unit !== "string") invalid();
}
function distribution(
  answer: Record<string, unknown>,
  field: ExtractionField,
): void {
  probabilities(answer);
  const numeric = finite(field.min) && finite(field.max);
  const dated = date(field.min) && date(field.max);
  if ((!numeric && !dated) || field.min! >= field.max!) invalid();
  const inRange = (value: unknown): value is number | string =>
    (numeric ? finite(value) : date(value)) &&
    (value as number) >= (field.min as number) &&
    (value as number) <= (field.max as number);
  if (
    ![answer.p10, answer.median, answer.p90].every(inRange) ||
    (answer.p10 as number) > (answer.median as number) ||
    (answer.median as number) > (answer.p90 as number)
  )
    invalid();
  for (const key of ["value", "mean"])
    if (answer[key] !== undefined && !inRange(answer[key])) invalid();
  if (answer.value !== undefined && answer.value !== answer.median) invalid();
  if (answer.quantiles !== undefined) {
    if (
      !Array.isArray(answer.quantiles) ||
      answer.quantiles.length !== 99 ||
      !answer.quantiles.every(inRange) ||
      answer.quantiles.some((value, i, all) => i > 0 && value < all[i - 1]!)
    )
      invalid();
  }
}

/** Reject an entire response if any requested answer breaks the typed contract. */
export function validateExtractionAnswers(
  request: Pick<ExtractionRequest, "state" | "fields"> & { images?: string[] },
  raw: unknown,
  stateText?: string,
  spanEncoding: "detect" | "utf16" = "detect",
): Record<string, ExtractionAnswer> {
  const names = Object.keys(request.fields);
  if (
    !record(raw) ||
    Object.keys(raw).length !== names.length ||
    names.some((name) => !Object.hasOwn(raw, name))
  )
    invalid();
  const source = request.images?.length ? stateText : request.state;
  return Object.fromEntries(
    names.map((name) => {
      const answer = raw[name],
        field = request.fields[name]!;
      if (
        !record(answer) ||
        answer.type !== field.type ||
        !Object.hasOwn(answer, "value")
      )
        return invalid();
      const normalized = { ...answer };
      probabilities(answer);
      if (field.type === "estimate") {
        if (answer.value === undefined) invalid();
        distribution(answer, field);
      } else if (field.type === "forecast") {
        if (
          !Number.isInteger(field.horizon) ||
          field.horizon! < 1 ||
          field.horizon! > 64 ||
          !Array.isArray(answer.value) ||
          answer.value.length !== field.horizon
        )
          invalid();
        let steps: unknown[];
        if (answer.steps !== undefined) {
          if (
            !Array.isArray(answer.steps) ||
            answer.steps.length !== field.horizon
          )
            invalid();
          steps = answer.steps;
        } else {
          if (
            ![answer.median, answer.p10, answer.p90].every(
              (v) => Array.isArray(v) && v.length === field.horizon,
            )
          )
            invalid();
          steps = (answer.median as unknown[]).map((median, i) => ({
            median,
            p10: (answer.p10 as unknown[])[i],
            p90: (answer.p90 as unknown[])[i],
          }));
        }
        steps.forEach((step, i) => {
          if (!record(step)) invalid();
          distribution(step, field);
          if ((answer.value as unknown[])[i] !== step.median) invalid();
        });
        // Providers may include parallel arrays alongside per-step estimates.
        for (const key of ["median", "p10", "p90", "mean"] as const) {
          const values = answer[key];
          if (values === undefined) continue;
          if (!Array.isArray(values) || values.length !== field.horizon)
            invalid();
          values.forEach((value, i) => {
            const step = steps[i] as Record<string, unknown>;
            if (
              (key !== "mean" || step.mean !== undefined) &&
              value !== step[key]
            )
              invalid();
            distribution({ ...step, [key]: value }, field);
          });
        }
      } else if (field.type === "list") {
        if (
          !Array.isArray(answer.value) ||
          !["text", "number", "date"].includes(field.items ?? "") ||
          !answer.value.every((value) => scalar(value, field.items!, field))
        )
          invalid();
        if (
          (field.items === "text" && answer.value.length > 0) ||
          answer.spans !== undefined
        ) {
          if (
            !Array.isArray(answer.spans) ||
            answer.spans.length !== answer.value.length
          )
            invalid();
          const spans = answer.spans.map((span, i) =>
            field.items === "text"
              ? textSpan(
                  source,
                  span,
                  (answer.value as unknown[])[i],
                  spanEncoding,
                )
              : validSpan(span, source?.length ?? -1)
                ? span
                : invalid(),
          );
          if (spans.some((span, i) => i > 0 && span[0] < spans[i - 1]![1]))
            invalid();
          normalized.spans = spans;
        }
      } else {
        if (answer.value !== null && !scalar(answer.value, field.type, field))
          invalid();
        if (
          answer.guess !== undefined &&
          answer.guess !== null &&
          !scalar(answer.guess, field.type, field)
        )
          invalid();
        if (
          answer.p_null !== undefined &&
          (answer.p_null as number) > (field.null_threshold ?? 0.5) !==
            (answer.value === null)
        )
          invalid();
        if (
          answer.value !== null &&
          answer.guess !== undefined &&
          answer.guess !== answer.value
        )
          invalid();
        if (field.type === "text") {
          const candidate = answer.value ?? answer.guess;
          if (candidate != null)
            normalized.span = textSpan(
              source,
              answer.span,
              candidate,
              spanEncoding,
            );
          else if (answer.span !== undefined && answer.span !== null) invalid();
        }
      }
      return [name, normalized as unknown as ExtractionAnswer];
    }),
  );
}
