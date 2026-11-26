import { component$, useSignal, type PropFunction } from "@qwik.dev/core";
import type {
  DossierAttachment,
  DossierCheckResult,
  DossierProbe,
  ProjectInterviewAnswers,
} from "../../types";
import { isAnswered, probeAnswerText } from "../../utils/dossier-probes";
import type { BriefEdition } from "../../utils/brief-history";
import {
  BEARING_LABELS,
  FIELD_DEPARTMENTS,
  LOAD_BEARING,
} from "../../utils/brief-facets";
import {
  standingFromViews,
  type BriefStanding,
  type FirstQuestion,
  type StrengthView,
  type Tension,
} from "../../utils/brief-strength";
import { AnswerStrength } from "./answer-strength";

const FIELD_LABELS: Record<keyof ProjectInterviewAnswers, string> = {
  workingTitle: "Working title",
  format: "Format",
  audience: "Audience",
  goal: "Goal",
  tone: "Tone",
  constraints: "Non-negotiables",
  successSignal: "Success signal",
};

const FIELD_ORDER: Array<keyof ProjectInterviewAnswers> = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
];

interface DossierPreviewProps {
  answers: ProjectInterviewAnswers;
  probes: DossierProbe[];
  attachments: DossierAttachment[];
  activeField?: keyof ProjectInterviewAnswers;
  existingMaterialWords?: number;
  mode: "first-run" | "refine";
  reviewedFieldCount?: number;
  draftReview?: DossierCheckResult | null;
  draftReviewLoading?: boolean;
  draftReviewError?: string | null;
  /**
   * Optional per-field marker class. The conversation surface uses it to show
   * how confident the room is in a field it inferred from talk rather than
   * from a typed answer; the form leaves it unset, because a field the writer
   * typed themselves has nothing to be uncertain about.
   */
  fieldTone?: Partial<Record<keyof ProjectInterviewAnswers, string>>;
  /** Replaces the working-title masthead — the conversation names its own state. */
  headline?: string;
  editions?: BriefEdition[];
  /** Live answer strength per field; omitted, the working copy shows no meter. */
  strengths?: Partial<Record<keyof ProjectInterviewAnswers, StrengthView>>;
  /** Fields Jev is reading right now. */
  strengthReading?: Partial<Record<keyof ProjectInterviewAnswers, boolean>>;
  /** Probability that a stranger could write the piece from this brief. */
  briefSufficiency?: number | null;
  /** Reader, goal and landing; derived from `strengths` when omitted. */
  standing?: BriefStanding;
  /** What a stranger handed this brief would ask first. */
  firstQuestion?: FirstQuestion | null;
  /** Two answers that pull against each other. */
  tension?: Tension | null;
  /** The Particular the writer just answered; its row stamps and scrolls into view. */
  recentProbeId?: string | null;
  /** Bumped per answer so repeated answers to one Particular replay the stamp. */
  recentProbeRevision?: number;
  onJumpToField$?: PropFunction<(field: keyof ProjectInterviewAnswers) => void>;
  onReadDraft$?: PropFunction<() => void>;
  onApplyObservation$?: PropFunction<(index: number) => void>;
  onDismissObservation$?: PropFunction<(index: number) => void>;
}

/**
 * The live dossier occupies the folio's left leaf. It is useful working
 * context, not a second summary card: every field is visible, the field being
 * typed carries a caret so the sheet visibly takes the strike, answered
 * Particulars are retained in order, and draft drift is reviewed in place.
 *
 * Density is the whole design constraint. The folio is locked to one viewport,
 * so this side earns its height in compact rows: long values clamp to three
 * lines unless they are the field under the carriage, the ledger collapses to
 * a single struck line, and the draft-alignment block is a one-line bar until
 * there is something to report.
 */
