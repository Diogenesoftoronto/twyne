/**
 * Paginated canvas — the DOM half of the pagination engine.
 *
 * The document stays one continuous ProseMirror. Nothing here touches the
 * schema, so `getHTML()`, the Lix mirror, comment reconciliation and undo all
 * carry on seeing exactly the document the writer typed. What this extension
 * adds is vertical space: an invisible spacer widget at each page boundary,
 * sized so that every page's content top lands on a uniform grid. The sheets,
 * the running header and the page numbers are painted separately by
 * `page-chrome.tsx`, which needs only the page count — because the grid makes
 * every other position arithmetic.
 *
 * The arithmetic lives in `pagination-geometry.ts` and is unit tested there.
 * This file is the impure part: it measures, it schedules, and it dispatches.
 *
 * ## The three rules that keep it stable
 *
 * 1. **Never read `offsetTop`.** Only `offsetHeight` and the computed margins.
 *    The geometry module reconstructs the stack from those, which makes the
 *    engine a fixed point: its own spacers cannot change its own inputs. An
 *    engine that read `offsetTop` would oscillate forever at every heading,
 *    because inserting a spacer stops a margin from collapsing.
 * 2. **Read, then compute, then write — never interleave.** All measurement
 *    happens in one batch inside a `requestAnimationFrame`, so the browser
 *    performs exactly one forced layout per pass rather than one per block.
 * 3. **Key the widgets.** Without a stable `key`, ProseMirror rebuilds every
 *    spacer's DOM on every keystroke and the document visibly flickers.
 *
 * Structurally this mirrors `mark-anchor-widgets.ts`, the codebase's existing
 * decoration plugin, and coexists with it: ProseMirror unions `decorations`
 * across plugins, and the spacer's `side: -100` sorts it before that file's
 * `side: 1` anchor chips at a coincident position.
 */
import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  computePageGeometry,
  paginate,
  sameBreaks,
  type BlockMetric,
  type PageBreak,
  type PageGeometry,
} from "../pagination-geometry";
import { rootFontSize } from "../../../utils/css-units";
import { resolvePageSetup, type LayoutSettings } from "../../../types";

/**
 * How long the writer must pause before the pages resettle. During a burst
 * they see the previous break positions, stale by at most a line, for a
 * fraction of a second — which is far better than a page boundary that
 * twitches on every keystroke.
 */
const TYPING_QUIET_MS = 90;

/** Coalescing window for resize, font-load and layout changes. */
const RESIZE_QUIET_MS = 100;

/**
 * Past either ceiling the engine gives up and falls back to a continuous
 * column. A pathological paste must not freeze the tab, and nobody wants
 * two thousand page frames painted behind their prose.
 */
export const PAGINATION_MAX_BLOCKS = 20_000;
export const PAGINATION_MAX_PAGES = 2_000;

export interface PaginationInfo {
  pageCount: number;
  geometry: PageGeometry;
  /** False when a ceiling was hit and the canvas fell back to continuous flow. */
  active: boolean;
}

export interface PaginationOptions {
  /** Live page settings. Replaced at runtime via `setPaginationLayout`. */
  layout: LayoutSettings | null;
  /**
   * Content rendered after the editor but inside the page canvas — the
   * manuscript notes block. It is not a ProseMirror node, so the engine
   * cannot measure it as one, but it still has to fit on a sheet.
   */
  getTailElement?: () => HTMLElement | null;
  /**
   * Override for the scrolling ancestor. Left unset, the engine finds it
   * itself — which is usually the better answer, since which element actually
   * scrolls depends on the surrounding flex layout and changes with the
   * viewport.
   */
  getScroller?: () => HTMLElement | null;
  /** Fired whenever the page count or the geometry changes. */
  onPaginate?: (info: PaginationInfo) => void;
}

interface PluginState {
  decorations: DecorationSet;
  breaks: PageBreak[];
  /** The live page settings, replaced by `setPaginationLayout`. */
  layout: LayoutSettings | null;
  /**
   * Bumped whenever something other than the document invalidates the
   * measurement. `view.update` compares it against the previous state, which
   * is the only reliable way to notice a non-document change from there.
   */
  configVersion: number;
}

