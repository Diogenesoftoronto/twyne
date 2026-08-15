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
  loadFolioContentFromIdb,
} from "../../utils/idb";
import { createRevisionSnapshot } from "../../utils/revision-history";
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
import { EditorialLoader } from "../ui/editorial-loader";
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
import { toAgentPersona } from "../../../convex/agentPrompts";
import { truncateGalleySummary } from "../../utils/galley-summary";

interface RubricStore {
  result: RubricResult | null;
  isAnalyzing: boolean;
  isReviewing: boolean;
  /** Visible text from the full review currently being generated. */
  streamingReview: string;
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
  /** Which of the three readings of the same result is on screen. */
  section: RubricSection;
  /** Criteria whose reasoning is open, keyed by criterion id. */
  openCriteria: Record<string, boolean>;
}

/**
 * The proof is three different documents wearing one scroll bar: a list of
 * marks, five judges talking, and an essay. Splitting them means each is a
 * short scroll instead of one very long one.
 */
type RubricSection = "marks" | "room" | "review";

interface RubricCriterion {
  id: string;
  label: string;
  description: string;
  score: number;
  maxScore: number;
  feedback: string;
}

interface RubricResult {
  folioId?: string;
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
  activeFolioId: string;
}

export const RubricPanel = component$(
  ({ brief, activeFolioId }: RubricPanelProps) => {
    const clientSig = useConvexClient();
    const store = useStore<RubricStore>({
      result: null,
      isAnalyzing: false,
      isReviewing: false,
      streamingReview: "",
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
      section: "marks",
      openCriteria: {},
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
            validationKey: "draft_too_short",
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
                  persona: toAgentPersona(p),
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
            const personasForServer = defaultPersonas().map(toAgentPersona);
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
            })) as {
              score: number;
              rationale: string;
              provider: string;
            } | null;
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
            })) as {
              score: number;
              rationale: string;
              provider: string;
            } | null;
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
        let targetFit: { score: number; rationale: string; provider?: string } =
          {
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
            })) as {
              score: number;
              rationale: string;
              provider: string;
            } | null;
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
              reportApplicationDiagnostic(
                "twyne:rubric:custom-criterion",
                error,
                {
                  feature: "rubric",
                  operation: "judge-custom-criterion",
                },
              );
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
          folioId: activeFolioId,
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
        void saveRubricResultToIdb(result, activeFolioId);
        store.history = await appendRubricHistory(
          {
            folioId: activeFolioId,
            at: result.timestamp,
            overall: result.overallScore,
            grade: result.overallGrade,
            targetFit: targetFit.score,
            perCriterion: Object.fromEntries(
              visibleCriteria.map((c) => [c.id, c.score]),
            ),
          },
          activeFolioId,
        );
        const revisionHtml = await loadFolioContentFromIdb(activeFolioId);
        await createRevisionSnapshot({
          folioId: activeFolioId,
          html: revisionHtml,
          label: `Rubric pass · ${result.overallScore}/100`,
          source: "rubric",
          force: true,
        });
      } finally {
        store.isAnalyzing = false;
      }
    });

    const generateReview = $(async () => {
      const result = store.result;
      if (!result || store.isReviewing) return;
      store.isReviewing = true;
      store.streamingReview = "";
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
            (snapshot) => {
              store.streamingReview = snapshot.text;
            },
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
          void saveRubricResultToIdb(updated, activeFolioId);
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
        store.streamingReview = "";
      }
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async () => {
      const cached = await loadRubricResultFromIdb(activeFolioId);
      if (cached && !store.result) {
        store.result = cached;
        store.judges = cached.judges ?? [];
        store.static = cached.staticScore ?? null;
      }
      const aiRaw = await loadAiSettingsFromIdb();
      store.aiSettings = normalizeAiSettings(aiRaw);
      const [specs, history] = await Promise.all([
        loadCriteriaSpecs(activeFolioId),
        loadRubricHistory(activeFolioId),
      ]);
      store.criteriaSpecs = specs;
      store.history = history;
    });

    /** Open or close one criterion's reasoning. */
    const toggleCriterionOpen = $((id: string) => {
      store.openCriteria = {
        ...store.openCriteria,
        [id]: !store.openCriteria[id],
      };
    });

    /* ── The writer's criteria ─────────────────────────────────────── */

    const persistSpecs = $(async (next: RubricCriterionSpec[]) => {
      store.criteriaSpecs = next;
      await saveCriteriaSpecs(next, activeFolioId);
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
        <div class="px-5 py-3 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
          <p class="dept-label">Dept. of Rigor</p>
          <h2
            class="mt-0.5 text-xl text-[var(--color-ink)]"
            style="font-family: var(--font-display); font-weight: 600;"
          >
            The Galley Proof
          </h2>
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
            <p
              class="mt-2 max-w-xs text-xs leading-5 text-[var(--color-ink-muted)]"
              style="font-family: var(--font-serif); font-style: italic;"
            >
              {summarizeBrief(brief)}
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
          <div class="flex flex-1 items-center justify-center">
            <EditorialLoader
              personas={DEFAULT_PERSONAS}
              label="Five judges reading"
            />
          </div>
        )}

        {store.result && !store.isAnalyzing && (
          <div class="flex-1 min-h-0 flex flex-col">
            {/* The verdict. Stays on screen whichever reading is open. */}
            <div class="px-5 py-4 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
              <div class="flex items-center gap-4">
                <div
                  class={`flex-shrink-0 w-16 h-16 flex items-center justify-center ${getGradeColor(store.result.overallGrade)}`}
                  role="img"
                  aria-label={`Overall grade ${store.result.overallGrade}, ${store.result.overallScore} of 100`}
                  style={{
                    borderRadius: "999px",
                    border: "2.5px solid currentColor",
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: "1.85rem",
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
                    class="mt-0.5 text-2xl text-[var(--color-ink)]"
                    style="font-family: var(--font-display); font-weight: 600;"
                  >
                    {store.result.overallScore}
                    <span class="text-sm text-[var(--color-ink-muted)]">
                      {" "}
                      / 100
                    </span>
                  </p>
                  {store.result.writerScore !== undefined && (
                    <p
                      class="panel-meta mt-0.5 text-[var(--color-ink-muted)]"
                      title="The same criteria re-scored under the weights you set. The grade above is the fixed editorial instrument, so the two can be compared over time."
                    >
                      {store.result.writerScore} by your weights
                    </p>
                  )}
                </div>
              </div>
              <details class="group mt-3">
                <summary
                  class="panel-prose cursor-pointer text-[var(--color-ink-light)] marker:text-[var(--color-ink-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-cobalt)]"
                  style="font-family: var(--font-serif); font-style: italic;"
                  aria-label="Editor's summary, expand to read the full summary"
                >
                  {truncateGalleySummary(store.result.summary)}
                </summary>
                <p
                  class="panel-prose mt-2 border-l border-[var(--color-paper-3)] pl-3 text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif); font-style: italic;"
                >
                  {store.result.summary}
                </p>
              </details>
              {store.error && (
                <div class="mt-3">
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
            </div>

            {/* The trend line — the rubric as a trajectory, not a snapshot. */}
            {store.history.length >= 2 && (
              <div class="px-5 py-2 border-b border-dashed border-[var(--color-paper-3)]">
                <div class="flex items-baseline justify-between">
                  <p class="dept-label">The Run of Grades</p>
                  <ScoreDeltaBadge delta={scoreDelta(store.history)} />
                </div>
                <Sparkline history={store.history} />
              </div>
            )}

            {/* Three readings of one proof, each its own short scroll. */}
            <div class="flex border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
              {(
                [
                  {
                    id: "marks",
                    label: "Marks",
                    count: store.result.criteria.length,
                  },
                  {
                    id: "room",
                    label: "The Room",
                    count: store.result.judges.length,
                  },
                  { id: "review", label: "Review" },
                ] as Array<{ id: RubricSection; label: string; count?: number }>
              ).map((s) => {
                const active = store.section === s.id;
                return (
                  <button
                    key={s.id}
                    onClick$={() => {
                      store.section = s.id;
                    }}
                    class="panel-meta flex-1 px-2 py-2 uppercase focus-ring"
                    aria-pressed={active}
                    style={{
                      borderBottom: active
                        ? "2px solid var(--color-cobalt)"
                        : "2px solid transparent",
                      color: active
                        ? "var(--color-ink)"
                        : "var(--color-ink-muted)",
                      background: active ? "var(--color-paper)" : "transparent",
                    }}
                  >
                    {s.label}
                    {s.count !== undefined && (
                      <span class="ml-1 text-[var(--color-ink-muted)]">
                        {s.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto">
              {/* ── Marks: every criterion on one screen, reasoning on demand ── */}
              {store.section === "marks" && (
                <div class="px-4 py-3">
                  <div class="space-y-1">
                    {store.result.criteria.map((criterion, idx) => (
                      <RubricCriterionRow
                        key={criterion.id}
                        criterion={criterion}
                        index={idx + 1}
                        open={store.openCriteria[criterion.id] === true}
                        scoreColor={getScoreColor(
                          criterion.score,
                          criterion.maxScore,
                        )}
                        onToggle$={toggleCriterionOpen}
                      />
                    ))}
                  </div>

                  <div class="mt-4 border-t border-dashed border-[var(--color-paper-3)] pt-3">
                    <button
                      onClick$={() => {
                        store.criteriaOpen = !store.criteriaOpen;
                      }}
                      class="panel-meta w-full text-left uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus-ring"
                      aria-expanded={store.criteriaOpen}
                    >
                      {store.criteriaOpen ? "▾" : "▸"} What the proof desk
                      grades
                    </button>
                    {store.criteriaOpen && (
                      <div class="mt-2">
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
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── The Room: five judges, each given room to be read ── */}
              {store.section === "room" && (
                <div class="px-4 py-3 space-y-3">
                  {store.result.judges.map((judge) => (
                    <JudgeCard key={judge.personaId} judge={judge} />
                  ))}
                </div>
              )}

              {/* ── Review: the long-form argument behind the grade ── */}
              {store.section === "review" && (
                <div class="px-4 py-4">
                  {store.result.review ? (
                    <>
                      <div class="flex items-center justify-between gap-2">
                        <p class="dept-label">The Critic's Full Review</p>
                        <SpeakButton
                          compact
                          id="rubric-review"
                          text={store.result.review}
                          label="the critic"
                        />
                      </div>
                      <div
                        data-speech-id="rubric-review"
                        class="comment-markdown mt-2 text-[var(--color-ink)]"
                        style="font-family: var(--font-serif);"
                        dangerouslySetInnerHTML={renderMarkdown(
                          store.result.review,
                        )}
                      />
                    </>
                  ) : store.isReviewing && store.streamingReview.trim() ? (
                    <div
                      class="comment-markdown text-[var(--color-ink)]"
                      style="font-family: var(--font-serif);"
                      aria-live="polite"
                      dangerouslySetInnerHTML={renderMarkdown(
                        store.streamingReview,
                      )}
                    />
                  ) : (
                    <div class="py-6 text-center">
                      <p
                        class="panel-prose mx-auto max-w-xs text-[var(--color-ink-light)]"
                        style="font-family: var(--font-serif); font-style: italic;"
                      >
                        The marks say where the draft stands. A full review says
                        why, in one sitting.
                      </p>
                      <button
                        onClick$={generateReview}
                        disabled={store.isReviewing}
                        class="btn-paper mt-3"
                      >
                        {store.isReviewing
                          ? "✍ Writing…"
                          : "✍ Write the full review"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div class="flex items-center gap-3 border-t border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-4 py-2.5">
              <button onClick$={analyze} class="btn-paper flex-1 text-xs">
                ↻ Send back for re-reading
              </button>
              <Link
                href="/rubric"
                class="panel-meta flex-shrink-0 uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
              >
                Full report ↗
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  },
);

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
        class="text-xs leading-5 text-[var(--color-ink-muted)]"
        style="font-family: var(--font-serif);"
      >
        The standing criteria stay put so one pass can be compared with the next
        — switch them off or reweight them, but they can't be removed. Anything
        you add below is yours, and the room judges it too.
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
        class="flex-1 min-w-0 truncate text-[13px]"
        style={{
          fontFamily: "var(--font-serif)",
          color: spec.enabled ? "var(--color-ink)" : "var(--color-ink-muted)",
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

/**
 * One criterion, as a line rather than a card.
 *
 * The old card put a label, a bar, a paragraph of reasoning and a prescribed
 * next move on screen for all eleven criteria at once — about two thousand
 * words of 12px type in a 340px column. The mark and the bar are what a
 * writer scans; the reasoning is what they read once they've found the row
 * that matters, so it waits behind a click and arrives at a readable size.
 */
const RubricCriterionRow = component$<{
  criterion: RubricCriterion;
  scoreColor: string;
  index: number;
  open: boolean;
  onToggle$: PropFunction<(id: string) => void>;
}>((props) => {
  const { criterion, scoreColor, open } = props;
  const pct = Math.round((criterion.score / criterion.maxScore) * 100);

  return (
    <div
      class="border-b border-dashed border-[var(--color-paper-3)] last:border-b-0"
      style={{ ["--bar-color" as never]: scoreColor }}
    >
      <button
        onClick$={() => props.onToggle$(criterion.id)}
        class="focus-ring w-full py-2 text-left hover:bg-[var(--color-paper-soft)]"
        aria-expanded={open}
      >
        <div class="flex items-baseline gap-2.5">
          <span
            class="w-3 flex-shrink-0 text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter); font-size: 0.7rem;"
            aria-hidden="true"
          >
            {open ? "▾" : "▸"}
          </span>
          <span
            class="min-w-0 flex-1 truncate text-[var(--color-ink)]"
            style="font-family: var(--font-display); font-weight: 600; font-size: 0.9375rem;"
          >
            {criterion.label}
          </span>
          <span
            class="flex-shrink-0 tabular-nums"
            style={{
              color: scoreColor,
              fontFamily: "var(--font-typewriter)",
              fontSize: "0.8125rem",
            }}
          >
            {criterion.score}
            <span class="text-[var(--color-ink-muted)]">
              /{criterion.maxScore}
            </span>
          </span>
        </div>
        <div
          class="ml-[1.375rem] mt-1.5 h-[3px] bg-[var(--color-paper-2)]"
          role="meter"
          aria-label={criterion.label}
          aria-valuemin={0}
          aria-valuemax={criterion.maxScore}
          aria-valuenow={criterion.score}
        >
          <div
            class="rubric-bar h-full"
            style={{ width: `${pct}%`, backgroundColor: scoreColor }}
          />
        </div>
      </button>

      {open && (
        <div class="ml-[1.375rem] pb-3">
          <p
            class="panel-prose text-[var(--color-ink-light)]"
            style="font-family: var(--font-serif);"
          >
            {criterion.feedback}
          </p>
          {pct < 60 && (
            <p
              class="panel-prose mt-2 border-l-2 pl-2.5"
              style={{
                fontFamily: "var(--font-serif)",
                borderColor: "var(--color-vermilion)",
                color: "var(--color-ink)",
              }}
            >
              <span
                class="panel-meta block uppercase text-[var(--color-vermilion)]"
                style="font-family: var(--font-typewriter);"
              >
                Next move
              </span>
              {nextMoveFor(criterion.id)}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * One judge's verdict.
 *
 * The judges used to be a bulleted list keyed by raw persona id — "devil",
 * "scholar" — with the reasoning set in 12px italic and the Markdown the
 * model wrote (its quoted lines from the draft, its emphasis) flattened to
 * plain text. Here each editor is named, coloured like their portrait in the
 * Cast, and their note rendered as what it is.
 */
function JudgeCard({ judge }: { judge: JudgeResult }) {
  const persona = DEFAULT_PERSONAS.find((p) => p.id === judge.personaId);
  const color = persona?.color ?? "var(--color-ink)";
  const scoreColor =
    judge.score >= 7
      ? "var(--color-accent-green)"
      : judge.score >= 4
        ? "var(--color-accent-amber)"
        : "var(--color-accent-red)";

  return (
    <div
      class="desk-card border-l-2"
      style={{
        borderColor: color,
        ["--card-accent" as never]: color,
        ["--card-pad-x" as never]: "0.75rem",
      }}
    >
      {/* Portrait in the gutter, name against the left margin, the mark
        stamped against the right — the same masthead the room's notes
        use, so a verdict and a note read as the same kind of object. */}
      <div class="desk-card__head">
        {persona?.icon && (
          <span class="desk-card__mark" aria-hidden="true">
            {persona.icon}
          </span>
        )}
        <p class="desk-card__name">{persona?.name ?? judge.personaId}</p>
        <span
          class="desk-card__stamp desk-card__stamp--quiet tabular-nums"
          style={{ color: scoreColor, fontSize: "0.8125rem" }}
        >
          {judge.score}
          <span class="text-[var(--color-ink-muted)]">/10</span>
        </span>
        {persona?.role && (
          <div class="desk-card__byline" style={{ color }}>
            {persona.role}
          </div>
        )}
      </div>
      <div
        class="desk-card__body comment-markdown"
        dangerouslySetInnerHTML={renderMarkdown(judge.rationale)}
      />
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
