import { component$ } from "@qwik.dev/core";
import type { NoteEvidence } from "../../utils/note-evidence";
import {
  REVEAL_QUOTE_EVENT,
  type RevealQuoteDetail,
} from "../../utils/quote-grounding";

/** One line of a 340px card, give or take. Inlined: Qwik segments do not
 * carry module constants a helper's default parameter reads. */
function short(text: string, max = 110): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Same event a quote link inside the note sends; the editor resolves it live. */
export function revealPassage(quote: string, context: string): void {
  window.dispatchEvent(
    new CustomEvent<RevealQuoteDetail>(REVEAL_QUOTE_EVENT, {
      detail: { quote, context },
    }),
  );
}

/**
 * The other passages a note draws on, and the facts the editor read on the
 * way. Each passage is a button that sends the writer to it in the draft; the
 * card's own anchor stays the blockquote above the note, so this list only
 * holds what the anchor does not.
 *
 * Passages are listed open — they are what turns "A and B are connected" into
 * something the writer can check in two clicks. Facts sit in a closed
 * disclosure: they support the note, they are not the note.
 */
export const NoteEvidenceList = component$<{
  evidence?: NoteEvidence;
  /** Note text, so a repeated passage is told apart by the note's words. */
  context: string;
  onColor?: boolean;
}>(({ evidence, context, onColor }) => {
  if (!evidence) return null;
  const { passages, facts } = evidence;
  if (passages.length === 0 && facts.length === 0) return null;
  const noteContext = context.slice(0, 400);
  return (
    <div class={["note-evidence", { "is-on-color": !!onColor }]}>
      {passages.length > 0 && (
        <div class="note-evidence__passages">
          <span class="note-evidence__label">also in the draft</span>
          <ul>
            {passages.map((passage) => (
              <li key={passage}>
                <button
                  type="button"
                  class="note-evidence__passage"
                  aria-label={`Show passage in the manuscript: ${short(passage, 200)}`}
                  title="Show this passage in the manuscript"
                  onClick$={(event) => {
                    event.stopPropagation();
                    revealPassage(passage, noteContext);
                  }}
                >
                  {`« ${short(passage)} »`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {facts.length > 0 && (
        <details
          class="note-evidence__facts"
          onClick$={(event) => event.stopPropagation()}
        >
          <summary>
            <span class="note-evidence__label">
              facts in the draft
            </span>
            <span class="note-evidence__count">{facts.length}</span>
          </summary>
          <dl>
            {facts.map((fact) => (
              <div key={fact.id} class="note-evidence__fact">
                <dt>{fact.label}</dt>
                <dd>
                  <span class="note-evidence__reading">
                    <span
                      class={[
                        "note-evidence__value",
                        { "is-near": !!fact.near },
                      ]}
                    >
                      {fact.value}
                    </span>
                    {fact.near && (
                      <span class="note-evidence__near">closest reading</span>
                    )}
                  </span>
                  {fact.passages.map((passage) => (
                    <button
                      key={passage}
                      type="button"
                      class="note-evidence__source"
                      aria-label={`Show where the draft says this: ${short(passage, 200)}`}
                      title="Show this passage in the manuscript"
                      onClick$={(event) => {
                        event.stopPropagation();
                        revealPassage(passage, noteContext);
                      }}
                    >
                      {`« ${short(passage, 80)} »`}
                    </button>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
});
