/**
 * The margins as the conductor sees fit to fill them.
 *
 * Right margin, the room: notes and replies as they are written, sources the
 * Apparatus found, the works the draft names, the charter, the dossier's
 * amendments. Left margin, the archive: what the writer has written before
 * that this passage echoes, and what their dossier already holds.
 *
 * Every card sits level with the passage it speaks to. Hover one — or hover
 * a marked passage in the text — and a proofreader's bracket and a drawn line
 * join the card to its passage, and to every other card on that passage.
 * Nothing here decides what appears; `flow-conductor.ts` does.
 *
 * A comment or a persona note is a conversation. Open it — from its card or
 * from the chip in the text — and the editor's conversation card unfolds in
 * this card's slot while the card steps aside; the cards below make room.
 * See `utils/margin-surface.ts` for the handshake.
 *
 * The desk, at the head of the room, keeps two things that outlast the
 * cards. While the page is quiet, the pneumatic post: a capsule tab counting
 * what the conductor is holding back, delivered when the writer pauses or
 * taps it. When a run of focus ends, the galley slip: what the run set.
 */
import {
  $,
  component$,
  useSignal,
  useStore,
  useVisibleTask$,
} from "@qwik.dev/core";
import { FLOW_LAYOUT_EVENT } from "../../utils/in-flow-events";
import {
  FLOW_EVENT,
  flowController,
  flowSnapshot,
  type FlowSnapshot,
} from "../editor/extensions/flow-conductor";
import {
  KIND_LABELS,
  SIDE_FOR,
  stackCards,
  type FlowItem,
  type FlowItemKind,
} from "../../utils/flow-items";
import {
  FLOW_SESSION_EVENT,
  type FlowSession,
  type FlowSessionEnd,
} from "../../utils/flow-session";
import type { FlowMode } from "../../utils/flow-state";
import {
  MARGIN_SLOT_EVENT,
  OPEN_MARGIN_THREAD_EVENT,
  registerMarginSurface,
  type MarginSlot,
  type MarginSlotDetail,
  type OpenMarginThreadDetail,
} from "../../utils/margin-surface";
import { Icon } from "../ui/icon";
import { PersonaMasthead } from "../personas/persona-portrait";

const ROOM_WIDTH = 268;
const ARCHIVE_WIDTH = 212;
const GUTTER = 28;
/** The editor's conversation card is this wide when there is room for it. */
const THREAD_WIDTH = 340;
/** Before the unfolded card has rendered, assume it is about this tall. */
const THREAD_GUESS = 280;

interface Placed {
  item: FlowItem;
  top: number;
  side: "room" | "archive";
}

interface Line {
  d: string;
  color: string;
  dashed: boolean;
}

interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

interface Bracket {
  d: string;
  color: string;
}

interface SurfaceState {
  mode: FlowMode;
  enabled: boolean;
  items: FlowItem[];
  held: number;
  expanded: boolean;
  peekId: string | null;
  hoverId: string | null;
  /** The item whose conversation is unfolded over its slot. */
  openId: string | null;
  /** A conversation with no card (resolved, say) still needs a slot. */
  openTop: number | null;
  placed: Placed[];
  room: "rail" | "dock";
  archive: boolean;
  lines: Line[];
  marks: Mark[];
  brackets: Bracket[];
  width: number;
  height: number;
  dockBottom: number;
  drafts: Record<string, string>;
  busy: Record<string, boolean>;
  notices: Record<string, string>;
  /** The conductor turned focus on (the page is in zen by its hand). */
  autoFocus: boolean;
  heldKinds: Partial<Record<FlowItemKind, number>>;
  /** A capsule just dropped into the post. */
  arriving: boolean;
  /** The last run's galley slip, until it is filed. */
  slip: FlowSession | null;
  slipExpanded: boolean;
}

const kindAccent = (kind: FlowItemKind) =>
  kind === "echo" || kind === "shelf"
    ? "var(--color-cobalt)"
    : kind === "charter" || kind === "amendment"
      ? "var(--color-vermilion)"
      : kind === "work"
        ? "var(--color-mustard)"
        : kind === "way-in"
          ? "var(--color-periwinkle)"
          : "var(--color-sage)";

const accent = (item: FlowItem) => item.color || kindAccent(item.kind);

/** What the post says it is holding, one kind at a time. */
const POST_NAMES: Record<FlowItemKind, { one: string; many: string }> = {
  comment: { one: "margin note", many: "margin notes" },
  "persona-note": { one: "note from the room", many: "notes from the room" },
  source: { one: "source", many: "sources" },
  work: { one: "work on the shelf", many: "works on the shelf" },
  shelf: { one: "dossier reference", many: "dossier references" },
  echo: { one: "echo of your writing", many: "echoes of your writing" },
  charter: { one: "charter reminder", many: "charter reminders" },
  amendment: { one: "proposed amendment", many: "proposed amendments" },
  "way-in": { one: "way in", many: "ways in" },
};

