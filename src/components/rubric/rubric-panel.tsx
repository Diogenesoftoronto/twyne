import {
  component$,
  useStore,
  useVisibleTask$,
  $,
  type PropFunction,
} from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import type { ProjectBrief } from "../../types";
import { loadDraftText, summarizeBrief } from "../../utils/anti-tabula-rasa";
import {
  scoreStaticFeatures,
  scoreSufficiency,
  combineJudgesAndStatic,
  capShapeScore,
  UNJUDGED_TARGET_FIT,
  type StaticScore,
  type JudgeResult,
} from "../../utils/rubric";
import {
  loadRubricResultFromIdb,
  saveRubricResultToIdb,
  loadAiSettingsFromIdb,
} from "../../utils/idb";
import type { AiSettings } from "../../types";
import {
  hasConfiguredAiProvider,
  runClientJudge,
  runClientEvidenceJudge,
  runClientIntegrityJudge,
  runClientTargetFitJudge,
  runClientCustomCriterionJudge,
  runClientRubricReview,
  normalizeAiSettings,
} from "../../utils/ai-client";
import { draftReadiness, MIN_RUBRIC_WORDS } from "../../utils/draft-thresholds";
import { renderMarkdown } from "../../utils/markdown";
import { ApplicationNotice } from "../ui/application-notice";
import { SpeakButton } from "../ui/speak-button";
import type { AppError } from "../../types/application-errors";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import type { RubricCriterionSpec, RubricHistoryEntry } from "../../types";
import {
  activeCustomCriteria,
  appendRubricHistory,
  clampWeight,
  MIN_WEIGHT,
  MAX_WEIGHT,
  defaultCriteriaSpecs,
  loadCriteriaSpecs,
  loadRubricHistory,
  newCustomCriterion,
  saveCriteriaSpecs,
  scoreDelta,
  weightedCriteriaScore,
  sparklinePoints,
} from "../../utils/rubric-criteria";

interface RubricStore {
  result: RubricResult | null;
  isAnalyzing: boolean;
  isReviewing: boolean;
  error: AppError | null;
  judges: JudgeResult[];
  static: StaticScore | null;
  brief: ProjectBrief | null;
  aiSettings: AiSettings | null;
  /** The writer's criteria configuration: spine toggles plus their own. */
  criteriaSpecs: RubricCriterionSpec[];
  /** Score history, for the trend line. */
  history: RubricHistoryEntry[];
  /** Whether the criteria editor is open. */
  criteriaOpen: boolean;
  /** Draft fields for a new custom criterion. */
  newCriterionLabel: string;
  newCriterionDescription: string;
  /** Criteria the room proposed, awaiting the writer's decision. */
  suggestions: Array<{ label: string; description: string }>;
  isSuggesting: boolean;
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
  review?: string;
  reviewProvider?: string;
  /** Relevance to the brief, 0-10. Absent on results saved before the gate. */
  targetFit?: number;
  /** The same criteria re-scored by the writer's own weights, 0-100. */
  writerScore?: number;
}

interface RubricPanelProps {
  brief: ProjectBrief | null;
}

