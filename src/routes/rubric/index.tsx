import {
  component$,
  useStore,
  useStylesScoped$,
  useVisibleTask$,
} from "@qwik.dev/core";
import { Link, type DocumentHead } from "@qwik.dev/router";
import type { RubricResult } from "../../types";
import {
  loadActiveFolioIdFromIdb,
  loadRubricResultFromIdb,
} from "../../utils/idb";
import { renderMarkdown } from "../../utils/markdown";
import { GradeStamp } from "../../components/rubric/grade-stamp";

interface RubricPageStore {
  result: RubricResult | null;
  loaded: boolean;
}

const GRADE_COLOR: Record<string, string> = {
  "A+": "var(--color-accent-green)",
  A: "var(--color-accent-green)",
  "A-": "var(--color-accent-green)",
  "B+": "var(--color-accent-blue)",
  B: "var(--color-accent-blue)",
  "B-": "var(--color-accent-blue)",
  "C+": "var(--color-accent-amber)",
  C: "var(--color-accent-amber)",
  "C-": "var(--color-accent-amber)",
  "D+": "var(--color-vermilion)",
  D: "var(--color-vermilion)",
  "D-": "var(--color-vermilion)",
  F: "var(--color-vermilion)",
};

function scoreColor(score: number, max: number): string {
  const pct = score / max;
  if (pct >= 0.8) return "var(--color-accent-green)";
  if (pct >= 0.6) return "var(--color-accent-amber)";
  return "var(--color-accent-red)";
}

function pct(n: number): number {
  return Math.round(n * 100);
}

