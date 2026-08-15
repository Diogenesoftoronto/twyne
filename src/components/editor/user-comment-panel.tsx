import { component$, type PropFunction } from "@builder.io/qwik";
import { renderMarkdown } from "../../utils/markdown";
import { SpeakButton } from "../ui/speak-button";
import type { UserCommentPopover } from "./editor-state";

interface UserCommentPanelProps {
  comment: UserCommentPopover | null;
  onClose$: PropFunction<() => void>;
  onDraftChange$: PropFunction<(draft: string) => void>;
  onSubmit$: PropFunction<(commentId: string) => void>;
  onToggleResolved$: PropFunction<(commentId: string) => void>;
  onDelete$: PropFunction<(commentId: string) => void>;
}

/** The writer's conversation around one inline comment mark. */
export const UserCommentPanel = component$<UserCommentPanelProps>((props) => {
  const comment = props.comment;
  const onDraftChange$ = props.onDraftChange$;
  const onSubmit$ = props.onSubmit$;
  const onToggleResolved$ = props.onToggleResolved$;
  const onDelete$ = props.onDelete$;

  if (!comment) return null;

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-6"
      style="background: rgba(20, 16, 10, 0.55);"
      role="dialog"
      aria-label={`Comment from ${comment.author}`}
      onClick$={props.onClose$}
    >
      <div
        class="bg-[var(--color-paper)] border-2 w-full max-w-xl flex flex-col"
        style={{
          "border-color": comment.resolved
            ? "var(--color-accent-green)"
            : "var(--color-mustard)",
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
            class="text-[0.7rem] tracking-[0.18em] uppercase"
            style={{
              fontFamily: "var(--font-typewriter)",
              color: comment.resolved
                ? "var(--color-accent-green)"
                : "var(--color-mustard)",
            }}
          >
            {comment.resolved ? "resolved · " : "open · "}
            {timeAgo(comment.createdAt)}
          </p>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <SpeakButton
              compact
              id={`user-comment-${comment.id}`}
              text={comment.text}
            />
            <button
              onClick$={props.onClose$}
              class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] text-base"
              aria-label="Close comment"
            >
              ✕
            </button>
          </div>
        </div>

        <div class="px-5 py-4 space-y-3">
          <div
            data-speech-id={`user-comment-${comment.id}`}
            class="comment-markdown text-[1rem] leading-6 text-[var(--color-ink)]"
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

          <div
            class="pt-2 mt-2 border-t border-dashed"
            style={{ "border-color": "var(--color-paper-3)" }}
          >
            <textarea
              value={comment.draft}
              onInput$={(_, element) => onDraftChange$(element.value)}
              onKeyDown$={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  onSubmit$(comment.id);
                }
              }}
              placeholder="Reply as the writer…"
              class="w-full mt-2 px-2 py-1.5 text-xs bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)] resize-none focus:outline-none focus:border-[var(--color-mustard)]"
              style="font-family: var(--font-serif); border-radius: 2px;"
              rows={3}
            />
            <div class="mt-2 flex items-center justify-between gap-2">
              <span
                class="text-[10px] text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter); letter-spacing: 0.12em;"
              >
                ⌘↩ to reply
              </span>
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
        </div>
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
