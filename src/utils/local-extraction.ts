import type {
  ExtractionAnswer,
  ExtractionRequest,
  ExtractionResult,
} from "./extraction";
import { validateExtractionAnswers } from "./extraction-validation";

const MODEL = "lfm2-350m-extract";
const ENDPOINT = "http://127.0.0.1:8081/v1/chat/completions";

/** A generated quotation has provenance only when it maps to one exact span. */
function uniqueSpan(source: string, value: string): [number, number] | null {
  if (!value.trim()) return null;
  const start = source.indexOf(value);
  return start >= 0 && source.indexOf(value, start + 1) === -1
    ? [start, start + value.length]
    : null;
}

export async function askLocalExtraction(
  request: ExtractionRequest,
): Promise<ExtractionResult> {
  const source = request.state;
  const fields = Object.entries(request.fields);
  if (
    !source ||
    source.length > 24_000 ||
    fields.length === 0 ||
    fields.length > 12 ||
    fields.some(
      ([, field]) =>
        field.type !== "text" &&
        !(field.type === "list" && field.items === "text"),
    )
  )
    return { ok: false, transport: "local", error: "unsupported" };

  try {
    const schema = {
      type: "object",
      properties: Object.fromEntries(
        fields.map(([name, field]) => [
          name,
          {
            ...(field.type === "text"
              ? { type: ["string", "null"] }
              : { type: "array", items: { type: "string" } }),
            description: field.instructions,
          },
        ]),
      ),
      required: fields.map(([name]) => name),
      additionalProperties: false,
    };
    const promptSchema = Object.fromEntries(
      fields.map(([name, field]) => [
        name,
        field.type === "text"
          ? field.instructions || "Exact quotation, or null"
          : [field.instructions || "Exact quotations, or an empty list"],
      ]),
    );
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 1200,
        response_format: {
          type: "json_schema",
          json_schema: { name: "manuscript_extraction", strict: true, schema },
        },
        messages: [
          {
            role: "system",
            content:
              "Return data as a JSON object with the following schema:\n" +
              JSON.stringify(promptSchema) +
              "\nCopy the wording exactly. Use null or an empty list when the source gives no answer.",
          },
          { role: "user", content: source },
        ],
      }),
    });
    if (!response.ok) throw new Error("Local extraction unavailable");
    const payload = await response.json();
    const choice = payload?.choices?.[0];
    if (
      choice?.finish_reason !== "stop" ||
      typeof choice.message?.content !== "string"
    )
      throw new Error("Incomplete extraction");
    const data: unknown = JSON.parse(choice.message.content);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Invalid extraction");
    const values = data as Record<string, unknown>;
    const answers = Object.fromEntries(
      fields.map(([name, field]): [string, ExtractionAnswer] => {
        const raw = values[name];
        if (!Object.hasOwn(values, name))
          throw new Error("Missing extraction field");
        if (field.type === "text") {
          if (raw !== null && typeof raw !== "string")
            throw new Error("Invalid text extraction");
          const span = typeof raw === "string" ? uniqueSpan(source, raw) : null;
          return [
            name,
            {
              type: "text",
              value: span ? raw : null,
              ...(span ? { span } : {}),
            },
          ];
        }
        if (!Array.isArray(raw)) throw new Error("Invalid extraction list");
        const matches = [...new Set(raw)]
          .flatMap((value) => {
            const span =
              typeof value === "string" ? uniqueSpan(source, value) : null;
            return span ? [{ span, value }] : [];
          })
          .sort((a, b) => a.span[0] - b.span[0]);
        const spans: [number, number][] = [];
        const value: string[] = [];
        for (const match of matches) {
          if (match.span[0] < (spans.at(-1)?.[1] ?? 0)) continue;
          spans.push(match.span);
          value.push(match.value);
        }
        return [name, { type: "list", value, spans }];
      }),
    );
    return {
      ok: true,
      model: MODEL,
      transport: "local",
      truncated: false,
      answers: validateExtractionAnswers(request, answers, undefined, "utf16"),
    };
  } catch {
    return { ok: false, transport: "local", error: "provider" };
  }
}
