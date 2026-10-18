import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import {
  liveReviewSnapshot,
  type LiveReviewSnapshot,
} from "../../utils/live-review";

// A dismissed notice stays dismissed for this browser session.
const DISMISSED_KEY = "twyne:review-notices-dismissed";
const dismissedNotices = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]");
  } catch {
    return [];
  }
};

/** Always visible above the manuscript; feedback never requires opening the board. */
export const LiveReviewStatus = component$<{ folioId: string }>(
  ({ folioId }) => {
    const state = useStore({
      label: "Review follows your writing",
      detail: "",
      expanded: false,
      problem: "",
      /** Which feed raised the problem, so the other cannot clear it. */
      source: "" as "" | "quick" | "live",
      fix: "" as "" | "signin" | "model",
      shown: false,
      dismissed: false,
    });
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(
      ({ track, cleanup }) => {
        track(() => folioId);
        state.label = "Review follows your writing";
        state.detail = "";
        state.problem = "";
        state.source = "";
        state.shown = false;
        state.dismissed = false;
        // A problem shows only after it has lasted, so the row never flickers.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const setProblem = (
          source: "quick" | "live",
          text: string,
          fix: "" | "signin" | "model" = "",
        ) => {
          if (!text && state.source !== source) return;
          if (text === state.problem) return;
          clearTimeout(timer);
          state.problem = text;
          state.source = text ? source : "";
          state.fix = fix;
          state.shown = false;
          state.dismissed = dismissedNotices().includes(text);
          if (text)
            timer = setTimeout(() => {
              state.shown = true;
            }, 2000);
        };
        const quick = (event: Event) => {
          const detail = (
            event as CustomEvent<{
              folioId: string;
              label: string;
              detail: string;
              reason?: string;
            }>
          ).detail;
          if (detail.folioId !== folioId) return;
          state.label = detail.label;
          state.detail = detail.detail;
          if (!detail.detail) state.expanded = false;
          // Only a failed check carries a reason. Typing ("Waiting for a
          // pause…") must not clear the notice, or the row comes and goes
          // with every pause; only an answered check does.
          if (detail.reason)
            setProblem(
              "quick",
              detail.label,
              detail.reason === "signed out"
                ? "signin"
                : detail.reason === "unconfigured"
                  ? "model"
                  : "",
            );
          else if (
            detail.detail ||
            detail.label === "No clear issue in this passage"
          )
            setProblem("quick", "");
        };
        const review = (event?: Event) => {
          const detail = event
            ? (event as CustomEvent<LiveReviewSnapshot>).detail
            : liveReviewSnapshot();
          if (detail.folioId !== folioId || state.detail) return;
          if (["paused", "offline", "unavailable"].includes(detail.status))
            state.label = detail.message;
          // Paused is the writer's own choice, not a problem to report.
          if (detail.status === "offline" || detail.status === "unavailable")
            setProblem("live", detail.message);
          else setProblem("live", "");
        };
        review();
        window.addEventListener("twyne:quick-review", quick);
        window.addEventListener("twyne:live-review", review);
        cleanup(() => {
          window.removeEventListener("twyne:quick-review", quick);
          window.removeEventListener("twyne:live-review", review);
          clearTimeout(timer);
        });
      },
      { strategy: "document-ready" },
    );
    // Idle review status does not need a full row above the text. Only a
    // lasting problem is announced, once; routine labels stay silent.
    if (!state.detail)
      return (
        <>
          <span class="sr-only">{state.label}</span>
          <span class="sr-only" role="status">
            {state.shown ? state.problem : ""}
          </span>
          {state.shown && !state.dismissed && (
            <div class="live-review-status live-review-status--notice">
              <span class="live-review-status__label">{state.problem}</span>
              {state.fix === "signin" && (
                <Link class="live-review-status__action" href="/signin/">
                  Sign in
                </Link>
              )}
              {state.fix === "model" && (
                <Link
                  class="live-review-status__action"
                  href="/settings/#judgement-model"
                >
                  Set up a model
                </Link>
              )}
              <button
                type="button"
                class="live-review-status__dismiss focus-ring"
                aria-label="Dismiss review notice"
                onClick$={() => {
                  state.dismissed = true;
                  try {
                    sessionStorage.setItem(
                      DISMISSED_KEY,
                      JSON.stringify([...dismissedNotices(), state.problem]),
                    );
                  } catch {
                    // Storage refused; the notice stays dismissed until reload.
                  }
                }}
              >
                ×
              </button>
            </div>
          )}
        </>
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
        </div>
        {state.expanded && state.detail && (
          <p class="live-review-status__detail">{state.detail}</p>
        )}
      </div>
    );
  },
);
