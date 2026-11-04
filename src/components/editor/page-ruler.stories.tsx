import { component$, useSignal } from "@qwik.dev/core";
import type { Meta, StoryObj } from "storybook-framework-qwik";
import {
  DEFAULT_LAYOUT,
  resolveMargins,
  type LayoutSettings,
} from "../../types";
import { PageRuler } from "./page-ruler";

const RulerPreview = component$<{
  initialLayout: LayoutSettings;
  zen: boolean;
}>((props) => {
  const layout = useSignal({ ...props.initialLayout });
  const margins = resolveMargins(layout.value);
  return (
    <section style="padding: 2rem 1rem; overflow-x: auto; min-height: 100dvh; background: var(--color-paper-soft);">
      <p class="mb-4 text-xs text-[var(--color-ink-light)]" role="status">
        Drag the margin markers, or focus one and use the arrow keys. Left:{" "}
        {margins.left.toFixed(2)} rem; right: {margins.right.toFixed(2)} rem.
      </p>
      <div style="width: 42rem; max-width: none;">
        <PageRuler
          layout={layout.value}
          pageWidthRem={42}
          zen={props.zen}
          onChange$={(next) => {
            layout.value = next;
          }}
        />
        <article
          class="paper-sheet"
          style={{
            padding: `3rem ${margins.right}rem 5rem ${margins.left}rem`,
            minHeight: "24rem",
          }}
        >
          <h1 style="font: 1.8rem/1.3 var(--font-display); margin-bottom: 1rem;">
            The public room
          </h1>
          <p style="font: 1.1rem/1.8 var(--font-serif);">
            The library was the only room in the city where nobody had to buy
            anything to stay. At nine each morning, its doors opened to anyone
            who needed a chair.
          </p>
        </article>
      </div>
    </section>
  );
});
const meta = {
  title: "Editor/PageRuler",
  component: RulerPreview,
  parameters: { layout: "fullscreen" },
  args: { initialLayout: DEFAULT_LAYOUT, zen: false },
} satisfies Meta<typeof RulerPreview>;
export default meta;
type Story = StoryObj<typeof RulerPreview>;
export const Interactive: Story = {};
export const AsymmetricMargins: Story = {
  args: { initialLayout: { ...DEFAULT_LAYOUT, marginLeft: 6, marginRight: 2 } },
};
export const NarrowColumn: Story = {
  args: { initialLayout: { ...DEFAULT_LAYOUT, marginLeft: 8, marginRight: 8 } },
};
export const Zen: Story = { args: { zen: true } };
