import { component$, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
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
  runClientAgent,
  normalizeAiSettings,
} from "../../utils/ai-client";

interface CommentsStore {
  comments: UserComment[];
  newCommentText: string;
  replyingTo: string | null;
  /** Per-comment reply drafts (keyed by comment id). */
  replyDrafts: Record<string, string>;
  askPersonaFor: string | null;
  askPersonaId: string | null;
  isAskingEditor: boolean;
  askError: string | null;
  personas: Persona[];
  aiSettings: AiSettings | null;
  /** Ids of threads whose anchor mark is gone from the doc. */
  ghostIds: Set<string>;
  /** Show only ghosts? Off by default; the chip flips it. */
  ghostsOnly: boolean;
}

interface CommentsPanelProps {
  brief: ProjectBrief | null;
  activeFolioId: string | null;
  /** Seed notes, for tests and isolated previews. Skips persisted storage when set. */
  initialComments?: UserComment[];
}

export const CommentsPanel = component$(
  ({ brief, activeFolioId, initialComments }: CommentsPanelProps) => {
    const clientSig = useConvexClient();
    const store = useStore<CommentsStore>({
      comments: initialComments ?? [],
      newCommentText: "",
      replyingTo: null,
      replyDrafts: {},
      askPersonaFor: null,
      askPersonaId: null,
      isAskingEditor: false,
      askError: null,
      personas: DEFAULT_PERSONAS,
      aiSettings: null,
      ghostIds: new Set<string>(),
      ghostsOnly: false,
    });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    if (initialComments) return;
    store.comments = await loadUserComments();
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
          store.comments = all;
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
    const askEditor = $(async (commentId: string) => {
      const personaId = store.askPersonaId;
      if (!personaId) return;
      const comment = store.comments.find((c) => c.id === commentId);
      if (!comment) return;
      const persona = store.personas.find((p) => p.id === personaId);
      if (!persona) return;
      const client = clientSig.value;

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
      store.askError = null;
      try {
        let replyText = "";

        // ── Try client-side AI first (BYOK) ─────────────────────────
        const settings = store.aiSettings;
        if (
          settings?.advancedMode &&
          settings.providers.length > 0
        ) {
          try {
            const res = await runClientAgent(
              "comment-reply",
              {
                persona: {
                  id: persona.id,
                  name: persona.name,
                  role: persona.role,
                  description: persona.description,
                  focus: persona.focus,
                  color: persona.color,
                  icon: persona.icon,
                },
                brief: brief ?? null,
                draftText: "",
                priorMessages,
                userMessage,
                instruction: "elaborate",
              },
              settings,
            );
            if (res) {
              replyText = res.text;
            }
          } catch (err) {
            console.warn("[twyne:comments] client AI failed:", err);
          }
        }

        // ── Fallback to Convex server action ────────────────────────
        if (!replyText && client) {
          const res = await client.action(api.agents.runPersona, {
            persona: {
              id: persona.id,
              name: persona.name,
              role: persona.role,
              description: persona.description,
              focus: persona.focus,
              color: persona.color,
              icon: persona.icon,
            },
            userMessage,
            draftText: "",
            brief: brief ?? null,
            priorMessages,
          });
          replyText = (res as { reply?: string })?.reply ?? "";
        }

        if (!replyText) {
          replyText = fallbackReply(persona, comment);
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
      } catch (err) {
        store.askError = (err as Error).message ?? "Editor unavailable.";
      } finally {
        store.isAskingEditor = false;
        store.askPersonaFor = null;
        store.askPersonaId = null;
      }
    });

    const unresolved = store.comments.filter((c) => {
      if (c.resolved) return false;
      // The "ghosts only" filter shows threads whose anchor
      // passage is gone from the manuscript. Ghosts come first
      // so the writer sees the orphans before anything else.
      if (store.ghostsOnly && !store.ghostIds.has(c.id)) return false;
      return true;
    });
    const resolved = store.comments.filter((c) => c.resolved);

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
          <textarea
            value={store.newCommentText}
            aria-label="New margin note"
            onInput$={(e) => {
              store.newCommentText = (e.target as HTMLTextAreaElement).value;
            }}
            onKeyDown$={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                addComment();
              }
            }}
            placeholder={getCommentPlaceholder(brief)}
            class="w-full px-3 py-2 text-sm bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)] resize-none focus:outline-none focus:border-[var(--color-mustard)] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] placeholder:italic"
            style="font-family: var(--font-serif); border-radius: 2px;"
            rows={2}
          />
          <button
            onClick$={addComment}
            disabled={!store.newCommentText.trim()}
            class="btn-press mt-2 w-full"
          >
            Pencil it in
          </button>
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
                    <p
                      class="text-sm text-[var(--color-ink-light)] leading-6"
                      style="font-family: var(--font-serif);"
                    >
                      {comment.text}
                    </p>
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
                        </div>
                        <p
                          class="text-xs text-[var(--color-ink-light)] leading-5"
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontStyle:
                              reply.authorKind === "persona"
                                ? "italic"
                                : "normal",
                          }}
                        >
                          {reply.text}
                        </p>
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
                      <p class="text-[0.7rem] text-[var(--color-vermilion)] mb-1.5">
                        {store.askError}
                      </p>
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
                    <textarea
                      value={store.replyDrafts[comment.id] ?? ""}
                      aria-label="Reply to note"
                      onInput$={(e) => {
                        store.replyDrafts[comment.id] = (
                          e.target as HTMLTextAreaElement
                        ).value;
                      }}
                      onKeyDown$={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          void addReply(
                            comment.id,
                            store.replyDrafts[comment.id] ?? "",
                          );
                        }
                      }}
                      placeholder="Annotate…"
                      class="w-full px-2 py-1.5 text-xs bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)] resize-none focus:outline-none focus:border-[var(--color-mustard)]"
                      style="font-family: var(--font-serif); border-radius: 2px;"
                      rows={2}
                    />
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

/** Last-resort reply if the agent call fails. */
function fallbackReply(persona: Persona, c: UserComment): string {
  return `${persona.name}: I would push you on this — ${c.text.slice(0, 60)}${c.text.length > 60 ? "…" : ""}. What's the strongest counter-argument?`;
}

function getCommentPlaceholder(brief: ProjectBrief | null): string {
  if (!brief) return "Add a comment...";
  return `Note for ${brief.answers.audience}...`;
}