export const paginationPluginKey = new PluginKey<PluginState>("twynePagination");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    twynePagination: {
      /** Push new page settings in and trigger a full repagination. */
      setPaginationLayout: (layout: LayoutSettings) => ReturnType;
      /** Force a remeasure — used after an image or diagram finishes rendering. */
      refreshPagination: () => ReturnType;
    };
  }
}

function spacerWidget(height: number, page: number, forced: boolean) {
  return () => {
    const el = document.createElement("div");
    el.className = "twyne-page-spacer";
    el.setAttribute("data-page-spacer", String(page));
    if (forced) el.setAttribute("data-forced", "true");
    el.setAttribute("aria-hidden", "true");
    el.contentEditable = "false";
    // Inline height rather than a custom property: this is the one number the
    // whole grid depends on, and a stylesheet must not be able to override it.
    el.style.height = `${height}px`;
    return el;
  };
}

function buildDecorations(doc: any, breaks: readonly PageBreak[]): DecorationSet {
  if (breaks.length === 0) return DecorationSet.empty;
  const decos = breaks.map((b) =>
    Decoration.widget(b.pos, spacerWidget(b.height, b.page, b.forced), {
      // Stable identity, height included, so ProseMirror reuses the DOM node
      // whenever the break has not actually moved. Without this every
      // keystroke recreates every spacer and the page visibly jumps.
      key: `twyne-page-break:${b.page}:${Math.round(b.height)}`,
      // Sort ahead of the mark-anchor chips, which use side: 1. The page gap
      // opens before the chip rather than swallowing it.
      side: -100,
      // A break falling inside a commented span must not inherit its
      // highlight — the spacer is page furniture, not prose.
      marks: [],
      ignoreSelection: true,
    }),
  );
  return DecorationSet.create(doc, decos);
}

/**
 * Measure every top-level block.
 *
 * Blocks are located by walking the document and asking the view for each
 * node's DOM, rather than by indexing `.ProseMirror.children`. Widget
 * decorations from the other plugins — anchor chips, remote carets, and our
 * own spacers — are real children too, so an index-based walk would silently
 * pair block 7's metrics with block 9's position.
 *
 * The margin cache exists because `getComputedStyle` is the expensive call
 * here and margins change far less often than heights do. It is keyed on the
 * element, so ProseMirror replacing a paragraph with a heading invalidates
 * the entry for free.
 */
function measureBlocks(
  view: EditorView,
  marginCache: WeakMap<HTMLElement, { mt: number; mb: number }>,
): BlockMetric[] | null {
  const doc = view.state.doc;
  if (doc.childCount > PAGINATION_MAX_BLOCKS) return null;

  const metrics: BlockMetric[] = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const nodePos = pos;
    pos += node.nodeSize;

    const dom = view.nodeDOM(nodePos);
    const el =
      dom && (dom as HTMLElement).nodeType === 1
        ? (dom as HTMLElement)
        : null;

    const forcedBreak = node.type.name === "pageBreak";
    // Headings must not be stranded as the last block on a page. This mirrors
    // `break-after: avoid` in the print stylesheet, so screen and paper make
    // the same decision rather than two plausible different ones.
    const keepWithNext =
      node.type.name === "heading" || node.attrs.keepWithNext === true;

    if (!el) {
      metrics.push({
        pos: nodePos,
        height: 0,
        marginTop: 0,
        marginBottom: 0,
        forcedBreak,
        keepWithNext,
      });
      continue;
    }

    let margins = marginCache.get(el);
    if (!margins) {
      const cs = getComputedStyle(el);
      margins = {
        mt: parseFloat(cs.marginTop) || 0,
        mb: parseFloat(cs.marginBottom) || 0,
      };
      marginCache.set(el, margins);
    }

    metrics.push({
      pos: nodePos,
      height: el.offsetHeight,
      marginTop: margins.mt,
      marginBottom: margins.mb,
      forcedBreak,
      keepWithNext,
    });
  }
  return metrics;
}

/**
 * Find the element that actually scrolls the manuscript.
 *
 * Which one that is depends on the surrounding flex layout and changes with
 * the viewport — a pane that scrolls at one window size grows to fit its
 * content at another, at which point the document scrolls instead. Testing
 * `scrollHeight > clientHeight` rather than trusting a selector is what keeps
 * scroll anchoring from silently becoming a no-op.
 */
