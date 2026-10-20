/**
 * Connected passages, gathered.
 *
 * A read-only sheet over a dimmed desk: every passage a note or thread
 * connects, quoted from the manuscript with its paragraph around it, in
 * reading order. Beside them, the whole manuscript in miniature, so the
 * lines run from where each passage sits to the passage itself. Nothing here
 * edits the text; "Go to passage" closes the sheet and puts the caret there.
 */
import {
  $,
  component$,
  noSerialize,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
  type NoSerialize,
} from "@qwik.dev/core";
import {
  excerptFromRange,
  orderPassages,
  PASSAGE_GATHER_EVENT,
  revealPassage,
  type GatherRequest,
} from "../../utils/passage-gather";
import styles from "./passage-gather.css?inline";

interface Shown {
  id: string;
  label: string;
  color: string;
  notes: string[];
  before: string;
  match: string;
  after: string;
  at: number;
}
interface GatherState {
  open: boolean;
  closing: boolean;
  title: string;
  note: string;
  notice: string;
  passages: Shown[];
  /** The manuscript's blocks in miniature: top and height as fractions. */
  blocks: { top: number; height: number; width: number }[];
  view: { top: number; height: number };
  lines: { d: string; color: string }[];
}

const clip = (text: string, n: number) =>
  text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;