const SLIP_ENDINGS: Record<FlowSessionEnd, string> = {
  pause: "Set down at a pause.",
  reached: "You reached for the margin.",
  manual: "Focus lifted by hand.",
  away: "You stepped away.",
  closed: "The folio closed mid-run.",
};

const runLength = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest
    ? `${Math.floor(minutes / 60)} h ${rest} min`
    : `${minutes / 60} h`;
};

const clip = (text: string, n: number) =>
  text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;

export const FlowSurface = component$<{ zen: boolean; readOnly?: boolean }>(
  (props) => {
    const root = useSignal<HTMLDivElement>();
    const state = useStore<SurfaceState>({
      mode: "working",
      enabled: false,
      items: [],
      held: 0,
      expanded: false,
      peekId: null,
      hoverId: null,
      openId: null,
      openTop: null,
      placed: [],
      room: "rail",
      archive: true,
      lines: [],
      marks: [],
      brackets: [],
      width: 0,
      height: 0,
      dockBottom: 80,
      drafts: {},
      busy: {},
      notices: {},
      autoFocus: false,
      heldKinds: {},
      arriving: false,
      slip: null,
      slipExpanded: false,
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      const el = root.value;
      const canvas = el?.closest<HTMLElement>(".page-canvas");
      const scroller = canvas?.parentElement;
      if (!el || !canvas || !scroller) return;
      let frame = 0;
      let latest: FlowSnapshot = flowSnapshot();
      let lastSlot = "";
      let observedThread: Element | null = null;
      const observedCards = new Set<Element>();
      let waiters: Array<(slot: MarginSlot | null) => void> = [];
      let arrivingTimer: ReturnType<typeof setTimeout> | undefined;
      let seenSessionId: string | null = null;

      const itemsToShow = (): FlowItem[] => {
        const controller = flowController();
        const all = controller?.items() ?? [];
        const base =
          state.expanded && latest.mode !== "flow" ? all : latest.visible;
        const list = [...base];
        for (const id of [state.peekId, state.openId]) {
          const extra = id && all.find((i) => i.id === id);
          if (extra && !list.some((i) => i.id === extra.id)) list.push(extra);
        }
        return list.map((i) => JSON.parse(JSON.stringify(i)) as FlowItem);
      };

      const threadCard = () =>
        state.openId
          ? document.querySelector<HTMLElement>(
              `[data-margin-item="${CSS.escape(state.openId)}"]`,
            )
          : null;

      const layout = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const controller = flowController();
          const cards = new Set(
            canvas.querySelectorAll(
              ".flow-card, .in-flow-rail, .in-flow-shelf__inner, .flow-slip",
            ),
          );
          for (const node of observedCards) {
            if (!cards.has(node)) {
              observer.unobserve(node);
              observedCards.delete(node);
            }
          }
          for (const node of cards) {
            if (!observedCards.has(node)) {
              observer.observe(node);
              observedCards.add(node);
            }
          }
          const canvasRect = canvas.getBoundingClientRect();
          const scrollerRect = scroller.getBoundingClientRect();
          state.width = canvasRect.width;
          state.height = canvasRect.height;
          state.dockBottom = Math.max(
            16,
            window.innerHeight - scrollerRect.bottom + 12,
          );
          const rightRoom = scrollerRect.right - canvasRect.right;
          const leftRoom = canvasRect.left - scrollerRect.left;
          state.room = rightRoom >= ROOM_WIDTH + GUTTER + 8 ? "rail" : "dock";
          state.archive = leftRoom >= ARCHIVE_WIDTH + GUTTER + 8;

          const items = itemsToShow();
          const caret = controller?.cursorTop();
          const fallbackTop = caret != null ? caret - canvasRect.top : 0;
          const want = items.map((item) => {
            const first = controller?.anchorRects(item)[0]?.[0];
            const side =
              SIDE_FOR[item.kind] === "archive" && state.archive
                ? "archive"
                : "room";
            const card = el.querySelector<HTMLElement>(
              `[data-flow-card="${CSS.escape(item.id)}"]`,
            );
            const open = item.id === state.openId;
            return {
              item,
              // An unfolded conversation always lives in the room.
              side: open ? "room" : side,
              id: item.id,
              top: (first ? first.top - canvasRect.top : fallbackTop) - 4,
              height: open
                ? threadCard()?.offsetHeight || THREAD_GUESS
                : card?.offsetHeight || 120,
            } as const;
          });

          // Step around the live tool card on the right and the tool shelf
          // on the left, so nothing is ever drawn over them.
          const rel = (node: Element | null) => {
            if (!node) return null;
            const r = node.getBoundingClientRect();
            return r.height
              ? { top: r.top - canvasRect.top, height: r.height }
              : null;
          };
          const tool = rel(canvas.querySelector(".in-flow-rail"));
          const shelf = rel(canvas.querySelector(".in-flow-shelf__inner"));
          // The galley slip rests at the foot of the room; cards give way.
          const galley =
            state.room === "rail" ? rel(el.querySelector(".flow-slip")) : null;
          let cardless =
            state.openId &&
            state.openTop != null &&
            !items.some((i) => i.id === state.openId)
              ? {
                  top: state.openTop,
                  height: threadCard()?.offsetHeight || THREAD_GUESS,
                }
              : null;
          if (cardless && state.openId) {
            const [kind, ...rest] = state.openId.split(":");
            const attribute =
              kind === "suggestion"
                ? "data-suggestion-id"
                : kind === "comment"
                  ? "data-comment-id"
                  : "data-persona-note-id";
            const anchor = canvas.querySelector(
              `[${attribute}="${CSS.escape(rest.join(":"))}"]`,
            );
            const top = anchor
              ? anchor.getBoundingClientRect().top - canvasRect.top
              : cardless.top;
            cardless = {
              ...cardless,
              top: stackCards(
                [{ id: state.openId, top, height: cardless.height }],
                tool ? [tool] : [],
              )[state.openId],
            };
          }
          const roomTops = stackCards(
            want.filter((w) => w.side === "room"),
            [tool, cardless, galley].filter(
              (o): o is { top: number; height: number } => !!o,
            ),
          );
          const archiveTops = stackCards(
            want.filter((w) => w.side === "archive"),
            shelf ? [shelf] : [],
          );
          state.placed = want.map((w) => ({
            item: w.item,
            side: w.side,
            top: (w.side === "room" ? roomTops : archiveTops)[w.id] ?? w.top,
          }));
          state.items = items;
          drawConnections();
          publishSlot(
            canvasRect,
            scroller.getBoundingClientRect(),
            cardless?.top ?? null,
          );
        });
      };

      /** Tell the editor where the unfolded conversation belongs now. */
      const publishSlot = (
        canvasRect: DOMRect,
        scrollerRect: DOMRect,
        cardlessTop: number | null,
      ) => {
        const thread = threadCard();
        if (thread !== observedThread) {
          if (observedThread) observer.unobserve(observedThread);
          if (thread) observer.observe(thread);
          observedThread = thread;
        }
        const id = state.openId;
        const placed = id
          ? state.placed.find((p) => p.item.id === id)
          : undefined;
        const top = placed?.top ?? cardlessTop;
        const slot: MarginSlot | null =
          id && top != null && state.room === "rail"
            ? (() => {
                const room =
                  scrollerRect.right - canvasRect.right - GUTTER - 12;
                const width = Math.round(
                  Math.max(ROOM_WIDTH, Math.min(THREAD_WIDTH, room)),
                );
                // Follow the passage, but never slide under the masthead or
                // off the bottom of the screen while the writer is replying.
                const want = canvasRect.top + top;
                const y = Math.round(
                  Math.min(
                    Math.max(want, scrollerRect.top + 8),
                    window.innerHeight - 180,
                  ),
                );
                return {
                  left: Math.round(canvasRect.right + GUTTER),
                  top: y,
                  width,
                  maxH: Math.max(180, Math.round(window.innerHeight - y - 12)),
                };
              })()
            : id && top != null
              ? (() => {
                  const y = Math.max(
                    12,
                    Math.min(
                      Math.max(scrollerRect.top + 8, canvasRect.top + top),
                      window.innerHeight - 220,
                    ),
                  );
                  return {
                    left: 12,
                    top: y,
                    width: Math.min(THREAD_WIDTH, window.innerWidth - 24),
                    maxH: Math.max(160, window.innerHeight - y - 12),
                  };
                })()
              : null;
        const pending = waiters;
        waiters = [];
        for (const resolve of pending) resolve(slot);
        if (!id || !slot) {
          lastSlot = "";
          return;
        }
        const key = `${id}|${slot.left}|${slot.top}|${slot.width}|${slot.maxH}`;
        if (key === lastSlot) return;
        lastSlot = key;
        window.dispatchEvent(
          new CustomEvent<MarginSlotDetail>(MARGIN_SLOT_EVENT, {
            detail: { itemId: id, slot },
          }),
        );
      };

      /** Brackets, highlights and lines for whatever is hovered. */
      const drawConnections = () => {
        const controller = flowController();
        const id = state.hoverId ?? state.peekId ?? state.openId;
        const focus = id && state.placed.find((p) => p.item.id === id);
        if (!controller || !focus) {
          state.lines = [];
          state.marks = [];
          state.brackets = [];
          return;
        }
        const canvasRect = canvas.getBoundingClientRect();
        const text = canvas.querySelector("#twyne-editor-mount .ProseMirror");
        const textRect = (text ?? canvas).getBoundingClientRect();
        const textLeft = textRect.left - canvasRect.left;
        const textRight = textRect.right - canvasRect.left;
        const anchors = new Set(focus.item.anchors);
        // Every card that shares a passage with the hovered one, or that it
        // links to, is part of the same conversation.
        const related = state.placed.filter(
          (p) =>
            p === focus ||
            focus.item.links?.includes(p.item.id) ||
            p.item.links?.includes(focus.item.id) ||
            p.item.anchors.some((a) => anchors.has(a)),
        );
        const lines: Line[] = [];
        const marks: Mark[] = [];
        const brackets: Bracket[] = [];
        for (const placed of related) {
          const color = accent(placed.item);
          const primary = placed === focus;
          for (const group of controller.anchorRects(placed.item)) {
            const tops = group.map((r) => r.top - canvasRect.top);
            const bottoms = group.map((r) => r.bottom - canvasRect.top);
            const top = Math.min(...tops);
            const bottom = Math.max(...bottoms);
            if (primary)
              for (const r of group)
                marks.push({
                  x: r.left - canvasRect.left,
                  y: r.top - canvasRect.top,
                  w: r.width,
                  h: r.height,
                  color,
                });
            // A proofreader's bracket in the gutter on the card's side.
            const onRight = placed.side === "room";
            const bx = onRight ? textRight + 10 : textLeft - 10;
            const tick = onRight ? -5 : 5;
            brackets.push({
              d: `M ${bx + tick} ${top} H ${bx} V ${bottom} H ${bx + tick}`,
              color,
            });
            // Only a card that is actually standing in a margin gets a line.
            // In the dock the room holds one card, which is rarely this one,
            // and a line to it would join the passage to the wrong note.
            const standing = onRight ? state.room === "rail" : state.archive;
            if (!standing) continue;
            const cardX = onRight ? state.width + GUTTER : -GUTTER;
            const cardY = placed.top + 20;
            const midY = (top + bottom) / 2;
            const bend = onRight ? 36 : -36;
            lines.push({
              d: `M ${cardX} ${cardY} C ${cardX - bend} ${cardY}, ${bx + bend} ${midY}, ${bx + (onRight ? 3 : -3)} ${midY}`,
              color,
              dashed: !primary,
            });
          }
        }
        state.lines = lines;
        state.marks = marks;
        state.brackets = brackets;
      };

      const onSnapshot = (event: Event) => {
        const next = (event as CustomEvent<FlowSnapshot>).detail;
        const savedSession = flowController()?.lastSession();
        // Restore once, so filing a slip does not bring it back on the next tick.
        if (next.enabled && savedSession && savedSession.id !== seenSessionId) {
          seenSessionId = savedSession.id;
          state.slip =
            savedSession.ended === "closed" ? null : { ...savedSession };
          state.slipExpanded = false;
        }
        if (
          next.mode !== latest.mode &&
          next.mode !== "working" &&
          next.mode !== "stuck"
        )
          state.expanded = false;
        const quiet = next.mode === "flow" || next.mode === "settling";
        // A capsule drops into the post: the count darkens for a moment,
        // nothing moves. Only while the page is quiet; otherwise the cards
        // themselves arrive.
        if (quiet && next.held > state.held) {
          state.arriving = true;
          clearTimeout(arrivingTimer);
          arrivingTimer = setTimeout(() => {
            state.arriving = false;
          }, 1_400);
        }
        // Writing again files the last run's slip.
        if (quiet && state.slip) state.slip = null;
        latest = next;
        state.mode = next.mode;
        state.enabled = next.enabled;
        state.held = next.held;
        state.heldKinds = { ...(next.heldKinds ?? {}) };
        state.autoFocus = next.autoFocus;
        layout();
      };

      const onSession = (event: Event) => {
        const session = (event as CustomEvent<FlowSession>).detail;
        if (!session || session.ended === "closed") return;
        seenSessionId = session.id;
        state.slip = { ...session };
        state.slipExpanded = false;
      };

      // Hovering a marked passage in the text peeks its card, even one that
      // is waiting — the writer asked by pointing at it.
      const onOver = (event: Event) => {
        const target = event.target as Element | null;
        const comment = target?.closest<HTMLElement>("[data-comment-id]");
        const note = target?.closest<HTMLElement>("[data-persona-note-id]");
        const chip = target?.closest<HTMLElement>(".twyne-mark-anchor");
        const chipKind = chip?.dataset.anchorKind;
        const id = comment
          ? `comment:${comment.dataset.commentId}`
          : note
            ? `note:${note.dataset.personaNoteId}`
            : chip && (chipKind === "comment" || chipKind === "note")
              ? `${chipKind}:${chip.dataset.anchorId}`
              : null;
        if (id === state.peekId) return;
        state.peekId = id;
        layout();
      };

      const observer = new ResizeObserver(layout);
      const unregister = registerMarginSurface({
        active: () =>
          state.enabled &&
          state.room === "rail" &&
          !root.value?.hidden &&
          !root.value?.hasAttribute("data-quiet"),
        reveal(itemId, anchorTop) {
          // Asking for a conversation brings back a card the writer set aside.
          const controller = flowController();
          controller?.recall(itemId);
          state.openId = itemId;
          state.openTop = anchorTop - canvas.getBoundingClientRect().top;
          return new Promise<MarginSlot | null>((resolve) => {
            waiters.push(resolve);
            layout();
          });
        },
        setOpen(itemId) {
          // Closing the prior conversation can render before reveal resolves.
          // Keep the reservation until its caller has received a position.
          if (!itemId && waiters.length) return;
          if (itemId === state.openId) return;
          state.openId = itemId;
          if (!itemId) state.openTop = null;
          layout();
        },
      });

      window.addEventListener(FLOW_EVENT, onSnapshot);
      window.addEventListener(FLOW_SESSION_EVENT, onSession);
      window.addEventListener("resize", layout);
      window.addEventListener("twyne:content", layout);
      window.addEventListener(FLOW_LAYOUT_EVENT, layout);
      scroller.addEventListener("scroll", layout, { passive: true });
      canvas.addEventListener("pointerover", onOver);
      canvas.addEventListener("focusin", onOver);
      observer.observe(canvas);
      observer.observe(scroller);
      onSnapshot(new CustomEvent(FLOW_EVENT, { detail: flowSnapshot() }));
      cleanup(() => {
        unregister();
        for (const resolve of waiters) resolve(null);
        cancelAnimationFrame(frame);
        clearTimeout(arrivingTimer);
        window.removeEventListener(FLOW_EVENT, onSnapshot);
        window.removeEventListener(FLOW_SESSION_EVENT, onSession);
        window.removeEventListener("resize", layout);
        window.removeEventListener("twyne:content", layout);
        window.removeEventListener(FLOW_LAYOUT_EVENT, layout);
        scroller.removeEventListener("scroll", layout);
        canvas.removeEventListener("pointerover", onOver);
        canvas.removeEventListener("focusin", onOver);
        observer.disconnect();
      });
    });

    const hover = $((id: string | null) => {
      state.hoverId = id;
      window.dispatchEvent(new Event(FLOW_LAYOUT_EVENT));
    });

    /** Comments and persona notes unfold into their conversation. */
    const converse = $((item: FlowItem) => {
      const [kind, ...rest] = item.id.split(":");
      if (kind !== "comment" && kind !== "note") return;
      flowController()?.engage(item.id);
      window.dispatchEvent(
        new CustomEvent<OpenMarginThreadDetail>(OPEN_MARGIN_THREAD_EVENT, {
          detail: { kind, id: rest.join(":") },
        }),
      );
    });

    const dismiss = $((id: string) => {
      flowController()?.dismiss(id);
      if (state.hoverId === id) state.hoverId = null;
    });

    const draft = $(async (id: string) => {
      state.busy = { ...state.busy, [id]: true };
      state.notices = { ...state.notices, [id]: "" };
      const text = await flowController()?.draftAmendment(id);
      state.busy = { ...state.busy, [id]: false };
      if (text) state.drafts = { ...state.drafts, [id]: text };
      else
        state.notices = {
          ...state.notices,
          [id]: "No model is set up to draft it — write the new wording yourself.",
        };
    });

    const file = $(async (id: string) => {
      state.busy = { ...state.busy, [id]: true };
      const error = await flowController()?.fileAmendment(
        id,
        state.drafts[id] ?? "",
      );
      state.busy = { ...state.busy, [id]: false };
      state.notices = { ...state.notices, [id]: error ?? "" };
    });

    // Focus the writer chose is only the text. Focus the conductor chose
    // keeps the desk: the post that holds the margin until a pause.
    if (props.readOnly || (props.zen && !state.autoFocus))
      return <div ref={root} hidden />;
    const quiet = props.zen;

    const card = (placed: Placed) => {
      const { item } = placed;
      const color = accent(item);
      const reply = item.data?.reply;
      // A way in may point at an earlier passage worth picking up.
      const thread =
        item.kind === "way-in"
          ? state.items.find((other) => other.id === item.links?.[0])
          : undefined;
      return (
        <article
          key={item.id}
          data-flow-card={item.id}
          class={[
            "flow-card",
            `flow-card--${item.kind}`,
            {
              "is-hovered":
                state.hoverId === item.id || state.peekId === item.id,
              "is-unfolded": state.openId === item.id,
            },
          ]}
          aria-hidden={state.openId === item.id ? "true" : undefined}
          style={{
            top: `${placed.top}px`,
            "--flow-accent": color,
          }}
          onMouseEnter$={() => hover(item.id)}
          onMouseLeave$={() => hover(null)}
          onFocusIn$={() => hover(item.id)}
          onFocusOut$={() => hover(null)}
        >
          <header
            class={[
              "flow-card__head",
              { "persona-critique-head": item.kind === "persona-note" },
            ]}
          >
            {item.kind === "persona-note" ? (
              <PersonaMasthead
                personaId={item.data?.personaId}
                name={item.byline}
                size={56}
              />
            ) : (
              <span class="flow-card__kicker">
                {KIND_LABELS[item.kind]}
                {item.kind === "echo" && item.folioName
                  ? ` · ${item.folioName}`
                  : ""}
              </span>
            )}
            <button
              type="button"
              class="flow-card__close"
              onClick$={() => dismiss(item.id)}
              aria-label="Set this aside"
              title="Set aside — it won't come back"
            >
              <Icon name="close-circle" size={14} />
            </button>
          </header>

          {(item.kind === "charter" || item.kind === "amendment") && (
            <span class="flow-stamp" aria-hidden="true">
              {item.kind === "charter" ? "Charte" : "Avenant"}
            </span>
          )}

          {item.kind === "work" && item.work ? (
            <a
              class={`flow-work flow-work--${item.work.medium}`}
              href={item.work.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick$={() => flowController()?.engage(item.id)}
            >
              <span class="flow-work__sleeve">
                {item.work.cover ? (
                  <img
                    src={item.work.cover}
                    alt=""
                    width={72}
                    height={item.work.medium === "book" ? 108 : 72}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span class="flow-work__blank">
                    {item.work.title.slice(0, 1)}
                  </span>
                )}
                {(item.work.medium === "album" ||
                  item.work.medium === "song") && (
                  <span class="flow-work__disc" aria-hidden="true" />
                )}
              </span>
              <span class="flow-work__text">
                <span class="flow-work__medium">{item.work.medium}</span>
                <strong>{item.work.title}</strong>
                {item.body && <span>{item.body}</span>}
              </span>
            </a>
          ) : (
            <button
              type="button"
              class="flow-card__body"
              onClick$={() =>
                item.kind === "comment" || item.kind === "persona-note"
                  ? converse(item)
                  : flowController()?.focusAnchor(item)
              }
              title={
                item.kind === "comment" || item.kind === "persona-note"
                  ? "Open the conversation"
                  : "Go to the passage"
              }
            >
              {item.kind !== "persona-note" || item.title ? (
                <strong class="flow-card__title">{item.title}</strong>
              ) : null}
              {item.body && (
                <span
                  class={
                    item.kind === "echo"
                      ? "flow-card__carbon"
                      : "flow-card__text"
                  }
                >
                  {clip(item.body, item.kind === "echo" ? 360 : 280)}
                </span>
              )}
            </button>
          )}

          {reply !== undefined && (reply || item.streaming) && (
            <p class={["flow-card__reply", { "is-streaming": item.streaming }]}>
              <span class="flow-card__reply-by">{item.data?.replyAuthor}</span>
              {clip(reply ?? "", 420)}
            </p>
          )}

          {item.kind === "way-in" && (
            <div class="flow-way-in">
              {thread && (
                <button
                  type="button"
                  class="flow-link"
                  onClick$={() => {
                    flowController()?.engage(item.id);
                    flowController()?.focusAnchor(thread);
                  }}
                  title={clip(thread.body, 140)}
                >
                  Pick up the thread
                </button>
              )}
              <span class="flow-way-in__hint">
                Set it aside and the margin stays quiet here.
              </span>
            </div>
          )}

          {item.kind === "amendment" && (
            <div class="flow-amend">
              <textarea
                class="flow-amend__input"
                rows={3}
                placeholder="What is this piece for now?"
                value={state.drafts[item.id] ?? ""}
                onInput$={(_, target) => {
                  state.drafts = { ...state.drafts, [item.id]: target.value };
                }}
                aria-label="New wording for the dossier"
              />
              <div class="flow-amend__actions">
                <button
                  type="button"
                  class="flow-link"
                  disabled={state.busy[item.id]}
                  onClick$={() => draft(item.id)}
                >
                  {state.busy[item.id] ? "Drafting…" : "Draft it for me"}
                </button>
                <button
                  type="button"
                  class="btn-paper flow-mini"
                  disabled={
                    state.busy[item.id] || !(state.drafts[item.id] ?? "").trim()
                  }
                  onClick$={() => file(item.id)}
                >
                  File it
                </button>
              </div>
              {state.notices[item.id] && (
                <p class="flow-card__notice" role="status">
                  {state.notices[item.id]}
                </p>
              )}
            </div>
          )}

          {(item.byline && item.kind !== "persona-note") || item.url ? (
            <footer class="flow-card__foot">
              {item.byline && item.kind !== "persona-note" && (
                <span>{item.byline}</span>
              )}
              {item.url && item.kind !== "work" && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flow-link"
                  onClick$={() => flowController()?.engage(item.id)}
                >
                  Open
                </a>
              )}
            </footer>
          ) : null}
        </article>
      );
    };

    /** The pneumatic post: what is being held while the page is quiet. */
    const post = () => {
      const kinds = (Object.keys(state.heldKinds) as FlowItemKind[]).filter(
        (kind) => (state.heldKinds[kind] ?? 0) > 0,
      );
      const told = kinds
        .map((kind) => {
          const n = state.heldKinds[kind] ?? 0;
          return `${n} ${n === 1 ? POST_NAMES[kind].one : POST_NAMES[kind].many}`;
        })
        .join(", ");
      const pips = kinds
        .flatMap((kind) =>
          Array.from({ length: state.heldKinds[kind] ?? 0 }, (_, i) => ({
            key: `${kind}-${i}`,
            color: kindAccent(kind),
          })),
        )
        .slice(0, 6);
      const summary = `Held while you write${told ? `: ${told}` : ""}. They come in when you pause.`;
      return (
        <button
          type="button"
          class={["flow-post", { "is-arriving": state.arriving }]}
          onClick$={() => flowController()?.release()}
          title={`${summary} Open them now.`}
          aria-label={`${state.held} waiting. ${summary} Open them now.`}
        >
          <svg
            class="flow-post__capsule"
            viewBox="0 0 30 14"
            width="30"
            height="14"
            aria-hidden="true"
          >
            <rect x="1" y="1.5" width="28" height="11" rx="5.5" />
            <line x1="8.5" y1="1.5" x2="8.5" y2="12.5" />
            <line x1="21.5" y1="1.5" x2="21.5" y2="12.5" />
          </svg>
          <span class="flow-post__count">{state.held}</span>
          <span class="flow-post__label">waiting</span>
          {pips.length > 0 && (
            <span class="flow-post__pips" aria-hidden="true">
              {pips.map((pip) => (
                <i key={pip.key} style={{ background: pip.color }} />
              ))}
            </span>
          )}
        </button>
      );
    };

    /** The galley slip: what the last run of focus set. */
    const slip = (run: FlowSession) => (
      <aside class="flow-slip" aria-label="Galley slip for your last run">
        <header class="flow-slip__head">
          {state.room === "dock" ? (
            <button
              type="button"
              class="flow-slip__toggle"
              aria-label={
                state.slipExpanded
                  ? "Hide galley slip details"
                  : "Show galley slip details"
              }
              aria-expanded={state.slipExpanded}
              aria-controls="flow-slip-details"
              onClick$={() => {
                state.slipExpanded = !state.slipExpanded;
              }}
            >
              <span class="flow-slip__title">Galley</span>
              <span class="flow-slip__summary">
                {runLength(run.flowMs)} · {run.words.toLocaleString()} words
              </span>
              <Icon
                name={state.slipExpanded ? "arrow-down" : "arrow-up"}
                size={14}
              />
            </button>
          ) : (
            <>
              <span class="flow-slip__title">Galley</span>
              <time dateTime={new Date(run.endedAt).toISOString()}>
                {new Date(run.endedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </>
          )}
          <button
            type="button"
            class="flow-slip__close"
            onClick$={() => {
              state.slip = null;
              state.slipExpanded = false;
            }}
            aria-label="File this slip"
            title="File it"
          >
            <Icon name="close-circle" size={14} />
          </button>
        </header>
        <div
          id="flow-slip-details"
          class="flow-slip__body"
          hidden={state.room === "dock" && !state.slipExpanded}
        >
          <dl class="flow-slip__rows">
            <div>
              <dt>In flow</dt>
              <dd>{runLength(run.flowMs)}</dd>
            </div>
            <div>
              <dt>Words set</dt>
              <dd>{run.words.toLocaleString()}</dd>
            </div>
            {run.wpm > 0 && (
              <div>
                <dt>Pace</dt>
                <dd>{run.wpm} a minute</dd>
              </div>
            )}
            {run.waited > 0 && (
              <div>
                <dt>Held for you</dt>
                <dd>{run.waited}</dd>
              </div>
            )}
            {run.amendments > 0 && (
              <div>
                <dt>Amendments</dt>
                <dd>{run.amendments} proposed</dd>
              </div>
            )}
          </dl>
          <footer class="flow-slip__foot">
            <em>{SLIP_ENDINGS[run.ended]}</em>
            <span class="flow-slip__stamp" aria-hidden="true">
              Composé
            </span>
            <a class="flow-link" href="/house/?tab=engine">
              Earlier runs
            </a>
          </footer>
        </div>
      </aside>
    );

    // Outside flow the cards themselves arrive, and "N more in the margin"
    // counts the rest; the post only holds while the page is quiet.
    const posting =
      state.enabled && state.held > 0 && (state.mode === "flow" || quiet);
    const desk = () =>
      posting || state.slip ? (
        <div
          class={["flow-desk", `flow-desk--${state.room}`]}
          style={
            state.room === "rail" ? { width: `${ROOM_WIDTH}px` } : undefined
          }
        >
          <div class="flow-desk__top">{posting && post()}</div>
          <div class="flow-desk__bottom">{state.slip && slip(state.slip)}</div>
        </div>
      ) : null;

    if (quiet)
      return (
        <div
          ref={root}
          class="flow-surface"
          style={{ "--flow-dock-bottom": `${state.dockBottom}px` }}
          data-mode={state.mode}
          data-quiet
          aria-label="Held margin notes"
        >
          {desk()}
        </div>
      );

    const room = state.placed.filter((p) => p.side === "room");
    const archive = state.placed.filter((p) => p.side === "archive");
    const waiting = state.held > 0 && state.enabled && state.mode !== "flow";

    return (
      <div
        ref={root}
        class="flow-surface"
        style={{ "--flow-dock-bottom": `${state.dockBottom}px` }}
        data-mode={state.mode}
        aria-label="Margin notes and connections"
      >
        <svg
          class="flow-overlay"
          width={state.width}
          height={state.height}
          aria-hidden="true"
        >
          {state.marks.map((m, i) => (
            <rect
              key={`m${i}`}
              class="flow-overlay__mark"
              x={m.x - 1}
              y={m.y + m.h - 3}
              width={m.w + 2}
              height={3}
              style={{ fill: m.color }}
            />
          ))}
          {state.brackets.map((b, i) => (
            <path
              key={`b${i}`}
              class="flow-overlay__bracket"
              d={b.d}
              style={{ stroke: b.color }}
            />
          ))}
          {state.lines.map((l, i) => (
            <path
              key={`l${i}`}
              class={["flow-overlay__line", { "is-dashed": l.dashed }]}
              d={l.d}
              style={{ stroke: l.color }}
            />
          ))}
        </svg>

        {state.archive && (
          <div
            class="flow-column flow-column--archive"
            style={{ width: `${ARCHIVE_WIDTH}px` }}
          >
            {archive.map(card)}
          </div>
        )}

        {state.room === "rail" ? (
          <div
            class="flow-column flow-column--room"
            style={{ width: `${ROOM_WIDTH}px` }}
          >
            {room.map(card)}
            {waiting && (
              <button
                type="button"
                class="flow-waiting"
                style={{
                  top: `${Math.max(0, ...room.map((p) => p.top + 140))}px`,
                }}
                onClick$={() => {
                  state.expanded = !state.expanded;
                  window.dispatchEvent(new Event(FLOW_LAYOUT_EVENT));
                }}
              >
                {state.expanded ? "Fewer" : `${state.held} more in the margin`}
              </button>
            )}
          </div>
        ) : (
          room.length > 0 && (
            <div
              class="flow-dock"
              role="complementary"
              aria-label="From the margin"
            >
              {card({ ...room[0], top: 0 })}
              {room.length + state.held > 1 && (
                <p class="flow-dock__more">
                  {room.length + state.held - 1} more when there's room
                </p>
              )}
            </div>
          )
        )}

        {desk()}
      </div>
    );
  },
);
