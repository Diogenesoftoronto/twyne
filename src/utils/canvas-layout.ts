/**
 * Deterministic layout for the source canvas.
 *
 * The reference boards this feature is modelled on are *columns* — one per
 * theme, cards stacked in reading order — not organic graphs. So this is column
 * packing, not a force simulation. That buys three things a physics layout
 * cannot: the same board every time you open it (no settling animation, no
 * "where did that card go"), a layout that is trivially unit-testable, and no
 * per-frame cost on a board of two hundred cards.
 *
 * Two invariants everything here protects:
 *
 *   1. **A pinned card never moves.** Once the writer has dragged or resized a
 *      card they have made a claim about where it belongs; re-running the
 *      mapping pass must not overrule them. Pinned cards are obstacles that
 *      free cards flow around.
 *
 *   2. **A streaming card holds its slot.** Cards are laid out while the model
 *      is still composing them. If layout reflowed on every delta the board
 *      would jitter for the whole extraction, so a streaming card reserves its
 *      declared box and the reflow happens once, on completion.
 *
 * Pure — no DOM, no clock, no randomness. `layoutCanvas` is a function of its
 * arguments alone.
 */

import type { CanvasCluster, CanvasNode } from "../types";

export interface LayoutOptions {
  columnWidth: number;
  /** Horizontal space between columns. */
  gapX: number;
  /** Vertical space between cards in a column. */
  gapY: number;
  /** A column wraps into a new one past this height. */
  maxColumnHeight: number;
  originX: number;
  originY: number;
  /** Excerpts are inset under their source to show the parent relationship. */
  childIndent: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  columnWidth: 320,
  gapX: 32,
  gapY: 16,
  maxColumnHeight: 2400,
  originX: 0,
  originY: 0,
  childIndent: 16,
};

/** Cards with no cluster land in a trailing column of their own. */
const UNCLUSTERED = "\0unclustered";

/**
 * Kind ordering *within* a cluster. The brief is what the piece is about, so it
 * reads first; attachments are the writer's own starting material; sources and
 * the writer's loose notes follow.
 */
const KIND_RANK: Record<CanvasNode["kind"], number> = {
  brief: 0,
  attachment: 1,
  source: 2,
  excerpt: 2, // sorted immediately after its parent source, never independently
  note: 3,
};

function rect(n: CanvasNode) {
  return { left: n.x, top: n.y, right: n.x + n.w, bottom: n.y + n.h };
}

function overlaps(a: ReturnType<typeof rect>, b: ReturnType<typeof rect>): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Order the free cards of one cluster into a single reading sequence: each
 * source followed immediately by its own excerpts, in document order.
 *
 * Sorting is total and tie-broken by id so the result cannot depend on the
 * order the caller happened to hand us — that is what makes the layout
 * reproducible across a reload or a re-map.
 */
