import { $, component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import {
  localDecisionStatus,
  type LocalDecisionStatus,
} from "../../utils/local-decisions";

export const LocalDecisionSettings = component$(() => {
  const state = useStore({
    status: null as LocalDecisionStatus | null,
    error: "",
    checking: false,
  });
  const refresh = $(async (download = false) => {
    state.checking = true;
    state.error = "";
    try {
      state.status = await localDecisionStatus(download);
    } catch (error) {
      state.error =
        error instanceof TypeError
          ? "Start the local decision service on this computer, then check again."
          : error instanceof Error
            ? error.message
            : "Couldn't reach local decisions.";
    } finally {
      state.checking = false;
    }
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    void refresh();
    const timer = setInterval(() => {
      if (
        !state.checking &&
        ["downloading", "loading"].includes(state.status?.phase ?? "")
      )
        void refresh();
    }, 2000);
    cleanup(() => clearInterval(timer));
  });
  const phase = state.status?.phase;
  const busy = phase === "downloading" || phase === "loading";
  const installed = phase === "downloaded" || phase === "ready";
  return (
    <div class="mt-4 space-y-3 text-xs text-[var(--color-ink-light)]">
      <p>
        Liquid d1-2B runs decisions on this computer. After the first download,
        it works offline without an account or API key. Your text stays on this
        computer for these decisions. Writing and research models have their own
        settings.
      </p>
      <p>
        Model download: 3.85 GB, plus the Python runtime. Allow 10 GB of disk
        space. CPU inference can be slow; the first check also loads the model
        into memory.
      </p>
      <p role="status" aria-live="polite">
        {state.error ||
          state.status?.error ||
          ({
            not_downloaded: "Ready to download.",
            downloading:
              "Downloading and verifying the model and runtime… Keep Twyne open.",
            downloaded:
              "Downloaded. The model will load on your first check, including offline.",
            loading: "Loading the model on this computer…",
            ready: "Running locally. Decisions are available offline.",
            error:
              "Local decisions need attention. Retry the download or check the service.",
          }[phase ?? "not_downloaded"] ??
            "Checking the local service…")}
      </p>
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="btn-paper text-xs"
          disabled={state.checking || busy || installed || !state.status}
          onClick$={() => refresh(true)}
        >
          {busy
            ? "Preparing local decisions…"
            : installed
              ? "Downloaded"
              : "Download local decisions"}
        </button>
        <button
          type="button"
          class="btn-paper text-xs"
          disabled={state.checking}
          onClick$={() => refresh()}
        >
          Check status
        </button>
      </div>
      <details>
        <summary class="cursor-pointer text-[var(--color-ink)]">
          Local service setup
        </summary>
        <p class="mt-2">
          The desktop shell starts this service when Python 3.11–3.13 is
          available. Install{" "}
          <a
            href="https://docs.astral.sh/uv/"
            target="_blank"
            rel="noreferrer"
            class="underline"
          >
            uv
          </a>{" "}
          before downloading. From a Twyne source checkout, you can also run:
        </p>
        <pre class="mt-2 overflow-x-auto bg-[var(--color-paper-2)] p-2 text-[0.7rem]">
          python3 desktop/decision/server.py
        </pre>
        <p class="mt-2">
          Keep the service running while you write. Only the download needs
          internet. This installs Liquid's pinned model code under the{" "}
          <a
            href="https://huggingface.co/LiquidAI/d1-2B/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
            class="underline"
          >
            LFM Open License
          </a>
          .
        </p>
      </details>
    </div>
  );
});