export const RubricPanel = component$(({ brief }: RubricPanelProps) => {
  const clientSig = useConvexClient();
  const store = useStore<RubricStore>({
    result: null,
    isAnalyzing: false,
    isReviewing: false,
    error: null,
    judges: [],
    static: null,
    brief: null,
    aiSettings: null,
    criteriaSpecs: defaultCriteriaSpecs(),
    history: [],
    criteriaOpen: false,
    newCriterionLabel: "",
    newCriterionDescription: "",
    suggestions: [],
    isSuggesting: false,
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
        store.error = createAppError("VALIDATION_FAILED", {
          metadata: { feature: "rubric", operation: "analyze" },
        });
        return;
      }

      // 1. Run the static-feature scorer in the browser (cheap, deterministic).
      const staticScore = scoreStaticFeatures(draftText);
      store.static = staticScore;

      // 2. Run the five personas as judges. Try client AI first (BYOK),
      //    then Convex server action, then local heuristic.
      let judges: JudgeResult[] = [];

      const settings = store.aiSettings;
      if (hasConfiguredAiProvider(settings) && settings) {
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
        } catch (error) {
          store.error = normalizeApplicationError(error, {
            source: "provider",
            metadata: { feature: "rubric", operation: "judge-room" },
          });
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
        } catch (error) {
          store.error = normalizeApplicationError(error, {
            source: "convex",
            metadata: { feature: "rubric", operation: "judge-room" },
          });
          return;
        }
      }

      if (judges.length === 0) {
        store.error = createAppError(
          hasConfiguredAiProvider(settings)
            ? "PROVIDER_ERROR"
            : "CONFIGURATION_ERROR",
          {
            source: hasConfiguredAiProvider(settings)
              ? "provider"
              : "application",
            recovery: {
              action: hasConfiguredAiProvider(settings)
                ? "retry"
                : "choose-provider",
              canRetry: hasConfiguredAiProvider(settings),
            },
            metadata: { feature: "rubric", operation: "judge-room" },
          },
        );
        return;
      }
      if (judges.every((j) => j.provider === "local")) {
        store.error = createAppError("PROVIDER_ERROR", {
          source: "provider",
          metadata: { feature: "rubric", operation: "judge-room" },
        });
        return;
      }
      store.judges = judges;

      // 2b. A dedicated LLM judge for content sufficiency vs the stated
      //     goal — falls back to the keyword heuristic when offline/signed out.
      const localSufficiency = () => {
        const s = scoreSufficiency(draftText, brief?.answers.goal ?? null);
        return { score: s.score, rationale: s.feedback };
      };
      let sufficiency: { score: number; rationale: string };
      try {
        sufficiency = client
          ? ((await client.action(api.agents.judgeSufficiency, {
              brief: brief ?? null,
              draftText,
            })) as { score: number; rationale: string })
          : localSufficiency();
      } catch {
        sufficiency = localSufficiency();
      }

      // 2c. Dedicated LLM judges for evidence & integrity when we can
      //     reach one. These catch what the static regex/density scorers
      //     miss — padded citations, fake specificity, sophisticated
      //     bullshit, legitimate emphatic prose flagged as filler.
      const settings2 = store.aiSettings;

      const localEvidence = () => {
        const f = scoreStaticFeatures(draftText).features;
        const density = f.citationDensity;
        const score =
          f.citationCount === 0
            ? f.paragraphCount > 0
              ? 3
              : 1
            : density >= 1.5 && density <= 6
              ? 7
              : density < 1.5
                ? 5
                : 4;
        const audience = brief?.answers.audience || "the intended reader";
        return {
          score,
          rationale: `${f.citationCount} citation-like reference${
            f.citationCount === 1 ? "" : "s"
          } (${density.toFixed(
            1,
          )} per 1,000 words). Counts shape, not substance — judge locally only. For ${audience}, evidence has to earn its claim.`,
        };
      };

      const localIntegrity = () => {
        const f = scoreStaticFeatures(draftText).features;
        const deduction =
          f.unsupportedUniversalClaimCount * 0.6 +
          f.duplicateParagraphRatio * 60;
        const score =
          deduction > 0 ? Math.max(1, 10 - Math.round(deduction)) : 7;
        return {
          score,
          rationale: `${f.unsupportedUniversalClaimCount} unsupported universal claim${
            f.unsupportedUniversalClaimCount === 1 ? "" : "s"
          }, ${(f.fillerWordRatio * 100).toFixed(1)}% filler, ${(
            f.vagueWordRatio * 100
          ).toFixed(1)}% vague wording, ${(
            f.duplicateParagraphRatio * 100
          ).toFixed(
            0,
          )}% duplicated paragraphs. Regex misses sophisticated bullshit and false-positives on legitimate emphatic prose.`,
        };
      };

      let evidence: { score: number; rationale: string; provider?: string };
      try {
        const clientRes = settings2
          ? await runClientEvidenceJudge(
              { brief: brief ?? null, draftText },
              settings2,
            )
          : null;
        if (clientRes) {
          evidence = clientRes;
        } else if (client) {
          const serverRes = (await client.action(api.agents.judgeEvidence, {
            brief: brief ?? null,
            draftText,
          })) as { score: number; rationale: string; provider: string } | null;
          evidence = serverRes ?? localEvidence();
        } else {
          evidence = localEvidence();
        }
      } catch {
        evidence = localEvidence();
      }

      let integrity: { score: number; rationale: string; provider?: string };
      try {
        const clientRes = settings2
          ? await runClientIntegrityJudge(
              { brief: brief ?? null, draftText },
              settings2,
            )
          : null;
        if (clientRes) {
          integrity = clientRes;
        } else if (client) {
          const serverRes = (await client.action(api.agents.judgeIntegrity, {
            brief: brief ?? null,
            draftText,
          })) as { score: number; rationale: string; provider: string } | null;
          integrity = serverRes ?? localIntegrity();
        } else {
          integrity = localIntegrity();
        }
      } catch {
        integrity = localIntegrity();
      }

      // 2d. The relevance gate. Everything above judges how *well* the draft
      //     is written; this judges whether it is about the right thing at
      //     all. Its score caps the shape-derived criteria below, so fluent
      //     prose about the wrong subject can no longer bank 10/10 on pacing,
      //     vocabulary and paragraph shape. When no judge can run we fall
      //     back to UNJUDGED_TARGET_FIT (10), which is a no-op — an unjudged
      //     draft must never be punished for the absence of a provider.
      let targetFit: { score: number; rationale: string; provider?: string } = {
        score: UNJUDGED_TARGET_FIT,
        rationale:
          "Relevance was not judged this pass, so the shape measurements are uncapped. Connect a provider to have the room check the draft against the brief.",
      };
      try {
        const clientRes = settings2
          ? await runClientTargetFitJudge(
              { brief: brief ?? null, draftText },
              settings2,
            )
          : null;
        if (clientRes) {
          targetFit = clientRes;
        } else if (client) {
          const serverRes = (await client.action(api.agents.judgeTargetFit, {
            brief: brief ?? null,
            draftText,
          })) as { score: number; rationale: string; provider: string } | null;
          if (serverRes) targetFit = serverRes;
        }
      } catch (error) {
        reportApplicationDiagnostic("twyne:rubric:target-fit", error, {
          feature: "rubric",
          operation: "judge-target-fit",
        });
      }

      // 3. Combine into a brutal grade, gated on relevance.
      const combined = combineJudgesAndStatic(
        judges,
        staticScore,
        brief,
        targetFit.score,
      );
      const criteria = buildCriteria(
        staticScore,
        judges,
        combined.combined,
        brief,
        sufficiency,
        evidence,
        integrity,
        targetFit,
      );

      // 4. The writer's own criteria, judged alongside the spine. Each is one
      //    call; they run in parallel and a failure drops that criterion
      //    rather than failing the pass — a broken custom criterion must not
      //    cost the writer the rest of their rubric.
      const customCriteria = await Promise.all(
        activeCustomCriteria(store.criteriaSpecs).map(async (spec) => {
          try {
            const res = settings2
              ? await runClientCustomCriterionJudge(
                  {
                    brief: brief ?? null,
                    draftText,
                    label: spec.label,
                    description: spec.description,
                  },
                  settings2,
                )
              : null;
            const judged =
              res ??
              (client
                ? ((await client.action(api.agents.judgeCustomCriterion, {
                    brief: brief ?? null,
                    draftText,
                    label: spec.label,
                    description: spec.description,
                  })) as { score: number; rationale: string })
                : null);
            if (!judged) return null;
            return {
              id: spec.id,
              label: spec.label,
              description: spec.description,
              score: Math.min(10, Math.max(0, judged.score)),
              maxScore: 10,
              feedback: judged.rationale,
            } as RubricCriterion;
          } catch (error) {
            reportApplicationDiagnostic("twyne:rubric:custom-criterion", error, {
              feature: "rubric",
              operation: "judge-custom-criterion",
            });
            return null;
          }
        }),
      );

      // Honour the writer's enable/disable choices on the spine, keep their
      // ordering, and append what they added themselves.
      const enabledIds = new Set(
        store.criteriaSpecs.filter((s) => s.enabled).map((s) => s.id),
      );
      const visibleCriteria = [
        ...criteria.filter((c) => enabledIds.has(c.id)),
        ...customCriteria.filter((c): c is RubricCriterion => c !== null),
      ];

      const result: RubricResult = {
        criteria: visibleCriteria,
        overallScore: combined.combined,
        overallGrade: combined.grade,
        summary: combined.summary,
        timestamp: Date.now(),
        judges,
        staticScore,
        targetFit: targetFit.score,
        writerScore:
          weightedCriteriaScore(
            store.criteriaSpecs,
            Object.fromEntries(visibleCriteria.map((c) => [c.id, c.score])),
          ) ?? undefined,
      };
      store.result = result;
      void saveRubricResultToIdb(result);
      store.history = await appendRubricHistory({
        at: result.timestamp,
        overall: result.overallScore,
        grade: result.overallGrade,
        targetFit: targetFit.score,
        perCriterion: Object.fromEntries(
          visibleCriteria.map((c) => [c.id, c.score]),
        ),
      });
    } finally {
      store.isAnalyzing = false;
    }
  });

  const generateReview = $(async () => {
    const result = store.result;
    if (!result || store.isReviewing) return;
    store.isReviewing = true;
    store.error = null;
    try {
      const draftText = await loadDraftText();
      const combined = combineJudgesAndStatic(
        result.judges,
        result.staticScore,
        brief ?? null,
        result.targetFit ?? UNJUDGED_TARGET_FIT,
      );
      const payload = {
        combined: result.overallScore,
        grade: result.overallGrade,
        judgeMean: combined.judgeMean,
        minJudge: combined.minJudge,
        staticTotal: combined.staticTotal,
        judges: result.judges.map((j) => ({
          personaId: j.personaId,
          score: j.score,
          rationale: j.rationale,
        })),
        staticFeedback: result.staticScore.feedback,
      };

      let review = "";
      let reviewProvider = "local";
      const settings = store.aiSettings;
      if (hasConfiguredAiProvider(settings) && settings) {
        const res = await runClientRubricReview(
          { ...payload, brief: brief ?? null, draftText },
          settings,
        );
        if (res) {
          review = res.text;
          reviewProvider = `client-${res.provider}`;
        }
      }
      if (!review && clientSig.value) {
        const res = (await clientSig.value.action(api.agents.reviewRubric, {
          ...payload,
          brief: brief ?? null,
          draftText,
        })) as { review: string; provider: string };
        review = res.review;
        reviewProvider = res.provider;
      }

      if (review) {
        const updated: RubricResult = { ...result, review, reviewProvider };
        store.result = updated;
        void saveRubricResultToIdb(updated);
      } else {
        store.error = createAppError("CONFIGURATION_ERROR", {
          recovery: { action: "choose-provider", canRetry: false },
          metadata: { feature: "rubric", operation: "review" },
        });
      }
    } catch (error) {
      store.error = normalizeApplicationError(error, {
        metadata: { feature: "rubric", operation: "review" },
      });
    } finally {
      store.isReviewing = false;
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
    const [specs, history] = await Promise.all([
      loadCriteriaSpecs(),
      loadRubricHistory(),
    ]);
    store.criteriaSpecs = specs;
    store.history = history;
  });

  /* ── The writer's criteria ─────────────────────────────────────── */

  const persistSpecs = $(async (next: RubricCriterionSpec[]) => {
    store.criteriaSpecs = next;
    await saveCriteriaSpecs(next);
  });

  const toggleCriterion = $((id: string) => {
    void persistSpecs(
      store.criteriaSpecs.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s,
      ),
    );
  });

  const setCriterionWeight = $((id: string, weight: number) => {
    void persistSpecs(
      store.criteriaSpecs.map((s) =>
        s.id === id ? { ...s, weight: clampWeight(weight) } : s,
      ),
    );
  });

  const removeCriterion = $((id: string) => {
    // Spine entries are disabled, never deleted — that is what keeps one
    // pass comparable with the next.
    void persistSpecs(
      store.criteriaSpecs.filter((s) => s.id !== id || s.source === "spine"),
    );
  });

  const addCriterion = $(() => {
    const label = store.newCriterionLabel.trim();
    if (!label) return;
    void persistSpecs([
      ...store.criteriaSpecs,
      newCustomCriterion(label, store.newCriterionDescription),
    ]);
    store.newCriterionLabel = "";
    store.newCriterionDescription = "";
  });

  const acceptSuggestion = $((s: { label: string; description: string }) => {
    void persistSpecs([
      ...store.criteriaSpecs,
      newCustomCriterion(s.label, s.description),
    ]);
    store.suggestions = store.suggestions.filter((x) => x.label !== s.label);
  });

  const suggestCriteria = $(async () => {
    if (store.isSuggesting) return;
    store.isSuggesting = true;
    store.error = null;
    try {
      const client = clientSig.value;
      if (!client) {
        store.error = createAppError("AUTHENTICATION_REQUIRED", {
          recovery: { action: "sign-in", canRetry: false },
          metadata: { feature: "rubric", operation: "suggest-criteria" },
        });
        return;
      }
      const draftText = await loadDraftText();
      const res = (await client.action(api.agents.suggestRubricCriteria, {
        brief: brief ?? null,
        draftText: draftText.slice(0, 4000),
        existingLabels: store.criteriaSpecs
          .filter((s) => s.enabled)
          .map((s) => s.label),
      })) as { criteria: Array<{ label: string; description: string }> };
      store.suggestions = res.criteria ?? [];
    } catch (error) {
      store.error = normalizeApplicationError(error, {
        metadata: { feature: "rubric", operation: "suggest-criteria" },
      });
    } finally {
      store.isSuggesting = false;
    }
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
            <div class="mt-3 max-w-sm">
              <ApplicationNotice
                error={store.error}
                compact
                onRetry$={store.error.recovery.canRetry ? analyze : undefined}
                recoveryLabel="Open AI settings"
                recoveryHref="/settings/"
              />
            </div>
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
                  {store.result.writerScore !== undefined && (
                    <span
                      class="ml-2 text-[11px] text-[var(--color-ink-muted)]"
                      style="font-family: var(--font-typewriter); font-weight: 400;"
                      title="The same criteria re-scored under the weights you set. The grade to its left is the fixed editorial instrument, so the two can be compared over time."
                    >
                      · {store.result.writerScore} by your weights
                    </span>
                  )}
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
                <div class="mt-2">
                  <ApplicationNotice
                    error={store.error}
                    compact
                    onRetry$={
                      store.error.recovery.canRetry ? analyze : undefined
                    }
                    recoveryLabel="Open AI settings"
                    recoveryHref="/settings/"
                  />
                </div>
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

          {/* The trend line — the rubric as a trajectory, not a snapshot. */}
          {store.history.length >= 2 && (
            <div class="px-5 py-3 border-b border-dashed border-[var(--color-paper-3)]">
              <div class="flex items-baseline justify-between">
                <p class="dept-label">The Run of Grades</p>
                <ScoreDeltaBadge delta={scoreDelta(store.history)} />
              </div>
              <Sparkline history={store.history} />
            </div>
          )}

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

          {/* Full narrative review */}
          <div class="px-4 py-4 border-t border-dashed border-[var(--color-paper-3)]">
            <div class="flex items-center justify-between gap-2">
              <p class="dept-label">The Critic's Full Review</p>
              {store.result.review && (
                <SpeakButton
                  compact
                  id="rubric-review"
                  text={store.result.review}
                  label="the critic"
                />
              )}
            </div>
            {store.result.review ? (
              <div
                class="comment-markdown mt-2 text-[13px] leading-6 text-[var(--color-ink)]"
                style="font-family: var(--font-serif);"
                dangerouslySetInnerHTML={renderMarkdown(store.result.review)}
              />
            ) : (
              <button
                onClick$={generateReview}
                disabled={store.isReviewing}
                class="btn-paper w-full mt-2"
              >
                {store.isReviewing
                  ? "✍ Writing the full review…"
                  : "✍ Expand to a full-page review"}
              </button>
            )}
          </div>

          <div class="px-4 py-3 border-t border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] space-y-2">
            <button
              onClick$={() => {
                store.criteriaOpen = !store.criteriaOpen;
              }}
              class="w-full text-left text-[11px] tracking-[0.12em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus-ring"
              style="font-family: var(--font-typewriter);"
              aria-expanded={store.criteriaOpen}
            >
              {store.criteriaOpen ? "▾" : "▸"} What the proof desk grades
            </button>
            {store.criteriaOpen && (
              <CriteriaEditor
                specs={store.criteriaSpecs}
                suggestions={store.suggestions}
                isSuggesting={store.isSuggesting}
                newLabel={store.newCriterionLabel}
                newDescription={store.newCriterionDescription}
                onToggle$={toggleCriterion}
                onWeight$={setCriterionWeight}
                onRemove$={removeCriterion}
                onAdd$={addCriterion}
                onSuggest$={suggestCriteria}
                onAccept$={acceptSuggestion}
                onLabelInput$={$((v: string) => {
                  store.newCriterionLabel = v;
                })}
                onDescriptionInput$={$((v: string) => {
                  store.newCriterionDescription = v;
                })}
              />
            )}
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

/**
 * The score trend. Scaled to the observed range rather than 0-100 so a writer
 * working in a narrow band can actually see their movement — a fixed axis
 * flattens six passes of real progress into a straight line.
 */
function Sparkline({ history }: { history: RubricHistoryEntry[] }) {
  const points = sparklinePoints(history);
  if (points.length < 2) return null;
  const w = 100;
  const h = 24;
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${(p.x * w).toFixed(1)} ${((1 - p.y) * h).toFixed(1)}`,
    )
    .join(" ");
  const last = points[points.length - 1];
  const first = history[0];
  const latest = history[history.length - 1];

  return (
    <div class="mt-1.5">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height="28"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Grade over ${history.length} passes, from ${first.overall} to ${latest.overall} out of 100`}
      >
        <path
          d={path}
          fill="none"
          stroke="var(--color-cobalt)"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
          stroke-linejoin="round"
        />
        <circle
          cx={last.x * w}
          cy={(1 - last.y) * h}
          r="2"
          fill="var(--color-vermilion)"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <p
        class="mt-0.5 text-[10px] tracking-[0.1em] text-[var(--color-ink-muted)]"
        style="font-family: var(--font-typewriter);"
      >
        {history.length} passes · {first.overall} → {latest.overall}
      </p>
    </div>
  );
}

function ScoreDeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      class="text-[11px]"
      style={{
        fontFamily: "var(--font-typewriter)",
        color: up ? "var(--color-accent-green)" : "var(--color-accent-red)",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(delta)} since last
    </span>
  );
}

interface CriteriaEditorProps {
  specs: RubricCriterionSpec[];
  suggestions: Array<{ label: string; description: string }>;
  isSuggesting: boolean;
  newLabel: string;
  newDescription: string;
  onToggle$: PropFunction<(id: string) => void>;
  onWeight$: PropFunction<(id: string, weight: number) => void>;
  onRemove$: PropFunction<(id: string) => void>;
  onAdd$: PropFunction<() => void>;
  onSuggest$: PropFunction<() => void>;
  onAccept$: PropFunction<(s: { label: string; description: string }) => void>;
  onLabelInput$: PropFunction<(v: string) => void>;
  onDescriptionInput$: PropFunction<(v: string) => void>;
}

/**
 * The writer's control over what gets graded.
 *
 * Spine criteria can be switched off and reweighted but not deleted — that is
 * the deliberate line that keeps a grade from March comparable with one from
 * June. Criteria the writer adds are theirs entirely.
 */
const CriteriaEditor = component$<CriteriaEditorProps>((props) => {
  const spine = props.specs.filter((s) => s.source === "spine");
  const custom = props.specs.filter((s) => s.source === "custom");

  return (
    <div class="rounded-sm border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-3 space-y-3">
      <p
        class="text-[10px] leading-4 text-[var(--color-ink-muted)]"
        style="font-family: var(--font-serif);"
      >
        The standing criteria stay put so one pass can be compared with the
        next — switch them off or reweight them, but they can't be removed.
        Anything you add below is yours, and the room judges it too.
      </p>

      <div class="space-y-1">
        {spine.map((s) => (
          <CriterionRow
            key={s.id}
            spec={s}
            onToggle$={props.onToggle$}
            onWeight$={props.onWeight$}
          />
        ))}
      </div>

      {custom.length > 0 && (
        <div class="space-y-1 border-t border-dashed border-[var(--color-paper-3)] pt-2">
          <p class="dept-label">Your own</p>
          {custom.map((s) => (
            <CriterionRow
              key={s.id}
              spec={s}
              onToggle$={props.onToggle$}
              onWeight$={props.onWeight$}
              onRemove$={props.onRemove$}
            />
          ))}
        </div>
      )}

      <div class="border-t border-dashed border-[var(--color-paper-3)] pt-2 space-y-1.5">
        <input
          value={props.newLabel}
          placeholder="A criterion of your own"
          onInput$={(_, el) => props.onLabelInput$(el.value)}
          onKeyDown$={(e) => {
            if (e.key === "Enter") props.onAdd$();
          }}
          class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1 text-xs text-[var(--color-ink)] focus:border-[var(--color-cobalt)] focus:outline-none"
          style="font-family: var(--font-serif); border-radius: 2px;"
          aria-label="New criterion name"
        />
        <input
          value={props.newDescription}
          placeholder="What does a strong version look like?"
          onInput$={(_, el) => props.onDescriptionInput$(el.value)}
          onKeyDown$={(e) => {
            if (e.key === "Enter") props.onAdd$();
          }}
          class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1 text-xs text-[var(--color-ink)] focus:border-[var(--color-cobalt)] focus:outline-none"
          style="font-family: var(--font-serif); border-radius: 2px;"
          aria-label="What a strong version looks like"
        />
        <div class="flex gap-2">
          <button
            onClick$={props.onAdd$}
            disabled={!props.newLabel.trim()}
            class="btn-paper flex-1 text-xs disabled:opacity-30"
          >
            + Add
          </button>
          <button
            onClick$={props.onSuggest$}
            disabled={props.isSuggesting}
            class="btn-paper flex-1 text-xs disabled:opacity-40"
            title="Ask the room what would actually discriminate for this piece"
          >
            {props.isSuggesting ? "Thinking…" : "✦ Suggest"}
          </button>
        </div>
      </div>

      {props.suggestions.length > 0 && (
        <div class="border-t border-dashed border-[var(--color-paper-3)] pt-2 space-y-1.5">
          <p class="dept-label">Proposed for this piece</p>
          {props.suggestions.map((s) => (
            <button
              key={s.label}
              onClick$={() => props.onAccept$(s)}
              class="w-full text-left border border-dashed border-[var(--color-paper-3)] px-2 py-1.5 hover:border-[var(--color-cobalt)] hover:bg-[var(--color-paper-soft)] focus-ring"
              style="border-radius: 2px;"
              title="Add this to your rubric"
            >
              <span
                class="block text-xs text-[var(--color-ink)]"
                style="font-family: var(--font-display); font-weight: 600;"
              >
                + {s.label}
              </span>
              <span
                class="block text-[11px] leading-4 text-[var(--color-ink-light)]"
                style="font-family: var(--font-serif);"
              >
                {s.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

const CriterionRow = component$<{
  spec: RubricCriterionSpec;
  onToggle$: PropFunction<(id: string) => void>;
  onWeight$: PropFunction<(id: string, weight: number) => void>;
  onRemove$?: PropFunction<(id: string) => void>;
}>((props) => {
  const { spec } = props;
  return (
    <div class="flex items-center gap-2">
      <input
        type="checkbox"
        checked={spec.enabled}
        onChange$={() => props.onToggle$(spec.id)}
        class="h-3.5 w-3.5 flex-shrink-0 accent-[var(--color-cobalt)]"
        aria-label={`Grade ${spec.label}`}
      />
      <span
        class="flex-1 min-w-0 truncate text-[11px]"
        style={{
          fontFamily: "var(--font-serif)",
          color: spec.enabled
            ? "var(--color-ink)"
            : "var(--color-ink-muted)",
        }}
        title={spec.description}
      >
        {spec.label}
      </span>
      <input
        type="number"
        min={MIN_WEIGHT}
        max={MAX_WEIGHT}
        step={0.25}
        value={spec.weight}
        onChange$={(_, el) => props.onWeight$(spec.id, Number(el.value))}
        disabled={!spec.enabled}
        class="w-12 flex-shrink-0 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-1 py-0.5 text-right text-[11px] disabled:opacity-40"
        style="border-radius: 2px;"
        aria-label={`Weight for ${spec.label}`}
        title="Relative weight"
      />
      {props.onRemove$ && (
        <button
          onClick$={() => props.onRemove$!(spec.id)}
          class="flex-shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)] focus-ring text-xs"
          aria-label={`Remove ${spec.label}`}
          title="Remove this criterion"
        >
          ✕
        </button>
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
    targetFit:
      "Re-read the brief's audience and goal, then name the one section that is not serving them and either cut it or point it back at the commission.",
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

function buildCriteria(
  staticScore: StaticScore,
  judges: JudgeResult[],
  final: number,
  brief: ProjectBrief | null,
  sufficiency: { score: number; rationale: string },
  evidence: { score: number; rationale: string },
  integrity: { score: number; rationale: string },
  targetFit: { score: number; rationale: string },
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

  /**
   * Shape criteria are computed from sentence-length variance, type-token
   * ratio and paragraph balance — measurements that never read the brief.
   * Cap them by relevance and say so in the feedback, so a low score reads
   * as "this doesn't count for much here" rather than as a mystery.
   */
  const shaped = (rawScore: number, baseFeedback: string) => {
    const { score, capped, ceiling } = capShapeScore(rawScore, targetFit.score);
    return {
      score,
      feedback: capped
        ? `${baseFeedback} Capped at ${ceiling}/10: this measures shape, not substance, and target fit is only ${targetFit.score}/10. Well-formed sentences about the wrong thing are still the wrong thing.`
        : baseFeedback,
    };
  };

  const structure = shaped(
    Math.min(10, staticScore.perFeature.structure),
    `${staticScore.features.paragraphCount} paragraph${
      staticScore.features.paragraphCount === 1 ? "" : "s"
    } across ${staticScore.features.sentenceCount} sentences. ${staticScore.feedback[0] ?? ""}`,
  );
  const pacing = shaped(
    Math.min(10, staticScore.perFeature.pacing),
    `Average sentence is ${staticScore.features.avgSentenceLength.toFixed(
      1,
    )} words, with a standard deviation of ${staticScore.features.sentenceLengthStdDev.toFixed(
      1,
    )}. A healthy mix lives in 12-22 word sentences with variance of 5-10.`,
  );
  const vocabulary = shaped(
    Math.min(10, staticScore.perFeature.vocabulary),
    `Type-token ratio: ${(staticScore.features.uniqueWordsRatio * 100).toFixed(
      1,
    )}% (${staticScore.features.avgWordLength.toFixed(
      1,
    )} average word length). Healthy range: 35-60%.`,
  );
  const paragraphShape = shaped(
    Math.min(10, staticScore.perFeature.paragraphShape),
    `${(staticScore.features.shortParagraphRatio * 100).toFixed(
      0,
    )}% of paragraphs are short, ${(
      staticScore.features.longParagraphRatio * 100
    ).toFixed(
      0,
    )}% are long. A balance of 2-3 sentence paragraphs and 5-8 sentence paragraphs reads best.`,
  );

  return [
    {
      id: "targetFit",
      label: "Target Fit",
      description:
        "Whether the draft is about the right thing, for the right reader — independent of how well it is written",
      score: Math.min(10, targetFit.score),
      maxScore: 10,
      feedback: targetFit.rationale,
    },
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
      score: Math.min(10, evidence.score),
      maxScore: 10,
      feedback: evidence.rationale,
    },
    {
      id: "sufficiency",
      label: "Sufficiency & Development",
      description:
        "Whether the draft develops enough on-topic material to earn its thesis or goal",
      score: sufficiency.score,
      maxScore: 10,
      feedback: sufficiency.rationale,
    },
    {
      id: "integrity",
      label: "Bullshit Resistance",
      description: "Unsupported certainty, filler, vagueness, and repetition",
      score: Math.min(10, integrity.score),
      maxScore: 10,
      feedback: integrity.rationale,
    },
    {
      id: "structure",
      label: "Organization & Flow",
      description: "Logical structure and transitions",
      score: structure.score,
      maxScore: 10,
      feedback: structure.feedback,
    },
    {
      id: "pacing",
      label: "Pacing & Rhythm",
      description: "Sentence length variation and cadence",
      score: pacing.score,
      maxScore: 10,
      feedback: pacing.feedback,
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
      score: vocabulary.score,
      maxScore: 10,
      feedback: vocabulary.feedback,
    },
    {
      id: "paragraph",
      label: "Paragraph Shape",
      description: "Balance of short and long paragraphs",
      score: paragraphShape.score,
      maxScore: 10,
      feedback: paragraphShape.feedback,
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
