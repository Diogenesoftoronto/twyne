/**
 * The quote tool the editorial personas call to pin a note to an exact
 * passage from the draft.
 *
 * Instead of asking the model to retype a passage (which it paraphrases,
 * truncates, or invents), we hand it a `quote_passage` tool: it passes the
 * sentence it is responding to, and the tool fuzzy-resolves that against the
 * actual draft and returns the *canonical* verbatim text. The resolved
 * passage is captured as the note's anchor, so the anchor always comes from
 * the draft itself rather than from the model's typing.
 *
 * Shared by both code paths:
 *  - the client BYOK path in `src/utils/ai-client.ts`
 *  - the Convex server path in `convex/agents.ts`
 *
 * Intentionally no `"use node";` directive and no zod dependency: this is
 * pure string assembly plus the AI SDK's `tool`/`jsonSchema` helpers, so it
 * bundles cleanly in the Vite client too.
 */
import { tool, jsonSchema, type ToolSet } from "ai";
import {
  selectPassageWindow,
  type PassageRange,
} from "../src/utils/passage-window";
import {
  validatePersonaFields,
  validatePersonaQuestions,
  type PersonaResearch,
  type PersonaExtractionReading,
  type PersonaExtractionAnswer,
} from "../src/utils/persona-research";
import type { ExtractionField } from "../src/utils/extraction";
import type { JudgementQuestion } from "./lib/judgementContract";

/* ── Draft passage resolution (verbatim + fuzzy match) ──────────── */

/**
 * Resolve a (possibly approximate) quote against the draft, returning the
 * exact text as it appears in the draft, or undefined when it cannot be
 * matched. Used to be `persona-anchors.extractDynamicFeedbackAnchor`'s
 * inner matcher; now the single source of truth for both anchoring and the
 * quote tool.
 */
export function resolveDraftPassage(
  quote: string | undefined,
  draftText: string,
): string | undefined {
  const cleaned = quote?.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.split(/\s+/).length < 3) return undefined;
  if (draftText.includes(cleaned)) return cleaned;

  const normalizedQuote = normalizeText(cleaned);
  if (!normalizedQuote) return undefined;

  for (const passage of draftPassages(draftText)) {
    const normalizedPassage = normalizeText(passage);
    if (
      normalizedPassage === normalizedQuote ||
      normalizedPassage.includes(normalizedQuote)
    ) {
      return passage;
    }
  }
  return undefined;
}

