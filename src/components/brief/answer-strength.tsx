import { component$, type PropFunction } from "@qwik.dev/core";
import { isBinding } from "../../utils/brief-facets";
import {
  facetTally,
  type BriefField,
  type StrengthView,
} from "../../utils/brief-strength";

interface AnswerStrengthProps {
  strength: StrengthView;
  /** This answer is being judged right now. */
  reading?: boolean;
  /** Judgement is unreachable; say the grade is the first look only. */
  quickOnly?: boolean;
  /**
   * `full` sits under the field being answered and explains itself;
   * `compact` is the four-notch bar in the working copy.
   */
  variant?: "full" | "compact";
  /** The reading the writer picked when the answer fit two. */
  pickedSplit?: string;
  /** Optional override: answer the split from here instead of Particulars. */
  onPickSplit$?: PropFunction<(field: BriefField, option: string) => void>;
  /** Optional override: flip a constraint line between binding and weighed. */
  onToggleLine$?: PropFunction<(text: string) => void>;
}

const FACET_MARK = { yes: "✓", near: "~", no: "✗", unseen: "·" } as const;
const FACET_SAID = {
  yes: "Covered:",
  near: "Nearly:",
  no: "Missing:",
  unseen: "Not seen yet:",
} as const;

/**
 * How much of notch `n` (1–4) is filled, as a percentage. Every notch up to
 * the level is full, as it always was; the next one fills with the progress
 * the score shows through the level, so the bar never contradicts the label.
 */
function notchFill(score: number | undefined, level: number, n: number) {
  if (level >= n) return 100;
  if (score === undefined || level === 0 || n !== level + 1) return 0;
  const through = (score - (level - 1) * 25) / 25;
  return Math.round(Math.max(0, Math.min(1, through)) * 100);
}

/**
 * A password meter for brief answers, with its working shown: four notches
 * for Vague → Sharp, the checklist the level came from with the writer's own
 * words quoted beside each line, and the one thing that would raise it.
 * Constraints show each line as the room will use it instead.
 *
 * Nothing here needs a click. The split options and the line labels are
 * overrides for a writer who wants to answer early or disagrees.
 */
