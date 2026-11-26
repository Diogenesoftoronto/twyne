/**
 * Settings → Scene Pictures & Interactive Worlds.
 *
 * Scene Bench can draw a selected passage as a static picture or launch a live
 * Genie 4 interactive world (24fps video + 48kHz stereo audio). Both spend far
 * more than text, so each stays off until the writer opts in and chooses whose
 * model pays for it.
 */
import { $, component$, type PropFunction } from "@qwik.dev/core";
import type { SceneMediaSettings } from "../../types";
import { DEFAULT_SCENE_MEDIA } from "../../utils/scene-media";
import {
  clampWorldIdleSeconds,
  clampWorldMaxSeconds,
  estimateWorldSessionCostMicros,
  formatCreditMicros,
  formatWorldDuration,
  hostedSceneCostLabel,
  hostedSceneWorldCostLabel,
  SCENE_CREDIT_WARNING,
  SCENE_WORLD_CREDIT_WARNING,
} from "../../utils/scene-media-credit";

const PICTURE_SOURCES: Array<{
  id: SceneMediaSettings["source"];
  title: string;
  body: string;
}> = [
  {
    id: "twyne",
    title: "Twyne's image model",
    body: `${hostedSceneCostLabel()}. Needs Pro or welcome credit.`,
  },
  {
    id: "provider",
    title: "Your own models",
    body: "OpenAI, Google, OpenRouter, or any OpenAI-compatible image endpoint. Choose the models under Feature Routing: Scene Pictures and Scene Picture Comparison.",
  },
];

const MAX_SESSION_OPTIONS = [30, 60, 120, 180, 300] as const;
const IDLE_STOP_OPTIONS = [15, 30, 45, 60, 120] as const;

