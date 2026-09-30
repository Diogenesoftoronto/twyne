/**
 * The margins, used the way Google Docs uses them.
 *
 * Right margin: the one live tool, pinned level with the passage it is about
 * and joined to it by a hairline, so it reads as a note on *that* passage.
 * Left margin: "Your tools" — the tools the writer kept — and a faint tick
 * beside each paragraph they have been working hard at.
 *
 * Both rails sit inside the page canvas, so they scroll with the page. When
 * the window is too narrow to give a margin room, the rails step aside: the
 * tool opens as a card under its passage instead and the shelf folds away.
 */
import {
  $,
  component$,
  useSignal,
  useStore,
  useVisibleTask$,
} from "@qwik.dev/core";
import {
  inFlowController,
  inFlowSnapshot,
} from "../editor/extensions/struggle-tracker";
import {
  IN_FLOW_EVENT,
  type ActiveTool,
  type InFlowSnapshot,
} from "../../utils/in-flow-tools";
import {
  loadSavedTools,
  removeSavedTool,
  SAVED_TOOLS_EVENT,
  type SavedTool,
} from "../../utils/saved-tools";
import { TOOL_LABELS } from "../../utils/struggle-signals";
import { configFor, ToolRenderer } from "./tool-renderer";

const CARD_WIDTH = 296;
const RAIL_GAP = 28;
const SHELF_WIDTH = 176;

interface RailState {
  active: ActiveTool | null;
  /** Card top relative to the canvas, or null before measuring. */
  cardTop: number | null;
  /** Passage top/height relative to the canvas, for the connector. */
  anchorTop: number;
  anchorHeight: number;
  ticks: number[];
  mode: "rail" | "popover";
  shelf: boolean;
  /** Popover mode: fixed viewport position. */
  popLeft: number;
  popTop: number;
  saved: SavedTool[];
  naming: boolean;
  name: string;
  keepError: string;
}

