import {
  $,
  useComputed$,
  component$,
  sync$,
  type PropFunction,
} from "@qwik.dev/core";
import { renderMarkdown } from "../../utils/markdown";
import { CommentBody } from "../comments/comment-body";
import { SpeakButton } from "../ui/speak-button";
import { PersonaPortrait } from "../personas/persona-portrait";
import { resolvePersonaPortrait } from "../../utils/persona-portrait";
import { useAuth } from "../../utils/auth-context";
import {
  accountAvatarUrl,
  accountDisplayName,
} from "../../utils/account-display";
import { stopSpeech } from "../../utils/speech";
import {
  CardBust,
  CardMenu,
  CardNotice,
  CheckIcon,
  CloseIcon,
  ExpandIcon,
  openFullThread,
  SendIcon,
  useSpeechError,
} from "./card-parts";
import type { UserCommentPopover } from "./editor-state";

interface UserCommentPanelProps {
  comment: UserCommentPopover | null;
  onClose$: PropFunction<() => void>;
  onCreate$: PropFunction<() => void>;
  onDiscard$: PropFunction<() => void>;
  onSubmit$: PropFunction<(commentId: string) => void>;
  onToggleResolved$: PropFunction<(commentId: string) => void>;
  onDelete$: PropFunction<(commentId: string) => void>;
}

/**
 * The writer's conversation around one inline comment mark: the same two
 * boxes as a persona's note, with the writer's own face on the first.
 */
