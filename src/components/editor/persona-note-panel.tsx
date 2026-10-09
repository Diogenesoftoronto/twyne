import { component$, type PropFunction } from "@qwik.dev/core";
import { renderMarkdown } from "../../utils/markdown";
import { SpeakButton } from "../ui/speak-button";
import { PersonaMasthead } from "../personas/persona-portrait";
import type { NotePopover } from "./editor-state";
import { openLiveVoice } from "../../utils/live-voice-workspace";

interface PersonaNotePanelProps {
  note: NotePopover | null;
  onPin$: PropFunction<(noteId: string) => void>;
  onClose$: PropFunction<() => void>;
  onReply$: PropFunction<
    (noteId: string, text: string, author: string) => void
  >;
  onStrike$: PropFunction<(noteId: string) => void>;
}

/** The anchored conversation with a persona about one marked passage. */
export const PersonaNotePanel = component$<PersonaNotePanelProps>((props) => {
  const note = props.note;
  const onPin$ = props.onPin$;
  const onClose$ = props.onClose$;
  const onReply$ = props.onReply$;
  const onStrike$ = props.onStrike$;

  if (!note) return null;

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
        if (!note.pinned) onPin$(note.id);
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
      <div class="manuscript-comment-card__head persona-critique-head">
        <PersonaMasthead name={note.author} label={note.label} size={56} />
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            class="tool-btn"
            aria-label={`Talk with ${note.author} about this note`}
            title={`Talk with ${note.author}`}
            onClick$={() => openLiveVoice(note.author, note.note)}
          >
            ◉
          </button>
          <SpeakButton
            compact
            id={`note-popover-${note.id}`}
            text={note.note}
            author={note.author}
            label={note.author}
          />
          <button
            onClick$={onClose$}
            class="manuscript-comment-card__close"
            aria-label="Close note"
          >
            ✕
          </button>
        </div>
      </div>

      <div class="manuscript-comment-card__body">
        {note.quote && (
          <blockquote class="manuscript-comment-card__quote">
            {`« ${note.quote.length > 280 ? note.quote.slice(0, 279) + "…" : note.quote} »`}
          </blockquote>
        )}
        <div
          data-speech-id={`note-popover-${note.id}`}
          class="comment-markdown text-[0.95rem] leading-6 text-[var(--color-ink)]"
          style={{ fontFamily: "var(--font-serif)" }}
          dangerouslySetInnerHTML={renderMarkdown(note.note)}
        />
        {note.briefTitle && (
          <p
            class="text-[0.65rem] text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {`filed against “${note.briefTitle}”`}
          </p>
        )}

        {note.thread.length > 0 && (
          <div class="persona-note-thread space-y-2 pt-2">
            {note.thread.map((reply) =>
              reply.authorKind === "user" ? (
                <WriterThreadReply key={reply.id} text={reply.text} />
              ) : (
                <PersonaThreadReply
                  key={reply.id}
                  personaId={reply.personaId}
                  author={reply.author}
                  text={reply.text}
                  color={note.color}
                />
              ),
            )}
          </div>
        )}

        {note.replying && note.streamingReply.trim() && (
          <div class="persona-note-streaming flex justify-start">
            <PersonaReplyBubble
              author={note.author}
              text={note.streamingReply}
              color={note.color}
            />
          </div>
        )}
        {note.replying && !note.streamingReply.trim() && (
          <div
            class="persona-note-typing flex items-center gap-2 pt-1 italic text-[0.75rem] text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            <span class="typing-dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
            <span>{note.author} is typing…</span>
          </div>
        )}
        {note.error && (
          <p
            class="persona-note-error text-[0.7rem] leading-4 pt-1 text-[var(--color-vermilion)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {note.error}
          </p>
        )}

        <div class="manuscript-comment-card__composer">
          <textarea
            value={note.draft}
            data-thread-draft-kind="note"
            data-thread-draft-id={note.id}
            onKeyDown$={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                note.draft.trim()
              ) {
                event.preventDefault();
                onReply$(note.id, note.draft, note.author);
              }
            }}
            placeholder={`Reply to ${note.author}…`}
            aria-label={`Reply to ${note.author}`}
            class="manuscript-comment-card__textarea"
            rows={3}
          />
          <div class="manuscript-comment-card__actions">
            <span>⌘↩ to reply</span>
            <div class="flex gap-2">
              <button
                onClick$={() => onStrike$(note.id)}
                class="btn-paper text-[11px]"
              >
                Strike
              </button>
              <button
                onClick$={() => onReply$(note.id, note.draft, note.author)}
                disabled={!note.draft.trim()}
                class="btn-press text-[11px] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Reply
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

const WriterThreadReply = component$<{ text: string }>(({ text }) => (
  <div class="flex justify-end" data-author-kind="user">
    <div
      class="max-w-[85%] px-3 py-2 border border-[var(--color-paper-3)] text-[0.85rem] leading-5 text-[var(--color-ink)]"
      style={{
        "background-color": "var(--color-paper-soft)",
        "border-radius": "6px 6px 2px 6px",
        fontFamily: "var(--font-serif)",
      }}
    >
      <p
        class="text-[0.6rem] tracking-[0.14em] uppercase mb-1 text-[var(--color-ink-muted)]"
        style={{ fontFamily: "var(--font-typewriter)" }}
      >
        You
      </p>
      <div
        class="comment-markdown whitespace-pre-wrap"
        dangerouslySetInnerHTML={renderMarkdown(text)}
      />
    </div>
  </div>
));

const PersonaThreadReply = component$<{
  personaId?: string;
  author: string;
  text: string;
  color: string;
}>((props) => (
  <div class="flex justify-start" data-author-kind="persona">
    <PersonaReplyBubble {...props} />
  </div>
));

const PersonaReplyBubble = component$<{
  personaId?: string;
  author: string;
  text: string;
  color: string;
}>(({ personaId, author, text, color }) => (
  <div
    class="max-w-[85%] px-3 py-2 border text-[0.85rem] leading-5 text-[var(--color-ink)]"
    style={{
      "background-color": color,
      "border-color": color,
      "border-radius": "6px 6px 6px 2px",
      fontFamily: "var(--font-serif)",
    }}
  >
    <PersonaMasthead
      personaId={personaId}
      name={author}
      size={56}
      onColor
      class="mb-2"
    />
    <div
      class="comment-markdown comment-markdown-on-color whitespace-pre-wrap"
      style={{ color: "var(--color-paper)" }}
      dangerouslySetInnerHTML={renderMarkdown(text)}
    />
  </div>
));