export const MarginRails = component$<{ zen: boolean; readOnly?: boolean }>(
  (props) => {
    const root = useSignal<HTMLDivElement>();
    const state = useStore<RailState>({
      active: null,
      cardTop: null,
      anchorTop: 0,
      anchorHeight: 0,
      ticks: [],
      mode: "rail",
      shelf: true,
      popLeft: 0,
      popTop: 0,
      saved: [],
      naming: false,
      name: "",
      keepError: "",
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      const el = root.value;
      const canvas = el?.closest<HTMLElement>(".page-canvas");
      const scroller = canvas?.parentElement;
      if (!el || !canvas || !scroller) return;
      let tickPositions: number[] = [];
      let frame = 0;

      const measure = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const canvasRect = canvas.getBoundingClientRect();
          const scrollerRect = scroller.getBoundingClientRect();
          const right = scrollerRect.right - canvasRect.right;
          const left = canvasRect.left - scrollerRect.left;
          state.mode = right >= CARD_WIDTH + RAIL_GAP + 8 ? "rail" : "popover";
          state.shelf = left >= SHELF_WIDTH + RAIL_GAP;

          const controller = inFlowController();
          const rect = state.active ? controller?.anchorRect() : null;
          if (rect) {
            state.anchorTop = rect.top - canvasRect.top;
            state.anchorHeight = rect.height;
            state.cardTop = Math.max(0, state.anchorTop - 6);
            state.popLeft = Math.max(
              12,
              Math.min(rect.left, window.innerWidth - CARD_WIDTH - 12),
            );
            state.popTop = Math.max(
              12,
              Math.min(rect.bottom + 10, window.innerHeight - 120),
            );
          } else {
            state.cardTop = null;
          }
          state.ticks = tickPositions
            .map((pos) => controller?.blockTop(pos))
            .filter((top): top is number => typeof top === "number")
            .map((top) => top - canvasRect.top);
        });
      };

      const onSnapshot = (detail: InFlowSnapshot) => {
        // Plain copies only: the snapshot is shared module state.
        state.active = detail.active
          ? (JSON.parse(JSON.stringify(detail.active)) as ActiveTool)
          : null;
        if (!detail.active) {
          state.naming = false;
          state.keepError = "";
        }
        tickPositions = detail.ticks;
        measure();
      };
      const onEvent = (event: Event) =>
        onSnapshot((event as CustomEvent<InFlowSnapshot>).detail);
      const onSaved = (event: Event) => {
        state.saved = (event as CustomEvent<SavedTool[]>).detail ?? [];
      };

      onSnapshot(inFlowSnapshot());
      void loadSavedTools().then((tools) => {
        state.saved = tools;
      });
      window.addEventListener(IN_FLOW_EVENT, onEvent);
      window.addEventListener(SAVED_TOOLS_EVENT, onSaved);
      window.addEventListener("twyne:content", measure);
      window.addEventListener("resize", measure);
      // The popover is fixed to the viewport, so it must follow a scroll.
      const onScroll = () => {
        if (state.active && state.mode === "popover") measure();
      };
      scroller.addEventListener("scroll", onScroll, { passive: true });
      const observer = new ResizeObserver(measure);
      observer.observe(canvas);
      observer.observe(scroller);
      cleanup(() => {
        cancelAnimationFrame(frame);
        window.removeEventListener(IN_FLOW_EVENT, onEvent);
        window.removeEventListener(SAVED_TOOLS_EVENT, onSaved);
        window.removeEventListener("twyne:content", measure);
        window.removeEventListener("resize", measure);
        scroller.removeEventListener("scroll", onScroll);
        observer.disconnect();
      });
    });

    const keep = $(async () => {
      const tool = state.active;
      if (!tool) return;
      const name = state.name.trim() || TOOL_LABELS[tool.kind];
      try {
        await inFlowController()?.keep(name, configFor(tool));
        state.naming = false;
        state.keepError = "";
      } catch {
        state.keepError = "Couldn't keep it — storage refused the write.";
      }
    });

    if (props.zen || props.readOnly) return <div ref={root} hidden />;

    const tool = state.active;
    const card = tool && (
      <article
        class={[
          "in-flow-card",
          { "in-flow-card--filling": tool.status === "filling" },
        ]}
        aria-label={`${TOOL_LABELS[tool.kind]} for this passage`}
      >
        <header class="in-flow-card__head">
          <button
            type="button"
            class="in-flow-card__title"
            onClick$={() => inFlowController()?.focusAnchor()}
            title="Go to the passage"
          >
            {TOOL_LABELS[tool.kind]}
          </button>
          {tool.tentative && (
            <span
              class="in-flow-card__maybe"
              title="The signals were mixed; ignore this if it doesn't fit."
            >
              maybe
            </span>
          )}
          <button
            type="button"
            class="in-flow-card__close"
            onClick$={() => inFlowController()?.dismiss()}
            aria-label="Dismiss this tool"
            title="Dismiss — this passage stays quiet for a while"
          >
            ✕
          </button>
          <p class="in-flow-card__reason">{tool.reason}</p>
        </header>
        <ToolRenderer tool={tool} />
        {tool.notice && <p class="in-flow-card__notice">{tool.notice}</p>}
        <footer class="in-flow-card__foot">
          {tool.savedId ? (
            <span class="in-flow-quiet">In Your tools</span>
          ) : state.naming ? (
            <div class="in-flow-row">
              <input
                class="in-flow-input"
                placeholder={TOOL_LABELS[tool.kind]}
                value={state.name}
                onInput$={(_, el) => {
                  state.name = el.value;
                }}
                onKeyDown$={(event) => {
                  if (event.key === "Enter") void keep();
                  if (event.key === "Escape") state.naming = false;
                }}
                aria-label="Name for this tool"
              />
              <button
                type="button"
                class="btn-paper in-flow-mini"
                onClick$={keep}
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              class="in-flow-link"
              onClick$={() => {
                state.naming = true;
                state.name = "";
              }}
              title="Save this tool, as you've set it up, to reuse on any passage"
            >
              Keep this tool
            </button>
          )}
          {state.keepError && (
            <p class="in-flow-card__notice" role="alert">
              {state.keepError}
            </p>
          )}
        </footer>
      </article>
    );

    return (
      <div ref={root} class="in-flow-rails" aria-live="polite">
        {state.shelf && (
          <aside class="in-flow-shelf" aria-label="Your tools">
            {/* The shelf appears once there is something on it; an empty
                placeholder would only push the writer's echoes down the
                margin. A tool card's "Keep this tool" introduces it. */}
            {state.saved.length > 0 && (
              <div class="in-flow-shelf__inner">
                <p class="in-flow-label">Your tools</p>
                <ul class="in-flow-shelf__list">
                  {state.saved.map((saved) => (
                    <li key={saved.id}>
                      <button
                        type="button"
                        class="in-flow-shelf__tool"
                        onClick$={() => inFlowController()?.openSaved(saved)}
                        title={`Use ${saved.name} on the paragraph you're in`}
                      >
                        <span>{saved.name}</span>
                        <small>{TOOL_LABELS[saved.kind]}</small>
                      </button>
                      <button
                        type="button"
                        class="in-flow-shelf__remove"
                        onClick$={() => void removeSavedTool(saved.id)}
                        aria-label={`Remove ${saved.name}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {state.ticks.map((top) => (
              <span
                key={`tick-${top}`}
                class="in-flow-tick"
                style={{ top: `${top}px` }}
                aria-hidden="true"
              />
            ))}
          </aside>
        )}

        {tool && state.cardTop !== null && state.mode === "rail" && (
          <>
            <span
              class="in-flow-connector"
              style={{
                top: `${state.anchorTop + Math.min(12, state.anchorHeight / 2)}px`,
              }}
              aria-hidden="true"
            />
            <div
              class="in-flow-rail"
              style={{ top: `${state.cardTop}px`, width: `${CARD_WIDTH}px` }}
            >
              {card}
            </div>
          </>
        )}

        {tool && state.cardTop !== null && state.mode === "popover" && (
          <div
            class="in-flow-popover"
            style={{
              left: `${state.popLeft}px`,
              top: `${state.popTop}px`,
              width: `${CARD_WIDTH}px`,
            }}
          >
            {card}
          </div>
        )}
      </div>
    );
  },
);
