import { component$, type PropFunction } from "@qwik.dev/core";
import ImgApprovalStamp from "../../media/approval-stamp.svg?jsx";
import { renderMarkdown } from "../../utils/markdown";
import { SpeakButton } from "../ui/speak-button";
import type { SuggestionPopover } from "./editor-state";

interface SuggestionPanelProps {
  suggestion: SuggestionPopover | null;
  stampVisible: boolean;
  onClose$: PropFunction<() => void>;
  onStrike$: PropFunction<() => void>;
  onAccept$: PropFunction<() => void>;
}

/** The accept-or-strike decision surface for a persona's proposed rewrite. */
export const SuggestionPanel = component$<SuggestionPanelProps>((props) => {
  const suggestion = props.suggestion;

  return (
    <>
      {suggestion && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-6"
          style="background: rgba(20, 16, 10, 0.55);"
          role="dialog"
          aria-label={`Proposed edit from ${suggestion.author}`}
          onClick$={props.onClose$}
        >
          <div
            class="bg-[var(--color-paper)] border-2 w-full max-w-xl flex flex-col"
            style={{
              "border-color": suggestion.color,
              "border-radius": "4px",
              "box-shadow": "0 20px 50px rgba(0,0,0,0.35)",
            }}
            onClick$={(event) => event.stopPropagation()}
          >
            <div
              class="px-5 py-3 border-b flex items-baseline justify-between gap-3"
              style={{
                "border-color": "var(--color-paper-3)",
                background: "var(--color-paper-soft)",
              }}
            >
              <p
                class="text-[0.7rem] tracking-[0.14em] uppercase"
                style={{
                  fontFamily: "var(--font-typewriter)",
                  color: suggestion.color,
                }}
              >
                {suggestion.author} proposes
              </p>
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
                  class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] text-base"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div class="px-5 py-4 space-y-3">
              <p
                class="text-[0.85rem] leading-6 line-through text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {suggestion.original}
              </p>
              <p
                data-speech-id={`suggestion-${suggestion.id}`}
                class="text-[0.95rem] leading-6 text-[var(--color-ink)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {suggestion.replacement}
              </p>
              {suggestion.rationale && (
                <div
                  class="comment-markdown text-[0.78rem] italic leading-5 text-[var(--color-ink-light)]"
                  style={{ fontFamily: "var(--font-serif)" }}
                  dangerouslySetInnerHTML={renderMarkdown(suggestion.rationale)}
                />
              )}
              <div class="pt-2 flex gap-2 justify-end">
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
        <div class="approval-stamp-overlay" aria-hidden="true">
          <ImgApprovalStamp aria-hidden="true" width="220" height="220" />
        </div>
      )}
    </>
  );
});
