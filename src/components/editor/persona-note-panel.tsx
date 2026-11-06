import { DestinationTag } from "../ui/destination-tag";
import { loadAiConsequence } from "../../utils/consequence";
import { GroundedNote } from "../personas/grounded-note";
import { NoteEvidenceList } from "../personas/note-evidence-list";
import {
  $,
  useComputed$,
  useSignal,
  useVisibleTask$,
  component$,
  sync$,
  type PropFunction,
} from "@qwik.dev/core";
import { renderMarkdown } from "../../utils/markdown";
import { revealQuoteFromEvent } from "../../utils/quote-grounding";
import { SpeakButton } from "../ui/speak-button";
import { PersonaPortrait } from "../personas/persona-portrait";
import { EditorialActivity } from "../ui/editorial-activity";
import type { NotePopover } from "./editor-state";
import { openLiveVoice } from "../../utils/live-voice-workspace";
import { stopSpeech } from "../../utils/speech";
import {
  CardBust,
  CardMenu,
  CardNotice,
  CloseIcon,
  ExpandIcon,
  MicIcon,
  openFullThread,
  SendIcon,
  useSpeechError,
} from "./card-parts";

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
  const destination = useSignal<"provider" | "credit">("credit");
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => { destination.value = await loadAiConsequence(); });
  const note = props.note;
  const onPin$ = props.onPin$;
  const onClose$ = props.onClose$;
  const onReply$ = props.onReply$;
  const onStrike$ = props.onStrike$;
  const onDismissError$ = props.onDismissError$;
  const speechId = `note-popover-${note?.id ?? ""}`;
  /** Why this note would not read aloud, while that is still the case. */
  const speechError = useSpeechError(
    useComputed$(() => `note-popover-${props.note?.id ?? ""}`),
  );
  // Enter sends and Shift+Enter breaks the line, as in every chat box.
  const holdEnter = sync$((event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing)
      event.preventDefault();
  });

  if (!note) return null;

  const streaming = note.replying && !!note.streamingReply.trim();
  const now = Date.now();
  const lastId = note.thread.at(-1)?.id;

  return (
    <div
      class={[
        "persona-note-card twyne-card manuscript-comment-card",
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
        if (!note.pinned) onPin$(note.id);
      }}
      onFocusIn$={() => {
        if (!note.pinned) onPin$(note.id);
      }}
    >
      <section class="persona-note__note">
        <div class="persona-note__head">
          <CardBust
            name={note.author}
            activity={note.replying ? "writing" : undefined}
          />
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
                inheritColor
                id={speechId}
                text={note.note}
                author={note.author}
                label={note.author}
              />
            </span>
            <CardMenu>
              <button
                type="button"
                role="menuitem"
                class="focus-ring"
                onClick$={() => onStrike$(note.id)}
              >
                Strike — mark as addressed
              </button>
            </CardMenu>
            <button
              type="button"
              class="persona-note__tool focus-ring"
              aria-label={`Open the full note from ${note.author}`}
              aria-haspopup="dialog"
              title="Open the full note"
              onClick$={() => {
                openFullThread({ kind: "note", id: note.id });
                onClose$();
              }}
            >
              <ExpandIcon />
            </button>
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
            <div class="py-3">
              <EditorialActivity label={`${note.author} is replying`} />
            </div>
          )}
          {note.error && (
            <CardNotice
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
          <DestinationTag to={destination.value} quiet />
        </button>
      </form>
    </div>
  );
});

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
