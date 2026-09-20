import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import { loadMetaFromIdb, saveMetaToIdb } from "../../utils/idb";
import {
  liveReviewSnapshot,
  type LiveReviewSnapshot,
} from "../../utils/live-review";

/** Always visible above the manuscript; feedback never requires opening the board. */
export const LiveReviewStatus = component$<{ folioId: string }>(
  ({ folioId }) => {
    const state = useStore({
      label: "Review follows your writing",
      detail: "",
      enabled: true,
      expanded: false,
      unavailable: false,
    });
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      ({ track, cleanup }) => {
        track(() => folioId);
        let disposed = false;
        state.label = "Review follows your writing";
        state.detail = "";
        void loadMetaFromIdb<boolean>("live-review-enabled").then((value) => {
          if (!disposed) state.enabled = value !== false;
        });
        const quick = (event: Event) => {
          const detail = (
            event as CustomEvent<{
              folioId: string;
              label: string;
              detail: string;
            }>
          ).detail;
          if (detail.folioId !== folioId) return;
          state.label = detail.label;
          state.detail = detail.detail;
          if (!detail.detail) state.expanded = false;
        };
        const review = (event?: Event) => {
          const detail = event
            ? (event as CustomEvent<LiveReviewSnapshot>).detail
            : liveReviewSnapshot();
          if (detail.folioId !== folioId || state.detail) return;
          state.unavailable = detail.status === "unavailable";
          if (["paused", "offline", "unavailable"].includes(detail.status))
            state.label = detail.message;
        };
        review();
        window.addEventListener("twyne:quick-review", quick);
        window.addEventListener("twyne:live-review", review);
        cleanup(() => {
          disposed = true;
          window.removeEventListener("twyne:quick-review", quick);
          window.removeEventListener("twyne:live-review", review);
        });
      },
      { strategy: "document-ready" },
    );
    return (
      <div class="live-review-status">
        <div class="live-review-status__line">
          <span class="sr-only" role="status">
            {state.detail ? state.label : ""}
          </span>
          {state.detail ? (
            <button
              class="live-review-status__finding focus-ring"
              aria-expanded={state.expanded}
              onClick$={() => {
                state.expanded = !state.expanded;
              }}
            >
              <span aria-hidden="true">◇</span> {state.label}
            </button>
          ) : (
            <span class="live-review-status__label">{state.label}</span>
          )}
          <button
            class="live-review-status__toggle focus-ring"
            onClick$={async () => {
              state.enabled = !state.enabled;
              await saveMetaToIdb("live-review-enabled", state.enabled);
              state.detail = "";
              state.label = state.enabled
                ? "Review follows your writing"
                : "Automatic review paused";
              window.dispatchEvent(
                new CustomEvent("twyne:live-review-setting"),
              );
            }}
          >
            {state.enabled ? "Pause review" : "Resume review"}
          </button>
        </div>
        {state.expanded && state.detail && (
          <p class="live-review-status__detail">{state.detail}</p>
        )}
        {state.unavailable && (
          <Link href="/settings/" class="panel-meta focus-ring">
            Review account and AI settings ↗
          </Link>
        )}
      </div>
    );
  },
);
