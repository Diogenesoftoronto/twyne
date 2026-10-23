/**
 * Suggested rewrites through `twyne_suggest_rewrite`.
 *
 * A rewrite has to change the passage, keep the facts that make it the
 * writer's, and respect the size rule the prompt states (one sentence, or no
 * longer than the original paragraph). The judge, when enabled, decides
 * whether the stated problem was actually fixed.
 *
 * With `--jev`, Jev splits the judge's one word into the parts it is made
 * of: how much of the stated problem is left, how much of the original's
 * meaning survived, whether the rewrite invents a fact or a source, whether
 * it still fits the sentences around it, and, fact by fact, whether what the
 * corpus says must survive did. `jev_rewrite` weighs the first three.
 */
import {
  askJev,
  jevComposite,
  jevNot,
  jevRewriteRequest,
  jevShare,
  judged,
  judgeRewrite,
} from "../judges";
import { jaccard, keepsFact, pass, ratio, words, type Score } from "../scoring";
import { readJsonl } from "./load";
import type { ProjectBrief, Suite } from "./types";

export interface RewriteCase {
  case_id: string;
  personaId: string;
  level: "sentence" | "paragraph";
  brief: ProjectBrief;
  draftText: string;
  original: string;
  problem: string;
  mustPreserve: string[];
  /** Rewrites of passages in the same draft are not independent. */
  cluster?: string;
}

interface RewriteResult {
  replacement?: string;
  rationale?: string;
  provider?: string;
}

function sentenceCount(text: string): number {
  return (text.match(/[.!?]+(\s|$)/g) ?? []).length || 1;
}

/** A short stable name for a draft, so rewrites of one draft share a cluster. */
function draftKey(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `draft-${(h >>> 0).toString(16)}`;
}

/** How much each part counts in `jev_rewrite`: the fix first, then the rest. */
const REWRITE_WEIGHTS = { fixes: 0.5, meaning: 0.3, fits: 0.2 };

export const rewriteSuite: Suite<RewriteCase> = {
  name: "rewrite",
  surface: "MCP twyne_suggest_rewrite",
  load: () =>
    readJsonl<RewriteCase>("app/cases/rewrite.jsonl").map((testCase) => ({
      ...testCase,
      cluster: draftKey(testCase.draftText),
    })),

  async run({ mcp }, testCase) {
    const raw = await mcp.call("twyne_suggest_rewrite", {
      personaId: testCase.personaId,
      draftText: testCase.draftText,
      original: testCase.original,
      level: testCase.level,
      brief: testCase.brief,
    });
    const result = raw as RewriteResult;
    return {
      raw,
      output: `${result.replacement ?? ""}\n\n(${testCase.personaId}, ${result.provider ?? "?"}) ${result.rationale ?? ""}`,
    };
  },

  async score({ judge, jev }, testCase, raw) {
    const result = raw as RewriteResult;
    const replacement = result.replacement?.trim() ?? "";
    const kept = testCase.mustPreserve.filter((fact) =>
      keepsFact(replacement, fact),
    );
    const originalWords = words(testCase.original).length;
    const replacementWords = words(replacement).length;
    const lengthOk =
      testCase.level === "sentence"
        ? sentenceCount(replacement) <= 1 &&
          replacementWords <= Math.ceil(originalWords * 1.5) + 5
        : replacementWords <= Math.ceil(originalWords * 1.15);
    const scores: Record<string, Score> = {
      contract: pass(
        replacement.length > 0 && replacement !== testCase.original.trim(),
        replacement ? undefined : "no replacement returned",
      ),
      hosted: pass(
        !!result.provider && result.provider !== "local",
        result.provider,
      ),
      preserves_facts: {
        score: ratio(kept.length, testCase.mustPreserve.length) ?? 1,
        explanation:
          `${kept.length}/${testCase.mustPreserve.length} kept` +
          (kept.length < testCase.mustPreserve.length
            ? `; dropped ${testCase.mustPreserve.filter((fact) => !kept.includes(fact)).join(", ")}`
            : ""),
        items: Object.fromEntries(
          testCase.mustPreserve.map((fact, i) => [
            `f${i + 1}`,
            kept.includes(fact) ? 1 : 0,
          ]),
        ),
      },
      size_rule: pass(
        lengthOk,
        `${replacementWords} words vs ${originalWords} in the original (${testCase.level})`,
      ),
      changed: pass(
        jaccard(testCase.original, replacement) < 0.85,
        "the replacement is not a near-copy of the original",
      ),
    };

    const readings = jev
      ? (async (): Promise<Record<string, Score>> => {
          if (!replacement) {
            const absent: Score = {
              score: 0,
              label: "absent",
              explanation: "no replacement",
            };
            return Object.fromEntries(
              [
                "jev_fixes_problem",
                "jev_keeps_meaning",
                "jev_fits_context",
                "jev_no_invention",
                "jev_keeps_facts",
                "jev_rewrite",
              ].map((k) => [k, absent]),
            );
          }
          const request = jevRewriteRequest({
            problem: testCase.problem,
            original: testCase.original,
            replacement,
            draft: testCase.draftText,
            facts: testCase.mustPreserve,
          });
          const answers = await askJev(jev, request.state, request.questions);
          const fits = answers.fits;
          return {
            jev_fixes_problem: answers.jev_fixes_problem,
            jev_keeps_meaning: answers.jev_keeps_meaning,
            jev_fits_context:
              typeof fits?.score === "number"
                ? { ...fits, label: fits.score >= 0.5 ? "fits" : "breaks flow" }
                : fits,
            jev_no_invention: jevNot(
              answers.invents,
              "nothing invented",
              "invents",
            ),
            jev_keeps_facts: jevShare(answers, request.factIds, {
              emptyLabel: "no facts listed",
            }),
            jev_rewrite: jevComposite([
              [answers.jev_fixes_problem, REWRITE_WEIGHTS.fixes],
              [answers.jev_keeps_meaning, REWRITE_WEIGHTS.meaning],
              [answers.fits, REWRITE_WEIGHTS.fits],
            ]),
          };
        })()
      : null;

    if (judge) {
      scores.improves = await judged(async () => {
        if (!replacement)
          return { score: 0, label: "absent", explanation: "no replacement" };
        const verdict = await judgeRewrite(judge, {
          draft: testCase.draftText,
          original: testCase.original,
          problem: testCase.problem,
          replacement,
        });
        return {
          score: verdict.score,
          label: verdict.score === null ? "judge-error" : verdict.label,
          explanation: verdict.explanation,
        };
      });
    }
    if (readings) Object.assign(scores, await readings);
    return scores;
  },

  example: (testCase) => ({
    case_id: testCase.case_id,
    personaId: testCase.personaId,
    level: testCase.level,
    draftText: testCase.draftText,
    original: testCase.original,
    problem: testCase.problem,
    mustPreserve: JSON.stringify(testCase.mustPreserve),
    brief: JSON.stringify(testCase.brief),
  }),
};
