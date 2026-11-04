import {
  component$,
  useComputed$,
  type PropFunction,
} from "@qwik.dev/core";
import { WorkflowStamp } from "../ui/workflow-stamp";
import { renderMarkdown } from "../../utils/markdown";
import { SpeakButton } from "../ui/speak-button";
import { sentenceWordDiff, type WordDiff } from "../../utils/sentence-bench";
import { openLiveVoice } from "../../utils/live-voice-workspace";
import { stopSpeech } from "../../utils/speech";
import {
  CardBust,
  CardNotice,
  CheckIcon,
  CloseIcon,
  MicIcon,
  StrikeIcon,
  useSpeechError,
} from "./card-parts";
import type { SuggestionPopover } from "./editor-state";

interface SuggestionPanelProps {
  suggestion: SuggestionPopover | null;
  stampVisible: boolean;
  onClose$: PropFunction<() => void>;
  onStrike$: PropFunction<() => void>;
  onAccept$: PropFunction<() => void>;
}

/**
 * Below this share of unchanged text an inline diff is mostly strikethrough,
 * so the card shows the old wording above the new instead.
 */
const INLINE_DIFF_MIN_SAME = 0.35;

function readableDiff(original: string, replacement: string): WordDiff[] | null {
  const diff = sentenceWordDiff(original, replacement);
  const same = diff
    .filter((part) => part.kind === "same")
    .reduce((n, part) => n + part.text.trim().length, 0);
  const total = Math.max(original.trim().length, replacement.trim().length, 1);
  return same / total >= INLINE_DIFF_MIN_SAME ? diff : null;
}

/**
 * The accept-or-strike decision for a persona's proposed rewrite. It sits in
 * the margin beside its passage, like every other note, so the writer can
 * read the change against the text around it. The change reads as one
 * passage with the cut words struck and the new ones inked in.
 */
export const SuggestionPanel = component$<SuggestionPanelProps>((props) => {
  const suggestion = props.suggestion;
  const speechError = useSpeechError(
    useComputed$(() => `suggestion-${props.suggestion?.id ?? ""}`),
  );

  const diff = suggestion
    ? readableDiff(suggestion.original, suggestion.replacement)
    : null;

  return (
    <>
      {suggestion && (
        <div
          class={[
            "manuscript-comment-card suggestion-card twyne-card",
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
          <section class="persona-note__note">
            <div class="persona-note__head">
              <CardBust name={suggestion.author} />
              <div class="persona-note__tools">
                <button
                  type="button"
                  class="persona-note__tool persona-note__tool--talk focus-ring"
                  aria-label={`Talk with ${suggestion.author} about this edit`}
                  title={`Talk with ${suggestion.author}`}
                  onClick$={() =>
                    openLiveVoice(
                      suggestion.author,
                      suggestion.rationale || suggestion.replacement,
                    )
                  }
                >
                  <MicIcon />
                </button>
                <span class="persona-note__tool">
                  <SpeakButton
                  inheritColor
                    id={`suggestion-${suggestion.id}`}
                    text={suggestion.replacement}
                    author={suggestion.author}
                    label={suggestion.author}
                  />
                </span>
                <button
                  type="button"
                  onClick$={props.onClose$}
                  class="persona-note__tool focus-ring"
                  aria-label="Close proposed edit"
                  title="Close — decide later"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div class="persona-note__scroll">
              {diff ? (
                <p
                  class="suggestion-card__diff"
                  data-speech-id={`suggestion-${suggestion.id}`}
                >
                  {diff.map((part, i) =>
                    part.kind === "same" ? (
                      <span key={i}>{part.text}</span>
                    ) : part.kind === "removed" ? (
                      <del key={i}>{part.text}</del>
                    ) : (
                      <ins key={i}>{part.text}</ins>
                    ),
                  )}
                </p>
              ) : (
                <>
                  <p class="suggestion-card__struck">{suggestion.original}</p>
                  <p
                    data-speech-id={`suggestion-${suggestion.id}`}
                    class="suggestion-card__replacement"
                  >
                    {suggestion.replacement}
                  </p>
                </>
              )}
              {suggestion.rationale && (
                <div
                  class="comment-markdown suggestion-card__why"
                  dangerouslySetInnerHTML={renderMarkdown(suggestion.rationale)}
                />
              )}
              {speechError.value && (
                <CardNotice
                  tone="warning"
                  icon="voice"
                  message="Couldn’t read this aloud."
                  detail={speechError.value}
                  actionLabel="Voice settings"
                  actionHref="/settings/"
                  onDismiss$={() => stopSpeech()}
                />
              )}
            </div>

            <div class="suggestion-card__decide">
              <button
                type="button"
                onClick$={props.onStrike$}
                disabled={suggestion.busy}
                class="suggestion-card__strike focus-ring"
                aria-label="Strike — keep your wording"
                title="Strike — keep your wording"
              >
                <StrikeIcon />
              </button>
              <button
                type="button"
                onClick$={props.onAccept$}
                disabled={suggestion.busy}
                class="persona-note__send suggestion-card__accept focus-ring"
                aria-label={
                  suggestion.busy ? "Stamping…" : "Accept & stamp"
                }
                title="Accept & stamp"
                aria-busy={suggestion.busy}
              >
                <CheckIcon />
              </button>
            </div>
          </section>
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
