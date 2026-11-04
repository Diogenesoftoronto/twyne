import { GroundedNote } from "../personas/grounded-note";
import { NoteEvidenceList } from "../personas/note-evidence-list";
import {
  $,
  component$,
  sync$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import { renderMarkdown } from "../../utils/markdown";
import { revealQuoteFromEvent } from "../../utils/quote-grounding";
import { SpeakButton } from "../ui/speak-button";
import { PersonaPortrait } from "../personas/persona-portrait";
import { resolvePersonaPortrait } from "../../utils/persona-portrait";
import type { NotePopover } from "./editor-state";
import { openLiveVoice } from "../../utils/live-voice-workspace";
import { speechState, stopSpeech } from "../../utils/speech";

interface PersonaNotePanelProps {
  note: NotePopover | null;
  onPin$: PropFunction<(noteId: string) => void>;
  onClose$: PropFunction<() => void>;
  onReply$: PropFunction<
    (noteId: string, text: string, author: string) => void
  >;
  onStrike$: PropFunction<(noteId: string) => void>;
  onDismissError$?: PropFunction<(noteId: string) => void>;
}

/** A reply that landed this recently gets the arrival pulse. */
const FRESH_REPLY_MS = 2500;

/**
 * The anchored conversation with a persona about one marked passage.
 *
 * Two stacked boxes: the persona's engraving stands on the first, which
 * holds the note and the thread; the second is the reply. The face and the
 * card's colour already say who is speaking, and the marked passage sits
 * beside the card, so no name, role, label or quote repeats here.
 */
export const PersonaNotePanel = component$<PersonaNotePanelProps>((props) => {
  const note = props.note;
  const onPin$ = props.onPin$;
  const onClose$ = props.onClose$;
  const onReply$ = props.onReply$;
  const onStrike$ = props.onStrike$;
  const onDismissError$ = props.onDismissError$;
  const menuOpen = useSignal(false);
  /** Why this note would not read aloud, while that is still the case. */
  const speechError = useSignal("");
  const speechId = `note-popover-${note?.id ?? ""}`;

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const id = `note-popover-${track(() => props.note?.id) ?? ""}`;
    const sync = () => {
      const s = speechState();
      speechError.value =
        s.id === id && s.status === "error"
          ? s.error?.message || "The note could not be read aloud."
          : "";
    };
    sync();
    window.addEventListener("twyne:speech", sync);
    cleanup(() => window.removeEventListener("twyne:speech", sync));
  });
  // Enter sends and Shift+Enter breaks the line, as in every chat box.
  const holdEnter = sync$((event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing)
      event.preventDefault();
  });

  if (!note) return null;

  const streaming = note.replying && !!note.streamingReply.trim();
  const now = Date.now();
  const lastId = note.thread.at(-1)?.id;
  // Without an engraving there is no figure to stand on the box.
  const figure = !!resolvePersonaPortrait({ name: note.author }).src;

  return (
    <div
      class={[
        "persona-note-card manuscript-comment-card",
        { "is-in-margin": !!note.margin },
      ]}
      data-margin-item={note.margin ?? undefined}
      role="dialog"
      aria-label={`Note from ${note.author}`}
      style={{
        left: `${note.x}px`,
        top: note.top != null ? `${note.top}px` : "auto",
        bottom: note.bottom != null ? `${note.bottom}px` : "auto",
        "max-height": `${note.maxH}px`,
        width: note.width ? `${note.width}px` : undefined,
        "--comment-color": note.color,
      }}
      onClick$={(event) => {
        event.stopPropagation();
        if (!(event.target as HTMLElement).closest(".persona-note__menu"))
          menuOpen.value = false;
        if (!note.pinned) onPin$(note.id);
      }}
      onKeyDown$={(event) => {
        if (event.key === "Escape" && menuOpen.value) menuOpen.value = false;
      }}
      onMouseLeave$={(event) => {
        if (note.pinned || note.replying || note.thread.length > 0) return;
        const related = (event as MouseEvent)
          .relatedTarget as HTMLElement | null;
        if (related?.closest(".twyne-persona-note")) return;
        if (related?.closest(".twyne-mark-anchor")) return;
        onClose$();
      }}
    >
      <section class="persona-note__note">
        <div class="persona-note__head">
          <span class="persona-note__bust" title={note.author}>
            <PersonaPortrait
              name={note.author}
              framing={figure ? "figure" : "face"}
              size={figure ? 96 : 40}
              speaking={streaming ? "tts" : undefined}
            />
          </span>
          <div class="persona-note__tools">
            <button
              type="button"
              class="persona-note__tool persona-note__tool--talk focus-ring"
              aria-label={`Talk with ${note.author} about this note`}
              title={`Talk with ${note.author}`}
              onClick$={() => openLiveVoice(note.author, note.note)}
            >
              <MicIcon />
            </button>
            <span class="persona-note__tool">
              <SpeakButton
                id={speechId}
                text={note.note}
                author={note.author}
                label={note.author}
              />
            </span>
            <span class="persona-note__menu">
              <button
                type="button"
                class="persona-note__tool focus-ring"
                aria-label="More actions"
                title="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen.value}
                onClick$={() => (menuOpen.value = !menuOpen.value)}
              >
                <MoreIcon />
              </button>
              {menuOpen.value && (
                <span class="persona-note__menu-list" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    class="focus-ring"
                    onClick$={() => onStrike$(note.id)}
                  >
                    Strike — mark as addressed
                  </button>
                </span>
              )}
            </span>
            <button
              type="button"
              onClick$={onClose$}
              class="persona-note__tool focus-ring"
              aria-label="Close note"
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div class="persona-note__scroll">
          <GroundedNote
            data-speech-id={`note-popover-${note.id}`}
            class="comment-markdown persona-note__text"
            onClick$={(event: Event) => revealQuoteFromEvent(event)}
            text={note.note}
          />
          <NoteEvidenceList evidence={note.evidence} context={note.note} />

          {note.thread.map((reply) =>
            reply.authorKind === "user" ? (
              <WriterThreadReply key={reply.id} text={reply.text} />
            ) : (
              <PersonaThreadReply
                key={reply.id}
                personaId={reply.personaId}
                author={reply.author}
                noteAuthor={note.author}
                text={reply.text}
                fresh={
                  reply.id === lastId && now - reply.timestamp < FRESH_REPLY_MS
                }
              />
            ),
          )}

          {streaming && (
            <div
              class="persona-note__reply is-streaming"
              data-author-kind="persona"
            >
              <GroundedNote
                class="comment-markdown"
                onClick$={(event: Event) => revealQuoteFromEvent(event)}
                text={note.streamingReply}
              />
            </div>
          )}
          {note.replying && !streaming && (
            <div class="persona-note__thinking" role="status">
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span class="sr-only">{`${note.author} is replying`}</span>
            </div>
          )}
          {note.error && (
            <NoteNotice
              tone="error"
              message={note.error}
              actionLabel={note.draft.trim() ? "Send again" : undefined}
              onAction$={() => onReply$(note.id, note.draft, note.author)}
              onDismiss$={
                onDismissError$ ? () => onDismissError$(note.id) : undefined
              }
            />
          )}
          {speechError.value && (
            <NoteNotice
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

      <form
        class="persona-note__compose"
        preventdefault:submit
        onSubmit$={() => onReply$(note.id, note.draft, note.author)}
      >
        <textarea
          value={note.draft}
          data-thread-draft-kind="note"
          data-thread-draft-id={note.id}
          onKeyDown$={[
            holdEnter,
            $((event: KeyboardEvent) => {
              if (event.key !== "Enter" || event.shiftKey || event.isComposing)
                return;
              if (!note.draft.trim() || note.replying) return;
              onReply$(note.id, note.draft, note.author);
            }),
          ]}
          placeholder="Write back…"
          aria-label={`Reply to ${note.author}`}
          class="persona-note__input"
          rows={1}
        />
        <button
          type="submit"
          class="persona-note__send focus-ring"
          disabled={!note.draft.trim() || note.replying}
          aria-label="Reply"
          title="Reply (Enter)"
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
});

/**
 * One compact line inside the card: a tinted glyph, the message, and at most
 * one way forward. The card's own colour stays for the persona; tone colours
 * only the glyph and a hairline, so a warning never outshouts the note.
 */
const NoteNotice = component$<{
  tone: "error" | "warning";
  icon?: "alert" | "voice";
  message: string;
  /** The longer reason, on hover; the line itself stays short. */
  detail?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction$?: PropFunction<() => void>;
  onDismiss$?: PropFunction<() => void>;
}>((props) => (
  <div
    class="persona-note__notice"
    data-tone={props.tone}
    role={props.tone === "error" ? "alert" : "status"}
  >
    <span class="persona-note__notice-icon" aria-hidden="true">
      {props.icon === "voice" ? <MutedIcon /> : <AlertIcon />}
    </span>
    <p class="persona-note__notice-text" title={props.detail}>
      {props.message}{" "}
      {props.actionLabel && props.actionHref && (
        <a
          href={props.actionHref}
          class="persona-note__notice-action focus-ring"
        >
          {props.actionLabel}
        </a>
      )}
    </p>
    {props.actionLabel && !props.actionHref && props.onAction$ && (
      <button
        type="button"
        class="persona-note__notice-retry focus-ring"
        aria-label={props.actionLabel}
        title={props.actionLabel}
        onClick$={props.onAction$}
      >
        <RetryIcon />
      </button>
    )}
    {props.onDismiss$ && (
      <button
        type="button"
        class="persona-note__notice-dismiss focus-ring"
        aria-label="Dismiss"
        title="Dismiss"
        onClick$={props.onDismiss$}
      >
        <CloseIcon />
      </button>
    )}
  </div>
));

function AlertIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="M12 7v6"
        stroke="var(--color-paper)"
        stroke-width="2.4"
        stroke-linecap="round"
      />
      <circle cx="12" cy="17" r="1.4" fill="var(--color-paper)" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="2"
        width="6"
        height="12"
        rx="3"
        fill="currentColor"
        stroke="none"
      />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

const WriterThreadReply = component$<{ text: string }>(({ text }) => (
  <div
    class="persona-note__reply persona-note__reply--writer comment-markdown"
    data-author-kind="user"
    dangerouslySetInnerHTML={renderMarkdown(text)}
  />
));

/** Full width under the note; a face only when another persona joins in. */
const PersonaThreadReply = component$<{
  personaId?: string;
  author: string;
  noteAuthor: string;
  text: string;
  fresh: boolean;
}>(({ personaId, author, noteAuthor, text, fresh }) => (
  <div
    class={["persona-note__reply", { "is-fresh": fresh }]}
    data-author-kind="persona"
  >
    {author !== noteAuthor && (
      <span class="persona-note__guest" title={author}>
        <PersonaPortrait personaId={personaId} name={author} size={22} />
      </span>
    )}
    <GroundedNote
      class="comment-markdown"
      onClick$={(event: Event) => revealQuoteFromEvent(event)}
      text={text}
    />
  </div>
));
