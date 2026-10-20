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
      if (answer.value === null) {
        return answer.guess != null
          ? { status: "near", ...source, pNull: answer.p_null ?? 1 }
          : literal;
      }
      // The span only proposes text; the deterministic matcher still owns anchoring.
      const checked = resolveQuotation(source.passage, draft, context);
      return checked.status === "resolved" ? checked : literal;
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

/** Mounted notes share in-flight work and completed results for one draft snapshot. */
export function createGroundingAssistCache(maxEntries = 128) {
  const cache = new Map<string, Promise<AssistedQuotation[]>>();
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
    if (existing) return existing;
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
    cache.set(key, pending);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return pending;
  };
}

export const assistGroundedNote = createGroundingAssistCache();
