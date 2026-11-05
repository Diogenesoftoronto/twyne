import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Wet ink: words the writer has just set stay in a slightly bluer, wetter ink
 * until the draft is stored on this device, then dry to black.
 *
 * It reads as a press detail, and it is also the truthful save indicator:
 * ink that stays wet means the save has not landed. Drying is driven by the
 * route's `twyne:draft-saved` event, which fires only once IndexedDB commits.
 *
 * The cost model keeps typing untouched:
 *   - per transaction, the plugin maps a short list of doc ranges (capped)
 *     and appends the inserted span. No decorations, so no DOM changes;
 *   - the ranges are painted through the CSS Custom Highlight API, which
 *     colours text without touching the DOM or layout, at most once per frame;
 *   - drying swaps the highlight name (`twyne-ink-wet` → `twyne-ink-drying`)
 *     and clears it after `--dur-dry`. Highlights cannot transition today, so
 *     the drying ink is a mid-tone; a two-step dry reads as ink settling.
 *
 * Browsers without `CSS.highlights` (or `data-motion="still"`) simply never
 * paint the ink; the manuscript and its saving are unaffected.
 */

export const WET_INK_HIGHLIGHT = "twyne-ink-wet";
export const DRYING_INK_HIGHLIGHT = "twyne-ink-drying";
/** Event the route dispatches once a draft is stored on this device. */
export const DRAFT_SAVED_EVENT = "twyne:draft-saved";

/** Long pastes and imports are not "fresh ink"; only hand-set words are. */
const MAX_INK_SPAN = 400;
/** A burst rarely touches more places than this before a save lands. */
const MAX_INK_RANGES = 48;
/** Keep in step with `--dur-dry`; full level only, calm is shorter. */
const DRY_MS = { full: 1600, calm: 900 } as const;

export interface InkRange {
  from: number;
  to: number;
}

export interface WetInkState {
  /** Ranges set since the last save, in the current document's positions. */
  wet: InkRange[];
}

type WetInkMeta = { type: "dry" };

export const wetInkPluginKey = new PluginKey<WetInkState>("twyneWetInk");

/** Merge touching or overlapping ranges, keeping them sorted. */
export function mergeInkRanges(ranges: InkRange[]): InkRange[] {
  const sorted = ranges
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from);
  const merged: InkRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Fold one transaction into the wet ranges: map what was wet through the
 * change, then add whatever the writer just set by hand.
 */
export function applyInkTransaction(
  state: WetInkState,
  tr: Transaction,
): WetInkState {
  const meta = tr.getMeta(wetInkPluginKey) as WetInkMeta | undefined;
  if (meta?.type === "dry") return { wet: [] };
  if (!tr.docChanged) return state;

  const mapped: InkRange[] = [];
  for (const range of state.wet) {
    const from = tr.mapping.map(range.from, 1);
    const to = tr.mapping.map(range.to, -1);
    if (to > from) mapped.push({ from, to });
  }

  // Only the writer's own hand: collaborators' edits, undo and redo, pastes,
  // drops and programmatic rewrites (accepting a suggestion, Typst apply)
  // arrive dry. prosemirror-history tags its transactions with `history$`.
  const uiEvent = tr.getMeta("uiEvent");
  const handSet =
    !tr.getMeta("y-sync$") &&
    tr.getMeta("addToHistory") !== false &&
    !tr.getMeta("history$") &&
    !tr.getMeta("paste") &&
    uiEvent !== "drop" &&
    uiEvent !== "paste";

  if (handSet) {
    tr.mapping.maps.forEach((map, index) => {
      // Positions from step `index` still have to be mapped through the
      // steps after it to land in the final document.
      const rest = tr.mapping.slice(index + 1);
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        if (newEnd <= newStart || newEnd - newStart > MAX_INK_SPAN) return;
        const from = rest.map(newStart, -1);
        const to = rest.map(newEnd, 1);
        if (to > from) mapped.push({ from, to });
      });
    });
  }

  const merged = mergeInkRanges(mapped);
  // A writer who never pauses keeps the most recent ink; older ink has
  // been on the page long enough to read as set.
  return {
    wet:
      merged.length > MAX_INK_RANGES
        ? merged.slice(merged.length - MAX_INK_RANGES)
        : merged,
  };
}

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
}
type HighlightCtor = new (...ranges: Range[]) => unknown;

