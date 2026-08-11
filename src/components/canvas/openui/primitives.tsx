/**
 * The Qwik renderers behind the OpenUI component library.
 *
 * One component per primitive in `library.ts`. The renderer walks the parsed
 * AST and calls these with `{ props, renderNode, statementId }` — the shape
 * lang-core's `ComponentRenderProps` describes. `renderNode` turns a child
 * element node into JSX; leaf primitives never need it.
 *
 * Everything here is styled in Twyne's letterpress register — typewriter faces
 * for structural furniture, serif for the source's own words, dashed rules
 * rather than solid boxes — so an extracted card sits beside the manuscript
 * without looking like it came from a different application.
 *
 * These render at any zoom. Keep sizes in `rem` and let the stage's CSS
 * transform do the scaling; nothing here should read the zoom level.
 */

import { component$, type Component, type JSXOutput } from "@builder.io/qwik";

/** The props lang-core's adapter contract hands every component. */
export interface CanvasBlockProps<P> {
  props: P;
  renderNode: (value: unknown) => JSXOutput;
  statementId?: string;
}

/**
 * The widened component type the library is keyed on.
 *
 * `createLibrary<C>` takes a single `C` for every entry, but each primitive is
 * typed to its own prop shape. This is the one place that variance is erased —
 * lang-core stores the value opaquely and never inspects it, so nothing
 * downstream depends on the narrower type. Implementations stay fully checked
 * against their own props; only the library boundary is loose.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CanvasComponent = Component<CanvasBlockProps<any>>;

/* ── Leaf blocks ─────────────────────────────────────────────────────────── */

export const ProseBlock = component$<CanvasBlockProps<{ text?: string }>>(
  ({ props }) => (
    <p class="mb-2 font-[var(--font-serif)] text-[0.82rem] leading-relaxed text-[var(--color-ink-light)]">
      {props.text}
    </p>
  ),
);

export const OutlineBlock = component$<
  CanvasBlockProps<{
    items?: { text?: string; depth?: number; emphasis?: boolean }[];
  }>
>(({ props }) => (
  <ul class="mb-2 space-y-0.5">
    {(props.items ?? []).map((item, i) => (
      <li
        key={i}
        class="font-[var(--font-serif)] text-[0.8rem] leading-snug text-[var(--color-ink-light)]"
        style={{
          // Depth is a number from the model; clamp so a bad value can't push
          // the line out of the card.
          paddingLeft: `${Math.min(Math.max(item.depth ?? 0, 0), 4) * 0.85}rem`,
          fontWeight: item.emphasis ? 600 : 400,
        }}
      >
        {item.text}
      </li>
    ))}
  </ul>
));

export const KeyValueTableBlock = component$<
  CanvasBlockProps<{ caption?: string; rows?: { key?: string; value?: string }[] }>
