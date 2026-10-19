/**
 * Settings → Scene Pictures.
 *
 * Scene Bench can draw a selected passage so the writer can see what a reader
 * has to imagine. Pictures cost far more than text, so this stays off until
 * the writer turns it on, and the writer chooses whose model pays for it.
 */
import { $, component$, type PropFunction } from "@qwik.dev/core";
import type { SceneMediaSettings } from "../../types";
import { DEFAULT_SCENE_MEDIA } from "../../utils/scene-media";
import {
  hostedSceneCostLabel,
  SCENE_CREDIT_WARNING,
} from "../../utils/scene-media-credit";

const SOURCES: Array<{
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

export const SceneMediaSettingsPanel = component$<{
  value: SceneMediaSettings | undefined;
  onChange$: PropFunction<(next: SceneMediaSettings) => void>;
}>((props) => {
  const current: SceneMediaSettings = {
    ...DEFAULT_SCENE_MEDIA,
    ...props.value,
  };
  const set = $((patch: Partial<SceneMediaSettings>) =>
    props.onChange$({ ...current, ...patch }),
  );

  return (
    <section id="scene-pictures" class="folio p-5 scroll-mt-6">
      <h2
        class="text-base font-semibold mb-1"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Scene Pictures
      </h2>
      <p class="text-xs text-[var(--color-ink-light)] mb-4">
        Scene Bench can draw a selected passage, then compare the picture with
        your page: what the words put in a reader's mind, what the reader has to
        invent, and what they might get wrong. Nothing is generated until you
        press Generate in the bench.
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
          {SOURCES.map((source) => {
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
    </section>
  );
});