/** Split a draft into candidate passages: each sentence and each paragraph. */
export function draftPassages(draftText: string): string[] {
  const passages: string[] = [];
  for (const paragraph of draftText.split(/\n+/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    const sentences = trimmed.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [];
    passages.push(...sentences.map((s) => s.trim()));
    passages.push(trimmed);
  }
  return passages;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'" ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first substantive sentence of a draft — a deterministic anchor for the
 * local fallback generator, which has no model and so cannot call the tool.
 */
export function firstSubstantiveSentence(
  draftText: string,
): string | undefined {
  for (const passage of draftPassages(draftText)) {
    if (passage.split(/\s+/).length >= 4) return passage;
  }
  return undefined;
}

/* ── The quote tool ─────────────────────────────────────────────── */

export interface QuoteTools {
  /** Pass to `generateText({ tools })`. */
  tools: ToolSet;
  /** The first passage the model successfully quoted, used as the anchor. */
  getAnchor: () => string | undefined;
  getAnchors: () => string[];
  getExtractions: () => PersonaExtractionReading[];
}

/**
 * Build a `quote_passage` tool bound to one draft. The execute closure records
 * every resolved passage so the caller can read back the anchor after
 * generation completes.
 */
export function buildQuoteTools(
  draftText: string,
  research?: PersonaResearch,
): QuoteTools {
  const resolved: string[] = [];
  const extractions: PersonaExtractionReading[] = [];
  const capture = (passage: string) => {
    if (!resolved.includes(passage) && resolved.length < 24)
      resolved.push(passage);
  };
  const safe = async (run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch {
      return {
        ok: false,
        error:
          "Research unavailable or invalid arguments. Continue with the passages already found.",
      };
    }
  };

  const tools: ToolSet = {
    quote_passage: tool({
      description:
        "Look up the exact text of a passage from the writer's draft. " +
        "Pass the sentence (or a close approximation of it) you are " +
        "responding to; the tool returns the verbatim text as it appears " +
        "in the draft. Call this before making any claim about the draft so " +
        "your note pins to the real passage. Do not retype passages by hand.",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The sentence or short passage from the draft you want to quote.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: async ({ query }) => {
        const passage =
          typeof query === "string"
            ? resolveDraftPassage(query, draftText)
            : undefined;
        if (passage) {
          capture(passage);
          return { found: true, passage };
        }
        return {
          found: false,
          passage: null,
          note: "No matching passage found in the draft. Quote something the writer actually wrote.",
        };
      },
    }),
  };

  if (research?.extract) {
    tools.find_passages = tool({
      description:
        "Find verbatim draft passages about a topic before claiming a pattern. Returns source offsets and records several anchors. A selected window is partial coverage of a long manuscript.",
      inputSchema: jsonSchema<{ about: string; max?: number }>({
        type: "object",
        properties: {
          about: { type: "string", minLength: 1, maxLength: 1200 },
          max: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["about"],
        additionalProperties: false,
      }),
      execute: async ({ about, max }) =>
        safe(async () => {
          if (typeof about !== "string" || !about.trim())
            return { ok: false, error: "Supply a topic." };
          const limit =
            typeof max === "number" && Number.isFinite(max)
              ? Math.max(1, Math.min(8, Math.floor(max)))
              : 4;
          const window = selectPassageWindow(draftText, about.slice(0, 1200));
          if (!research.reserve())
            return {
              ok: false,
              error: "Research budget reached. Finish the note.",
            };
          const result = await research.extract!({
            state: window.state,
            fields: {
              passages: {
                type: "list",
                items: "text",
                instructions: `Up to ${limit} passages about: ${about.slice(0, 1200)}`,
              },
            },
          });
          if (!result.ok)
            return { ok: false, error: "Passage search unavailable." };
          const answer = result.answers?.passages;
          const passages =
            answer?.value == null
              ? []
              : (answer.spans ?? [])
                  .slice(0, limit)
                  .map((span) => window.resolve(span))
                  .filter((p): p is PassageRange => p !== null);
          passages.forEach((p) => capture(p.passage));
          return {
            ok: true,
            passages,
            partial: window.truncated || !!result.truncated,
          };
        }),
    });
    tools.extract = tool({
      description:
        "Read typed facts from the draft: dates, ages, durations, counts and names for continuity. Use 1–12 named fields. Null value with guess is a near miss, not an established fact. Returns values plainly; do not ask extraction to perform arithmetic.",
      inputSchema: jsonSchema<{ fields: Record<string, ExtractionField> }>({
        type: "object",
        properties: {
          fields: {
            type: "object",
            minProperties: 1,
            maxProperties: 12,
            additionalProperties: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "text",
                    "number",
                    "date",
                    "time",
                    "datetime",
                    "duration",
                    "list",
                    "estimate",
                    "forecast",
                  ],
                },
                instructions: { type: "string", maxLength: 1200 },
                unit: { type: "string" },
                integer: { type: "boolean" },
                decimals: { type: "integer" },
                items: { enum: ["text", "number", "date"] },
                min: { type: ["number", "string"] },
                max: { type: ["number", "string"] },
                step: { type: ["number", "string"] },
                scale: { enum: ["linear", "log"] },
                null_threshold: { type: "number" },
                horizon: { type: "integer" },
                interval: {
                  enum: [
                    "step",
                    "minute",
                    "hour",
                    "day",
                    "week",
                    "month",
                    "quarter",
                    "year",
                  ],
                },
              },
              required: ["type"],
              additionalProperties: false,
            },
          },
        },
        required: ["fields"],
        additionalProperties: false,
      }),
      execute: async ({ fields: input }) =>
        safe(async () => {
          const fields = validatePersonaFields(input);
          const window = selectPassageWindow(
            draftText,
            Object.values(fields)
              .map((f) => f.instructions ?? "")
              .join(" "),
          );
          if (!research.reserve())
            return {
              ok: false,
              error: "Research budget reached. Finish the note.",
            };
          const result = await research.extract!({
            state: window.state,
            fields,
          });
          if (!result.ok)
            return { ok: false, error: "Fact extraction unavailable." };
          const answers: Record<string, PersonaExtractionAnswer> =
            Object.fromEntries(
              Object.entries(result.answers ?? {}).map(([id, answer]) => {
                const source = window.resolve(answer.span);
                const passages = (answer.spans ?? [])
                  .map((s) => window.resolve(s))
                  .filter((p): p is PassageRange => p !== null);
                if (answer.value != null) {
                  if (answer.type === "text" && source) capture(source.passage);
                  if (answer.type === "list" && fields[id]?.items === "text")
                    passages.forEach((p) => capture(p.passage));
                }
                const plain = { ...answer };
                delete plain.span;
                delete plain.spans;
                return [
                  id,
                  {
                    ...plain,
                    ...(source
                      ? { span: [source.from, source.to] as [number, number] }
                      : {}),
                    spans: passages.map((p): [number, number] => [
                      p.from,
                      p.to,
                    ]),
                    ...(answer.type === "text"
                      ? {
                          value:
                            answer.value === null
                              ? null
                              : (source?.passage ?? null),
                          guess:
                            answer.guess != null
                              ? (source?.passage ?? null)
                              : null,
                        }
                      : {}),
                    ...(answer.type === "list" && fields[id]?.items === "text"
                      ? {
                          value:
                            answer.value === null
                              ? null
                              : passages.map((p) => p.passage),
                          guess:
                            answer.guess != null
                              ? passages.map((p) => p.passage)
                              : null,
                        }
                      : {}),
                    source,
                    passages,
                  },
                ];
              }),
            );
          const reading = {
            fields,
            answers,
            partial: window.truncated || !!result.truncated,
          };
          extractions.push(reading);
          return {
            ok: true,
            ...reading,
          };
        }),
    });
  }
  if (research?.judge) {
    tools.judge = tool({
      description:
        "Judge relationships between passages already returned by quote_passage, find_passages or extract. Write up to 8 noul (p yes), choice or score questions; choice/score need ordered criteria. Returns probabilities, not new facts.",
      inputSchema: jsonSchema<{
        passages: string[];
        questions: Record<string, JudgementQuestion>;
      }>({
        type: "object",
        properties: {
          passages: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 8,
          },
          questions: {
            type: "object",
            minProperties: 1,
            maxProperties: 8,
            additionalProperties: {
              type: "object",
              properties: {
                type: { enum: ["noul", "choice", "score"] },
                instructions: { type: "string", maxLength: 1200 },
                criteria: {
                  type: "array",
                  items: { type: "string", maxLength: 300 },
                  minItems: 2,
                  maxItems: 12,
                },
              },
              required: ["type", "instructions"],
              additionalProperties: false,
            },
          },
        },
        required: ["passages", "questions"],
        additionalProperties: false,
      }),
      execute: async ({ passages, questions: input }) =>
        safe(async () => {
          const questions = validatePersonaQuestions(input);
          if (
            !Array.isArray(passages) ||
            !passages.length ||
            passages.length > 8 ||
            passages.some((p) => !resolved.includes(p)) ||
            passages.join("").length > 24_000
          )
            return {
              ok: false,
              error:
                "Use up to 8 passages already found, at most 24000 characters.",
            };
          if (!research.reserve())
            return {
              ok: false,
              error: "Research budget reached. Finish the note.",
            };
          const result = await research.judge!({
            state: Object.fromEntries(
              passages.map((p, i) => [`passage_${i + 1}`, p]),
            ),
            questions,
          });
          return result.ok
            ? { ok: true, answers: result.answers }
            : { ok: false, error: "Passage judgement unavailable." };
        }),
    });
  }

  return {
    tools,
    getAnchor: () => resolved[0],
    getAnchors: () => [...resolved],
    getExtractions: () => [...extractions],
  };
}