function highlightApi(): {
  registry: HighlightRegistryLike;
  Highlight: HighlightCtor;
} | null {
  if (typeof window === "undefined" || typeof CSS === "undefined") return null;
  const registry = (CSS as unknown as { highlights?: HighlightRegistryLike })
    .highlights;
  const Highlight = (window as unknown as { Highlight?: HighlightCtor })
    .Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

function inkLevel(): "full" | "calm" | "still" {
  const value = document.documentElement.getAttribute("data-motion");
  return value === "calm" || value === "still" ? value : "full";
}

/** DOM ranges for doc ranges. Positions that no longer resolve are skipped. */
function domRanges(view: EditorView, ranges: InkRange[]): Range[] {
  const out: Range[] = [];
  const size = view.state.doc.content.size;
  for (const { from, to } of ranges) {
    if (from < 0 || to > size || to <= from) continue;
    try {
      const start = view.domAtPos(from, 1);
      const end = view.domAtPos(to, -1);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      if (!range.collapsed) out.push(range);
    } catch {
      // A node view or a position inside an atom: leave that ink unpainted.
    }
  }
  return out;
}

class WetInkPainter {
  private frame = 0;
  private dryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onSaved = () => this.dry();

  /** Resolved per use: cheap, and correct if the API appears after mount. */
  private get api() {
    return highlightApi();
  }

  constructor(private readonly view: EditorView) {
    window.addEventListener(DRAFT_SAVED_EVENT, this.onSaved);
  }

  update() {
    if (this.frame || !this.api) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  private paint() {
    const api = this.api;
    if (!api) return;
    const state = wetInkPluginKey.getState(this.view.state);
    if (!state || state.wet.length === 0 || inkLevel() === "still") {
      api.registry.delete(WET_INK_HIGHLIGHT);
      return;
    }
    api.registry.set(
      WET_INK_HIGHLIGHT,
      new api.Highlight(...domRanges(this.view, state.wet)),
    );
  }

  /** The draft is on disk: the ink dries in two steps, then is just ink. */
  private dry() {
    const state = wetInkPluginKey.getState(this.view.state);
    if (!state || state.wet.length === 0) return;
    const level = inkLevel();
    const api = this.api;
    if (api && level !== "still") {
      if (this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
      api.registry.delete(WET_INK_HIGHLIGHT);
      api.registry.set(
        DRYING_INK_HIGHLIGHT,
        new api.Highlight(...domRanges(this.view, state.wet)),
      );
      if (this.dryTimer !== undefined) clearTimeout(this.dryTimer);
      this.dryTimer = setTimeout(() => {
        this.dryTimer = undefined;
        api.registry.delete(DRYING_INK_HIGHLIGHT);
      }, DRY_MS[level]);
    }
    if (this.view.isDestroyed) return;
    this.view.dispatch(
      this.view.state.tr
        .setMeta(wetInkPluginKey, { type: "dry" } satisfies WetInkMeta)
        .setMeta("addToHistory", false),
    );
  }

  destroy() {
    window.removeEventListener(DRAFT_SAVED_EVENT, this.onSaved);
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.dryTimer !== undefined) clearTimeout(this.dryTimer);
    const api = this.api;
    api?.registry.delete(WET_INK_HIGHLIGHT);
    api?.registry.delete(DRYING_INK_HIGHLIGHT);
  }
}

export const WetInk = Extension.create({
  name: "twyneWetInk",

  addProseMirrorPlugins() {
    return [
      new Plugin<WetInkState>({
        key: wetInkPluginKey,
        state: {
          init: () => ({ wet: [] }),
          apply: (tr, state) => applyInkTransaction(state, tr),
        },
        view: (view) => {
          // Read-only and server renders never set ink.
          if (typeof window === "undefined") return {};
          const painter = new WetInkPainter(view);
          return {
            update: () => painter.update(),
            destroy: () => painter.destroy(),
          };
        },
      }),
    ];
  },
});

/** The wet ranges in the current state (for tests and diagnostics). */
export function getWetInk(
  state: Parameters<typeof wetInkPluginKey.getState>[0],
): InkRange[] {
  return wetInkPluginKey.getState(state)?.wet ?? [];
}