export function orderCluster(nodes: CanvasNode[]): CanvasNode[] {
  const excerptsBySource = new Map<string, CanvasNode[]>();
  const leaders: CanvasNode[] = [];

  for (const n of nodes) {
    // An excerpt only trails its parent if the parent is in this same group;
    // an orphan (parent pinned, or in another cluster) is placed on its own so
    // it cannot silently vanish from the board.
    if (n.kind === "excerpt" && n.parentId && nodes.some((p) => p.id === n.parentId)) {
      excerptsBySource.set(n.parentId, [...(excerptsBySource.get(n.parentId) ?? []), n]);
    } else {
      leaders.push(n);
    }
  }

  leaders.sort((a, b) => {
    const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (byKind !== 0) return byKind;
    const byOrder = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
    if (byOrder !== 0) return byOrder;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const out: CanvasNode[] = [];
  for (const leader of leaders) {
    out.push(leader);
    const kids = excerptsBySource.get(leader.id);
    if (!kids) continue;
    kids.sort((a, b) => {
      const byOrder =
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
      if (byOrder !== 0) return byOrder;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    out.push(...kids);
  }
  return out;
}

/**
 * Position every unpinned card. Returns a new array; no input is mutated.
 *
 * Pinned cards are returned untouched, and free cards are nudged down past any
 * pinned card they would have landed on.
 */
export function layoutCanvas(
  nodes: CanvasNode[],
  clusters: CanvasCluster[] = [],
  options: Partial<LayoutOptions> = {},
): CanvasNode[] {
  const opt = { ...DEFAULT_LAYOUT, ...options };
  const pinned = nodes.filter((n) => n.pinned);
  const free = nodes.filter((n) => !n.pinned);
  const pinnedRects = pinned.map(rect);

  // Declared cluster order first, then any cluster referenced by a node but
  // missing from the list (sorted, for determinism), then the unclustered.
  const declared = clusters.map((c) => c.id);
  const referenced = [...new Set(free.map((n) => n.cluster).filter(Boolean) as string[])];
  const extra = referenced.filter((id) => !declared.includes(id)).sort();
  const order = [...declared.filter((id) => referenced.includes(id)), ...extra, UNCLUSTERED];

  const byCluster = new Map<string, CanvasNode[]>();
  for (const n of free) {
    const key = n.cluster ?? UNCLUSTERED;
    byCluster.set(key, [...(byCluster.get(key) ?? []), n]);
  }

  const placed: CanvasNode[] = [];
  let column = 0;
  let cursorY = opt.originY;

  const columnX = () => opt.originX + column * (opt.columnWidth + opt.gapX);

  for (const clusterId of order) {
    const group = byCluster.get(clusterId);
    if (!group?.length) continue;

    // Each cluster opens a new column so the themes read as vertical bands.
    if (placed.length > 0) {
      column += 1;
      cursorY = opt.originY;
    }

    for (const node of orderCluster(group)) {
      const indent = node.kind === "excerpt" ? opt.childIndent : 0;
      const width = Math.max(1, opt.columnWidth - indent);
      const height = Math.max(1, node.h);

      // Wrap before placing, so a card is never left hanging off the bottom.
      if (cursorY > opt.originY && cursorY + height > opt.originY + opt.maxColumnHeight) {
        column += 1;
        cursorY = opt.originY;
      }

      let candidate: CanvasNode = {
        ...node,
        x: columnX() + indent,
        y: cursorY,
        w: width,
        h: height,
      };

      // Slide down past any pinned card in the way. Bounded by the number of
      // pinned cards: each pass clears at least one, and a card already below
      // every obstacle cannot be pushed again.
      for (let guard = 0; guard <= pinnedRects.length; guard++) {
        const hit = pinnedRects.find((p) => overlaps(rect(candidate), p));
        if (!hit) break;
        candidate = { ...candidate, y: hit.bottom + opt.gapY };
      }

      placed.push(candidate);
      cursorY = candidate.y + candidate.h + opt.gapY;
    }
  }

  // Preserve the caller's array order so a diff against the previous state is
  // positional; only x/y/w/h change.
  const byId = new Map(placed.map((n) => [n.id, n]));
  return nodes.map((n) => byId.get(n.id) ?? n);
}

/**
 * The box a card should occupy before its content exists — used when a card is
 * created mid-stream, so the slot is reserved at a plausible size and the board
 * does not lurch when the real content lands.
 */
export function reserveSlot(
  node: Pick<CanvasNode, "kind">,
  options: Partial<LayoutOptions> = {},
): { w: number; h: number } {
  const opt = { ...DEFAULT_LAYOUT, ...options };
  const indent = node.kind === "excerpt" ? opt.childIndent : 0;
  return {
    w: opt.columnWidth - indent,
    // Roughly a screenful of a typical extracted section. Wrong by a little is
    // fine; the reflow on stream completion corrects it.
    h: node.kind === "brief" ? 140 : 220,
  };
}
