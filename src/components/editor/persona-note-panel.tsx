import { component$, type PropFunction } from "@builder.io/qwik";
import { renderMarkdown } from "../../utils/markdown";
import { SpeakButton } from "../ui/speak-button";
import type { NotePopover } from "./editor-state";

interface PersonaNotePanelProps {
  note: NotePopover | null;
  onPin$: PropFunction<(noteId: string) => void>;
  onClose$: PropFunction<() => void>;
  onDraftChange$: PropFunction<(draft: string) => void>;
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
  const onDraftChange$ = props.onDraftChange$;
  const onReply$ = props.onReply$;
  const onStrike$ = props.onStrike$;

  if (!note) return null;

  return (
    <div
      class="persona-note-card fixed z-50 flex flex-col"
      role="dialog"
      aria-label={`Note from ${note.author}`}
      style={{
        left: `${note.x}px`,
        top: note.top != null ? `${note.top}px` : "auto",
        bottom: note.bottom != null ? `${note.bottom}px` : "auto",
        width: "340px",
        "max-height": `${note.maxH}px`,
        background: "var(--color-paper)",
        border: `2px solid ${note.color}`,
        "border-radius": "4px",
        "box-shadow": "0 14px 36px rgba(0,0,0,0.28)",
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
      <div
        class="px-5 py-3 border-b flex items-baseline justify-between gap-3"
        style={{
          "border-color": "var(--color-paper-3)",
          background: "var(--color-paper-soft)",
        }}
      >
        <div class="min-w-0">
          <p
            class="text-base text-[var(--color-ink)] truncate"
            style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
          >
            {note.author}
          </p>
          {note.label && (
            <p
              class="text-[0.7rem] tracking-[0.14em] uppercase mt-0.5"
              style={{
                fontFamily: "var(--font-typewriter)",
                color: note.color,
              }}
            >
              {note.label}
            </p>
          )}
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <SpeakButton
            compact
            id={`note-popover-${note.id}`}
            text={note.note}
            author={note.author}
            label={note.author}
          />
          <button
            onClick$={onClose$}
            class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] text-base"
            aria-label="Close note"
          >
            ✕
          </button>
        </div>
      </div>

      <div class="px-5 py-4 space-y-3 overflow-y-auto">
        {note.quote && (
          <blockquote
            class="text-[0.85rem] leading-6 text-[var(--color-ink-light)] border-l-2 pl-3 italic"
            style={{ "border-color": note.color }}
          >
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

        <div
          class="pt-2 border-t border-dashed"
          style={{ "border-color": "var(--color-paper-3)" }}
        >
          <textarea
            value={note.draft}
            onInput$={(_, element) => onDraftChange$(element.value)}
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
  author: string;
  text: string;
  color: string;
}>((props) => (
  <div class="flex justify-start" data-author-kind="persona">
    <PersonaReplyBubble {...props} />
  </div>
));

const PersonaReplyBubble = component$<{
  author: string;
  text: string;
  color: string;
}>(({ author, text, color }) => (
  <div
    class="max-w-[85%] px-3 py-2 border text-[0.85rem] leading-5 text-[var(--color-ink)]"
    style={{
      "background-color": color,
      "border-color": color,
      "border-radius": "6px 6px 6px 2px",
      fontFamily: "var(--font-serif)",
    }}
  >
    <p
      class="text-[0.6rem] tracking-[0.14em] uppercase mb-1"
      style={{
        fontFamily: "var(--font-typewriter)",
        color: "var(--color-paper)",
        opacity: "0.9",
      }}
    >
      {author}
    </p>
    <div
      class="comment-markdown comment-markdown-on-color whitespace-pre-wrap"
      style={{ color: "var(--color-paper)" }}
      dangerouslySetInnerHTML={renderMarkdown(text)}
    />
  </div>
));