export const DossierPreview = component$((props: DossierPreviewProps) => {
  const selectedEditionId = useSignal<string | null>(null);
  const selectedEdition = props.editions?.find(
    (edition) => edition.id === selectedEditionId.value,
  );
  const answers = selectedEdition?.brief.answers ?? props.answers;
  const probes = selectedEdition?.brief.probes ?? props.probes;
  const attachments = selectedEdition?.brief.attachments ?? props.attachments;
  const answeredProbes = probes.filter(isAnswered);
  const completedFields = Math.max(
    0,
    Math.min(
      FIELD_ORDER.length,
      (selectedEdition ? FIELD_ORDER.length : props.reviewedFieldCount) ??
        FIELD_ORDER.filter((field) => answers[field].trim().length > 0).length,
    ),
  );
  // Editions are a record of what was filed, not something to grade live.
  const strengths = selectedEdition ? undefined : props.strengths;
  const graded = strengths
    ? FIELD_ORDER.filter((field) => answers[field].trim()).map(
        (field) => strengths[field]!,
      )
    : [];
  const standing =
    props.standing ??
    standingFromViews(strengths ?? {}, {
      sufficiency: props.briefSufficiency ?? null,
      contradiction: null,
    });
  const firstQuestion = selectedEdition ? null : props.firstQuestion;
  const tension = selectedEdition ? null : props.tension;
  const clip = (text: string) =>
    text.length > 64 ? `${text.slice(0, 63).trimEnd()}…` : text;
  const department = (field: keyof ProjectInterviewAnswers) =>
    `${FIELD_DEPARTMENTS[field].numeral}. ${FIELD_DEPARTMENTS[field].name}`;
  const hasReview = props.draftReview !== undefined || !!props.onReadDraft$;
  const observations = props.draftReview?.observations ?? [];

  return (
    <section aria-labelledby="atr-title">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="dept-label">
            {props.mode === "refine" ? "Edition · Revised" : "Working copy"}
          </p>
          <h1
            id="atr-title"
            class="mt-0.5 truncate text-[1.15rem] leading-tight text-[var(--color-ink)]"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              letterSpacing: "-0.015em",
            }}
          >
            {selectedEdition
              ? answers.workingTitle.trim() || "Untitled dossier"
              : (props.headline ??
                (answers.workingTitle.trim() || "Untitled dossier"))}
          </h1>
        </div>
        <span class="stamp shrink-0 !px-2 !py-[0.15rem] !text-[0.55rem]">
          {completedFields} / {FIELD_ORDER.length} reviewed
        </span>
      </div>

      {props.editions && props.editions.length > 0 && (
        <details class="mt-2 border-y border-[var(--color-paper-3)] py-1.5">
          <summary class="cursor-pointer text-[0.65rem] tracking-[0.12em] text-[var(--color-ink-muted)]">
            Earlier editions · {props.editions.length}
          </summary>
          <p class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]">
            Saved on this device.
          </p>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              class={`border px-2 py-1 text-left text-[0.65rem] ${
                selectedEdition ? "border-[var(--color-paper-3)]" : "field-live"
              }`}
              aria-pressed={!selectedEdition}
              onClick$={() => (selectedEditionId.value = null)}
            >
              Current brief
            </button>
            {props.editions.map((edition) => (
              <button
                key={edition.id}
                type="button"
                class={`border px-2 py-1 text-left text-[0.65rem] ${
                  selectedEdition?.id === edition.id
                    ? "field-live"
                    : "border-[var(--color-paper-3)]"
                }`}
                aria-pressed={selectedEdition?.id === edition.id}
                onClick$={() => (selectedEditionId.value = edition.id)}
                title={new Date(edition.savedAt).toLocaleString()}
              >
                {edition.brief.answers.workingTitle.trim() || "Untitled"} ·{" "}
                {new Date(edition.savedAt).toLocaleDateString()}
              </button>
            ))}
          </div>
          {selectedEdition && (
            <p class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]">
              Read-only edition saved{" "}
              {new Date(selectedEdition.savedAt).toLocaleString()}.
            </p>
          )}
        </details>
      )}

      {strengths && graded.length > 0 && (
        <div class="brief-standing">
          <div class="brief-standing__row" role="status">
            <span
              class="brief-standing__bearing"
              aria-label="The three answers the draft is measured against"
            >
              {LOAD_BEARING.map((field) => (
                <span
                  key={field}
                  title={
                    standing.held[field]
                      ? `${BEARING_LABELS[field]} holds`
                      : `${BEARING_LABELS[field]} is ${(strengths[field]?.label ?? "Missing").toLowerCase()}`
                  }
                >
                  <i
                    class="brief-standing__dot"
                    data-held={standing.held[field] ? "true" : undefined}
                    aria-hidden="true"
                  />
                  {BEARING_LABELS[field]}
                  <span class="sr-only">
                    {standing.held[field]
                      ? " holds"
                      : ` is ${(strengths[field]?.label ?? "Missing").toLowerCase()}`}
                  </span>
                </span>
              ))}
            </span>
            {props.briefSufficiency != null && (
              <span title="How likely a writer who has never met you could write this piece from the brief alone">
                Stranger could write it ·{" "}
                <b>
                  {props.briefSufficiency >= 0.7
                    ? "likely"
                    : props.briefSufficiency >= 0.4
                      ? "maybe"
                      : "not yet"}
                </b>
              </span>
            )}
          </div>
          {firstQuestion && (
            <p class="brief-standing__say">
              <span class="brief-standing__kicker">
                A stranger's first question
              </span>
              “{firstQuestion.question}” —{" "}
              {props.onJumpToField$ ? (
                <button
                  type="button"
                  class="brief-standing__link"
                  onClick$={() => props.onJumpToField$?.(firstQuestion.field)}
                >
                  {department(firstQuestion.field)}
                </button>
              ) : (
                department(firstQuestion.field)
              )}
            </p>
          )}
          {tension && (
            <p class="brief-standing__say">
              <span class="brief-standing__kicker">These two pull apart</span>
              {([tension.a, tension.b] as const).map((field, index) => (
                <>
                  {index === 1 && " against "}
                  {props.onJumpToField$ ? (
                    <button
                      type="button"
                      class="brief-standing__link"
                      onClick$={() => props.onJumpToField$?.(field)}
                    >
                      {department(field)}
                    </button>
                  ) : (
                    department(field)
                  )}{" "}
                  <q>{clip(tension.values[index])}</q>
                </>
              ))}
              . {tension.reason}
            </p>
          )}
        </div>
      )}

      <dl class="mt-3 grid gap-1.5 sm:grid-cols-2">
        {FIELD_ORDER.map((field) => {
          const active = !selectedEdition && props.activeField === field;
          const value = answers[field];
          const body = (
            <>
              <dt class="dept-label !text-[0.55rem] !tracking-[0.24em] flex items-center gap-1.5">
                {props.fieldTone && (
                  <span
                    class={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      props.fieldTone[field] ?? "bg-[var(--color-paper-3)]"
                    }`}
                    aria-hidden="true"
                  />
                )}
                <span class="min-w-0 truncate">{FIELD_LABELS[field]}</span>
                {strengths?.[field] && value.trim() && (
                  <span class="ml-auto shrink-0 normal-case">
                    <AnswerStrength
                      strength={strengths[field]!}
                      reading={props.strengthReading?.[field]}
                      variant="compact"
                    />
                  </span>
                )}
              </dt>
              <dd
                class="mt-0.5 text-[0.76rem] leading-[1.35] text-[var(--color-ink-light)] break-words"
                style={{
                  fontFamily: "var(--font-serif)",
                  ...(active
                    ? {}
                    : {
                        display: "-webkit-box",
                        WebkitLineClamp: "3",
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }),
                }}
              >
                {value || (
                  <span class="italic text-[var(--color-ink-muted)]">
                    Not decided yet.
                  </span>
                )}
                {active && <span class="type-caret" aria-hidden="true" />}
              </dd>
            </>
          );

          const pulled =
            !!tension && (tension.a === field || tension.b === field);
          const shellClass = `min-w-0 border px-2.5 py-1.5 text-left ${
            pulled ? "brief-field--tension " : ""
          }${
            active
              ? "field-live"
              : "border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] hover:border-[var(--color-ink-muted)]"
          }`;

          return props.onJumpToField$ && !selectedEdition ? (
            <button
              key={field}
              type="button"
              onClick$={() => props.onJumpToField$?.(field)}
              class={shellClass}
              aria-current={active ? "step" : undefined}
              title={value || `${FIELD_LABELS[field]} — not decided yet`}
            >
              {body}
            </button>
          ) : (
            <div
              key={field}
              class={shellClass}
              aria-current={active ? "step" : undefined}
            >
              {body}
            </div>
          );
        })}
      </dl>

      <div class="mt-2.5 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2.5 py-1.5">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p class="dept-label !text-[0.55rem]">Particulars</p>
          <p
            class="text-[0.6rem] tracking-[0.14em] uppercase text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {answeredProbes.length}/{probes.length} answered ·{" "}
            {props.existingMaterialWords ?? 0} words · {attachments.length} refs
          </p>
        </div>
        {probes.length > 0 ? (
          <ol class="mt-1 space-y-0.5">
            {probes.map((probe, index) => {
              const recent = props.recentProbeId === probe.id;
              return (
                <li
                  key={
                    recent
                      ? `${probe.id}:${props.recentProbeRevision ?? 0}`
                      : probe.id
                  }
                  data-probe-row={probe.id}
                  class={[
                    "flex gap-1.5 text-[0.7rem] leading-[1.4] text-[var(--color-ink-light)]",
                    recent && "probe-filed-flash",
                  ]}
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  <span
                    class="shrink-0 text-[var(--color-vermilion)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    {isAnswered(probe) ? "✓" : `${index + 1}.`}
                  </span>
                  <span class="min-w-0">
                    {isAnswered(probe) ? (
                      <>
                        <span class="line-clamp-2 text-[var(--color-ink-muted)]">
                          {probe.prompt}
                        </span>
                        <span class="block text-[var(--color-ink)]">
                          {probeAnswerText(probe)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span class="text-[var(--color-ink-muted)]">
                          {probe.prompt}
                        </span>{" "}
                        <span class="italic text-[var(--color-ink-muted)]">
                          Awaiting an answer.
                        </span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p
            class="mt-1 text-[0.7rem] leading-[1.4] text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            The Particulars questions will sharpen the softest parts of this
            brief.
          </p>
        )}
      </div>

      {hasReview && (
        <section class="mt-2.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2.5 py-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="dept-label !text-[0.55rem]">Draft alignment</p>
              <p
                class="text-[0.72rem] leading-[1.4] text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                Has the manuscript outgrown the brief? Nothing changes until you
                apply a suggestion.
              </p>
            </div>
            {props.onReadDraft$ && (
              <button
                type="button"
                onClick$={props.onReadDraft$}
                disabled={props.draftReviewLoading}
                class="btn-press shrink-0 !px-2.5 !py-1 !text-[0.65rem] disabled:opacity-40"
              >
                {props.draftReviewLoading ? "Reading draft…" : "Read my draft"}
              </button>
            )}
          </div>

          {props.draftReviewLoading && (
            <p
              class="mt-2 flex items-center gap-2 text-[0.7rem] text-[var(--color-ink-muted)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
              role="status"
            >
              <span
                class="h-2 w-2 rounded-full bg-[var(--color-mustard)] interview-stream-pulse"
                aria-hidden="true"
              />
              Comparing the manuscript with all seven dossier fields.
            </p>
          )}

          {props.draftReviewError && (
            <p
              class="mt-2 border border-[var(--color-vermilion)] bg-[color-mix(in_srgb,var(--color-vermilion)_7%,var(--color-paper))] px-2.5 py-1.5 text-[0.72rem] leading-[1.45] text-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-serif)" }}
              role="alert"
            >
              {props.draftReviewError}
            </p>
          )}

          {!props.draftReviewLoading &&
            props.draftReview &&
            observations.length === 0 && (
              <p
                class="mt-2 border border-[var(--color-accent-green)] bg-[color-mix(in_srgb,var(--color-accent-green)_8%,var(--color-paper))] px-2.5 py-1.5 text-[0.72rem] leading-[1.45] text-[var(--color-ink-light)]"
                style={{ fontFamily: "var(--font-serif)" }}
                role="status"
              >
                No drift found. The current manuscript still matches the
                dossier.
              </p>
            )}

          {observations.map((observation, index) => (
            <article
              key={`${observation.field}-${observation.suggested}-${index}`}
              class="mt-2 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2.5 py-2 folio-shift"
            >
              <p class="dept-label !text-[0.55rem]">
                {FIELD_LABELS[observation.field]}
              </p>
              <p
                class="mt-1 text-[0.74rem] leading-[1.45] text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {observation.reason}
              </p>
              <dl class="mt-1.5 grid gap-1.5 text-[0.7rem] sm:grid-cols-2">
                <div class="border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1.5">
                  <dt class="dept-label !text-[0.55rem]">Filed now</dt>
                  <dd class="mt-0.5 leading-[1.4] text-[var(--color-ink-light)]">
                    {observation.current ||
                      props.answers[observation.field] ||
                      "Not filed"}
                  </dd>
                </div>
                <div class="border border-[var(--color-mustard)] bg-[var(--color-paper)] px-2 py-1.5">
                  <dt class="dept-label !text-[0.55rem]">Suggested</dt>
                  <dd class="mt-0.5 leading-[1.4] text-[var(--color-ink)]">
                    {observation.suggested}
                  </dd>
                </div>
              </dl>
              <div class="mt-1.5 flex flex-wrap items-center gap-2">
                {observation.suggested && props.onApplyObservation$ && (
                  <button
                    type="button"
                    onClick$={() => props.onApplyObservation$?.(index)}
                    class="btn-press !px-2.5 !py-1 !text-[0.65rem]"
                  >
                    Apply to dossier
                  </button>
                )}
                {props.onDismissObservation$ && (
                  <button
                    type="button"
                    onClick$={() => props.onDismissObservation$?.(index)}
                    class="btn-paper !px-2.5 !py-1 !text-[0.65rem]"
                  >
                    Dismiss suggestion
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
});