export const AnswerStrength = component$<AnswerStrengthProps>((props) => {
  const { strength } = props;
  const variant = props.variant ?? "full";
  // Each notch fills as the score crosses its quarter, so an edit that does
  // not change the level still visibly moves the bar.
  const notches = (
    <span class="answer-strength__notches" aria-hidden="true">
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          class="answer-strength__notch"
          data-lit={strength.level >= n ? "true" : undefined}
          style={{
            "--fill": `${notchFill(strength.score, strength.level, n)}%`,
          }}
        />
      ))}
    </span>
  );
  const score = strength.score;
  const delta = strength.delta ?? 0;

  if (variant === "compact") {
    return (
      <span
        class="answer-strength answer-strength--compact"
        data-level={strength.level}
        data-reading={props.reading ? "true" : undefined}
        title={[
          score === undefined
            ? strength.label
            : `${strength.label}, ${score} out of 100`,
          strength.hint,
        ]
          .filter(Boolean)
          .join(" — ")}
      >
        {notches}
        <span class="answer-strength__label">{strength.label}</span>
        {score !== undefined && strength.level > 0 && (
          <span
            class="answer-strength__score"
            data-provisional={strength.source === "jev" ? undefined : "true"}
            aria-hidden="true"
          >
            {strength.source === "jev" ? score : `~${score}`}
          </span>
        )}
      </span>
    );
  }

  const judged = strength.source === "jev";
  const source = props.reading
    ? "Judging this answer…"
    : judged
      ? strength.uncertain
        ? "Judged · a close call"
        : "Judged"
      : props.quickOnly
        ? "First look only"
        : "First look";
  const tally = facetTally(strength);
  const lines = strength.lines ?? [];
  const read = lines.filter((line) => line.kind);
  const binding = read.filter((line) => isBinding(line.kind!)).length;
  const weighed = read.filter((line) => line.kind === "preference").length;
  const restate = read.filter((line) => line.kind === "uncheckable").length;
  const split = strength.split;

  return (
    <div
      class="answer-strength answer-strength--full"
      data-level={strength.level}
      data-reading={props.reading ? "true" : undefined}
    >
      <div class="answer-strength__head">
        {notches}
        {/* Keyed on level so a change in grade replays the stamp. */}
        <span
          key={`${strength.level}-${strength.source}`}
          class="answer-strength__label answer-strength__label--stamp"
        >
          {strength.label}
        </span>
        {score !== undefined && strength.level > 0 && (
          <span
            class="answer-strength__score"
            data-provisional={judged ? undefined : "true"}
            title={
              judged
                ? "Strength of this answer, out of 100. A quarter of the range to each level."
                : "A first estimate while you type. It settles when this answer is judged."
            }
          >
            {/* Keyed on source so the settle replays when the judgement lands. */}
            <span
              key={judged ? "judged" : "estimate"}
              class="answer-strength__value"
            >
              {judged ? score : `~${score}`}
            </span>
            <span class="sr-only">
              {judged ? " out of 100" : " out of 100, estimated"}
            </span>
            {judged && delta !== 0 && (
              <span
                key={`${score}-${delta}`}
                class="answer-strength__delta"
                data-direction={delta > 0 ? "up" : "down"}
              >
                <span aria-hidden="true">{delta > 0 ? "▲" : "▼"}</span>
                {Math.abs(delta)}
                <span class="sr-only">
                  {delta > 0 ? " up" : " down"} since the last judgement
                </span>
              </span>
            )}
          </span>
        )}
        {tally && strength.level > 0 && (
          <span class="answer-strength__tally">
            {tally.met} of {tally.of}
          </span>
        )}
        <span class="answer-strength__source">{source}</span>
      </div>

      {strength.level > 0 && !!strength.facets?.length && (
        <ul
          class="answer-strength__facets"
          aria-label="What this answer covers"
        >
          {strength.facets.map((facet) => {
            const state =
              facet.met === true
                ? "yes"
                : facet.met === false
                  ? facet.near
                    ? "near"
                    : "no"
                  : "unseen";
            return (
              <li
                key={facet.id}
                class="answer-strength__facet"
                data-met={state}
              >
                <span class="answer-strength__mark" aria-hidden="true">
                  {FACET_MARK[state]}
                </span>
                <span>
                  <span class="sr-only">{FACET_SAID[state]} </span>
                  <span class="answer-strength__facet-name">{facet.name}</span>
                  {facet.quote && (
                    <>
                      {" "}
                      <q class="answer-strength__quote">{facet.quote}</q>
                    </>
                  )}
                  {facet.note && (
                    <span class="answer-strength__why"> {facet.note}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {lines.length > 0 && (
        <>
          <ul
            class="answer-strength__lines"
            aria-label="Constraints, as the room will use them"
          >
            {lines.map((line) => (
              <li
                key={line.text}
                class="answer-strength__line"
                data-kind={line.kind ?? undefined}
              >
                <span class="answer-strength__line-text">{line.text}</span>
                {line.kind && line.label ? (
                  props.onToggleLine$ ? (
                    <button
                      type="button"
                      class="answer-strength__kind"
                      aria-pressed={line.pinned ? "true" : "false"}
                      title={
                        isBinding(line.kind)
                          ? "Treat this as a preference instead"
                          : "Make this binding"
                      }
                      onClick$={() => props.onToggleLine$?.(line.text)}
                    >
                      {line.label}
                      {line.pinned && (
                        <span class="sr-only"> (set by you)</span>
                      )}
                    </button>
                  ) : (
                    <span class="answer-strength__kind">{line.label}</span>
                  )
                ) : (
                  props.reading && (
                    <span class="answer-strength__kind">Judging…</span>
                  )
                )}
                {line.note && line.kind && !isBinding(line.kind) && (
                  <p class="answer-strength__line-note">
                    {line.note}
                    {line.kind === "preference" && props.onToggleLine$ && (
                      <> Tap the label to make it binding.</>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {read.length === lines.length && (
            <p class="answer-strength__ledger">
              <span>
                Veto set ·{" "}
                <b>
                  {binding} of {lines.length}
                </b>{" "}
                {lines.length === 1 ? "line" : "lines"}
              </span>
              <span>
                Weighed · <b>{weighed}</b>
              </span>
              <span>
                Needs restating · <b>{restate}</b>
              </span>
            </p>
          )}
        </>
      )}

      <p class="answer-strength__note" role="status" aria-live="polite">
        <span class="sr-only">
          Answer strength: {strength.label}
          {score !== undefined && strength.level > 0
            ? `, ${score} out of 100`
            : ""}
          .{" "}
        </span>
        {(strength.noneDeclared ||
          (strength.level > 0 &&
            !strength.facets?.length &&
            !lines.length)) && (
          <span class="answer-strength__diagnosis">
            {strength.diagnosis.charAt(0).toUpperCase()}
            {strength.diagnosis.slice(1)}.{" "}
          </span>
        )}
        {strength.hint && (
          <span class="answer-strength__hint">
            {!!strength.facets?.length && strength.level > 0 && (
              <b class="answer-strength__add">Add</b>
            )}
            {strength.hint}
          </span>
        )}
      </p>

      {split && props.onPickSplit$ && (
        <div class="answer-strength__split">
          <p class="answer-strength__split-lead">{split.lead}</p>
          <div
            class="answer-strength__split-options"
            role="group"
            aria-label={split.prompt}
          >
            {split.options.map((option) => (
              <button
                key={option}
                type="button"
                class="answer-strength__split-option"
                aria-pressed={props.pickedSplit === option ? "true" : "false"}
                onClick$={() => props.onPickSplit$?.(split.field, option)}
              >
                {option}
              </button>
            ))}
          </div>
          <p class="answer-strength__split-foot">
            {props.pickedSplit
              ? "Filed to Particulars · the room reads your pick as binding"
              : "Waiting in Particulars · answer here or there"}
          </p>
        </div>
      )}
    </div>
  );
});
