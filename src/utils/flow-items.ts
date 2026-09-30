/**
 * Everything that may come to the margins, and the one rule for when it may.
 *
 * Producers (comments, the room's notes, the Apparatus, the shelf, your other
 * work, the charter, the dossier) hand the conductor `FlowItem`s. They never
 * draw anything themselves. `decideSurface` decides what the writer sees:
 *
 *   flow / settling   nothing new. What is already on the page stays; new
 *                     items wait, and the waiting count is all that shows.
 *   working           a few items, nearest the cursor first.
 *   stuck             the single best item for the paragraph the writer is
 *                     stuck in, and whatever it links to.
 *   away              no change.
 *
 * Pure: the conductor owns time, storage and the DOM.
 */
import type { FlowMode } from "./flow-state";

export type FlowItemKind =
  | "comment"
  | "persona-note"
  | "source"
  | "work"
  | "shelf"
  | "echo"
  | "charter"
  | "amendment"
  | "way-in";

/** Which margin an item belongs to: the room's voices, or the writer's own. */
export type FlowSide = "room" | "archive";

export const SIDE_FOR: Record<FlowItemKind, FlowSide> = {
  comment: "room",
  "persona-note": "room",
  source: "room",
  work: "room",
  charter: "room",
  amendment: "room",
  "way-in": "room",
  shelf: "archive",
  echo: "archive",
};

export const KIND_LABELS: Record<FlowItemKind, string> = {
  comment: "Margin note",
  "persona-note": "From the room",
  source: "From the Apparatus",
  work: "On the shelf",
  shelf: "From your dossier",
  echo: "You wrote",
  charter: "The charter",
  amendment: "Amendment",
  "way-in": "A way in",
};

/** How much a kind matters before the writer's own habits weigh in. */
const BASE_PRIORITY: Record<FlowItemKind, number> = {
  comment: 0.9,
  "persona-note": 0.75,
  charter: 0.7,
  amendment: 0.65,
  // Only offered while stuck, when it should lead.
  "way-in": 0.95,
  source: 0.55,
  echo: 0.55,
  work: 0.5,
  shelf: 0.45,
};

export interface WorkCard {
  medium: "book" | "album" | "song" | "film";
  title: string;
  creator?: string;
  year?: string;
  cover?: string;
  url?: string;
}

export interface FlowItem {
  id: string;
  kind: FlowItemKind;
  /** Passages in this manuscript the item speaks to, verbatim. */
  anchors: string[];
  title: string;
  /** Body text; for a streaming reply, what has arrived so far. */
  body: string;
  byline?: string;
  /** Accent for the card's rule, e.g. a persona's color. */
  color?: string;
  createdAt: number;
  /** Jev's 0..1 read of relevance, when it was asked. */
  relevance?: number;
  streaming?: boolean;
  work?: WorkCard;
  /** For echoes: which folio the passage lives in. */
  folioId?: string;
  folioName?: string;
  url?: string;
  /** Other items this one connects to (drawn as arrows on hover). */
  links?: string[];
  /** Kind-specific payload, e.g. an amendment's field and proposal. */
  data?: Record<string, string>;
}

export interface SurfaceContext {
  mode: FlowMode;
  /** Plain text of the paragraph under the cursor. */
  cursorText: string;
  /** Anchors already on screen, to prefer items the writer can see. */
  visibleAnchors?: ReadonlySet<string>;
  /** Items the writer dismissed; they never come back. */
  dismissed: ReadonlySet<string>;
  /** Items shown before this decision; kept while the page is quiet. */
  shown: ReadonlySet<string>;
  weight: (kind: FlowItemKind) => number;
  now: number;
  /** How many cards the working state allows. Default 3. */
  workingLimit?: number;
}

export interface Surfacing {
  visible: FlowItem[];
  held: number;
  /** One line per item — kept for the diagnostics log. */
  reasons: Record<string, string>;
}

