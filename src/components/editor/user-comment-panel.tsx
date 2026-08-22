import { component$, type PropFunction } from "@builder.io/qwik";
import { renderMarkdown } from "../../utils/markdown";
import { SpeakButton } from "../ui/speak-button";
import type { UserCommentPopover } from "./editor-state";

interface UserCommentPanelProps {
  comment: UserCommentPopover | null;
  onClose$: PropFunction<() => void>;
  onDraftChange$: PropFunction<(draft: string) => void>;
  onCreate$: PropFunction<() => void>;
  onDiscard$: PropFunction<() => void>;
  onSubmit$: PropFunction<(commentId: string) => void>;
  onToggleResolved$: PropFunction<(commentId: string) => void>;
  onDelete$: PropFunction<(commentId: string) => void>;
}

/** The writer's conversation around one inline comment mark. */
export const UserCommentPanel = component$<UserCommentPanelProps>((props) => {
  const comment = props.comment;
  const onDraftChange$ = props.onDraftChange$;
  const onCreate$ = props.onCreate$;
  const onDiscard$ = props.onDiscard$;
  const onSubmit$ = props.onSubmit$;
  const onToggleResolved$ = props.onToggleResolved$;
  const onDelete$ = props.onDelete$;

  if (!comment || !comment.visible) return null;

  const composing = comment.mode === "compose";

  return (
    <div
      class="manuscript-comment-card manuscript-comment-card--writer"
      style={{
        left: `${comment.x}px`,
        top: comment.top != null ? `${comment.top}px` : "auto",
        bottom: comment.bottom != null ? `${comment.bottom}px` : "auto",
        "max-height": `${comment.maxH}px`,
        "--comment-color": "var(--color-writer-note)",
      }}
      role="dialog"
      aria-label={
        composing ? "Write a margin note" : `Note from ${comment.author}`
      }
      onClick$={(event) => event.stopPropagation()}
    >
      <div class="manuscript-comment-card__head">
        <div class="min-w-0">
          <p class="manuscript-comment-card__author">You</p>
          <p
            class="manuscript-comment-card__label"
            style={{
              color: comment.resolved
                ? "var(--color-accent-green)"
                : "var(--color-writer-note)",
            }}
          >
            {composing
              ? "New margin"
              : `${comment.resolved ? "resolved" : "open"} · ${timeAgo(comment.createdAt)}`}
          </p>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          {!composing && (
            <SpeakButton
              compact
              id={`user-comment-${comment.id}`}
              text={comment.text}
            />
          )}
          <button
            onClick$={props.onClose$}
            class="manuscript-comment-card__close"
            aria-label="Close margin note"
          >
            ✕
          </button>
        </div>
      </div>

      <div class="manuscript-comment-card__body">
        {comment.quote && (
          <blockquote class="manuscript-comment-card__quote">
            {`« ${comment.quote.length > 280 ? comment.quote.slice(0, 279) + "…" : comment.quote} »`}
          </blockquote>
        )}

        {composing ? (
          <div class="manuscript-comment-card__composer">
            <textarea
              autoFocus
              value={comment.draft}
              onInput$={(_, element) => onDraftChange$(element.value)}
              onKeyDown$={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key === "Enter" &&
                  comment.draft.trim()
                ) {
                  event.preventDefault();
                  onCreate$();
                }
                if (event.key === "Escape") onDiscard$();
              }}
              placeholder="What belongs in the margin here?"
              class="manuscript-comment-card__textarea"
              rows={5}
            />
            <div class="manuscript-comment-card__actions">
              <span>⌘↩ to place</span>
              <div class="flex gap-2">
                <button onClick$={onDiscard$} class="btn-paper text-[11px]">
                  Discard
                </button>
                <button
                  onClick$={onCreate$}
                  disabled={!comment.draft.trim()}
                  class="btn-press text-[11px] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Place note
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              data-speech-id={`user-comment-${comment.id}`}
              class="comment-markdown text-[0.95rem] leading-6 text-[var(--color-ink)]"
              style="font-family: var(--font-serif);"
              dangerouslySetInnerHTML={renderMarkdown(comment.text)}
            />

            {comment.replies.length > 0 && (
              <div
                class="pt-2 mt-2 border-t border-dashed space-y-2"
                style={{ "border-color": "var(--color-paper-3)" }}
              >
                {comment.replies.map((reply) => (
                  <div key={reply.id} class="text-[0.85rem]">
                    <p
                      class="text-[0.6rem] tracking-[0.16em] uppercase"
                      style={{
                        fontFamily: "var(--font-typewriter)",
                        color:
                          reply.authorKind === "persona" && reply.color
                            ? reply.color
                            : "var(--color-ink-muted)",
                      }}
                    >
                      {reply.author}
                      {reply.authorKind === "persona" && (
                        <span class="ml-1.5 opacity-70">editor</span>
                      )}{" "}
                      · {timeAgo(reply.createdAt)}
                    </p>
                    <div
                      class="comment-markdown mt-0.5 text-[var(--color-ink-light)] leading-5"
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle:
                          reply.authorKind === "persona" ? "italic" : "normal",
                      }}
                      dangerouslySetInnerHTML={renderMarkdown(reply.text)}
                    />
                  </div>
                ))}
              </div>
            )}

            <div class="manuscript-comment-card__composer">
              <textarea
                value={comment.draft}
                onInput$={(_, element) => onDraftChange$(element.value)}
                onKeyDown$={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    onSubmit$(comment.id);
                  }
                }}
                placeholder="Reply as the writer…"
                class="manuscript-comment-card__textarea"
                rows={3}
              />
              <div class="manuscript-comment-card__actions">
                <span>⌘↩ to reply</span>
                <div class="flex gap-2">
                  <button
                    onClick$={() => onToggleResolved$(comment.id)}
                    class="btn-paper text-[11px]"
                  >
                    {comment.resolved ? "Reopen" : "Resolve"}
                  </button>
                  <button
                    onClick$={() => onDelete$(comment.id)}
                    class="btn-paper text-[11px] text-[var(--color-vermilion)]"
                  >
                    Erase
                  </button>
                  <button
                    onClick$={() => onSubmit$(comment.id)}
                    disabled={!comment.draft.trim()}
                    class="btn-press text-[11px] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Reply
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
