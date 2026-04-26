import { component$, useStore, $ } from "@builder.io/qwik";
import type { Comment, CommentReply, ProjectBrief } from "../../types";

interface CommentsStore {
  comments: Comment[];
  newCommentText: string;
  replyingTo: string | null;
  replyText: string;
}

interface CommentsPanelProps {
  brief: ProjectBrief | null;
}

export const CommentsPanel = component$(({ brief }: CommentsPanelProps) => {
  const store = useStore<CommentsStore>({
    comments: loadComments(),
    newCommentText: "",
    replyingTo: null,
    replyText: "",
  });

  const addComment = $(() => {
    if (!store.newCommentText.trim()) return;
    const comment: Comment = {
      id: `c-${Date.now()}`,
      text: store.newCommentText,
      selectedText: "",
      from: 0,
      to: 0,
      author: "You",
      timestamp: Date.now(),
      resolved: false,
      replies: [],
    };
    store.comments = [...store.comments, comment];
    store.newCommentText = "";
    saveComments(store.comments);
  });

  const addReply = $((commentId: string) => {
    if (!store.replyText.trim()) return;
    const reply: CommentReply = {
      id: `r-${Date.now()}`,
      text: store.replyText,
      author: "You",
      timestamp: Date.now(),
    };
    store.comments = store.comments.map((c) =>
      c.id === commentId ? { ...c, replies: [...c.replies, reply] } : c,
    );
    store.replyText = "";
    store.replyingTo = null;
    saveComments(store.comments);
  });

  const resolveComment = $((commentId: string) => {
    store.comments = store.comments.map((c) =>
      c.id === commentId ? { ...c, resolved: !c.resolved } : c,
    );
    saveComments(store.comments);
  });

  const deleteComment = $((commentId: string) => {
    store.comments = store.comments.filter((c) => c.id !== commentId);
    saveComments(store.comments);
  });

  const unresolved = store.comments.filter((c) => !c.resolved);
  const resolved = store.comments.filter((c) => c.resolved);

  return (
    <div class="flex flex-col h-full">
      <div class="px-4 py-3 border-b border-[var(--color-surface-3)]">
        <h2 class="text-sm font-semibold text-[var(--color-ink)] flex items-center gap-2">
          <span>💬</span> Comments
        </h2>
        <p class="text-xs text-[var(--color-ink-muted)] mt-1">
          {unresolved.length} open · {resolved.length} resolved
        </p>
      </div>

      <div class="px-4 py-3 border-b border-[var(--color-surface-3)]">
        <textarea
          value={store.newCommentText}
          onInput$={(e) => {
            store.newCommentText = (e.target as HTMLTextAreaElement).value;
          }}
          placeholder={getCommentPlaceholder(brief)}
          class="w-full px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-surface-3)] rounded-lg resize-none focus:outline-none focus:border-[var(--color-brand)] text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)]"
          rows={2}
        />
        <button
          onClick$={addComment}
          disabled={!store.newCommentText.trim()}
          class="mt-2 w-full py-1.5 px-3 rounded-lg text-xs font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Add Comment
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        {store.comments.length === 0 && (
          <div class="text-center py-8 text-[var(--color-ink-muted)]">
            <p class="text-sm">No comments yet</p>
            <p class="text-xs mt-1">Add notes as you review your work</p>
          </div>
        )}

        {unresolved.length > 0 && (
          <div class="px-4 pt-3 pb-1">
            <p class="text-xs font-medium text-[var(--color-ink-muted)] uppercase tracking-wider">
              Open
            </p>
          </div>
        )}
        {unresolved.map((comment) => (
          <div
            key={comment.id}
            class="px-4 py-3 border-b border-[var(--color-surface-3)]"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-semibold text-[var(--color-ink)]">
                    {comment.author}
                  </span>
                  <span class="text-xs text-[var(--color-ink-muted)]">
                    {getTimeAgo(comment.timestamp)}
                  </span>
                </div>
                {comment.selectedText && (
                  <p class="text-xs italic text-[var(--color-ink-muted)] mb-1 border-l-2 border-[var(--color-accent-amber)] pl-2">
                    "{comment.selectedText}"
                  </p>
                )}
                <p class="text-sm text-[var(--color-ink-light)]">
                  {comment.text}
                </p>
              </div>
              <div class="flex items-center gap-1 ml-2">
                <button
                  onClick$={() => resolveComment(comment.id)}
                  class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent-green)]"
                  title="Resolve"
                >
                  ✓
                </button>
                <button
                  onClick$={() => deleteComment(comment.id)}
                  class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent-red)]"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
            {comment.replies.length > 0 && (
              <div class="mt-2 ml-4 space-y-2">
                {comment.replies.map((reply) => (
                  <div key={reply.id}>
                    <div class="flex items-center gap-2 mb-0.5">
                      <span class="text-xs font-semibold text-[var(--color-ink-light)]">
                        {reply.author}
                      </span>
                      <span class="text-xs text-[var(--color-ink-muted)]">
                        {getTimeAgo(reply.timestamp)}
                      </span>
                    </div>
                    <p class="text-xs text-[var(--color-ink-light)]">
                      {reply.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {store.replyingTo === comment.id ? (
              <div class="mt-2 space-y-2">
                <textarea
                  value={store.replyText}
                  onInput$={(e) => {
                    store.replyText = (e.target as HTMLTextAreaElement).value;
                  }}
                  placeholder="Reply..."
                  class="w-full px-2 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-surface-3)] rounded resize-none focus:outline-none focus:border-[var(--color-brand)]"
                  rows={2}
                />
                <div class="flex gap-2">
                  <button
                    onClick$={() => addReply(comment.id)}
                    class="text-xs font-medium text-[var(--color-brand)] hover:text-[var(--color-brand-dark)]"
                  >
                    Reply
                  </button>
                  <button
                    onClick$={() => {
                      store.replyingTo = null;
                    }}
                    class="text-xs text-[var(--color-ink-muted)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick$={() => {
                  store.replyingTo = comment.id;
                }}
                class="mt-2 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-brand)]"
              >
                Reply
              </button>
            )}
          </div>
        ))}

        {resolved.length > 0 && (
          <div class="px-4 pt-4 pb-1">
            <p class="text-xs font-medium text-[var(--color-ink-muted)] uppercase tracking-wider">
              Resolved
            </p>
          </div>
        )}
        {resolved.map((comment) => (
          <div
            key={comment.id}
            class="px-4 py-3 border-b border-[var(--color-surface-3)] opacity-50"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-semibold text-[var(--color-ink)]">
                    {comment.author}
                  </span>
                  <span class="text-xs text-[var(--color-ink-muted)]">
                    {getTimeAgo(comment.timestamp)}
                  </span>
                </div>
                <p class="text-sm text-[var(--color-ink-light)]">
                  {comment.text}
                </p>
              </div>
              <div class="flex items-center gap-1 ml-2">
                <button
                  onClick$={() => resolveComment(comment.id)}
                  class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent-green)]"
                  title="Unresolve"
                >
                  ↩
                </button>
                <button
                  onClick$={() => deleteComment(comment.id)}
                  class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent-red)]"
                  title="Delete"
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
});

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function loadComments(): Comment[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem("twyne-comments");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveComments(comments: Comment[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("twyne-comments", JSON.stringify(comments));
  } catch {
    // storage full
  }
}

function getCommentPlaceholder(brief: ProjectBrief | null): string {
  if (!brief) return "Add a comment...";
  return `Note for ${brief.answers.audience}...`;
}
