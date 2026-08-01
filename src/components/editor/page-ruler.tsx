import {
  component$,
  useSignal,
  $,
  sync$,
  type PropFunction,
} from "@builder.io/qwik";
import {
  MARGIN_RANGE,
  resolveMargins,
  type LayoutSettings,
} from "../../types";

interface PageRulerProps {
  layout: LayoutSettings;
  onChange$: PropFunction<(next: LayoutSettings) => void>;
  /** Page width in rem, so the ruler spans exactly the page it describes. */
  pageWidthRem: number;
  /** Faded out while the writer is in zen mode, like the toolbar. */
  zen?: boolean;
}

type Edge = "left" | "right";

/** Root font size, for converting a pixel drag into rem. */
function rootFontSize(): number {
  if (typeof window === "undefined") return 16;
  const size = parseFloat(
    getComputedStyle(document.documentElement).fontSize || "16",
  );
  return Number.isFinite(size) && size > 0 ? size : 16;
}

function clampMargin(edge: Edge, rem: number, opposite: number, pageWidthRem: number): number {
  const range = MARGIN_RANGE[edge];
  // Never let the two margins meet: a text column narrower than this is not
  // a layout choice, it is a broken document the writer cannot type into.
  const MIN_COLUMN_REM = 8;
  const maxByColumn = Math.max(0, pageWidthRem - opposite - MIN_COLUMN_REM);
  return Math.min(Math.max(rem, range.min), Math.min(range.max, maxByColumn));
}

/** Round to the nearest step, so dragging lands on tidy values. */
function snap(rem: number, step: number): number {
  return Math.round(rem / step) * step;
}

/**
 * A Word-style page ruler with draggable margin markers.
 *
 * The previous layout tool offered only sliders in a popover, which asks the
 * writer to translate "3.25 rem" into a picture of their page. A ruler is
 * direct manipulation: the marker sits where the margin is, you drag the edge
 * of the text column, and the manuscript reflows underneath. That is what
 * "change the margins" means to anyone who has used a word processor.
 *
 * Dragging is done with pointer capture rather than document-level listeners
 * so a drag that leaves the window still ends cleanly, and the keyboard gets
 * the same control — arrows nudge by one step, shift by four — because a
 * drag-only affordance is unusable without a mouse.
 */
export const PageRuler = component$<PageRulerProps>((props) => {
  const dragging = useSignal<Edge | null>(null);
  const readout = useSignal<string>("");

  const commit = $((edge: Edge, rem: number) => {
    const m = resolveMargins(props.layout);
    const opposite = edge === "left" ? m.right : m.left;
    const next = clampMargin(edge, rem, opposite, props.pageWidthRem);
    void props.onChange$({
      ...props.layout,
      [edge === "left" ? "marginLeft" : "marginRight"]: next,
    });
    readout.value = `${next.toFixed(2)} rem`;
  });

  const onHandleDown = $((edge: Edge, e: PointerEvent, el: HTMLElement) => {
    el.setPointerCapture(e.pointerId);
    dragging.value = edge;
    const track = el.parentElement;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const px = rootFontSize();
    const step = MARGIN_RANGE[edge].step;

    const move = (ev: PointerEvent) => {
      // Measure from the page edge the marker belongs to, so the number the
      // writer sets is the margin itself rather than a position on the ruler.
      const fromEdge =
        edge === "left" ? ev.clientX - rect.left : rect.right - ev.clientX;
      void commit(edge, snap(fromEdge / px, step));
    };
    const up = () => {
      dragging.value = null;
      readout.value = "";
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });

  /**
   * Stop the arrow keys from scrolling the page out from under the writer.
   * Must be synchronous — an async QRL runs after the browser has already
   * acted on the event — and self-contained, which is what `sync$` enforces.
   * Tab is deliberately left alone so the handles stay reachable.
   */
  const preventScrollKeys = sync$((e: KeyboardEvent) => {
    if (["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
      e.preventDefault();
    }
  });

  const onHandleKey = $((edge: Edge, e: KeyboardEvent) => {
    const step = MARGIN_RANGE[edge].step * (e.shiftKey ? 4 : 1);
    const m = resolveMargins(props.layout);
    const current = edge === "left" ? m.left : m.right;
    // Arrows move the marker in screen terms; for the right margin that is
    // the opposite of moving the number, since it is measured inward.
    if (e.key === "ArrowLeft") {
      void commit(edge, current + (edge === "left" ? -step : step));
    } else if (e.key === "ArrowRight") {
      void commit(edge, current + (edge === "left" ? step : -step));
    } else if (e.key === "Home") {
      void commit(edge, MARGIN_RANGE[edge].min);
    }
  });

  const m = resolveMargins(props.layout);
  const width = props.pageWidthRem;
  const leftPct = (m.left / width) * 100;
  const rightPct = (m.right / width) * 100;

  // A tick every rem, which at the default type size is a comfortable
  // approximation of a ruler's inch marks without pretending to be inches.
  const ticks = Array.from({ length: Math.max(0, Math.floor(width)) }, (_, i) => i + 1);

  return (
    <div
      class="ruler"
      style={{ width: `${width}rem`, maxWidth: "100%" }}
      data-dragging={dragging.value ? "true" : "false"}
      data-zen={props.zen ? "true" : "false"}
      role="group"
      aria-label="Page margins"
    >
      <div class="ruler-track">
        <div
          class="ruler-column"
          style={{ left: `${leftPct}%`, right: `${rightPct}%` }}
        />
        {ticks.map((t) => (
          <span
            key={t}
            class="ruler-tick"
            style={{ left: `${(t / width) * 100}%` }}
          />
        ))}

        <button
          type="button"
          class="ruler-handle"
          style={{ left: `${leftPct}%` }}
          title="Left margin — drag, or use the arrow keys"
          aria-label="Left margin"
          role="slider"
          aria-orientation="horizontal"
          aria-valuemin={MARGIN_RANGE.left.min}
          aria-valuemax={MARGIN_RANGE.left.max}
          aria-valuenow={Number(m.left.toFixed(2))}
          aria-valuetext={`Left margin ${m.left.toFixed(2)} rem`}
          onPointerDown$={(e, el) => onHandleDown("left", e, el)}
          onKeyDown$={[preventScrollKeys, $((e: KeyboardEvent) => onHandleKey("left", e))]}
        />
        <button
          type="button"
          class="ruler-handle"
          style={{ left: `${100 - rightPct}%` }}
          title="Right margin — drag, or use the arrow keys"
          aria-label="Right margin"
          role="slider"
          aria-orientation="horizontal"
          aria-valuemin={MARGIN_RANGE.right.min}
          aria-valuemax={MARGIN_RANGE.right.max}
          aria-valuenow={Number(m.right.toFixed(2))}
          aria-valuetext={`Right margin ${m.right.toFixed(2)} rem`}
          onPointerDown$={(e, el) => onHandleDown("right", e, el)}
          onKeyDown$={[preventScrollKeys, $((e: KeyboardEvent) => onHandleKey("right", e))]}
        />

        {dragging.value && readout.value && (
          <span
            class="ruler-readout"
            style={{
              left:
                dragging.value === "left"
                  ? `${leftPct}%`
                  : `${100 - rightPct}%`,
            }}
          >
            {readout.value}
          </span>
        )}
      </div>
    </div>
  );
});
