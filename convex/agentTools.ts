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
export function firstSubstantiveSentence(draftText: string): string | undefined {
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
}

/**
 * Build a `quote_passage` tool bound to one draft. The execute closure records
 * every resolved passage so the caller can read back the anchor after
 * generation completes.
 */
export function buildQuoteTools(draftText: string): QuoteTools {
  const resolved: string[] = [];

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
        const passage = resolveDraftPassage(query, draftText);
        if (passage) {
          resolved.push(passage);
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

  return {
    tools,
    getAnchor: () => resolved[0],
  };
}