export const PassageGather = component$(() => {
  useStyles$(styles);
  const sheet = useSignal<HTMLElement>();
  const live = useSignal<
    NoSerialize<{
      ranges: Map<string, Range>;
      resolvers: Map<string, () => Range | null>;
      goes: Map<string, () => void>;
      opener: HTMLElement | null;
      openerKey: string | null;
    }>
  >();
  const state = useStore<GatherState>({
    open: false,
    closing: false,
    title: "",
    note: "",
    notice: "",
    passages: [],
    blocks: [],
    view: { top: 0, height: 0 },
    lines: [],
  });

  const restoreFocus = useSignal(false);

  // Run after Qwik commits the closing render, when the margin controls
  // have been restored and any replaced opener has its final DOM node.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const open = track(() => state.open);
    if (open || !restoreFocus.value) return;
    restoreFocus.value = false;
    const opener = live.value?.opener;
    const openerKey = live.value?.openerKey;
    const current = openerKey
      ? document.querySelector<HTMLElement>(
          `[data-gather-opener="${CSS.escape(openerKey)}"]`,
        )
      : null;
    const target =
      current ??
      (opener?.isConnected ? opener : null) ??
      document.querySelector<HTMLElement>(".flow-dock__chip, .ProseMirror");
    target?.focus({ preventScroll: true });
  });

  const close = $((then?: () => void) => {
    if (!state.open || state.closing) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    state.closing = true;
    restoreFocus.value = !then;
    setTimeout(
      () => {
        state.open = false;
        state.closing = false;
        state.lines = [];
        delete document.documentElement.dataset.gathering;
        if (then) then();
      },
      still ? 0 : 180,
    );
  });

  const go = $((id: string) => {
    const custom = live.value?.goes.get(id);
    const resolve = live.value?.resolvers.get(id);
    let range = resolve ? resolve() : live.value?.ranges.get(id);
    const shown = state.passages.find((passage) => passage.id === id);
    const matches = () =>
      !!range &&
      !!shown &&
      document.contains(range.commonAncestorContainer) &&
      range.toString() === shown.match;
    if (!matches()) {
      state.notice =
        "This passage changed. Close and reopen this view to follow it.";
      return;
    }
    void close(() => {
      // A remote edit or decoration render can arrive during closing too.
      if (resolve) range = resolve();
      if (!matches()) return;
      if (custom) custom();
      else revealPassage(range!);
    });
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    let pending: (GatherRequest & { from: Map<string, DOMRect> }) | null = null;
    const onGather = (event: Event) => {
      const request = (event as CustomEvent<GatherRequest>).detail;
      const doc = document.querySelector<HTMLElement>(
        "#twyne-editor-mount .ProseMirror, .ProseMirror",
      );
      if (!request?.passages.length || !doc) return;
      const ordered = orderPassages(
        request.passages.filter((p) =>
          doc.contains(p.range.commonAncestorContainer),
        ),
      );
      if (!ordered.length) return;
      const ranges = new Map(ordered.map((p) => [p.id, p.range]));
      // Where each passage stands now, before anything on the page moves.
      const from = new Map(
        ordered.map((p) => [p.id, p.range.getBoundingClientRect()]),
      );
      const opener =
        request.opener ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      live.value = noSerialize({
        ranges,
        resolvers: new Map(
          ordered.flatMap((p) =>
            p.resolveRange ? [[p.id, p.resolveRange] as const] : [],
          ),
        ),
        goes: new Map(
          ordered.flatMap((p) => (p.go ? [[p.id, p.go] as const] : [])),
        ),
        opener,
        openerKey: opener?.dataset.gatherOpener ?? null,
      });
      state.title = request.title;
      state.note = clip(request.note ?? "", 320);
      state.notice = "";
      state.passages = ordered.map((p) => ({
        id: p.id,
        label: p.label,
        color: p.color,
        notes: (p.notes ?? []).map((n) => clip(n, 240)),
        ...excerptFromRange(p.range, doc),
      }));
      // The manuscript in miniature: one bar per block, as long as its text.
      const docRect = doc.getBoundingClientRect();
      const height = Math.max(1, docRect.height);
      state.blocks = Array.from(doc.children)
        .slice(0, 400)
        .map((block) => {
          const r = block.getBoundingClientRect();
          return {
            top: (r.top - docRect.top) / height,
            height: Math.max(r.height / height, 0.002),
            width: Math.min(1, 0.25 + (block.textContent?.length ?? 0) / 600),
          };
        })
        .filter((b) => b.top >= 0 && b.top <= 1);
      const scroller = doc.closest<HTMLElement>(".page-canvas")?.parentElement;
      const sRect = scroller?.getBoundingClientRect() ?? {
        top: 0,
        height: window.innerHeight,
      };
      state.view = {
        top: Math.max(0, (sRect.top - docRect.top) / height),
        height: Math.min(1, sRect.height / height),
      };
      state.closing = false;
      state.open = true;
      // Panels outside this stacking context step back while it is open.
      document.documentElement.dataset.gathering = "";
      pending = { ...request, passages: ordered, from };
      schedule();
    };
    window.addEventListener(PASSAGE_GATHER_EVENT, onGather);
    cleanup(() => window.removeEventListener(PASSAGE_GATHER_EVENT, onGather));

    // After the sheet renders: draw its lines, move focus in, and let each
    // passage travel from its place in the page.
    const settle = () => {
      const el = document.querySelector<HTMLElement>(
        "[data-passage-gather] [role=dialog]",
      );
      if (!el || !state.open) return;
      const body = el.querySelector<HTMLElement>(".passage-gather__body");
      if (!body) return;
      const box = body.getBoundingClientRect();
      state.lines = state.passages.flatMap((p) => {
        const tick = el.querySelector(
          `[data-gather-tick="${CSS.escape(p.id)}"]`,
        );
        const item = el.querySelector(
          `[data-gather-passage="${CSS.escape(p.id)}"]`,
        );
        if (!tick || !item) return [];
        const a = tick.getBoundingClientRect();
        const b = item.getBoundingClientRect();
        const x1 = a.right - box.left,
          y1 = a.top + a.height / 2 - box.top;
        // A passage scrolled out of the list keeps its line, to the edge.
        const list = item.parentElement!.getBoundingClientRect();
        const x2 = b.left - box.left,
          y2 =
            Math.min(
              Math.max(Math.min(b.top + 22, b.bottom - 8), list.top + 4),
              list.bottom - 4,
            ) - box.top;
        const bend = Math.max(12, (x2 - x1) / 2);
        return [
          {
            d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
            color: p.color,
          },
        ];
      });
      if (!pending) return;
      const request = pending;
      pending = null;
      el.querySelector<HTMLElement>(".passage-gather__close")?.focus({
        preventScroll: true,
      });
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (still || request.animate === false) return;
      for (const p of request.passages) {
        const item = el.querySelector<HTMLElement>(
          `[data-gather-passage="${CSS.escape(p.id)}"]`,
        );
        if (!item) continue;
        const to = item.getBoundingClientRect();
        const from = request.from.get(p.id);
        if (!from?.height) continue;
        const y = Math.min(
          Math.max(from.top, -40),
          window.innerHeight + 40 - to.height,
        );
        item.animate(
          [
            {
              transform: `translate(${from.left - to.left}px, ${y - to.top}px) scale(0.97)`,
              opacity: 0.35,
            },
            { transform: "none", opacity: 1 },
          ],
          { duration: 460, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
        );
      }
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => requestAnimationFrame(settle));
    };
    window.addEventListener("resize", schedule);
    // The list scrolls inside the sheet; its lines follow.
    const onScroll = (event: Event) => {
      if (
        (event.target as Element)?.classList?.contains("passage-gather__list")
      )
        schedule();
    };
    document.addEventListener("scroll", onScroll, true);

    // Escape belongs to the sheet while it is open, before the editor's
    // focus or instrument handlers see it. Tab stays inside the sheet.
    const onKey = (event: KeyboardEvent) => {
      if (!state.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void close();
        return;
      }
      // Read the live sheet: a ref can still name the previous opening's node.
      const dialog = document.querySelector<HTMLElement>(
        "[data-passage-gather] [role=dialog]",
      );
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>("button:not([disabled])"),
      );
      if (!focusable.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    cleanup(() => {
      delete document.documentElement.dataset.gathering;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey, true);
    });
  });

  if (!state.open) return null;
  return (
    <div
      class={["passage-gather", { "is-closing": state.closing }]}
      data-passage-gather
    >
      <div
        class="passage-gather__scrim"
        aria-hidden="true"
        onClick$={() => close()}
      />
      <section
        ref={sheet}
        class="passage-gather__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="passage-gather-title"
      >
        <header class="passage-gather__head">
          <div>
            <p class="passage-gather__kicker">
              {state.passages.length} connected passage
              {state.passages.length === 1 ? "" : "s"} · read only
            </p>
            <h2 id="passage-gather-title" class="passage-gather__title">
              {state.title}
            </h2>
            {state.note && <p class="passage-gather__note">{state.note}</p>}
            {state.notice && (
              <p class="passage-gather__notice" role="status">
                {state.notice}
              </p>
            )}
          </div>
          <button
            type="button"
            class="btn-paper in-flow-mini passage-gather__close"
            onClick$={() => close()}
            aria-keyshortcuts="Escape"
          >
            Close <kbd>Esc</kbd>
          </button>
        </header>
        <div class="passage-gather__body">
          <nav
            class="passage-gather__map"
            aria-label="Where these passages sit in the manuscript"
          >
            <div class="passage-gather__page" aria-hidden="true">
              {state.blocks.map((b, i) => (
                <i
                  key={i}
                  style={{
                    top: `${b.top * 100}%`,
                    height: `${b.height * 100}%`,
                    width: `${b.width * 100}%`,
                  }}
                />
              ))}
              <span
                class="passage-gather__view"
                style={{
                  top: `${state.view.top * 100}%`,
                  height: `${state.view.height * 100}%`,
                }}
              />
            </div>
            {state.passages.map((p, i) => (
              <button
                type="button"
                key={p.id}
                data-gather-tick={p.id}
                class="passage-gather__tick"
                style={{ top: `${p.at * 100}%`, "--gather-color": p.color }}
                aria-label={`Go to passage ${i + 1}: ${clip(p.match, 80)}`}
                onClick$={() => go(p.id)}
              >
                {i + 1}
              </button>
            ))}
          </nav>
          <svg class="passage-gather__lines" aria-hidden="true">
            {state.lines.map((line, i) => (
              <path key={i} d={line.d} style={{ stroke: line.color }} />
            ))}
          </svg>
          <ol class="passage-gather__list">
            {state.passages.map((p, i) => (
              <li
                key={p.id}
                data-gather-passage={p.id}
                class="passage-gather__passage"
                style={{ "--gather-color": p.color }}
              >
                <p class="passage-gather__label">
                  <span class="passage-gather__num">{i + 1}</span>
                  {p.label}
                  <span class="passage-gather__where">
                    {Math.round(p.at * 100)}% through
                  </span>
                </p>
                <blockquote class="passage-gather__text">
                  {p.before}
                  <mark>{p.match}</mark>
                  {p.after}
                </blockquote>
                {p.notes.length > 0 && (
                  <ul class="passage-gather__notes">
                    {p.notes.map((note, n) => (
                      <li key={n}>{note}</li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  class="passage-gather__go"
                  onClick$={() => go(p.id)}
                >
                  Go to passage
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
});