/** 0..1: how much of the item's anchor text is in `text`. */
export function anchorOverlap(item: FlowItem, text: string): number {
  if (!text || !item.anchors.length) return 0;
  const haystack = normalize(text);
  let best = 0;
  for (const anchor of item.anchors) {
    const needle = normalize(anchor);
    if (!needle) continue;
    if (haystack.includes(needle) || needle.includes(haystack)) return 1;
    const words = needle.split(" ").filter((w) => w.length > 3);
    if (!words.length) continue;
    const hits = words.filter((w) => haystack.includes(w)).length;
    best = Math.max(best, hits / words.length);
  }
  return best;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function scoreItem(item: FlowItem, context: SurfaceContext): number {
  const ageMin = Math.max(0, (context.now - item.createdAt) / 60_000);
  const freshness = 0.6 + 0.4 * Math.exp(-ageMin / 20);
  const near = anchorOverlap(item, context.cursorText);
  const onScreen = item.anchors.some((a) => context.visibleAnchors?.has(a))
    ? 0.15
    : 0;
  const relevance = item.relevance ?? 0.6;
  return (
    BASE_PRIORITY[item.kind] *
    context.weight(item.kind) *
    freshness *
    (0.5 + relevance) *
    (1 + near + onScreen)
  );
}

export function decideSurface(
  items: readonly FlowItem[],
  context: SurfaceContext,
): Surfacing {
  const reasons: Record<string, string> = {};
  const live = items.filter((item) => {
    if (context.dismissed.has(item.id)) {
      reasons[item.id] = "dismissed";
      return false;
    }
    return true;
  });
  const ranked = live
    .filter((item) => {
      if (item.kind === "way-in" && context.mode !== "stuck") {
        reasons[item.id] = "held: a way in is only offered while stuck";
        return false;
      }
      if (
        item.kind === "way-in" &&
        anchorOverlap(item, context.cursorText) <= 0.3
      ) {
        reasons[item.id] = "held: a way in belongs to another passage";
        return false;
      }
      return true;
    })
    .map((item) => ({ item, score: scoreItem(item, context) }))
    .sort((a, b) => b.score - a.score);

  let visible: FlowItem[];
  switch (context.mode) {
    case "flow":
    case "settling":
    case "away":
      // Nothing new arrives; what the writer already had stays put, except
      // in full flow, where the page stands alone.
      visible =
        context.mode === "flow"
          ? []
          : ranked
              .filter((r) => context.shown.has(r.item.id))
              .map((r) => r.item);
      for (const { item } of ranked)
        reasons[item.id] ??= visible.includes(item)
          ? "kept: already on the page"
          : `held: ${context.mode}`;
      break;
    case "stuck": {
      const best =
        ranked.find((r) => r.item.kind === "way-in") ??
        ranked.find((r) => anchorOverlap(r.item, context.cursorText) > 0.3) ??
        ranked[0];
      const linked = new Set(best?.item.links ?? []);
      visible = best
        ? [
            best.item,
            ...ranked.filter((r) => linked.has(r.item.id)).map((r) => r.item),
          ]
        : [];
      for (const { item, score } of ranked)
        reasons[item.id] = visible.includes(item)
          ? item === best?.item
            ? `stuck: best for this paragraph (${score.toFixed(2)})`
            : "stuck: linked to the best item"
          : "held: one thing at a time while stuck";
      break;
    }
    default: {
      const limit = context.workingLimit ?? 3;
      visible = ranked.slice(0, limit).map((r) => r.item);
      for (const [index, { item, score }] of ranked.entries())
        reasons[item.id] =
          index < limit
            ? `working: rank ${index + 1} (${score.toFixed(2)})`
            : `held: below the top ${limit}`;
    }
  }
  return { visible, held: live.length - visible.length, reasons };
}

/**
 * Stack cards down one margin without overlap. Each card wants to sit level
 * with its anchor; when two collide the later one moves down, and obstacles
 * (the live tool card, the shelf) are stepped around.
 */
export function stackCards(
  cards: ReadonlyArray<{ id: string; top: number; height: number }>,
  obstacles: ReadonlyArray<{ top: number; height: number }> = [],
  gap = 10,
): Record<string, number> {
  const placed: Array<{ top: number; height: number }> = [...obstacles];
  const out: Record<string, number> = {};
  for (const card of [...cards].sort((a, b) => a.top - b.top)) {
    let top = Math.max(0, card.top);
    let moved = true;
    while (moved) {
      moved = false;
      for (const block of placed) {
        const overlaps =
          top < block.top + block.height + gap &&
          top + card.height + gap > block.top;
        if (overlaps) {
          top = block.top + block.height + gap;
          moved = true;
        }
      }
    }
    placed.push({ top, height: card.height });
    out[card.id] = top;
  }
  return out;
}