>(({ props }) => (
  <div class="mb-2">
    {props.caption && <BlockCaption text={props.caption} />}
    <dl class="border border-[var(--color-paper-3)]">
      {(props.rows ?? []).map((row, i) => (
        <div
          key={i}
          class="grid grid-cols-[minmax(5rem,32%)_1fr] border-b border-dashed border-[var(--color-paper-3)] last:border-b-0"
        >
          <dt class="border-r border-dashed border-[var(--color-paper-3)] px-2 py-1 font-[var(--font-typewriter)] text-[0.66rem] leading-snug tracking-wide text-[var(--color-ink)]">
            {row.key}
          </dt>
          <dd class="px-2 py-1 font-[var(--font-serif)] text-[0.76rem] leading-snug text-[var(--color-ink-light)]">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  </div>
));

export const ComparisonBlock = component$<
  CanvasBlockProps<{
    caption?: string;
    columns?: string[];
    rows?: { label?: string; cells?: string[] }[];
  }>
>(({ props }) => {
  const columns = props.columns ?? [];
  return (
    <div class="mb-2">
      {props.caption && <BlockCaption text={props.caption} />}
      {/* A comparison can be wider than its card; let it scroll rather than
          forcing the card to grow and disturb the column packing. */}
      <div class="overflow-x-auto">
        <table class="w-full border-collapse border border-[var(--color-paper-3)]">
          <thead>
            <tr>
              <th class="border-b border-r border-dashed border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1" />
              {columns.map((col, i) => (
                <th
                  key={i}
                  class="border-b border-r border-dashed border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1 text-left font-[var(--font-typewriter)] text-[0.64rem] uppercase tracking-[0.08em] text-[var(--color-ink)] last:border-r-0"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(props.rows ?? []).map((row, r) => (
              <tr key={r}>
                <th class="border-b border-r border-dashed border-[var(--color-paper-3)] px-2 py-1 text-left font-[var(--font-typewriter)] text-[0.64rem] leading-snug text-[var(--color-ink-light)]">
                  {row.label}
                </th>
                {/* Index by column, not by cell, so a short row from the model
                    leaves blanks instead of shifting every later value left. */}
                {columns.map((_, c) => (
                  <td
                    key={c}
                    class="border-b border-r border-dashed border-[var(--color-paper-3)] px-2 py-1 font-[var(--font-serif)] text-[0.74rem] leading-snug text-[var(--color-ink-light)] last:border-r-0"
                  >
                    {row.cells?.[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export const FlowBlock = component$<
  CanvasBlockProps<{
    caption?: string;
    steps?: { id?: string; label?: string; detail?: string; after?: string[] }[];
  }>
>(({ props }) => {
  const steps = props.steps ?? [];
  // Rank each step by how far it sits from an entry step, so a branching tree
  // reads as tiers. Iterative rather than recursive: the model can emit an
  // `after` cycle, and a depth-first walk would hang the render.
  const rank = new Map<string, number>();
  for (const s of steps) if (s.id && !s.after?.length) rank.set(s.id, 0);
  for (let pass = 0; pass < steps.length; pass++) {
    let settled = true;
    for (const s of steps) {
      if (!s.id || rank.has(s.id)) continue;
      const parents = (s.after ?? []).map((p) => rank.get(p));
      if (parents.length && parents.every((p) => p !== undefined)) {
        rank.set(s.id, Math.max(...(parents as number[])) + 1);
        settled = false;
      }
    }
    if (settled) break;
  }
  // Anything still unranked was part of a cycle or referenced a missing id.
  // It belongs on the board, so give it the last tier rather than dropping it.
  const fallback = rank.size ? Math.max(...rank.values()) + 1 : 0;
  const tiers = new Map<number, typeof steps>();
  for (const s of steps) {
    const t = (s.id ? rank.get(s.id) : undefined) ?? fallback;
    tiers.set(t, [...(tiers.get(t) ?? []), s]);
  }

  return (
    <div class="mb-2">
      {props.caption && <BlockCaption text={props.caption} />}
      <div class="space-y-1">
        {[...tiers.keys()]
          .sort((a, b) => a - b)
          .map((tier) => (
            <div key={tier}>
              {tier > 0 && (
                <div
                  aria-hidden="true"
                  class="mx-auto h-2 w-px bg-[var(--color-paper-3)]"
                />
              )}
              <div class="flex flex-wrap justify-center gap-1">
                {(tiers.get(tier) ?? []).map((s, i) => (
                  <div
                    key={i}
                    class="min-w-0 flex-1 basis-[7rem] border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1 text-center"
                  >
                    <div class="font-[var(--font-typewriter)] text-[0.66rem] leading-snug text-[var(--color-ink)]">
                      {s.label}
                    </div>
                    {s.detail && (
                      <div class="mt-0.5 font-[var(--font-serif)] text-[0.68rem] leading-snug text-[var(--color-ink-muted)]">
                        {s.detail}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
});

export const QuoteBlock = component$<
  CanvasBlockProps<{ text?: string; locator?: string }>
>(({ props }) => (
  <blockquote class="mb-2 border-l-2 border-[var(--color-vermilion)] pl-2">
    <p class="font-[var(--font-serif)] text-[0.82rem] italic leading-relaxed text-[var(--color-ink)]">
      {props.text}
    </p>
    {props.locator && (
      <cite class="mt-0.5 block font-[var(--font-typewriter)] text-[0.62rem] not-italic tracking-wide text-[var(--color-ink-muted)]">
        {props.locator}
      </cite>
    )}
  </blockquote>
));

export const FigureBlock = component$<
  CanvasBlockProps<{ src?: string; alt?: string; caption?: string }>
>(({ props }) => {
  // The model is told never to invent a src, but a hallucinated or relative URL
  // would still render as a broken image on the board. Only http(s) is drawn.
  const src = props.src ?? "";
  const safe = /^https?:\/\//i.test(src);
  return (
    <figure class="mb-2">
      {safe ? (
        <img
          src={src}
          alt={props.alt ?? ""}
          loading="lazy"
          decoding="async"
          width={600}
          height={400}
          class="h-auto w-full border border-[var(--color-paper-3)] object-contain"
        />
      ) : (
        <div class="border border-dashed border-[var(--color-paper-3)] px-2 py-3 text-center font-[var(--font-typewriter)] text-[0.64rem] text-[var(--color-ink-muted)]">
          [figure not linkable] {props.alt}
        </div>
      )}
      {props.caption && (
        <figcaption class="mt-0.5 font-[var(--font-typewriter)] text-[0.62rem] leading-snug text-[var(--color-ink-muted)]">
          {props.caption}
        </figcaption>
      )}
    </figure>
  );
});

const CALLOUT_TONES: Record<string, { border: string; label: string }> = {
  note: { border: "var(--color-cobalt)", label: "note" },
  warning: { border: "var(--color-accent-red)", label: "warning" },
  key: { border: "var(--color-mustard)", label: "key" },
  caveat: { border: "var(--color-accent-amber)", label: "caveat" },
};

export const CalloutBlock = component$<
  CanvasBlockProps<{ tone?: string; title?: string; text?: string }>
>(({ props }) => {
  const tone = CALLOUT_TONES[props.tone ?? "note"] ?? CALLOUT_TONES.note;
  return (
    <aside
      class="mb-2 border-l-2 bg-[var(--color-paper-soft)] px-2 py-1.5"
      style={{ borderLeftColor: tone.border }}
    >
      <div
        class="font-[var(--font-typewriter)] text-[0.6rem] uppercase tracking-[0.12em]"
        style={{ color: tone.border }}
      >
        {props.title || tone.label}
      </div>
      <p class="mt-0.5 font-[var(--font-serif)] text-[0.78rem] leading-snug text-[var(--color-ink-light)]">
        {props.text}
      </p>
    </aside>
  );
});

const STANCE_COLORS: Record<string, string> = {
  supports: "var(--color-accent-green)",
  complicates: "var(--color-accent-amber)",
  contradicts: "var(--color-accent-red)",
  background: "var(--color-ink-muted)",
};

/**
 * The machine's own voice. Deliberately the only block with a filled ground and
 * a sans face — at a glance the writer can tell what the source said from what
 * the model thinks about it.
 */
export const AnnotationBlock = component$<
  CanvasBlockProps<{
    stance?: string;
    relevance?: string;
    draftAnchor?: string;
    score?: number;
  }>
>(({ props }) => {
  const color = STANCE_COLORS[props.stance ?? "background"] ?? STANCE_COLORS.background;
  return (
    <div class="mt-2 border-t border-dashed border-[var(--color-paper-3)] pt-1.5">
      <div class="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          class="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
        />
        <span
          class="font-[var(--font-typewriter)] text-[0.6rem] uppercase tracking-[0.12em]"
          style={{ color }}
        >
          {props.stance ?? "background"}
        </span>
        {typeof props.score === "number" && (
          <span class="font-[var(--font-typewriter)] text-[0.6rem] text-[var(--color-ink-muted)]">
            {"·".repeat(Math.min(Math.max(props.score, 1), 5))}
          </span>
        )}
      </div>
      <p class="mt-1 font-[var(--font-sans)] text-[0.74rem] leading-snug text-[var(--color-ink-light)]">
        {props.relevance}
      </p>
      {props.draftAnchor && (
        <p class="mt-1 border-l border-[var(--color-paper-3)] pl-1.5 font-[var(--font-serif)] text-[0.7rem] italic leading-snug text-[var(--color-ink-muted)]">
          “{props.draftAnchor}”
        </p>
      )}
    </div>
  );
});

/* ── Structure ───────────────────────────────────────────────────────────── */

/**
 * One card's interior. The chrome around it — border, drag handle, resize grip,
 * stance tint — belongs to `canvas-card.tsx`; this renders only what is inside,
 * so the same composed content can also fill the inspector panel at a larger
 * size without duplicating any of it.
 */
export const CardBlock = component$<
  CanvasBlockProps<{ title?: string; blocks?: unknown[] }>
>(({ props, renderNode }) => (
  <div>
    {props.title && (
      <h3 class="mb-1.5 border-b border-[var(--color-paper-3)] pb-1 font-[var(--font-display)] text-[0.9rem] leading-tight text-[var(--color-ink)]">
        {props.title}
      </h3>
    )}
    {(props.blocks ?? []).map((block, i) => (
      <div key={i}>{renderNode(block)}</div>
    ))}
  </div>
));

/**
 * The root. Extraction streams many cards from one source, and each completed
 * child is lifted out into its own `CanvasNode` by `source-extract.ts` — so in
 * practice this renders only in previews, where a plain stack is what's wanted.
 */
export const CardsRoot = component$<CanvasBlockProps<{ cards?: unknown[] }>>(
  ({ props, renderNode }) => (
    <div class="space-y-3">
      {(props.cards ?? []).map((card, i) => (
        <div key={i}>{renderNode(card)}</div>
      ))}
    </div>
  ),
);

function BlockCaption({ text }: { text: string }) {
  return (
    <div class="mb-0.5 font-[var(--font-typewriter)] text-[0.62rem] uppercase tracking-[0.1em] text-[var(--color-ink-muted)]">
      {text}
    </div>
  );
}
