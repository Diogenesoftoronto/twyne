import {
  component$,
  useSignal,
  useVisibleTask$,
  useStylesScoped$,
} from "@qwik.dev/core";
import {
  accountKnowledgeSnapshot,
  subscribeAccountKnowledge,
  resolveAccountToolReview,
  type AccountKnowledgeSnapshot,
} from "../../utils/account-knowledge";

/** Always mounted with the authenticated app, so an editor can ask for review anywhere. */
export const AccountToolReview = component$(() => {
  const review = useSignal<AccountKnowledgeSnapshot["review"]>();
  useStylesScoped$(
    `aside{position:sticky;top:0;z-index:30;background:var(--color-paper);color:var(--color-ink);border-bottom:1px solid var(--color-ink);padding:1rem;font-family:var(--font-typewriter);font-size:.85rem;} .review-body{max-width:65ch;margin:auto;} h2{font-family:var(--font-display);font-size:1rem;margin:0 0 .4rem;} pre{max-height:12rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;padding:.5rem;background:var(--color-paper-2);} .actions{display:flex;gap:1rem;flex-wrap:wrap;} button{min-height:44px;padding:.4rem .7rem;border:1px solid var(--color-ink);cursor:pointer;}button:focus-visible{outline:2px solid var(--color-vermilion);outline-offset:3px;}`,
  );
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const sync = () => {
      review.value = accountKnowledgeSnapshot().review;
    };
    sync();
    const unsubscribe = subscribeAccountKnowledge(sync);
    cleanup(() => {
      unsubscribe();
      resolveAccountToolReview(false);
    });
  });
  return review.value ? (
    <aside aria-label="Review external tool call" aria-live="polite">
      <div class="review-body">
        <h2>Review a call to {review.value.label}</h2>
        <p>
          Tool: <strong>{review.value.tool}</strong>. External tools may change
          remote data. Check these arguments before sending them.
        </p>
        <pre>{review.value.argumentsJson}</pre>
        <div class="actions">
          <button onClick$={() => resolveAccountToolReview(false)}>
            Cancel call
          </button>
          <button onClick$={() => resolveAccountToolReview(true)}>
            Allow this call
          </button>
        </div>
        <p>Approval covers this request only. No automatic retry.</p>
      </div>
    </aside>
  ) : null;
});