/** Concrete, prescriptive next step for a low-scoring criterion. */
function nextMoveFor(id: string): string {
  const moves: Record<string, string> = {
    thesis:
      "State the load-bearing claim in one sentence near the top, then make every section earn it.",
    evidence:
      "Pick the two weakest claims and attach a source, example, or number to each.",
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

/** Static curve anchors for "the brutal curve" explainer. */
const CURVE_ANCHORS: Array<[number, number, string]> = [
  [
    50,
    50,
    "A C-grade draft stays a C. It may have a promising idea, but it is not ready to carry the reader yet.",
  ],
  [
    60,
    58,
    "A coherent draft with a clear point, still needing substantial revision before publication.",
  ],
  [
    70,
    67,
    "A strong first pass: an engaging class essay, blog post, or early magazine draft with room to sharpen.",
  ],
  [
    80,
    76,
    "A polished, publishable-feeling essay or reported feature, with a few visible limits keeping it from the top tier.",
  ],
  [
    90,
    86,
    "A prize-caliber essay, reported feature, or literary piece may fit here, possibly Pulitzer-level if that is what the draft is aiming to be and the execution earns it.",
  ],
  [
    95,
    93,
    "Rare, field-leading work: the kind of piece an editor would build a cover, issue, or shortlist around.",
  ],
  [
    100,
    100,
    "A virtually unimprovable draft for its purpose, audience, and form.",
  ],
];

export default component$(() => {
  const store = useStore<RubricPageStore>({ result: null, loaded: false });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const folioId = await loadActiveFolioIdFromIdb();
    const cached = await loadRubricResultFromIdb(folioId);
    if (cached) store.result = cached;
    store.loaded = true;
  });

  useStylesScoped$(`
    .card {
      border: 1px solid var(--color-paper-3);
      background-color: var(--color-paper);
      background-image: url("/assets/rubric-proof-fibers.png");
      background-size: 24rem 24rem;
      border-radius: 4px;
    }
    .bar {
      height: 4px;
      background: var(--color-paper-2);
      border-radius: 2px;
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
    }
    .anchor {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      padding: 0.65rem 0.85rem;
      border-bottom: 1px dashed var(--color-paper-3);
    }
    .anchor:last-child { border-bottom: none; }
  `);

  return (
    <div
      class="min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-5xl mx-auto px-6 py-8">
        <div class="flex items-center justify-between mb-6">
          <div>
            <p
              class="dept-label mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Twyne
            </p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1.75rem",
                color: "var(--color-ink)",
              }}
            >
              The Galley Proof
            </h1>
            <p class="text-sm text-[var(--color-ink-light)] mt-1">
              The full breakdown — what the judges said, what the rubric
              counted, what to fix next.
            </p>
          </div>
          <Link
            href="/editor"
            class="btn-paper text-sm"
            style={{ fontFamily: "var(--font-display)" }}
          >
            ← Back to desk
          </Link>
        </div>

        {!store.loaded && (
          <p class="text-sm text-[var(--color-ink-muted)]">Loading…</p>
        )}

        {store.loaded && !store.result && (
          <div class="card p-8 text-center">
            <p
              class="text-4xl"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-cobalt)",
              }}
            >
              ❧
            </p>
            <p class="mt-3 text-sm text-[var(--color-ink-light)] max-w-md mx-auto">
              No galley on file yet. Open the proof desk in the right panel and
              run
              <em> Send to copyedit</em> to start.
            </p>
            <Link href="/editor" class="btn-press mt-4 inline-block text-sm">
              ← Back to desk
            </Link>
          </div>
        )}

        {store.result && (
          <div class="space-y-6">
            {/* Overall */}
            <section class="card p-6">
              <div class="flex items-stretch gap-6">
                <GradeStamp
                  grade={store.result.overallGrade}
                  score={store.result.overallScore}
                  color={
                    GRADE_COLOR[store.result.overallGrade] ?? "var(--color-ink)"
                  }
                  size="report"
                  animated
                />
                <div class="flex-1 min-w-0">
                  <p class="dept-label">Editor's Mark</p>
                  <p
                    class="mt-0.5 text-2xl text-[var(--color-ink)]"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 600,
                    }}
                  >
                    {store.result.overallScore}
                    <span class="text-sm text-[var(--color-ink-muted)]">
                      {" "}
                      / 100
                    </span>
                  </p>
                  <p
                    class="mt-2 text-sm leading-6 text-[var(--color-ink-light)]"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {store.result.summary}
                  </p>
                  <p
                    class="mt-3 text-[0.65rem] text-[var(--color-ink-muted)]"
                    style={{
                      fontFamily: "var(--font-typewriter)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {new Date(store.result.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            </section>

            {/* The brutal curve */}
            <section class="card p-6">
              <p class="dept-label">The Brutal Curve</p>
              <h2
                class="mt-0.5 text-lg text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
              >
                Why a "good" draft is still a C
              </h2>
              <p
                class="mt-2 text-xs leading-5 text-[var(--color-ink-light)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                The raw score is a blend, not a plain average: the judges' mean
                opinion counts for 45%, but the single harshest judge's score
                also counts on its own for 35% — so one editor who really isn't
                convinced can drag the grade down even if the rest of the room
                liked it. Mechanical polish (structure, pacing, citations) is
                the remaining 20%, deliberately a minor share, since clean prose
                around a hollow argument shouldn't read as a good draft. That
                raw blend is then curved: Twyne compresses the middle of the
                scale and stretches the top, so a 90+ is reserved for genuinely
                excellent work.
              </p>
              <div class="mt-4">
                {CURVE_ANCHORS.map(([raw, final, note]) => (
                  <div key={raw} class="anchor">
                    <div>
                      <span
                        class="font-mono text-sm"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        raw {raw}
                      </span>
                      <span
                        class="ml-2 text-[0.7rem] text-[var(--color-ink-muted)]"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          letterSpacing: "0.1em",
                        }}
                      >
                        → final {final}
                      </span>
                    </div>
                    <p
                      class="text-xs text-[var(--color-ink-light)]"
                      style={{ fontFamily: "var(--font-serif)" }}
                    >
                      {note}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* Full narrative review */}
            {store.result.review && (
              <section class="card p-6">
                <p class="dept-label">The Critic's Full Review</p>
                <div
                  class="comment-markdown mt-3 text-[15px] leading-7 text-[var(--color-ink)]"
                  style={{ fontFamily: "var(--font-serif)" }}
                  dangerouslySetInnerHTML={renderMarkdown(store.result.review)}
                />
              </section>
            )}

            {/* Per-persona judges */}
            {store.result.judges && store.result.judges.length > 0 && (
              <section class="card p-6">
                <p class="dept-label">The Judges' Verdict</p>
                <h2
                  class="mt-0.5 text-lg text-[var(--color-ink)]"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                >
                  Persona-by-persona
                </h2>
                <ul class="mt-3 space-y-2.5">
                  {store.result.judges.map((j) => (
                    <li
                      key={j.personaId}
                      class="flex items-start gap-3 border-b border-dashed border-[var(--color-paper-3)] pb-2.5 last:border-b-0 last:pb-0"
                    >
                      <span
                        class="font-mono text-base flex-shrink-0 w-8 text-right"
                        style={{
                          color: scoreColor(j.score, 10),
                          fontWeight: 700,
                        }}
                      >
                        {j.score}
                      </span>
                      <div class="flex-1">
                        <p
                          class="text-sm text-[var(--color-ink)]"
                          style={{
                            fontFamily: "var(--font-display)",
                            fontWeight: 600,
                          }}
                        >
                          {j.personaId}
                        </p>
                        <p
                          class="text-xs text-[var(--color-ink-light)] mt-0.5"
                          style={{ fontFamily: "var(--font-serif)" }}
                        >
                          {j.rationale}
                        </p>
                        <p
                          class="mt-0.5 text-[0.6rem] text-[var(--color-ink-muted)]"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            letterSpacing: "0.1em",
                          }}
                        >
                          provider: {j.provider}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Per-criterion breakdown */}
            <section class="card p-6">
              <p class="dept-label">The Criteria</p>
              <h2
                class="mt-0.5 text-lg text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
              >
                What the rubric counts
              </h2>
              <div class="mt-4 space-y-4">
                {store.result.criteria.map((c, idx) => {
                  const ratio = c.score / c.maxScore;
                  const widthPct = pct(ratio);
                  const color = scoreColor(c.score, c.maxScore);
                  return (
                    <div
                      key={c.id}
                      class="border-b border-dashed border-[var(--color-paper-3)] pb-4 last:border-b-0 last:pb-0"
                    >
                      <div class="flex items-baseline justify-between gap-3 mb-1.5">
                        <div class="flex items-baseline gap-2 min-w-0">
                          <span
                            class="text-[0.7rem] flex-shrink-0"
                            style={{
                              fontFamily: "var(--font-typewriter)",
                              color: "var(--color-ink-muted)",
                              letterSpacing: "0.15em",
                            }}
                          >
                            §{idx + 1}
                          </span>
                          <span
                            class="text-sm text-[var(--color-ink)]"
                            style={{
                              fontFamily: "var(--font-display)",
                              fontWeight: 600,
                            }}
                          >
                            {c.label}
                          </span>
                        </div>
                        <span
                          class="text-xs flex-shrink-0 font-mono"
                          style={{ color, letterSpacing: "0.1em" }}
                        >
                          {c.score}/{c.maxScore} · {widthPct}%
                        </span>
                      </div>
                      <div class="bar mb-2" role="meter" aria-label={c.label}>
                        <span
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                      <p
                        class="text-xs leading-5 text-[var(--color-ink-light)]"
                        style={{ fontFamily: "var(--font-serif)" }}
                      >
                        {c.feedback}
                      </p>
                      {ratio < 0.6 && (
                        <p
                          class="mt-1.5 text-[11px] leading-5"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            color: "var(--color-vermilion)",
                          }}
                        >
                          Next move → {nextMoveFor(c.id)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Static features */}
            {store.result.staticScore && (
              <section class="card p-6">
                <p class="dept-label">Static Features</p>
                <h2
                  class="mt-0.5 text-lg text-[var(--color-ink)]"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                >
                  What the rubric counted
                </h2>
                <div class="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                  {(
                    [
                      ["length", "Length"],
                      ["structure", "Structure"],
                      ["pacing", "Pacing"],
                      ["evidence", "Evidence"],
                      ["vocabulary", "Vocabulary"],
                      ["paragraphShape", "Paragraph shape"],
                    ] as const
                  ).map(([key, label]) => {
                    const v = store.result!.staticScore!.perFeature[key];
                    return (
                      <div
                        key={key}
                        class="border border-[var(--color-paper-3)] p-3"
                        style={{
                          borderRadius: "2px",
                          background: "var(--color-paper-2)",
                        }}
                      >
                        <p
                          class="text-[0.6rem] text-[var(--color-ink-muted)]"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            letterSpacing: "0.1em",
                          }}
                        >
                          {label}
                        </p>
                        <p
                          class="mt-1 text-base font-mono"
                          style={{ color: scoreColor(v, 10) }}
                        >
                          {v.toFixed(1)}/10
                        </p>
                      </div>
                    );
                  })}
                </div>
                <p
                  class="mt-3 text-xs text-[var(--color-ink-light)]"
                  style={{
                    fontFamily: "var(--font-typewriter)",
                    letterSpacing: "0.1em",
                  }}
                >
                  {store.result.staticScore.features.wordCount.toLocaleString()}{" "}
                  words · {store.result.staticScore.features.paragraphCount}{" "}
                  paragraphs · {store.result.staticScore.features.sentenceCount}{" "}
                  sentences · {store.result.staticScore.features.citationCount}{" "}
                  citations
                </p>
                {store.result.staticScore.feedback.length > 0 && (
                  <ul
                    class="mt-3 space-y-1 text-xs text-[var(--color-ink-light)]"
                    style={{
                      fontFamily: "var(--font-serif)",
                      listStyle: "disc",
                      paddingLeft: "1.25rem",
                    }}
                  >
                    {store.result.staticScore.feedback.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "The Galley Proof · Twyne",
  meta: [
    {
      name: "description",
      content:
        "The full Twyne rubric: per-criterion scores, judge verdicts, and the brutal curve.",
    },
  ],
};