export const SceneMediaSettingsPanel = component$<{
  value: SceneMediaSettings | undefined;
  onChange$: PropFunction<(next: SceneMediaSettings) => void>;
}>((props) => {
  const current: SceneMediaSettings = {
    ...DEFAULT_SCENE_MEDIA,
    ...props.value,
  };
  const worldEnabled = current.worldEnabled === true;
  const worldSource = current.worldSource ?? current.source ?? "twyne";
  const worldMaxSeconds = clampWorldMaxSeconds(current.worldMaxSeconds);
  const worldIdleSeconds = clampWorldIdleSeconds(current.worldIdleSeconds);

  const set = $((patch: Partial<SceneMediaSettings>) =>
    props.onChange$({ ...current, ...patch }),
  );

  const worldSources: Array<{
    id: SceneMediaSettings["source"];
    title: string;
    body: string;
  }> = [
    {
      id: "twyne",
      title: "Twyne's hosted Genie 4",
      body: `${hostedSceneWorldCostLabel(worldMaxSeconds)}. Needs Pro or welcome credit (at least $1.00 available).`,
    },
    {
      id: "provider",
      title: "Your own Google Gemini key",
      body: "Uses your paid-tier Google (Gemini) provider via the v1beta Interactions API (models/genie-4). Configure under Providers and Feature Routing: Interactive Scene World.",
    },
  ];

  return (
    <section id="scene-pictures" class="folio p-5 scroll-mt-6">
      <h2
        class="text-base font-semibold mb-1"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Scene Pictures & Interactive Worlds
      </h2>
      <p class="text-xs text-[var(--color-ink-light)] mb-4">
        Scene Bench can draw a selected passage and compare the picture with
        your page, or open a live Genie 4 world you can walk through and steer
        as you write. Nothing runs until you press Generate or Enter world in
        the bench.
      </p>

      <label class="flex items-start gap-2 text-sm text-[var(--color-ink)] cursor-pointer">
        <input
          type="checkbox"
          class="mt-1"
          checked={current.enabled}
          onChange$={(_, el) => set({ enabled: el.checked })}
        />
        <span>
          Allow Scene Bench to generate pictures
          <span class="block text-xs text-[var(--color-ink-light)]">
            {SCENE_CREDIT_WARNING}
          </span>
        </span>
      </label>

      {current.enabled && (
        <div class="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup">
          {PICTURE_SOURCES.map((source) => {
            const on = current.source === source.id;
            return (
              <button
                key={source.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick$={() => set({ source: source.id })}
                class={[
                  "text-left border p-3 focus-ring",
                  on
                    ? "border-[var(--color-cobalt)] bg-[var(--color-paper-soft)]"
                    : "border-[var(--color-paper-3)] hover:border-[var(--color-ink-muted)]",
                ]}
                style={{
                  borderRadius: "2px",
                  boxShadow: on ? "inset 3px 0 0 var(--color-cobalt)" : "none",
                }}
              >
                <span
                  class="block text-sm text-[var(--color-ink)]"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
                >
                  {source.title}
                </span>
                <span class="mt-1 block text-xs leading-snug text-[var(--color-ink-light)]">
                  {source.body}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        id="scene-worlds"
        class="mt-6 pt-5 border-t border-[var(--color-paper-3)] scroll-mt-6"
      >
        <h3
          class="text-sm font-semibold mb-1"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Interactive Scene Worlds (Genie 4)
        </h3>
        <p class="text-xs text-[var(--color-ink-light)] mb-3">
          Step inside the world of your passage at 24fps with synchronized
          stereo ambient audio, move with WASD or arrow keys, steer live from
          your edits, and capture any angle back into Scene Bench's page
          comparison.
        </p>

        <label class="flex items-start gap-2 text-sm text-[var(--color-ink)] cursor-pointer">
          <input
            type="checkbox"
            class="mt-1"
            checked={worldEnabled}
            onChange$={(_, el) => set({ worldEnabled: el.checked })}
          />
          <span>
            Allow Scene Bench to launch live Genie 4 worlds
            <span class="block text-xs text-[var(--color-ink-light)]">
              {SCENE_WORLD_CREDIT_WARNING}
            </span>
          </span>
        </label>

        {worldEnabled && (
          <>
            <div class="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup">
              {worldSources.map((source) => {
                const on = worldSource === source.id;
                return (
                  <button
                    key={source.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick$={() => set({ worldSource: source.id })}
                    class={[
                      "text-left border p-3 focus-ring",
                      on
                        ? "border-[var(--color-cobalt)] bg-[var(--color-paper-soft)]"
                        : "border-[var(--color-paper-3)] hover:border-[var(--color-ink-muted)]",
                    ]}
                    style={{
                      borderRadius: "2px",
                      boxShadow: on
                        ? "inset 3px 0 0 var(--color-cobalt)"
                        : "none",
                    }}
                  >
                    <span
                      class="block text-sm text-[var(--color-ink)]"
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 600,
                      }}
                    >
                      {source.title}
                    </span>
                    <span class="mt-1 block text-xs leading-snug text-[var(--color-ink-light)]">
                      {source.body}
                    </span>
                  </button>
                );
              })}
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <label class="block text-xs text-[var(--color-ink-light)]">
                Auto-stop session cap
                <select
                  class="mt-1 block w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2.5 py-2 text-sm text-[var(--color-ink)]"
                  value={String(worldMaxSeconds)}
                  onChange$={(_, el) =>
                    set({
                      worldMaxSeconds: clampWorldMaxSeconds(Number(el.value)),
                    })
                  }
                >
                  {MAX_SESSION_OPTIONS.map((seconds) => (
                    <option
                      key={seconds}
                      value={String(seconds)}
                      selected={worldMaxSeconds === seconds}
                    >
                      {`${formatWorldDuration(seconds)} (up to ${formatCreditMicros(estimateWorldSessionCostMicros(seconds))})`}
                    </option>
                  ))}
                </select>
              </label>

              <label class="block text-xs text-[var(--color-ink-light)]">
                Auto-stop when idle
                <select
                  class="mt-1 block w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2.5 py-2 text-sm text-[var(--color-ink)]"
                  value={String(worldIdleSeconds)}
                  onChange$={(_, el) =>
                    set({
                      worldIdleSeconds: clampWorldIdleSeconds(Number(el.value)),
                    })
                  }
                >
                  {IDLE_STOP_OPTIONS.map((seconds) => (
                    <option
                      key={seconds}
                      value={String(seconds)}
                      selected={worldIdleSeconds === seconds}
                    >
                      {`After ${seconds}s without movement or steering`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </div>
    </section>
  );
});
