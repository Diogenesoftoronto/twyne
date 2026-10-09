import { component$, type PropFunction } from "@qwik.dev/core";
import { WorkflowStamp } from "../ui/workflow-stamp";
import { renderMarkdown } from "../../utils/markdown";
import { SpeakButton } from "../ui/speak-button";
import { PersonaMasthead } from "../personas/persona-portrait";
import type { SuggestionPopover } from "./editor-state";

interface SuggestionPanelProps {
  suggestion: SuggestionPopover | null;
  stampVisible: boolean;
  onClose$: PropFunction<() => void>;
  onStrike$: PropFunction<() => void>;
  onAccept$: PropFunction<() => void>;
}

/**
 * The accept-or-strike decision for a persona's proposed rewrite. It sits in
 * the margin beside its passage, like every other note, so the writer can
 * read the change against the text around it.
 */
export const SuggestionPanel = component$<SuggestionPanelProps>((props) => {
  const suggestion = props.suggestion;

  return (
    <>
      {suggestion && (
        <div
          class={[
            "manuscript-comment-card suggestion-card",
            { "is-in-margin": !!suggestion.margin },
          ]}
          data-margin-item={suggestion.margin ?? undefined}
          role="dialog"
          aria-label={`Proposed edit from ${suggestion.author}`}
          style={{
            left: `${suggestion.x}px`,
            top: suggestion.top != null ? `${suggestion.top}px` : "auto",
            bottom:
              suggestion.bottom != null ? `${suggestion.bottom}px` : "auto",
            "max-height": `${suggestion.maxH}px`,
            width: suggestion.width ? `${suggestion.width}px` : undefined,
            "--comment-color": suggestion.color,
          }}
          onClick$={(event) => event.stopPropagation()}
        >
          <div class="manuscript-comment-card__head persona-critique-head">
            <PersonaMasthead
              name={suggestion.author}
              label="proposes"
              size={56}
            />
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <SpeakButton
                compact
                id={`suggestion-${suggestion.id}`}
                text={suggestion.replacement}
                author={suggestion.author}
                label={suggestion.author}
              />
              <button
                onClick$={props.onClose$}
                class="manuscript-comment-card__close"
                aria-label="Close proposed edit"
              >
                ✕
              </button>
            </div>
          </div>
          <div class="manuscript-comment-card__body">
            <p class="suggestion-card__struck">{suggestion.original}</p>
            <p
              data-speech-id={`suggestion-${suggestion.id}`}
              class="suggestion-card__replacement"
            >
              {suggestion.replacement}
            </p>
            {suggestion.rationale && (
              <div
                class="comment-markdown suggestion-card__why"
                dangerouslySetInnerHTML={renderMarkdown(suggestion.rationale)}
              />
            )}
            <div class="manuscript-comment-card__actions">
              <span>Strike or keep</span>
              <div class="flex gap-2">
                <button
                  onClick$={props.onStrike$}
                  disabled={suggestion.busy}
                  class="btn-paper text-xs"
                >
                  Strike
                </button>
                <button
                  onClick$={props.onAccept$}
                  disabled={suggestion.busy}
                  class="btn-press text-xs"
                >
                  {suggestion.busy ? "Stamping…" : "Accept & stamp"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {props.stampVisible && (
        <div
          class="approval-stamp-overlay"
          role="status"
          aria-label="Revision applied"
        >
          <WorkflowStamp kind="revised" />
        </div>
      )}
    </>
  );
});
