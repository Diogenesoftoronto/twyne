import {
  groundQuotations,
  quotationCandidates,
  resolveQuotation,
  type GroundedQuotation,
  type QuoteResolution,
} from "./quote-grounding";
import { selectPassageWindow, manuscriptParagraphs } from "./passage-window";
import type { PersonaResearch } from "./persona-research";

export type AssistedQuoteResolution =
  | QuoteResolution
  | {
      status: "near";
      from: number;
      to: number;
      passage: string;
      pNull: number;
    };
export interface AssistedQuotation
  extends Omit<GroundedQuotation, "resolution"> {
  resolution: AssistedQuoteResolution;
}

/** A near miss is returned as data; it never becomes an exact quote link. */
export async function assistQuotation(
  quote: string,
  draft: string,
  context: string,
  research: PersonaResearch,
): Promise<AssistedQuoteResolution> {
  const literal = resolveQuotation(quote, draft, context);
  if (literal.status === "resolved") return literal;
  try {
    if (literal.status === "unmatched" && research.extract) {
      const window = selectPassageWindow(
        draft,
        `${quote} ${context}`,
        24_000,
        5,
      );
      if (!window.state || !research.reserve()) return literal;
      const result = await research.extract({
        state: window.state,
        fields: {
          passage: {
            type: "text",
            instructions: `The passage this note quotes or paraphrases: ${quote.slice(0, 1200)}. Note context: ${context.slice(0, 1600)}`,
          },
        },
      });
      const answer = result.ok ? result.answers?.passage : undefined;
      const source = window.resolve(answer?.span);
      if (!answer || !source) return literal;
      if (answer.value == null && answer.guess == null) return literal;
      // A valid span proves where the proposed passage is, not that the note
      // quotes it. Only the original quotation can earn an exact quote link.
      return { status: "near", ...source, pNull: answer.p_null ?? 1 };
    }
    if (literal.status === "ambiguous" && research.judge) {
      const candidates = quotationCandidates(quote, draft);
      // Do not silently omit an occurrence from a choice.
      if (candidates.length < 2 || candidates.length > 8) return literal;
      const paragraphs = manuscriptParagraphs(draft);
      const options = candidates.map((_, i) => `occurrence_${i + 1}`);
      const state = Object.fromEntries(
        candidates.map((p, i) => [
          options[i],
          JSON.stringify({
            ...p,
            paragraph:
              paragraphs.find(
                (block) => p.from >= block.from && p.to <= block.to,
              )?.passage ?? draft.slice(Math.max(0, p.from - 400), p.to + 400),
          }),
        ]),
      );
      if (Object.values(state).join("").length > 24_000 || !research.reserve())
        return literal;
      const result = await research.judge({
        state: {
          ...state,
          note_context: context.slice(0, 2400),
          quotation: quote.slice(0, 1200),
        },
        questions: {
          occurrence: {
            type: "choice",
            instructions:
              "Which occurrence does this note refer to, given its context and each occurrence's paragraph? Choose none when the context does not distinguish them.",
            criteria: [...options, "none"],
          },
        },
      });
      const answer = result.ok
        ? (result.answers?.occurrence as
            | { probabilities?: Record<string, number> }
            | undefined)
        : undefined;
      const probabilities = answer?.probabilities;
      if (!probabilities) return literal;
      const ranked = [...options, "none"]
        .map((id) => ({ id, p: probabilities[id] }))
        .sort((a, b) => b.p - a.p);
      if (ranked.some((p) => !Number.isFinite(p.p) || p.p < 0 || p.p > 1))
        return literal;
      const [best, second] = ranked;
      if (best.id === "none" || best.p < 0.85 || best.p - second.p < 0.25)
        return literal;
      return { status: "resolved", ...candidates[options.indexOf(best.id)] };
    }
  } catch {
    // Keep the deterministic result on transport, budget or malformed-answer failure.
  }
  return literal;
}

/** Share in-flight work and successful results; unresolved notes can retry later. */
export function createGroundingAssistCache(
  maxEntries = 128,
  unresolvedTtlMs = 30_000,
  now = Date.now,
) {
  const cache = new Map<
    string,
    { pending: Promise<AssistedQuotation[]>; expiresAt: number }
  >();
  return async (
    note: string,
    draft: string,
    research: PersonaResearch,
  ): Promise<AssistedQuotation[]> => {
    const bytes = new TextEncoder().encode(draft);
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const key = `${hash}:${note}`;
    const existing = cache.get(key);
    if (existing && existing.expiresAt > now()) return existing.pending;
    cache.delete(key);
    const pending = (async () => {
      const grounded = groundQuotations(note, draft);
      const out: AssistedQuotation[] = [];
      let attempted = 0;
      for (const q of grounded) {
        out.push({
          ...q,
          resolution:
            q.resolution.status === "resolved" || attempted++ >= 4
              ? q.resolution
              : await assistQuotation(q.quote, draft, q.context, research),
        });
      }
      return out;
    })();
    const entry = { pending, expiresAt: Infinity };
    cache.set(key, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    try {
      const result = await pending;
      if (
        result.some(
          (q) =>
            q.resolution.status === "unmatched" ||
            q.resolution.status === "ambiguous",
        )
      )
        entry.expiresAt = now() + unresolvedTtlMs;
      return result;
    } catch (error) {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    }
  };
}

export const assistGroundedNote = createGroundingAssistCache();
