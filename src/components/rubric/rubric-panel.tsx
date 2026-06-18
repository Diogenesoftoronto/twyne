import { component$, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import type { ProjectBrief } from "../../types";
import { loadDraftText, summarizeBrief } from "../../utils/anti-tabula-rasa";
import {
  scoreStaticFeatures,
  combineJudgesAndStatic,
  type StaticScore,
  type JudgeResult,
} from "../../utils/rubric";
import {
  loadRubricResultFromIdb,
  saveRubricResultToIdb,
  loadAiSettingsFromIdb,
} from "../../utils/idb";
import type { AiSettings } from "../../types";
import { runClientJudge, normalizeAiSettings } from "../../utils/ai-client";
import { draftReadiness, MIN_RUBRIC_WORDS } from "../../utils/draft-thresholds";

interface RubricStore {
  result: RubricResult | null;
  isAnalyzing: boolean;
  error: string | null;
  judges: JudgeResult[];
  static: StaticScore | null;
  brief: ProjectBrief | null;
  aiSettings: AiSettings | null;
}

interface RubricCriterion {
  id: string;
  label: string;
  description: string;
  score: number;
  maxScore: number;
  feedback: string;
}

interface RubricResult {
  criteria: RubricCriterion[];
  overallScore: number;
  overallGrade: string;
  summary: string;
  timestamp: number;
  judges: JudgeResult[];
  staticScore: StaticScore;
}

interface RubricPanelProps {
  brief: ProjectBrief | null;
}

export const RubricPanel = component$(({ brief }: RubricPanelProps) => {
  const clientSig = useConvexClient();
  const store = useStore<RubricStore>({
    result: null,
    isAnalyzing: false,
    error: null,
    judges: [],
    static: null,
    brief: null,
    aiSettings: null,
  });

  const analyze = $(async () => {
    store.isAnalyzing = true;
    store.error = null;
    try {
      const draftText = await loadDraftText();
      const client = clientSig.value;
      const readiness = draftReadiness(draftText, MIN_RUBRIC_WORDS);
      if (!readiness.ok) {
        store.static = scoreStaticFeatures(draftText);
        store.judges = [];
        store.result = null;
        store.error = readiness.message;
        return;
      }

      // 1. Run the static-feature scorer in the browser (cheap, deterministic).
      const staticScore = scoreStaticFeatures(draftText);
      store.static = staticScore;

      // 2. Run the five personas as judges. Try client AI first (BYOK),
      //    then Convex server action, then local heuristic.
      let judges: JudgeResult[] = [];

      const settings = store.aiSettings;
      if (settings?.advancedMode && settings.providers.length > 0) {
        try {
          const personas = defaultPersonas();
          const tasks = personas.map(async (p) => {
            const res = await runClientJudge(
              {
                persona: {
                  id: p.id,
                  name: p.name,
                  role: p.role,
                  description: p.description,
                  focus: p.focus,
                  color: p.color,
                  icon: p.icon,
                },
                brief: brief ?? null,
                draftText,
                instruction: "feedback",
              },
              settings,
            );
            return {
              personaId: p.id,
              score: res?.score ?? 5,
              rationale:
                res?.rationale ??
                "The draft is partial; the work to come is the interesting part.",
              provider: res ? `client-${res.provider}` : "local",
            } as JudgeResult;
          });
          judges = await Promise.all(tasks);
        } catch (err) {
          console.warn("[twyne:rubric] client judges failed:", err);
        }
      }

      if (judges.length === 0 && client) {
        try {
          const personasForServer = defaultPersonas().map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            description: p.description,
            focus: p.focus,
            color: p.color,
            icon: p.icon,
          }));
          judges = (await client.action(api.agents.judgeRoom, {
            personas: personasForServer,
            brief: brief ?? null,
            draftText,
          })) as JudgeResult[];
        } catch (err) {
          store.error = (err as Error).message ?? "Judges unavailable.";
          judges = localJudges(draftText, brief);
        }
      }

      if (judges.length === 0) {
        judges = localJudges(draftText, brief);
      }
      if (judges.every((j) => j.provider === "local")) {
        store.error =
          "Rubric used local fallback judges. Production LLM calls are not configured or failed; set BIFROST_BASE_URL, RIVET_ENDPOINT, ANTHROPIC_API_KEY, or OPENAI_API_KEY in Convex.";
      }
      store.judges = judges;

      // 3. Combine into a brutal grade.
      const combined = combineJudgesAndStatic(judges, staticScore, brief);
      const criteria = buildCriteria(
        staticScore,
        judges,
        combined.combined,
        brief,
      );

      const result: RubricResult = {
        criteria,
        overallScore: combined.combined,
        overallGrade: combined.grade,
        summary: combined.summary,
        timestamp: Date.now(),
        judges,
        staticScore,
      };
      store.result = result;
      void saveRubricResultToIdb(result);
    } finally {
      store.isAnalyzing = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const cached = await loadRubricResultFromIdb();
    if (cached && !store.result) {
      store.result = cached;
      store.judges = cached.judges ?? [];
      store.static = cached.staticScore ?? null;
    }
    const aiRaw = await loadAiSettingsFromIdb();
    store.aiSettings = normalizeAiSettings(aiRaw);
  });

  const getScoreColor = (score: number, max: number) => {
    const pct = score / max;
    if (pct >= 0.8) return "var(--color-accent-green)";
    if (pct >= 0.6) return "var(--color-accent-amber)";
    return "var(--color-accent-red)";
  };

  const getGradeColor = (grade: string) => {
    if (grade.startsWith("A")) return "text-[var(--color-accent-green)]";
    if (grade.startsWith("B")) return "text-[var(--color-accent-blue)]";
    if (grade.startsWith("C")) return "text-[var(--color-accent-amber)]";
    return "text-[var(--color-accent-red)]";
  };

  return (
    <div class="flex flex-col h-full bg-[var(--color-paper-2)]">
      <div class="px-5 py-4 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
        <p class="dept-label">Dept. of Rigor</p>
        <h2
          class="mt-0.5 text-xl text-[var(--color-ink)]"
          style="font-family: var(--font-display); font-weight: 600;"
        >
          The Galley Proof
        </h2>
        <p
          class="mt-2 text-xs leading-5 text-[var(--color-ink-light)]"
          style="font-family: var(--font-serif); font-style: italic;"
        >
          {summarizeBrief(brief)}
        </p>
      </div>

      {!store.result && !store.isAnalyzing && (
        <div class="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
          <p
            class="text-4xl"
            style="font-family: var(--font-display); color: var(--color-cobalt);"
          >
            ❧
          </p>
          <p
            class="mt-3 text-sm text-[var(--color-ink-light)] max-w-xs leading-6"
            style="font-family: var(--font-serif); font-style: italic;"
          >
            Send the galley to the proof desk. Five judges read it, then the
            rubric counts features the eye can't see.
          </p>
          <button onClick$={analyze} class="btn-press mt-5">
            Send to copyedit
          </button>
          {store.error && (
            <p
              class="mt-3 max-w-sm text-xs leading-5 text-[var(--color-vermilion)]"
              style="font-family: var(--font-typewriter);"
              role="alert"
            >
              {store.error}
            </p>
          )}
        </div>
      )}

      {store.isAnalyzing && (
        <div
          class="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center"
          role="status"
        >
          <div
            class="text-4xl animate-spin"
            aria-hidden="true"
            style="font-family: var(--font-display); color: var(--color-cobalt);"
          >
            ✦
          </div>
          <p
            class="mt-4 text-sm text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter); letter-spacing: 0.15em; text-transform: uppercase;"
          >
            Five judges reading…
          </p>
          <p
            class="mt-2 text-[11px] text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter); letter-spacing: 0.15em;"
          >
            Measuring sentence cadence, citation density, paragraph shape
          </p>
        </div>
      )}

      {store.result && !store.isAnalyzing && (
        <div class="flex-1 overflow-y-auto">
          {/* Overall score */}
          <div class="px-5 py-5 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
            <div class="flex items-stretch gap-4">
              <div
                class={`flex-shrink-0 w-20 h-20 flex items-center justify-center ${getGradeColor(store.result.overallGrade)}`}
                role="img"
                aria-label={`Overall grade ${store.result.overallGrade}, ${store.result.overallScore} of 100`}
                style={{
                  borderRadius: "999px",
                  border: "2.5px solid currentColor",
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: "2.25rem",
                  lineHeight: 1,
                  fontStyle: "italic",
                  transform: "rotate(-4deg)",
                  background: "rgba(255,255,255,0.4)",
                }}
              >
                {store.result.overallGrade}
              </div>
              <div class="flex-1 min-w-0">
                <p class="dept-label">Editor's Mark</p>
                <p
                  class="mt-0.5 text-lg text-[var(--color-ink)]"
                  style="font-family: var(--font-display); font-weight: 600;"
                >
                  {store.result.overallScore}
                  <span class="text-sm text-[var(--color-ink-muted)]">
                    {" "}
                    / 100
                  </span>
                </p>
                <p
                  class="mt-1.5 text-xs leading-5 text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif); font-style: italic;"
                >
                  {store.result.summary}
                </p>
              </div>
            </div>

            {/* Per-judge scorecard */}
            <div class="mt-4 pt-4 border-t border-dashed border-[var(--color-paper-3)]">
              <p class="dept-label">The Judges' Verdict</p>
              {store.error && (
                <p
                  class="mt-1 text-[11px] leading-5 text-[var(--color-vermilion)]"
                  style="font-family: var(--font-typewriter);"
                  role="alert"
                >
                  {store.error}
                </p>
              )}
              <ul class="mt-2 space-y-1.5">
                {store.result.judges.map((j) => (
                  <li
                    key={j.personaId}
                    class="flex items-start gap-2 text-[12px] leading-5"
                  >
                    <span
                      class="font-mono flex-shrink-0 w-6 text-right"
                      style={{
                        color:
                          j.score >= 7
                            ? "var(--color-accent-green)"
                            : j.score >= 4
                              ? "var(--color-accent-amber)"
                              : "var(--color-accent-red)",
                        fontWeight: 600,
                      }}
                    >
                      {j.score}
                    </span>
                    <span
                      class="flex-1 text-[var(--color-ink-light)]"
                      style="font-family: var(--font-serif); font-style: italic;"
                    >
                      <span class="not-italic font-semibold text-[var(--color-ink)]">
                        {j.personaId}
                      </span>
                      {" — "}
                      {j.rationale}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Criteria */}
          <div class="px-4 py-4 space-y-3">
            {store.result.criteria.map((criterion, idx) => (
              <RubricCriterionCard
                key={criterion.id}
                criterion={criterion}
                index={idx + 1}
                scoreColor={getScoreColor(criterion.score, criterion.maxScore)}
              />
            ))}
          </div>

          <div class="px-4 py-3 border-t border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] space-y-2">
            <Link
              href="/rubric"
              class="block w-full text-center text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
              style="font-family: var(--font-typewriter); letter-spacing: 0.12em; text-transform: uppercase;"
            >
              Expand ↗ Full galley report
            </Link>
            <button onClick$={analyze} class="btn-paper w-full">
              ↻ Send back for re-reading
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

function RubricCriterionCard({
  criterion,
  scoreColor,
  index,
}: {
  criterion: RubricCriterion;
  scoreColor: string;
  index: number;
}) {
  const pct = Math.round((criterion.score / criterion.maxScore) * 100);
  const roman =
    ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][index - 1] ||
    `${index}`;

  return (
    <div
      class="bg-[var(--color-paper)] border border-[var(--color-paper-3)] p-4"
      style="border-radius: 2px;"
    >
      <div class="flex items-baseline justify-between gap-3 mb-2">
        <div class="flex items-baseline gap-2 min-w-0">
          <span
            class="text-xs flex-shrink-0"
            style={{
              fontFamily: "var(--font-typewriter)",
              color: "var(--color-ink-muted)",
              letterSpacing: "0.15em",
            }}
          >
            §{roman}
          </span>
          <span
            class="text-sm text-[var(--color-ink)] truncate"
            style="font-family: var(--font-display); font-weight: 600;"
          >
            {criterion.label}
          </span>
        </div>
        <span
          class="text-xs flex-shrink-0"
          style={{
            color: scoreColor,
            fontFamily: "var(--font-typewriter)",
            letterSpacing: "0.1em",
          }}
        >
          {criterion.score}/{criterion.maxScore}
        </span>
      </div>
      <div
        class="w-full h-[3px] bg-[var(--color-paper-2)] mb-2.5"
        role="meter"
        aria-label={criterion.label}
        aria-valuemin={0}
        aria-valuemax={criterion.maxScore}
        aria-valuenow={criterion.score}
      >
        <div
          class="rubric-bar h-full"
          style={{
            width: `${pct}%`,
            backgroundColor: scoreColor,
          }}
        />
      </div>
      <p
        class="text-xs leading-5 text-[var(--color-ink-light)]"
        style="font-family: var(--font-serif);"
      >
        {criterion.feedback}
      </p>
      {pct < 60 && (
        <p
          class="mt-1.5 text-[11px] leading-5"
          style={{
            fontFamily: "var(--font-typewriter)",
            color: "var(--color-vermilion)",
          }}
        >
          Next move → {nextMoveFor(criterion.id)}
        </p>
      )}
    </div>
  );
}

/** A concrete, prescriptive next step for a low-scoring criterion. */
function nextMoveFor(id: string): string {
  const moves: Record<string, string> = {
    thesis:
      "State the load-bearing claim in one sentence near the top, then make every section earn it.",
    evidence:
      "Pick the two weakest claims and attach a source, example, or number to each.",
    integrity:
      "Replace universal claims with testable claims; cut filler and add proof where the sentence asks for trust.",
    structure:
      "Add a section break or transition where the argument changes gears; cut a paragraph that repeats.",
    pacing:
      "Vary sentence length — break one long sentence in three, and merge two short ones.",
    voice:
      "Rewrite the opening line in the target tone; let it set the register for the rest.",
    vocabulary:
      "Replace three abstractions with concrete nouns; cut one piece of jargon per paragraph.",
    paragraph: "Split any paragraph over ~6 sentences; give each a single job.",
    engagement:
      "Put a stake or a question in the first 100 words so the reader knows why to continue.",
  };
  return (
    moves[id] ??
    "Make the one change that would most move this score, then re-read."
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";

function defaultPersonas() {
  return DEFAULT_PERSONAS;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 5;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function localJudges(
  draftText: string,
  brief: ProjectBrief | null,
): JudgeResult[] {
  const wc = draftText.split(/\s+/).filter(Boolean).length;
  const hasBrief = !!brief;
  const hasBody = wc > 80;
  let base = 3;
  if (hasBrief) base += 1;
  if (hasBody) base += 1;
  if (wc > 350) base += 1;
  if (wc > 800) base += 1;

  return DEFAULT_PERSONAS.map((p) => {
    let bias = 0;
    let rationale =
      "The draft is partial; the work to come is the interesting part.";
    if (p.id === "devil") {
      bias = wc < 200 ? -1 : 0;
      rationale =
        wc < 200
          ? "The argument is still under construction; the load-bearing claim is not yet visible."
          : "The argument moves, but the strongest counter-objection is still unstated.";
    } else if (p.id === "angel") {
      bias = hasBody ? 1 : 0;
      rationale = hasBody
        ? "There is at least one paragraph doing real work; protect it."
        : "The opening gestures are honest; trust them, then add weight.";
    } else if (p.id === "scholar") {
      bias = -1;
      rationale = "Claims outrun evidence; the bibliography is thin.";
    } else if (p.id === "editor") {
      bias = wc > 200 ? 0 : -1;
      rationale =
        wc > 200
          ? "Sentences are present, but rhythm and concision need a pass."
          : "The draft is too short to evaluate the cut; write more first.";
    } else if (p.id === "reader") {
      bias = hasBrief ? 0 : -1;
      rationale = hasBrief
        ? "As the named audience, I would keep reading past the open."
        : "Without a clear audience, the opening is interesting but slippery.";
    }
    return {
      personaId: p.id,
      score: clampScore(base + bias),
      rationale,
      provider: "local",
    };
  });
}

function buildCriteria(
  staticScore: StaticScore,
  judges: JudgeResult[],
  final: number,
  brief: ProjectBrief | null,
): RubricCriterion[] {
  const audience = brief?.answers.audience || "the intended reader";
  const goal = brief?.answers.goal || "the central goal";
  const tone = brief?.answers.tone || "the target tone";
  const judgeMean =
    judges.length > 0
      ? Math.round(
          (judges.reduce((s, j) => s + j.score, 0) / judges.length) * 10,
        ) / 10
      : 0;
  return [
    {
      id: "thesis",
      label: "Thesis & Argument",
      description: "Clarity and strength of the central argument",
      score: Math.min(10, Math.round(judgeMean * 10) / 10),
      maxScore: 10,
      feedback: `Judges averaged ${judgeMean}/10 on the central claim. The next pass is to make the load-bearing claim visible earlier against the stated goal: ${goal}.`,
    },
    {
      id: "evidence",
      label: "Evidence & Support",
      description: "Quality and relevance of supporting evidence",
      score: Math.min(10, staticScore.perFeature.evidence),
      maxScore: 10,
      feedback: `${staticScore.features.citationCount} citation-like reference${
        staticScore.features.citationCount === 1 ? "" : "s"
      } detected (${staticScore.features.citationDensity.toFixed(
        1,
      )} per 1,000 words). For ${audience}, evidence should earn its place.`,
    },
    {
      id: "integrity",
      label: "Bullshit Resistance",
      description: "Unsupported certainty, filler, vagueness, and repetition",
      score: Math.min(10, staticScore.perFeature.integrity),
      maxScore: 10,
      feedback: `${staticScore.features.unsupportedUniversalClaimCount} unsupported universal claim${
        staticScore.features.unsupportedUniversalClaimCount === 1 ? "" : "s"
      }; ${(staticScore.features.fillerWordRatio * 100).toFixed(1)}% filler; ${(
        staticScore.features.vagueWordRatio * 100
      ).toFixed(1)}% vague wording; ${(
        staticScore.features.duplicateParagraphRatio * 100
      ).toFixed(
        0,
      )}% duplicated paragraphs. The rubric now penalizes confident-sounding prose that does not pay rent.`,
    },
    {
      id: "structure",
      label: "Organization & Flow",
      description: "Logical structure and transitions",
      score: Math.min(10, staticScore.perFeature.structure),
      maxScore: 10,
      feedback: `${staticScore.features.paragraphCount} paragraph${
        staticScore.features.paragraphCount === 1 ? "" : "s"
      } across ${staticScore.features.sentenceCount} sentences. ${staticScore.feedback[0] ?? ""}`,
    },
    {
      id: "pacing",
      label: "Pacing & Rhythm",
      description: "Sentence length variation and cadence",
      score: Math.min(10, staticScore.perFeature.pacing),
      maxScore: 10,
      feedback: `Average sentence is ${staticScore.features.avgSentenceLength.toFixed(
        1,
      )} words, with a standard deviation of ${staticScore.features.sentenceLengthStdDev.toFixed(
        1,
      )}. A healthy mix lives in 12-22 word sentences with variance of 5-10.`,
    },
    {
      id: "voice",
      label: "Voice & Tone",
      description: "Consistency of voice for the named audience",
      score: Math.min(10, judgeMean),
      maxScore: 10,
      feedback: `Target tone: ${tone}. Read aloud — does the cadence match the reader, ${audience}?`,
    },
    {
      id: "vocabulary",
      label: "Vocabulary & Diction",
      description: "Type-token ratio and word choice",
      score: Math.min(10, staticScore.perFeature.vocabulary),
      maxScore: 10,
      feedback: `Type-token ratio: ${(staticScore.features.uniqueWordsRatio * 100).toFixed(1)}% (${staticScore.features.avgWordLength.toFixed(1)} average word length). Healthy range: 35-60%.`,
    },
    {
      id: "paragraph",
      label: "Paragraph Shape",
      description: "Balance of short and long paragraphs",
      score: Math.min(10, staticScore.perFeature.paragraphShape),
      maxScore: 10,
      feedback: `${(staticScore.features.shortParagraphRatio * 100).toFixed(0)}% of paragraphs are short, ${(staticScore.features.longParagraphRatio * 100).toFixed(0)}% are long. A balance of 2-3 sentence paragraphs and 5-8 sentence paragraphs reads best.`,
    },
    {
      id: "engagement",
      label: "Reader Engagement",
      description: "Whether the reader reaches the success signal",
      score: Math.min(10, Math.max(0, Math.round((final / 100) * 10))),
      maxScore: 10,
      feedback: `Combined score ${final}/100. ${final >= 80 ? "Strong work — keep going." : final >= 65 ? "Real progress, but the room is still asking for more." : "The next pass is the important one."}`,
    },
  ];
}