export const UserCommentPanel = component$<UserCommentPanelProps>((props) => {
  const comment = props.comment;
  const onCreate$ = props.onCreate$;
  const onDiscard$ = props.onDiscard$;
  const onSubmit$ = props.onSubmit$;
  const onToggleResolved$ = props.onToggleResolved$;
  const onDelete$ = props.onDelete$;
  const auth = useAuth();
  const speechError = useSpeechError(
    useComputed$(() => `user-comment-${props.comment?.id ?? ""}`),
  );
  // Enter sends and Shift+Enter breaks the line, as in every chat box.
  const holdEnter = sync$((event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing)
      event.preventDefault();
  });

  if (!comment || !comment.visible) return null;

  const composing = comment.mode === "compose";
  const user = auth.value.user;
  const writer = user ? accountDisplayName(user) : "You";
  const avatar = accountAvatarUrl(user?.image);

  return (
    <div
      class={[
        "manuscript-comment-card manuscript-comment-card--writer user-comment-card twyne-card",
        { "is-in-margin": !!comment.margin, "is-resolved": comment.resolved },
      ]}
      data-margin-item={comment.margin ?? undefined}
      style={{
        left: `${comment.x}px`,
        top: comment.top != null ? `${comment.top}px` : "auto",
        bottom: comment.bottom != null ? `${comment.bottom}px` : "auto",
        "max-height": `${comment.maxH}px`,
        width: comment.width ? `${comment.width}px` : undefined,
        "--comment-color": "var(--color-writer-note)",
      }}
      role="dialog"
      aria-label={
        composing ? "Write a margin note" : `Note from ${comment.author}`
      }
      onClick$={(event) => event.stopPropagation()}
    >
      {!composing && (
        <section class="persona-note__note">
          <div class="persona-note__head">
            <CardBust
              personaId="writer"
              name={writer}
              imageUrl={avatar}
              color="var(--color-writer-note)"
            />
            <span class="user-comment-card__when">
              {timeAgo(comment.createdAt)}
            </span>
            <div class="persona-note__tools">
              <span class="persona-note__tool">
                <SpeakButton
                  id={`user-comment-${comment.id}`}
                  text={comment.text}
                />
              </span>
              <button
                type="button"
                class={[
                  "persona-note__tool user-comment-card__resolve focus-ring",
                  { "is-on": comment.resolved },
                ]}
                aria-pressed={comment.resolved}
                aria-label={comment.resolved ? "Reopen" : "Resolve"}
                title={
                  comment.resolved ? "Resolved — reopen" : "Mark resolved"
                }
                onClick$={() => onToggleResolved$(comment.id)}
              >
                <CheckIcon />
              </button>
              <CardMenu>
                <button
                  type="button"
                  role="menuitem"
                  class="focus-ring"
                  onClick$={() => onDelete$(comment.id)}
                >
                  Erase this note
                </button>
              </CardMenu>
              <button
                type="button"
                class="persona-note__tool focus-ring"
                aria-label="Open in Comments"
                title="Open in Comments — ask an editor, see every note"
                onClick$={() => {
                  openFullThread({ kind: "comment", id: comment.id });
                  props.onClose$();
                }}
              >
                <ExpandIcon />
              </button>
              <button
                type="button"
                onClick$={props.onClose$}
                class="persona-note__tool focus-ring"
                aria-label="Close margin note"
                title="Close"
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div class="persona-note__scroll">
            <div
              data-speech-id={`user-comment-${comment.id}`}
              class="comment-markdown persona-note__text"
            >
              <CommentBody text={comment.text} />
            </div>

            {comment.replies.map((reply) =>
              reply.authorKind === "persona" ? (
                <PersonaCommentReply
                  key={reply.id}
                  personaId={reply.personaId}
                  author={reply.author}
                  text={reply.text}
                />
              ) : (
                <div
                  key={reply.id}
                  class="persona-note__reply persona-note__reply--writer comment-markdown"
                  data-author-kind="user"
                  dangerouslySetInnerHTML={renderMarkdown(reply.text)}
                />
              ),
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
        </section>
      )}

      <form
        class="persona-note__compose"
        preventdefault:submit
        onSubmit$={() =>
          composing ? onCreate$() : onSubmit$(comment.id)
        }
      >
        {composing && (
          <span class="user-comment-card__face" title={writer}>
            <PersonaPortrait
              personaId="writer"
              name={writer}
              imageUrl={avatar}
              color="var(--color-writer-note)"
              size={26}
            />
          </span>
        )}
        <textarea
          autoFocus={composing}
          value={comment.draft}
          data-thread-draft-kind="comment"
          data-thread-draft-id={comment.id}
          onKeyDown$={[
            holdEnter,
            $((event: KeyboardEvent) => {
              if (event.key === "Escape" && composing) onDiscard$();
              if (event.key !== "Enter" || event.shiftKey || event.isComposing)
                return;
              if (!comment.draft.trim()) return;
              if (composing) onCreate$();
              else onSubmit$(comment.id);
            }),
          ]}
          placeholder={
            composing ? "What belongs in the margin here?" : "Write back…"
          }
          aria-label={composing ? "Margin note" : "Reply as the writer"}
          class="persona-note__input"
          rows={composing ? 2 : 1}
        />
        {composing && (
          <button
            type="button"
            onClick$={onDiscard$}
            class="persona-note__tool focus-ring"
            aria-label="Discard"
            title="Discard (Esc)"
          >
            <CloseIcon />
          </button>
        )}
        <button
          type="submit"
          class="persona-note__send focus-ring"
          disabled={!comment.draft.trim()}
          aria-label={composing ? "Place note" : "Reply"}
          title={composing ? "Place note (Enter)" : "Reply (Enter)"}
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
});

/** Rule and face in the persona's own colour, since the card is the writer's. */
const PersonaCommentReply = component$<{
  personaId?: string;
  author: string;
  text: string;
}>(({ personaId, author, text }) => {
  const color = resolvePersonaPortrait({ personaId, name: author }).color;
  return (
    <div
      class="persona-note__reply"
      data-author-kind="persona"
      style={{ "--comment-color": color }}
    >
      <span class="persona-note__guest" title={author}>
        <PersonaPortrait personaId={personaId} name={author} size={22} />
      </span>
      <div
        class="comment-markdown"
        dangerouslySetInnerHTML={renderMarkdown(text)}
      />
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
