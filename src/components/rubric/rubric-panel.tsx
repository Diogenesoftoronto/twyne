import { component$, useStore, $ } from "@builder.io/qwik";
import type { ProjectBrief, RubricResult, RubricCriterion } from "../../types";
import { loadDraftText, summarizeBrief } from "../../utils/anti-tabula-rasa";
import { detectCitations } from "../../utils/citations";

interface RubricStore {
  result: RubricResult | null;
  isAnalyzing: boolean;
}

interface RubricPanelProps {
  brief: ProjectBrief | null;
}

export const RubricPanel = component$(({ brief }: RubricPanelProps) => {
  const store = useStore<RubricStore>({
    result: null,
    isAnalyzing: false,
  });

  const analyze = $(() => {
    store.isAnalyzing = true;
    setTimeout(() => {
      store.result = generateContextualRubric(brief, loadDraftText());
      store.isAnalyzing = false;
    }, 2000);
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
    <div class="flex flex-col h-full">
      <div class="px-4 py-3 border-b border-[var(--color-surface-3)]">
        <h2 class="text-sm font-semibold text-[var(--color-ink)] flex items-center gap-2">
          <span>📋</span> Writing Rubric
        </h2>
        <p class="text-xs text-[var(--color-ink-muted)] mt-1">
          {summarizeBrief(brief)}
        </p>
      </div>

      {!store.result && !store.isAnalyzing && (
        <div class="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
          <p class="text-4xl mb-4">🎓</p>
          <p class="text-sm text-[var(--color-ink-light)] mb-4">
            Run the rubric to see how your writing scores across key dimensions
          </p>
          <button
            onClick$={analyze}
            class="py-2 px-4 rounded-lg text-sm font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)] transition-colors"
          >
            Run Rubric Analysis
          </button>
        </div>
      )}

      {store.isAnalyzing && (
        <div class="flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
          <div class="animate-spin text-4xl mb-4">⟳</div>
          <p class="text-sm text-[var(--color-ink-muted)]">
            Analyzing your writing across all criteria...
          </p>
        </div>
      )}

      {store.result && !store.isAnalyzing && (
        <div class="flex-1 overflow-y-auto">
          {/* Overall score */}
          <div class="px-4 py-4 border-b border-[var(--color-surface-3)] bg-[var(--color-surface)]">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs text-[var(--color-ink-muted)] uppercase tracking-wider">
                  Overall Grade
                </p>
                <p
                  class={`text-3xl font-bold ${getGradeColor(store.result.overallGrade)}`}
                >
                  {store.result.overallGrade}
                </p>
              </div>
              <div class="text-right">
                <p class="text-xs text-[var(--color-ink-muted)]">Score</p>
                <p class="text-2xl font-semibold text-[var(--color-ink)]">
                  {store.result.overallScore}
                  <span class="text-sm text-[var(--color-ink-muted)]">
                    /100
                  </span>
                </p>
              </div>
            </div>
            <p class="text-xs text-[var(--color-ink-light)] mt-2 leading-relaxed">
              {store.result.summary}
            </p>
          </div>

          {/* Criteria breakdown */}
          <div class="px-4 py-3 space-y-3">
            {store.result.criteria.map((criterion) => (
              <RubricCriterionCard
                key={criterion.id}
                criterion={criterion}
                scoreColor={getScoreColor(criterion.score, criterion.maxScore)}
              />
            ))}
          </div>

          {/* Re-run button */}
          <div class="px-4 py-3 border-t border-[var(--color-surface-3)]">
            <button
              onClick$={analyze}
              class="w-full py-2 px-3 rounded-lg text-xs font-medium bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:bg-[var(--color-surface-3)] transition-colors"
            >
              Re-run Analysis
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
}: {
  criterion: RubricCriterion;
  scoreColor: string;
}) {
  const pct = Math.round((criterion.score / criterion.maxScore) * 100);

  return (
    <div class="rounded-lg bg-white p-3 shadow-sm">
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-xs font-semibold text-[var(--color-ink)]">
          {criterion.label}
        </span>
        <span class="text-xs font-mono" style={{ color: scoreColor }}>
          {criterion.score}/{criterion.maxScore}
        </span>
      </div>
      <div class="w-full h-1.5 rounded-full bg-[var(--color-surface-2)] mb-2">
        <div
          class="rubric-bar h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: scoreColor,
          }}
        />
      </div>
      <p class="text-xs text-[var(--color-ink-muted)] leading-relaxed">
        {criterion.feedback}
      </p>
    </div>
  );
}

function generateContextualRubric(
  brief: ProjectBrief | null,
  draftText: string,
): RubricResult {
  const answers = brief?.answers;
  const words = draftText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const paragraphCount = draftText.split(/\n{2,}/).filter(Boolean).length;
  const citationCount = detectCitations(draftText).length;
  const hasBrief = Boolean(brief);
  const hasSubstantialDraft = wordCount >= 120;
  const audience = answers?.audience || "the intended reader";
  const goal = answers?.goal || "the central goal";
  const tone = answers?.tone || "the target tone";
  const successSignal = answers?.successSignal || "the intended outcome";

  const criteria: RubricCriterion[] = [
    {
      id: "thesis",
      label: "Thesis & Argument",
      description: "Clarity and strength of central argument",
      score: hasSubstantialDraft ? 7 : 4,
      maxScore: 10,
      feedback: hasSubstantialDraft
        ? `The draft has enough material to test against the stated goal: ${goal}. The next improvement is making the central claim explicit earlier.`
        : `The brief names the goal, but the draft needs more body text before the argument can carry it: ${goal}.`,
    },
    {
      id: "evidence",
      label: "Evidence & Support",
      description: "Quality and relevance of supporting evidence",
      score: Math.min(9, 4 + citationCount + (hasSubstantialDraft ? 1 : 0)),
      maxScore: 10,
      feedback:
        citationCount > 0
          ? `${citationCount} citation-like reference${citationCount === 1 ? "" : "s"} found. Now check whether each source helps ${audience}, rather than merely decorating the prose.`
          : `No citations were detected. Add source support or concrete examples for claims that ${audience} would not accept on trust.`,
    },
    {
      id: "structure",
      label: "Organization & Flow",
      description: "Logical structure and transitions",
      score: paragraphCount >= 4 ? 8 : 5,
      maxScore: 10,
      feedback:
        paragraphCount >= 4
          ? "The draft has enough paragraph structure to start shaping section-level movement. Check that each section changes what the reader knows."
          : "The draft needs more paragraph-level development before flow can be judged. Build a beginning, a turn, and a landing.",
    },
    {
      id: "clarity",
      label: "Clarity & Precision",
      description: "Word choice, sentence clarity, concision",
      score: hasSubstantialDraft ? 7 : 5,
      maxScore: 10,
      feedback: `Revise for the reader named in the brief: ${audience}. Prefer concrete nouns and remove sentences that do not move the piece toward its goal.`,
    },
    {
      id: "voice",
      label: "Voice & Tone",
      description: "Consistency and appropriateness of voice for audience",
      score: hasBrief ? 8 : 5,
      maxScore: 10,
      feedback: hasBrief
        ? `The target tone is clear: ${tone}. Keep checking diction against that promise.`
        : "The tone needs a project brief before it can be evaluated with confidence.",
    },
    {
      id: "mechanics",
      label: "Grammar & Mechanics",
      description: "Spelling, punctuation, grammar correctness",
      score: hasSubstantialDraft ? 8 : 6,
      maxScore: 10,
      feedback: hasSubstantialDraft
        ? "The draft is ready for sentence-level cleanup after the argument pass. Start with repeated openings, vague intensifiers, and overlong sentences."
        : "Mechanics are secondary until there is enough prose to edit. Draft first, polish after the shape exists.",
    },
    {
      id: "citation",
      label: "Citations & Sources",
      description: "Proper attribution and source quality",
      score: citationCount > 0 ? Math.min(8, 4 + citationCount) : 3,
      maxScore: 10,
      feedback:
        citationCount > 0
          ? "Detected source markers should be matched against a references section before the draft is considered complete."
          : "Add references for factual claims, definitions, data, and any point where reader trust depends on outside support.",
    },
    {
      id: "engagement",
      label: "Reader Engagement",
      description: "Ability to hold attention and create interest",
      score: hasBrief && hasSubstantialDraft ? 7 : 5,
      maxScore: 10,
      feedback: `The engagement test is whether the reader reaches this outcome: ${successSignal}. Make that promise visible in the opening movement.`,
    },
  ];

  const totalScore = criteria.reduce((sum, c) => sum + c.score, 0);
  const maxTotal = criteria.reduce((sum, c) => sum + c.maxScore, 0);
  const overallScore = Math.round((totalScore / maxTotal) * 100);

  let grade = "C";
  if (overallScore >= 90) grade = "A";
  else if (overallScore >= 85) grade = "A-";
  else if (overallScore >= 80) grade = "B+";
  else if (overallScore >= 75) grade = "B";
  else if (overallScore >= 70) grade = "B-";
  else if (overallScore >= 65) grade = "C+";
  else if (overallScore >= 60) grade = "C";

  return {
    criteria,
    overallScore,
    overallGrade: grade,
    summary: hasSubstantialDraft
      ? `The draft is ready for a goal-driven revision pass. Strongest next move: align evidence, structure, and tone around ${goal}.`
      : "The project brief is in place. The main gap is drafting enough body text for the rubric to evaluate beyond intent.",
    timestamp: Date.now(),
  };
}
