import { component$, type PropFunction } from "@qwik.dev/core";
import type {
  DossierAttachment,
  DossierCheckResult,
  DossierProbe,
  ProjectInterviewAnswers,
} from "../../types";
import { isAnswered, probeAnswerText } from "../../utils/dossier-probes";

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
  const answeredProbes = props.probes.filter(isAnswered);
  const completedFields = Math.max(
    0,
    Math.min(
      FIELD_ORDER.length,
      props.reviewedFieldCount ??
        FIELD_ORDER.filter((field) => props.answers[field].trim().length > 0)
          .length,
    ),
  );
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
            {props.headline ??
              (props.answers.workingTitle.trim() || "Untitled dossier")}
          </h1>
        </div>
        <span class="stamp shrink-0 !px-2 !py-[0.15rem] !text-[0.55rem]">
          {completedFields} / {FIELD_ORDER.length} reviewed
        </span>
      </div>

      <dl class="mt-3 grid gap-1.5 sm:grid-cols-2">
        {FIELD_ORDER.map((field) => {
          const active = props.activeField === field;
          const value = props.answers[field];
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
                {FIELD_LABELS[field]}
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

          const shellClass = `min-w-0 border px-2.5 py-1.5 text-left ${
            active
              ? "field-live"
              : "border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] hover:border-[var(--color-ink-muted)]"
          }`;

          return props.onJumpToField$ ? (
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
            {answeredProbes.length}/{props.probes.length} answered ·{" "}
            {props.existingMaterialWords ?? 0} words ·{" "}
            {props.attachments.length} refs
          </p>
        </div>
        {props.probes.length > 0 ? (
          <ol class="mt-1 space-y-0.5">
            {props.probes.map((probe, index) => (
              <li
                key={probe.id}
                class="flex gap-1.5 text-[0.7rem] leading-[1.4] text-[var(--color-ink-light)]"
                style={{ fontFamily: "var(--font-serif)" }}
                title={
                  isAnswered(probe)
                    ? `${probe.prompt} — ${probeAnswerText(probe)}`
                    : probe.prompt
                }
              >
                <span
                  class="shrink-0 text-[var(--color-vermilion)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {index + 1}.
                </span>
                <span class="min-w-0 truncate">
                  {isAnswered(probe) ? (
                    <>
                      <span class="text-[var(--color-ink-muted)]">
                        {probe.prompt}
                      </span>{" "}
                      <span class="text-[var(--color-ink)]">
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
            ))}
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
