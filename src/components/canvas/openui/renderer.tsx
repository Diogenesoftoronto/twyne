import { component$ } from "@builder.io/qwik";
import { createParser, type ElementNode } from "@openuidev/lang-core";
import { canvasSchema } from "./library";
import { OpenUiRenderNode } from "./render-node";

export const OpenUiRenderer = component$<{
  source?: string;
  root?: ElementNode | null;
  label?: string;
}>(({ source = "", root, label = "Extracted source card" }) => {
  const parsed = root === undefined && source
    ? createParser(canvasSchema(), "Cards").parse(source).root
    : root;

  if (!parsed) {
    return (
      <div role="status" class="font-[var(--font-typewriter)] text-[0.68rem] text-[var(--color-ink-muted)]">
        Waiting for source structure…
      </div>
    );
  }

  return (
    <div aria-label={label} class="openui-source-card">
      <OpenUiRenderNode node={parsed} />
    </div>
  );
});

