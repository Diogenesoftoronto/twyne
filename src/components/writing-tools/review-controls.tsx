import { $, component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import { loadMetaFromIdb, saveMetaToIdb } from "../../utils/idb";
import {
  COVER_LOOKUP_SETTING_KEY,
  FLOW_SETTING_EVENT,
  FLOW_SETTING_KEY,
  IN_FLOW_SETTING_EVENT,
  IN_FLOW_SETTING_KEY,
} from "../../utils/in-flow-events";

type Setting = "enabled" | "tools" | "flow" | "covers";

/** Where each switch is stored, and the event that tells its readers. */
const SETTINGS: Record<Setting, { key: string; event: string }> = {
  enabled: { key: "live-review-enabled", event: "twyne:live-review-setting" },
  tools: { key: IN_FLOW_SETTING_KEY, event: IN_FLOW_SETTING_EVENT },
  flow: { key: FLOW_SETTING_KEY, event: FLOW_SETTING_EVENT },
  covers: { key: COVER_LOOKUP_SETTING_KEY, event: FLOW_SETTING_EVENT },
};

const LABELS: Record<Setting, string> = {
  enabled: "Automatic review",
  tools: "Margin tools",
  flow: "Automatic focus",
  covers: "Cover lookups",
};

const TITLES: Record<Setting, string> = {
  enabled: "Review saved writing automatically. Switch off to pause.",
  tools: "Show small tools beside passages that may need attention.",
  flow: "Read the rhythm of your typing: go quiet and into focus while you're writing steadily, and bring help in when you stall.",
  covers:
    "Look up the books and records your draft names for a cover card. Only the title leaves this device.",
};

export const ReviewControls = component$(() => {
  const state = useStore({
    enabled: true,
    tools: true,
    flow: true,
    covers: true,
    ready: false,
    saving: false,
    error: "",
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      let disposed = false;
      const update = async () => {
        const [enabled, tools, flow, covers] = await Promise.all(
          (["enabled", "tools", "flow", "covers"] as const).map((setting) =>
            loadMetaFromIdb<boolean>(SETTINGS[setting].key),
          ),
        );
        if (disposed) return;
        state.enabled = enabled !== false;
        state.tools = tools !== false;
        state.flow = flow !== false;
        state.covers = covers !== false;
        state.ready = true;
      };
      void update();
      window.addEventListener("twyne:live-review-setting", update);
      window.addEventListener(IN_FLOW_SETTING_EVENT, update);
      window.addEventListener(FLOW_SETTING_EVENT, update);
      cleanup(() => {
        disposed = true;
        window.removeEventListener("twyne:live-review-setting", update);
        window.removeEventListener(IN_FLOW_SETTING_EVENT, update);
        window.removeEventListener(FLOW_SETTING_EVENT, update);
      });
    },
    { strategy: "document-ready" },
  );

  const toggle = $(async (setting: Setting) => {
    if (!state.ready || state.saving) return;
    const previous = state[setting];
    state[setting] = !previous;
    state.saving = true;
    state.error = "";
    try {
      const { key, event } = SETTINGS[setting];
      const next = state[setting];
      await saveMetaToIdb(key, next);
      if ((await loadMetaFromIdb<boolean>(key)) !== next) {
        throw new Error("Setting was not saved");
      }
      window.dispatchEvent(new CustomEvent(event));
    } catch {
      state[setting] = previous;
      state.error = "Could not save this setting. Try again.";
    } finally {
      state.saving = false;
    }
  });

  return (
    <section class="review-controls" aria-label="Review settings">
      {(["enabled", "tools", "flow", "covers"] as const).map((setting) => (
        <button
          key={setting}
          type="button"
          role="switch"
          aria-checked={state[setting]}
          class="review-controls__switch focus-ring"
          disabled={
            !state.ready ||
            state.saving ||
            (setting !== "enabled" && !state.enabled)
          }
          title={
            setting !== "enabled" && !state.enabled
              ? "Turn on automatic review first."
              : TITLES[setting]
          }
          onClick$={() => toggle(setting)}
        >
          <span class="review-controls__label">{LABELS[setting]}</span>
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
