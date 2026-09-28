import { $, component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import { loadMetaFromIdb, saveMetaToIdb } from "../../utils/idb";
import {
  IN_FLOW_SETTING_EVENT,
  IN_FLOW_SETTING_KEY,
} from "../../utils/in-flow-events";

export const ReviewControls = component$(() => {
  const state = useStore({
    enabled: true,
    tools: true,
    ready: false,
    saving: false,
    error: "",
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      let disposed = false;
      const update = async () => {
        const [enabled, tools] = await Promise.all([
          loadMetaFromIdb<boolean>("live-review-enabled"),
          loadMetaFromIdb<boolean>(IN_FLOW_SETTING_KEY),
        ]);
        if (disposed) return;
        state.enabled = enabled !== false;
        state.tools = tools !== false;
        state.ready = true;
      };
      void update();
      window.addEventListener("twyne:live-review-setting", update);
      window.addEventListener(IN_FLOW_SETTING_EVENT, update);
      cleanup(() => {
        disposed = true;
        window.removeEventListener("twyne:live-review-setting", update);
        window.removeEventListener(IN_FLOW_SETTING_EVENT, update);
      });
    },
    { strategy: "document-ready" },
  );

  const toggle = $(async (setting: "enabled" | "tools") => {
    if (!state.ready || state.saving) return;
    const previous = state[setting];
    state[setting] = !previous;
    state.saving = true;
    state.error = "";
    try {
      const key =
        setting === "enabled" ? "live-review-enabled" : IN_FLOW_SETTING_KEY;
      const next = state[setting];
      await saveMetaToIdb(key, next);
      if ((await loadMetaFromIdb<boolean>(key)) !== next) {
        throw new Error("Setting was not saved");
      }
      window.dispatchEvent(
        new CustomEvent(
          setting === "enabled"
            ? "twyne:live-review-setting"
            : IN_FLOW_SETTING_EVENT,
        ),
      );
    } catch {
      state[setting] = previous;
      state.error = "Could not save this setting. Try again.";
    } finally {
      state.saving = false;
    }
  });

  return (
    <section class="review-controls" aria-label="Review settings">
      {(["enabled", "tools"] as const).map((setting) => (
        <button
          key={setting}
          type="button"
          role="switch"
          aria-checked={state[setting]}
          class="review-controls__switch focus-ring"
          disabled={
            !state.ready ||
            state.saving ||
            (setting === "tools" && !state.enabled)
          }
          title={
            setting === "enabled"
              ? "Review saved writing automatically. Switch off to pause."
              : !state.enabled
                ? "Turn on automatic review to use margin tools."
                : "Show small tools beside passages that may need attention."
          }
          onClick$={() => toggle(setting)}
        >
          <span class="review-controls__label">
            {setting === "enabled" ? "Automatic review" : "Margin tools"}
          </span>
          <span class="review-controls__value" aria-hidden="true">
            {state[setting] ? "On" : "Off"}
          </span>
          <span class="review-controls__track" aria-hidden="true">
            <span />
          </span>
        </button>
      ))}
      <Link href="/settings/" class="review-controls__settings focus-ring">
        AI settings
      </Link>
      {state.error && (
        <p class="review-controls__error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
});
