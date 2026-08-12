import {
  component$,
  useSignal,
  useStore,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { useConvexClient } from "../../utils/convex-context";
import type { ProjectBrief, Persona } from "../../types";
import {
  type UserComment,
  type UserCommentReply,
  loadUserComments,
  upsertUserComment,
  appendUserCommentReply,
  toggleUserCommentResolved,
  deleteUserComment,
} from "../../utils/user-comments";
import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";
import { loadPersonasFromIdb, loadAiSettingsFromIdb } from "../../utils/idb";
import { api } from "../../../convex/_generated/api";
import type { AiSettings } from "../../types";
import {
  hasConfiguredAiProvider,
  runClientAgent,
  normalizeAiSettings,
} from "../../utils/ai-client";
import {
  activeMentionQuery,
  applyMention,
  filterMentionables,
  mentionedIn,
  type Mentionable,
} from "../../utils/mentions";
import { renderMarkdown } from "../../utils/markdown";
import { MentionDropdown, mentionOptionId } from "../ui/mention-dropdown";
import { ApplicationNotice } from "../ui/application-notice";
import { SpeakButton } from "../ui/speak-button";
import { VoiceRecorder, type VoiceCapture } from "../ui/voice-recorder";
import {
  formatDuration,
  readVoiceNote,
  storeVoiceNote,
} from "../../utils/voice-notes";
import type { AppError } from "../../types/application-errors";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { toAgentPersona } from "../../../convex/agentPrompts";

function personaToMentionable(p: Persona): Mentionable {
  return {
    id: p.id,
    name: p.name,
    kind: "persona",
    icon: p.icon,
    color: p.color,
  };
}

interface CommentsStore {
  comments: UserComment[];
  newCommentText: string;
  replyingTo: string | null;
  /** Per-comment reply drafts (keyed by comment id). */
  replyDrafts: Record<string, string>;
  askPersonaFor: string | null;
  askPersonaId: string | null;
  isAskingEditor: boolean;
  /** Visible text from the editor response currently being generated. */
  streamingEditorReply: string;
  askError: AppError | null;
  personas: Persona[];
  aiSettings: AiSettings | null;
  /** Ids of threads whose anchor mark is gone from the doc. */
  ghostIds: Set<string>;
  /** Show only ghosts? Off by default; the chip flips it. */
  ghostsOnly: boolean;
  /** Which textarea is showing an @-mention dropdown ("new" or a comment id). */
  mentionTarget: "new" | string | null;
  /** The partial name typed after "@". */
  mentionQuery: string;
  /** Keyboard-highlighted candidate within the open dropdown. */
  mentionIndex: number;
}

interface CommentsPanelProps {
  brief: ProjectBrief | null;
  activeFolioId: string | null;
  /** Seed notes, for tests and isolated previews. Skips persisted storage when set. */
  initialComments?: UserComment[];
  /**
   * Human collaborators taggable alongside personas. Not wired to a data
   * source yet — pass the result of `api.collaboration.getCollaborators`
   * (mapped to `Mentionable`s with `kind: "collaborator"`) once a folio is
   * shared, and the @-mention flow picks them up with no further changes.
   */
  collaborators?: Mentionable[];
}

/** DOM id of the textarea a mention dropdown belongs to. */
function mentionInputId(target: "new" | string): string {
  return `margin-note-${target}`;
}

/** DOM id of the dropdown itself, for `aria-activedescendant`. */
function mentionListId(target: "new" | string): string {
  return `mention-list-${target}`;
}

/**
 * Put the caret back where `applyMention` left it. The textarea's value is
 * driven by the store, so the browser resets the caret to the end on
 * re-render — we have to restore it on the next frame, once Qwik has
 * flushed. Without this, tagging someone mid-sentence throws you to the end
 * of the note.
 */
function restoreMentionCaret(target: "new" | string, caret: number): void {
  if (typeof document === "undefined") return;
  requestAnimationFrame(() => {
    const el = document.getElementById(
      mentionInputId(target),
    ) as HTMLTextAreaElement | null;
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  });
}

/**
 * Should this blur close the mention dropdown? Clicking a suggestion blurs
 * the textarea, and tearing the panel down at that moment is what used to
 * swallow the selection — so ignore blurs that land inside the dropdown.
 */
function blurLeavesMentionUi(event: FocusEvent): boolean {
  const next = event.relatedTarget;
  if (!(next instanceof Element)) return true;
  return !next.closest("[data-mention-dropdown]");
}

function commentProviderError(operation: string): AppError {
  return createAppError("PROVIDER_ERROR", {
    source: "provider",
    recovery: { action: "retry", canRetry: true },
    metadata: { feature: "comments", operation },
  });
}

function commentConfigurationError(operation: string): AppError {
  return createAppError("CONFIGURATION_ERROR", {
    source: "application",
    recovery: { action: "choose-provider", canRetry: false },
    metadata: { feature: "comments", operation },
  });
}

function normalizeCommentError(
  scope: string,
  thrown: unknown,
  source: "convex" | "provider",
  operation: string,
): AppError {
  const metadata = { feature: "comments", operation };
  reportApplicationDiagnostic(scope, thrown, metadata);
  return normalizeApplicationError(thrown, { source, metadata });
}

export const CommentsPanel = component$(
  ({
    brief,
    activeFolioId,
    initialComments,
    collaborators,
  }: CommentsPanelProps) => {
    const clientSig = useConvexClient();
    const store = useStore<CommentsStore>({
      comments: initialComments ?? [],
      newCommentText: "",
      replyingTo: null,
      replyDrafts: {},
      askPersonaFor: null,
      askPersonaId: null,
      isAskingEditor: false,
      streamingEditorReply: "",
      askError: null,
      personas: DEFAULT_PERSONAS,
      aiSettings: null,
      ghostIds: new Set<string>(),
      ghostsOnly: false,
      mentionTarget: null,
      mentionQuery: "",
      mentionIndex: 0,
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async () => {
      if (initialComments) return;
      store.comments = (await loadUserComments()).filter(
        (comment) => comment.folioId === activeFolioId,
      );
      const custom = await loadPersonasFromIdb();
      if (custom && custom.length > 0) store.personas = custom;
      const aiRaw = await loadAiSettingsFromIdb();
      store.aiSettings = normalizeAiSettings(aiRaw);
    });

    // Refresh when a comment is filed or replied to elsewhere in the editor.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
      const refresh = () => {
        void loadUserComments().then((all) => {
          if (initialComments) return;
          store.comments = all.filter(
            (comment) => comment.folioId === activeFolioId,
          );
        });
      };
      const onScroll = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        const id = typeof detail === "string" ? detail : detail?.id;
        if (!id) return;
        const el = document.querySelector(`[data-comment-id="${id}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      window.addEventListener("twyne:user-comments-changed", refresh);
      window.addEventListener("twyne:scroll-to-comment", onScroll);
      return () => {
        window.removeEventListener("twyne:user-comments-changed", refresh);
        window.removeEventListener("twyne:scroll-to-comment", onScroll);
      };
    });

    const triggerMentions = $((commentId: string, text: string) => {
      // Personas + (eventually) collaborators. Computed inline rather than
      // via a shared helper because Qwik's $() boundaries can't close over
      // local functions — only serializable values.
      const mentionables: Mentionable[] = [
        ...store.personas.map(personaToMentionable),
        ...(collaborators ?? []),
      ];
      for (const m of mentionedIn(text, mentionables)) {
        switch (m.kind) {
          case "persona":
            void askEditor(commentId, m.id);
            break;
          case "collaborator":
            // No-op for now: tagging a collaborator just highlights them in
            // the thread. Wire a notification here once one exists.
            break;
        }
      }
    });

    const addComment = $(async () => {
      if (!store.newCommentText.trim()) return;
      const comment: UserComment = {
        id: `c-${Date.now()}`,
        folioId: activeFolioId ?? "",
        text: store.newCommentText,
        author: "You",
        resolved: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        replies: [],
      };
      const all = await upsertUserComment(comment);
      store.comments = all;
      store.newCommentText = "";
      window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
      void triggerMentions(comment.id, comment.text);
    });

    /**
     * File a spoken note. The transcript becomes the comment text so it
     * threads, resolves and @-mentions like any other; the recording is kept
     * locally and playable from the card, because the transcript is not the
     * whole of what the writer said.
     */
    const addVoiceComment = $(async (capture: VoiceCapture) => {
      const transcript = capture.transcript.trim();
      if (!transcript) return;
      const id = `c-${Date.now()}`;
      const audioId = `va-${id}`;
      try {
        await storeVoiceNote(audioId, capture.blob);
      } catch (err) {
        // Losing the audio must not lose the words.
        reportApplicationDiagnostic("twyne:comments:store-voice-note", err, {
          feature: "comments",
          operation: "store-voice-note",
        });
      }
      const comment: UserComment = {
        id,
        folioId: activeFolioId ?? "",
        text: transcript,
        author: "You",
        resolved: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        replies: [],
        audioId,
        audioDurationMs: capture.durationMs,
      };
      const all = await upsertUserComment(comment);
      store.comments = all;
      window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
      void triggerMentions(comment.id, comment.text);
    });

    const addReply = $(async (commentId: string, text: string) => {
      if (!text.trim()) return;
      const reply: UserCommentReply = {
        id: `r-${Date.now()}`,
        author: "You",
        authorKind: "user",
        text,
        createdAt: Date.now(),
      };
      const all = await appendUserCommentReply(commentId, reply);
      store.comments = all;
      store.replyingTo = null;
      window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
      void triggerMentions(commentId, text);
    });

    const resolveComment = $(async (commentId: string) => {
      const all = await toggleUserCommentResolved(commentId);
      store.comments = all;
      window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
    });

    const deleteComment = $(async (commentId: string) => {
      const all = await deleteUserComment(commentId);
      store.comments = all;
      window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
    });

    /**
     * Ask an editor to weigh in on a comment thread. Pulls the persona's
     * voice, anchors the question on the quoted passage, and appends the
     * response as a persona-kind reply so the editor's colour + voice are
     * preserved.
     */
    const askEditor = $(
      async (commentId: string, personaIdOverride?: string) => {
        const personaId = personaIdOverride ?? store.askPersonaId;
        if (!personaId) return;
        const comment = store.comments.find((c) => c.id === commentId);
        if (!comment) return;
        const persona = store.personas.find((p) => p.id === personaId);
        if (!persona) return;
        const client = clientSig.value;
        store.askPersonaFor = commentId;
        store.askPersonaId = personaId;

        // Build the message — anchor + thread, mirror the inline-note call shape.
        const userMessage = [
          comment.anchor ? `On the passage: «${comment.anchor}»` : null,
          `The writer's note: ${comment.text}`,
          comment.replies.length > 0
            ? `The thread so far: ${comment.replies
                .map((r) => `${r.author}: ${r.text}`)
                .join(" · ")}`
            : null,
          "Reply as if you are this editor — one paragraph, your voice.",
        ]
          .filter(Boolean)
          .join("\n\n");

        const priorMessages = comment.replies.map((r) => ({
          author: r.authorKind,
          text: r.text,
        }));

        store.isAskingEditor = true;
        store.streamingEditorReply = "";
        store.askError = null;
        try {
          let replyText = "";

          // ── Try client-side AI first (BYOK) ─────────────────────────
          const settings = store.aiSettings;
          const hasByok = hasConfiguredAiProvider(settings);
          if (hasByok && settings) {
            try {
              const res = await runClientAgent(
                "comment-reply",
                {
                  persona: toAgentPersona(persona),
                  brief: brief ?? null,
                  draftText: "",
                  priorMessages,
                  userMessage,
                  instruction: "elaborate",
                },
                settings,
                (snapshot) => {
                  store.streamingEditorReply = snapshot.text;
                },
              );
              if (res && res.text.trim() && res.provider !== "local") {
                replyText = res.text;
              } else {
                store.askError = commentProviderError("ask-editor");
                return;
              }
            } catch (err) {
              store.askError = normalizeCommentError(
                "twyne:comments:ask-editor-client",
                err,
                "provider",
                "ask-editor",
              );
              return;
            }
          }

          // ── Server action only when no local provider is configured ────────
          if (!replyText && !hasByok && client) {
            try {
              const res = await client.action(api.agents.runPersona, {
                persona: toAgentPersona(persona),
                userMessage,
                draftText: "",
                brief: brief ?? null,
                priorMessages,
              });
              const result = res as {
                reply?: string;
                text?: string;
                provider?: string;
              };
              if (result.provider === "local") {
                store.askError = commentProviderError("ask-editor");
                return;
              }
              replyText = (result.reply ?? result.text ?? "").trim();
            } catch (err) {
              store.askError = normalizeCommentError(
                "twyne:comments:ask-editor-server",
                err,
                "convex",
                "ask-editor",
              );
              return;
            }
          }

          if (!replyText) {
            store.askError = hasByok
              ? commentProviderError("ask-editor")
              : commentConfigurationError("ask-editor");
            return;
          }
          const reply: UserCommentReply = {
            id: `r-${Date.now()}`,
            author: persona.name,
            authorKind: "persona",
            personaId: persona.id,
            color: persona.color,
            text: replyText,
            createdAt: Date.now(),
          };
          const all = await appendUserCommentReply(commentId, reply);
          store.comments = all;
          window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
          store.askPersonaFor = null;
          store.askPersonaId = null;
        } catch (err) {
          store.askError = normalizeCommentError(
            "twyne:comments:ask-editor",
            err,
            hasConfiguredAiProvider(store.aiSettings) ? "provider" : "convex",
            "ask-editor",
          );
        } finally {
          store.isAskingEditor = false;
          store.streamingEditorReply = "";
        }
      },
    );

    const unresolved = store.comments.filter((c) => {
      if (c.folioId !== activeFolioId) return false;
      if (c.resolved) return false;
      // The "ghosts only" filter shows threads whose anchor
      // passage is gone from the manuscript. Ghosts come first
      // so the writer sees the orphans before anything else.
      if (store.ghostsOnly && !store.ghostIds.has(c.id)) return false;
      return true;
    });
    const resolved = store.comments.filter(
      (c) => c.folioId === activeFolioId && c.resolved,
    );
    const mentionables: Mentionable[] = [
      ...store.personas.map(personaToMentionable),
      ...(collaborators ?? []),
    ];

    return (
      <div class="flex flex-col h-full bg-[var(--color-paper-2)]">
        <div class="px-5 py-4 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
          <p class="dept-label">Notes in the Margin</p>
          <h2
            class="mt-0.5 text-xl text-[var(--color-ink)]"
            style="font-family: var(--font-display); font-weight: 600;"
          >
            Marginalia
          </h2>
          <p
            class="mt-2 text-[11px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter);"
          >
            {unresolved.length} pending · {resolved.length} struck
            {store.ghostIds.size > 0 && (
              <span
                class="ml-1 text-[var(--color-vermilion)]"
                title="Threads whose anchor passage is no longer in the manuscript"
              >
                · {store.ghostIds.size} ghost
                {store.ghostIds.size === 1 ? "" : "s"}
              </span>
            )}
          </p>
          {store.ghostIds.size > 0 && (
            <button
              type="button"
              onClick$={() => {
                store.ghostsOnly = !store.ghostsOnly;
              }}
              class="mt-2 inline-flex items-center gap-1 text-[10px] tracking-[0.16em] uppercase border px-2 py-0.5"
              style={{
                fontFamily: "var(--font-typewriter)",
                borderColor: store.ghostsOnly
                  ? "var(--color-vermilion)"
                  : "var(--color-paper-3)",
                color: store.ghostsOnly
                  ? "var(--color-vermilion)"
                  : "var(--color-ink-muted)",
                borderRadius: "1px",
                background: store.ghostsOnly
                  ? "rgba(193, 39, 45, 0.06)"
                  : "transparent",
              }}
            >
              {store.ghostsOnly ? "✓ ghosts only" : "show ghosts only"}
            </button>
          )}
        </div>

        <div class="px-4 py-4 border-b border-[var(--color-paper-3)]">
          <div class="relative">
            <textarea
              id={mentionInputId("new")}
              value={store.newCommentText}
              aria-label="New margin note"
              role="combobox"
              aria-expanded={store.mentionTarget === "new"}
              aria-controls={mentionListId("new")}
              aria-activedescendant={
                store.mentionTarget === "new"
                  ? mentionOptionId(
                      mentionListId("new"),
                      filterMentionables(mentionables, store.mentionQuery)[
                        store.mentionIndex
                      ]?.id ?? "",
                    )
                  : undefined
              }
              onInput$={(e) => {
                const el = e.target as HTMLTextAreaElement;
                store.newCommentText = el.value;
                const q = activeMentionQuery(el.value, el.selectionStart);
                if (q !== null) {
                  store.mentionTarget = "new";
                  store.mentionQuery = q;
                  store.mentionIndex = 0;
                } else if (store.mentionTarget === "new") {
                  store.mentionTarget = null;
                }
              }}
              onKeyDown$={(e) => {
                const el = e.target as HTMLTextAreaElement;
                if (store.mentionTarget === "new") {
                  const candidates = filterMentionables(
                    mentionables,
                    store.mentionQuery,
                  );
                  if (e.key === "Escape") {
                    store.mentionTarget = null;
                    return;
                  }
                  if (candidates.length > 0) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const step = e.key === "ArrowDown" ? 1 : -1;
                      store.mentionIndex =
                        (store.mentionIndex + step + candidates.length) %
                        candidates.length;
                      return;
                    }
                    // Plain Enter picks the highlighted name; Mod+Enter still
                    // files the note, so the submit shortcut keeps working.
                    if (
                      (e.key === "Enter" && !e.metaKey && !e.ctrlKey) ||
                      e.key === "Tab"
                    ) {
                      e.preventDefault();
                      const item = candidates[store.mentionIndex];
                      if (item) {
                        const applied = applyMention(
                          store.newCommentText,
                          item.name,
                          el.selectionStart,
                        );
                        store.newCommentText = applied.text;
                        store.mentionTarget = null;
                        restoreMentionCaret("new", applied.caret);
                      }
                      return;
                    }
                  }
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  addComment();
                }
              }}
              onBlur$={(e) => {
                if (store.mentionTarget === "new" && blurLeavesMentionUi(e)) {
                  store.mentionTarget = null;
                }
              }}
              placeholder={getCommentPlaceholder(brief)}
              class="w-full px-3 py-2 text-sm bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)] resize-none focus:outline-none focus:border-[var(--color-mustard)] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] placeholder:italic"
              style="font-family: var(--font-serif); border-radius: 2px;"
              rows={2}
            />
            {store.mentionTarget === "new" && (
              <MentionDropdown
                id={mentionListId("new")}
                items={mentionables}
                query={store.mentionQuery}
                activeIndex={store.mentionIndex}
                size="md"
                onSelect$={$((item: Mentionable) => {
                  const el = document.getElementById(
                    mentionInputId("new"),
                  ) as HTMLTextAreaElement | null;
                  const applied = applyMention(
                    store.newCommentText,
                    item.name,
                    el?.selectionStart ?? store.newCommentText.length,
                  );
                  store.newCommentText = applied.text;
                  store.mentionTarget = null;
                  restoreMentionCaret("new", applied.caret);
                })}
              />
            )}
          </div>
          <p
            class="mt-1.5 text-[10px] tracking-[0.1em] uppercase text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter);"
          >
            Type @ to tag an editor — they'll weigh in automatically.
          </p>
          <button
            onClick$={addComment}
            disabled={!store.newCommentText.trim()}
            class="btn-press mt-2 w-full"
          >
            Pencil it in
          </button>
          <div class="mt-2">
            <VoiceRecorder
              label="Say it instead"
              transcriptionHint={
                brief
                  ? `${brief.answers.workingTitle}. ${brief.answers.audience}`
                  : undefined
              }
              onCapture$={addVoiceComment}
            />
          </div>
        </div>

        <div class="flex-1 overflow-y-auto">
          {store.comments.length === 0 && (
            <div class="text-center py-10 px-6">
              <p
                class="text-3xl"
                style="font-family: var(--font-display); color: var(--color-mustard);"
              >
                ✎
              </p>
              <p
                class="mt-3 text-sm text-[var(--color-ink-light)]"
                style="font-family: var(--font-serif); font-style: italic;"
              >
                The margins are quiet.
              </p>
              <p
                class="mt-1.5 text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                Pencil in a note as you re-read.
              </p>
            </div>
          )}

          {unresolved.length > 0 && (
            <div class="px-4 pt-4 pb-2">
              <p class="dept-label">Pending</p>
            </div>
          )}
          {unresolved.map((comment) => {
            const isAsking = store.askPersonaFor === comment.id;
            const isReplying = store.replyingTo === comment.id;
            return (
              <div
                key={comment.id}
                data-comment-id={comment.id}
                class="px-4 py-3 mx-3 mb-2 border border-[var(--color-paper-3)]"
                style="border-radius: 2px; background: linear-gradient(rgba(212, 160, 23, 0.06), rgba(212, 160, 23, 0.06)), var(--color-paper);"
              >
                <div class="flex items-start justify-between">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-baseline gap-2 mb-1">
                      <span
                        class="text-xs text-[var(--color-ink)]"
                        style="font-family: var(--font-display); font-weight: 600;"
                      >
                        {comment.author}
                      </span>
                      <span
                        class="text-[10px] tracking-[0.15em] uppercase text-[var(--color-ink-muted)]"
                        style="font-family: var(--font-typewriter);"
                      >
                        {getTimeAgo(comment.updatedAt ?? comment.createdAt)}
                      </span>
                    </div>
                    {comment.anchor && (
                      <p
                        class="text-xs italic text-[var(--color-ink-light)] mb-1 border-l border-[var(--color-mustard)] pl-2"
                        style="font-family: var(--font-serif);"
                      >
                        « {truncate(comment.anchor, 120)} »
                      </p>
                    )}
                    <div
                      class="comment-markdown text-sm text-[var(--color-ink-light)] leading-6"
                      style="font-family: var(--font-serif);"
                      dangerouslySetInnerHTML={renderMarkdown(comment.text)}
                    />
                    {comment.audioId && (
                      <VoiceNotePlayback
                        audioId={comment.audioId}
                        durationMs={comment.audioDurationMs}
                      />
                    )}
                  </div>
                  <div class="flex items-center gap-1 ml-2 flex-shrink-0">
                    <button
                      onClick$={() => resolveComment(comment.id)}
                      class="icon-btn text-sm hover:text-[var(--color-accent-green)]"
                      aria-label="Strike"
                      title="Strike — mark as addressed"
                    >
                      ✓
                    </button>
                    <button
                      onClick$={() => deleteComment(comment.id)}
                      class="icon-btn text-sm hover:text-[var(--color-vermilion)]"
                      aria-label="Erase"
                      title="Erase"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {comment.replies.length > 0 && (
                  <div class="mt-2 ml-4 pl-3 border-l border-dashed border-[var(--color-paper-3)] space-y-2">
                    {comment.replies.map((reply) => (
                      <div key={reply.id}>
                        <div class="flex items-baseline gap-2 mb-0.5">
                          <span
                            class="text-xs"
                            style={{
                              fontFamily: "var(--font-display)",
                              fontWeight: 600,
                              color:
                                reply.authorKind === "persona" && reply.color
                                  ? reply.color
                                  : "var(--color-ink-light)",
                            }}
                          >
                            {reply.author}
                            {reply.authorKind === "persona" && (
                              <span
                                class="ml-1.5 text-[0.55rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)]"
                                style="font-family: var(--font-typewriter);"
                              >
                                editor
                              </span>
                            )}
                          </span>
                          <span
                            class="text-[10px] tracking-[0.15em] uppercase text-[var(--color-ink-muted)]"
                            style="font-family: var(--font-typewriter);"
                          >
                            {getTimeAgo(reply.createdAt)}
                          </span>
                          {reply.authorKind === "persona" && (
                            <SpeakButton
                              compact
                              id={`comment-reply-${reply.id}`}
                              text={reply.text}
                              voice={
                                store.personas.find(
                                  (p) => p.id === reply.personaId,
                                )?.speechVoice
                              }
                              voices={
                                store.personas.find(
                                  (p) => p.id === reply.personaId,
                                )?.speechVoices
                              }
                              instructions={
                                store.personas.find(
                                  (p) => p.id === reply.personaId,
                                )?.voice
                              }
                              label={reply.author}
                            />
                          )}
                        </div>
                        <div
                          data-speech-id={
                            reply.authorKind === "persona"
                              ? `comment-reply-${reply.id}`
                              : undefined
                          }
                          class="comment-markdown text-xs text-[var(--color-ink-light)] leading-5"
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontStyle:
                              reply.authorKind === "persona"
                                ? "italic"
                                : "normal",
                          }}
                          dangerouslySetInnerHTML={renderMarkdown(reply.text)}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {isAsking ? (
                  <div
                    class="mt-2 p-2 border border-[var(--color-paper-3)]"
                    style="border-radius: 2px; background: var(--color-paper-2);"
                  >
                    <p
                      class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] mb-1.5"
                      style="font-family: var(--font-typewriter);"
                    >
                      Ask an editor
                    </p>
                    <div class="flex flex-wrap gap-1 mb-2">
                      {store.personas.map((persona) => (
                        <button
                          key={persona.id}
                          onClick$={() => (store.askPersonaId = persona.id)}
                          class="text-[0.7rem] px-1.5 py-0.5 border"
                          style={{
                            borderColor:
                              store.askPersonaId === persona.id
                                ? persona.color
                                : "var(--color-paper-3)",
                            color:
                              store.askPersonaId === persona.id
                                ? persona.color
                                : "var(--color-ink-light)",
                            fontFamily: "var(--font-typewriter)",
                            borderRadius: "1px",
                          }}
                        >
                          {persona.icon} {persona.name}
                        </button>
                      ))}
                    </div>
                    {store.askError && (
                      <div class="mb-2">
                        <ApplicationNotice
                          error={store.askError}
                          compact
                          recoveryLabel="Open AI settings"
                          recoveryHref="/settings/"
                          onRetry$={
                            store.askError.recovery.canRetry
                              ? () => askEditor(comment.id)
                              : undefined
                          }
                          onDismiss$={() => {
                            store.askError = null;
                          }}
                        />
                      </div>
                    )}
                    {store.isAskingEditor && (
                      <div
                        class="comment-markdown mb-2 p-2 border-l-2 text-xs leading-5 text-[var(--color-ink-light)]"
                        style={{
                          borderColor:
                            store.personas.find(
                              (persona) => persona.id === store.askPersonaId,
                            )?.color ?? "var(--color-paper-3)",
                          fontFamily: "var(--font-serif)",
                        }}
                        aria-live="polite"
                        dangerouslySetInnerHTML={renderMarkdown(
                          store.streamingEditorReply ||
                            "The editor is beginning to write…",
                        )}
                      />
                    )}
                    <div class="flex gap-3">
                      <button
                        onClick$={() => askEditor(comment.id)}
                        disabled={!store.askPersonaId || store.isAskingEditor}
                        class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-vermilion)] hover:text-[var(--color-vermilion-2)] disabled:opacity-40"
                        style="font-family: var(--font-typewriter);"
                      >
                        {store.isAskingEditor
                          ? "Editor is reading…"
                          : "Send to editor"}
                      </button>
                      <button
                        onClick$={() => {
                          store.askPersonaFor = null;
                          store.askPersonaId = null;
                          store.askError = null;
                        }}
                        class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
                        style="font-family: var(--font-typewriter);"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : isReplying ? (
                  <div class="mt-2 space-y-2">
                    <div class="relative">
                      <textarea
                        id={mentionInputId(comment.id)}
                        value={store.replyDrafts[comment.id] ?? ""}
                        aria-label="Reply to note"
                        role="combobox"
                        aria-expanded={store.mentionTarget === comment.id}
                        aria-controls={mentionListId(comment.id)}
                        aria-activedescendant={
                          store.mentionTarget === comment.id
                            ? mentionOptionId(
                                mentionListId(comment.id),
                                filterMentionables(
                                  mentionables,
                                  store.mentionQuery,
                                )[store.mentionIndex]?.id ?? "",
                              )
                            : undefined
                        }
                        onInput$={(e) => {
                          const el = e.target as HTMLTextAreaElement;
                          store.replyDrafts[comment.id] = el.value;
                          const q = activeMentionQuery(
                            el.value,
                            el.selectionStart,
                          );
                          if (q !== null) {
                            store.mentionTarget = comment.id;
                            store.mentionQuery = q;
                            store.mentionIndex = 0;
                          } else if (store.mentionTarget === comment.id) {
                            store.mentionTarget = null;
                          }
                        }}
                        onKeyDown$={(e) => {
                          const el = e.target as HTMLTextAreaElement;
                          if (store.mentionTarget === comment.id) {
                            const candidates = filterMentionables(
                              mentionables,
                              store.mentionQuery,
                            );
                            if (e.key === "Escape") {
                              store.mentionTarget = null;
                              return;
                            }
                            if (candidates.length > 0) {
                              if (
                                e.key === "ArrowDown" ||
                                e.key === "ArrowUp"
                              ) {
                                e.preventDefault();
                                const step = e.key === "ArrowDown" ? 1 : -1;
                                store.mentionIndex =
                                  (store.mentionIndex +
                                    step +
                                    candidates.length) %
                                  candidates.length;
                                return;
                              }
                              if (
                                (e.key === "Enter" &&
                                  !e.metaKey &&
                                  !e.ctrlKey) ||
                                e.key === "Tab"
                              ) {
                                e.preventDefault();
                                const item = candidates[store.mentionIndex];
                                if (item) {
                                  const applied = applyMention(
                                    store.replyDrafts[comment.id] ?? "",
                                    item.name,
                                    el.selectionStart,
                                  );
                                  store.replyDrafts[comment.id] = applied.text;
                                  store.mentionTarget = null;
                                  restoreMentionCaret(
                                    comment.id,
                                    applied.caret,
                                  );
                                }
                                return;
                              }
                            }
                          }
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            void addReply(
                              comment.id,
                              store.replyDrafts[comment.id] ?? "",
                            );
                          }
                        }}
                        onBlur$={(e) => {
                          if (
                            store.mentionTarget === comment.id &&
                            blurLeavesMentionUi(e)
                          ) {
                            store.mentionTarget = null;
                          }
                        }}
                        placeholder="Annotate… (@ to tag an editor)"
                        class="w-full px-2 py-1.5 text-xs bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)] resize-none focus:outline-none focus:border-[var(--color-mustard)]"
                        style="font-family: var(--font-serif); border-radius: 2px;"
                        rows={2}
                      />
                      {store.mentionTarget === comment.id && (
                        <MentionDropdown
                          id={mentionListId(comment.id)}
                          items={mentionables}
                          query={store.mentionQuery}
                          activeIndex={store.mentionIndex}
                          size="sm"
                          onSelect$={$((item: Mentionable) => {
                            const draft = store.replyDrafts[comment.id] ?? "";
                            const el = document.getElementById(
                              mentionInputId(comment.id),
                            ) as HTMLTextAreaElement | null;
                            const applied = applyMention(
                              draft,
                              item.name,
                              el?.selectionStart ?? draft.length,
                            );
                            store.replyDrafts[comment.id] = applied.text;
                            store.mentionTarget = null;
                            restoreMentionCaret(comment.id, applied.caret);
                          })}
                        />
                      )}
                    </div>
                    <div class="flex gap-3">
                      <button
                        onClick$={() =>
                          addReply(
                            comment.id,
                            store.replyDrafts[comment.id] ?? "",
                          )
                        }
                        class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-vermilion)] hover:text-[var(--color-vermilion-2)]"
                        style="font-family: var(--font-typewriter);"
                      >
                        File reply
                      </button>
                      <button
                        onClick$={() => {
                          store.replyingTo = null;
                          store.replyDrafts[comment.id] = "";
                        }}
                        class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
                        style="font-family: var(--font-typewriter);"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div class="mt-2 flex gap-3">
                    <button
                      onClick$={() => (store.replyingTo = comment.id)}
                      class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      + Annotate
                    </button>
                    <button
                      onClick$={() => {
                        store.askPersonaFor = comment.id;
                        store.askPersonaId = store.personas[0]?.id ?? null;
                        store.askError = null;
                      }}
                      class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      ✎ Ask an editor
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {resolved.length > 0 && (
            <div class="px-4 pt-5 pb-2">
              <p class="dept-label">Struck</p>
            </div>
          )}
          {resolved.map((comment) => (
            <div
              key={comment.id}
              data-comment-id={comment.id}
              class="px-4 py-3 mx-3 mb-2 bg-[var(--color-paper)] border border-[var(--color-paper-3)] opacity-55"
              style="border-radius: 2px;"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-2 mb-1">
                    <span
                      class="text-xs text-[var(--color-ink)]"
                      style="font-family: var(--font-display); font-weight: 600;"
                    >
                      {comment.author}
                    </span>
                    <span
                      class="text-[10px] tracking-[0.15em] uppercase text-[var(--color-ink-muted)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      {getTimeAgo(comment.updatedAt ?? comment.createdAt)}
                    </span>
                  </div>
                  {comment.anchor && (
                    <p
                      class="text-xs italic text-[var(--color-ink-light)] mb-1 border-l border-[var(--color-mustard)] pl-2"
                      style="font-family: var(--font-serif);"
                    >
                      « {truncate(comment.anchor, 120)} »
                    </p>
                  )}
                  <p
                    class="text-sm text-[var(--color-ink-light)] line-through decoration-[var(--color-ink-muted)] decoration-1"
                    style="font-family: var(--font-serif);"
                  >
                    {comment.text}
                  </p>
                </div>
                <div class="flex items-center gap-1 ml-2 flex-shrink-0">
                  <button
                    onClick$={() => resolveComment(comment.id)}
                    class="icon-btn text-sm hover:text-[var(--color-accent-green)]"
                    aria-label="Restore note"
                    title="Restore"
                  >
                    ↩
                  </button>
                  <button
                    onClick$={() => deleteComment(comment.id)}
                    class="icon-btn text-sm hover:text-[var(--color-vermilion)]"
                    aria-label="Erase note"
                    title="Erase"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  },
);

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function getCommentPlaceholder(brief: ProjectBrief | null): string {
  if (!brief) return "Add a comment...";
  return `Note for ${brief.answers.audience}...`;
}

/**
 * Play back the recording a spoken note came from.
 *
 * The Blob is loaded lazily on first press rather than on render: a panel with
 * thirty voice notes would otherwise pull thirty recordings out of IndexedDB
 * and hold thirty object URLs open for audio nobody asked to hear.
 */
const VoiceNotePlayback = component$<{
  audioId: string;
  durationMs?: number;
}>((props) => {
  const url = useSignal("");
  const playing = useSignal(false);
  const missing = useSignal(false);

  const toggle = $(async () => {
    if (!url.value) {
      const blob = await readVoiceNote(props.audioId);
      if (!blob) {
        missing.value = true;
        return;
      }
      url.value = URL.createObjectURL(blob);
    }
    playing.value = !playing.value;
  });

  if (missing.value) {
    return (
      <p
        class="mt-1 text-[10px] text-[var(--color-ink-muted)]"
        style="font-family: var(--font-typewriter);"
      >
        The recording isn't on this device — the note above is what was said.
      </p>
    );
  }

  return (
    <div class="mt-1.5 flex items-center gap-2">
      <button
        onClick$={toggle}
        class="icon-btn text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
        aria-label={
          playing.value ? "Pause the recording" : "Play the recording"
        }
        title={playing.value ? "Pause" : "Play the recording"}
      >
        {playing.value ? "❚❚" : "▶"}
      </button>
      {url.value && (
        <audio
          src={url.value}
          autoplay={playing.value}
          controls={false}
          onEnded$={() => {
            playing.value = false;
          }}
        />
      )}
      <span
        class="text-[10px] tracking-[0.1em] text-[var(--color-ink-muted)]"
        style="font-family: var(--font-typewriter);"
      >
        spoken{props.durationMs ? ` · ${formatDuration(props.durationMs)}` : ""}
      </span>
    </div>
  );
});