function resolveScroller(from: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = from.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

export const Pagination = Extension.create<PaginationOptions>({
  name: "twynePagination",

  addOptions() {
    return {
      layout: null,
      getTailElement: undefined,
      getScroller: undefined,
      onPaginate: undefined,
    };
  },

  addCommands() {
    return {
      setPaginationLayout:
        (layout: LayoutSettings) =>
        ({ tr }: CommandProps) => {
          tr.setMeta(paginationPluginKey, { layout });
          return true;
        },
      refreshPagination:
        () =>
        ({ tr }: CommandProps) => {
          tr.setMeta(paginationPluginKey, { refresh: true });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const initialLayout = options.layout;

    return [
      new Plugin<PluginState>({
        key: paginationPluginKey,

        state: {
          init: () => ({
            decorations: DecorationSet.empty,
            breaks: [],
            layout: initialLayout,
            configVersion: 0,
          }),

          apply(tr, old, _oldState, newState) {
            const meta = tr.getMeta(paginationPluginKey);

            if (meta?.result) {
              return {
                ...old,
                decorations: buildDecorations(newState.doc, meta.result),
                breaks: meta.result as PageBreak[],
              };
            }

            if (meta?.layout || meta?.refresh) {
              return {
                ...old,
                layout: meta.layout ?? old.layout,
                configVersion: old.configVersion + 1,
              };
            }

            if (tr.docChanged) {
              // Map the existing spacers forward so the page does not collapse
              // in the frame before the remeasure lands. They are stale by at
              // most one rAF, and mapping keeps them attached to the right
              // blocks in the meantime.
              return {
                ...old,
                decorations: old.decorations.map(tr.mapping, tr.doc),
              };
            }

            return old;
          },
        },

        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },

        view(view) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let rafId: number | null = null;
          let destroyed = false;
          let marginCache = new WeakMap<
            HTMLElement,
            { mt: number; mb: number }
          >();
          let lastGeometryKey = "";
          let lastPageCount = -1;

          const measure = () => {
            if (destroyed || view.isDestroyed) return;
            const layout = paginationPluginKey.getState(view.state)?.layout;
            if (!layout) return;

            const setup = resolvePageSetup(layout);
            const geometry = computePageGeometry(layout, rootFontSize());

            // Continuous mode: strip any spacers and let the column flow.
            if (setup.pagination === "continuous") {
              publish({ pageCount: 1, geometry, active: false });
              if (currentBreaks().length) dispatch([]);
              return;
            }

            const metrics = measureBlocks(view, marginCache);
            if (!metrics) {
              // Past the block ceiling — fall back rather than freeze.
              publish({ pageCount: 1, geometry, active: false });
              if (currentBreaks().length) dispatch([]);
              return;
            }

            const tailEl = options.getTailElement?.() ?? null;
            const result = paginate(metrics, geometry, {
              tailHeight: tailEl ? tailEl.offsetHeight : 0,
              maxPages: PAGINATION_MAX_PAGES,
            });

            publish({
              pageCount: result.pageCount,
              geometry,
              active: true,
            });

            // The only practical way to assert that the debounce works: an
            // end-to-end test can count measurement passes across a burst of
            // keystrokes. Read-only, and nothing in the app consumes it.
            if (typeof window !== "undefined") {
              const probe = ((window as any).__twynePagination ??= {
                measureCount: 0,
              });
              probe.measureCount++;
              probe.pageCount = result.pageCount;
              probe.breaks = result.breaks;
              probe.geometry = geometry;
            }

            // The guard that makes an infinite measure/decorate loop
            // structurally impossible rather than merely unlikely. With the
            // fixed-point property above it should never actually fire.
            if (sameBreaks(currentBreaks(), result.breaks)) return;

            dispatch(result.breaks, true);
          };

          const currentBreaks = (): PageBreak[] =>
            paginationPluginKey.getState(view.state)?.breaks ?? [];

          const publish = (info: PaginationInfo) => {
            const key = `${info.geometry.pageH}:${info.geometry.pageW}:${info.geometry.gap}:${info.geometry.marginTop}:${info.active}`;
            if (key === lastGeometryKey && info.pageCount === lastPageCount) {
              return;
            }
            lastGeometryKey = key;
            lastPageCount = info.pageCount;
            options.onPaginate?.(info);
          };

          const dispatch = (breaks: PageBreak[], anchor = false) => {
            const scroller =
              options.getScroller?.() ?? resolveScroller(view.dom);
            // Record where the caret sits on screen before the reflow. A full
            // repagination — a font landing, a margin drag — moves every
            // spacer, which yanks the document out from under the writer.
            let anchorTop: number | null = null;
            if (anchor && scroller) {
              try {
                anchorTop =
                  view.coordsAtPos(view.state.selection.head).top -
                  scroller.getBoundingClientRect().top;
              } catch {
                anchorTop = null;
              }
            }

            const tr = view.state.tr;
            tr.setMeta(paginationPluginKey, { result: breaks });
            // Pagination is a view concern, not an edit. Keeping it out of the
            // history means undo never has to restore a page layout, and the
            // `twyne:content` mirror never fires for a reflow.
            tr.setMeta("addToHistory", false);
            view.dispatch(tr);

            if (anchorTop == null || !scroller) return;
            requestAnimationFrame(() => {
              if (destroyed || view.isDestroyed) return;
              try {
                const now =
                  view.coordsAtPos(view.state.selection.head).top -
                  scroller.getBoundingClientRect().top;
                const delta = now - anchorTop;
                if (Math.abs(delta) > 1) scroller.scrollTop += delta;
              } catch {
                /* selection moved out of view; nothing to anchor to */
              }
            });
          };

          const schedule = (delay: number, invalidateStyles = false) => {
            if (invalidateStyles) marginCache = new WeakMap();
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              if (rafId != null) return;
              rafId = requestAnimationFrame(() => {
                rafId = null;
                measure();
              });
            }, delay);
          };

          /* ── Signals that invalidate the measurement ── */

          // Anything that changes a block's height without a transaction:
          // an image decoding, a mermaid diagram rendering, a table column
          // being dragged.
          const contentObserver =
            typeof ResizeObserver !== "undefined"
              ? new ResizeObserver(() => schedule(RESIZE_QUIET_MS))
              : null;
          contentObserver?.observe(view.dom);

          // The canvas changing width invalidates every height at once —
          // window resize, a side panel opening, zen mode.
          const canvasObserver =
            typeof ResizeObserver !== "undefined"
              ? new ResizeObserver(() => schedule(RESIZE_QUIET_MS, true))
              : null;
          const canvas = view.dom.closest(".page-canvas");
          if (canvas) canvasObserver?.observe(canvas);

          // A webfont swapping in changes every line box in the document.
          // `exportPdf` already knows this matters and awaits `fonts.ready`;
          // the screen engine needs the same discipline.
          const onFontsDone = () => schedule(RESIZE_QUIET_MS, true);
          const fontSet = (document as any).fonts;
          fontSet?.addEventListener?.("loadingdone", onFontsDone);

          schedule(0);

          return {
            update(_view, prevState) {
              const prev = paginationPluginKey.getState(prevState);
              const next = paginationPluginKey.getState(view.state);

              // A settings change — paper, orientation, margins — invalidates
              // every measurement, including the cached margins.
              if (prev && next && prev.configVersion !== next.configVersion) {
                schedule(RESIZE_QUIET_MS, true);
                return;
              }

              if (!prevState.doc.eq(view.state.doc)) {
                // Most edits only change height, but paragraph formatting can
                // change margins while ProseMirror reuses the same DOM node.
                // A WeakMap keyed by that node would otherwise return the old
                // margins and paginate as though the command had done nothing.
                schedule(TYPING_QUIET_MS, true);
              }
            },

            destroy() {
              destroyed = true;
              if (timer) clearTimeout(timer);
              if (rafId != null) cancelAnimationFrame(rafId);
              contentObserver?.disconnect();
              canvasObserver?.disconnect();
              fontSet?.removeEventListener?.("loadingdone", onFontsDone);
            },
          };
        },
      }),
    ];
  },
});
