import { Extension, type CommandProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { buildDocumentOutline } from "../../../utils/document-outline";
import {
  moveSectionRange,
  planSectionMove,
  type SectionDropPlacement,
} from "../../../utils/section-reorder";

const SECTION_DRAG_MIME = "application/x-twyne-section";

interface DropTarget {
  id: string;
  placement: SectionDropPlacement;
}

export interface SectionReorderPluginState {
  draggingId: string | null;
  dropTarget: DropTarget | null;
}

type SectionReorderMeta =
  | { type: "dragStart"; sourceId: string }
  | { type: "dragOver"; target: DropTarget | null }
  | { type: "clearDrag" };

export const sectionReorderPluginKey = new PluginKey<SectionReorderPluginState>(
  "twyneSectionReorder",
);

export function getSectionReorderState(
  state: EditorState,
): SectionReorderPluginState | undefined {
  return sectionReorderPluginKey.getState(state);
}

function dragHandle(id: string, label: string): HTMLElement {
  const handle = document.createElement("span");
  handle.dataset.sectionDragHandle = id;
  handle.draggable = true;
  handle.contentEditable = "false";
  handle.className = "twyne-section-drag-handle";
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", `Move section: ${label}`);
  handle.setAttribute("title", `Drag to move ${label}`);
  handle.textContent = "⋮⋮";
  handle.style.cssText =
    "position:absolute;transform:translate(-1.5rem,.2rem);cursor:grab;user-select:none;opacity:.55;";
  return handle;
}

function sectionDecorations(
  doc: ProseMirrorNode,
  pluginState: SectionReorderPluginState | undefined,
): DecorationSet {
  const outline = buildDocumentOutline(doc);
  const decorations: Decoration[] = outline.flat.map((heading) =>
    Decoration.widget(
      heading.from,
      () => dragHandle(heading.id, heading.label),
      {
        side: -1,
        key: `section-drag-handle:${heading.id}`,
      },
    ),
  );

  const target = pluginState?.dropTarget;
  if (target) {
    const heading = outline.byId[target.id];
    if (heading) {
      const position =
        target.placement === "before" ? heading.from : heading.to;
      decorations.push(
        Decoration.widget(
          position,
          () => {
            const indicator = document.createElement("span");
            indicator.contentEditable = "false";
            indicator.dataset.sectionDropIndicator = target.placement;
            indicator.style.cssText =
              "display:block;border-top:2px solid var(--accent-color,#6d5dfc);pointer-events:none;";
            return indicator;
          },
          { side: target.placement === "before" ? -2 : 2 },
        ),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

function eventElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

function headingAtEvent(
  view: EditorView,
  event: DragEvent,
): { id: string; element: HTMLElement } | null {
  const outline = buildDocumentOutline(view.state.doc);
  const directHeading = eventElement(event)?.closest("h1, h2, h3, h4, h5, h6");

  if (directHeading instanceof HTMLElement) {
    try {
      const contentPosition = view.posAtDOM(directHeading, 0);
      const exact = outline.flat.find(
        (heading) => heading.contentFrom === contentPosition,
      );
      if (exact) return { id: exact.id, element: directHeading };
    } catch {
      // The DOM may be redrawn between the event and this lookup. Fall back to
      // coordinates, which resolve against the current view.
    }
  }

  const atCoords = view.posAtCoords({
    left: event.clientX,
    top: event.clientY,
  });
  if (!atCoords) return null;
  let target = outline.flat[0];
  for (const heading of outline.flat) {
    if (heading.from > atCoords.pos) break;
    target = heading;
  }
  if (!target) return null;
  const dom = view.nodeDOM(target.from);
  return dom instanceof HTMLElement ? { id: target.id, element: dom } : null;
}

function dropPlacement(
  element: HTMLElement,
  event: DragEvent,
): SectionDropPlacement {
  const rect = element.getBoundingClientRect();
  return rect.height > 0 && event.clientY > rect.top + rect.height / 2
    ? "after"
    : "before";
}

function clearDrag(view: EditorView): void {
  view.dispatch(
    view.state.tr
      .setMeta(sectionReorderPluginKey, { type: "clearDrag" })
      .setMeta("addToHistory", false),
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sectionReorder: {
      moveSection: (
        sourceId: string,
        targetId: string,
        placement: SectionDropPlacement,
      ) => ReturnType;
    };
  }
}

/**
 * Draggable heading handles backed by the canonical document outline.
 *
 * The same `moveSection` command powers programmatic outline controls and DOM
 * drops. Integrators only need to register this extension; the central editor
 * remains free to decide when the capability is enabled.
 */
export const SectionReorder = Extension.create({
  name: "sectionReorder",

  addCommands() {
    return {
      moveSection:
        (sourceId, targetId, placement) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const plan = planSectionMove(buildDocumentOutline(state.doc), {
            sourceId,
            targetId,
            placement,
          });
          if (!plan || !moveSectionRange(tr, plan)) return false;
          dispatch?.(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SectionReorderPluginState>({
        key: sectionReorderPluginKey,
        state: {
          init: () => ({ draggingId: null, dropTarget: null }),
          apply(tr, previous) {
            const meta = tr.getMeta(sectionReorderPluginKey) as
              | SectionReorderMeta
              | undefined;
            if (meta?.type === "dragStart") {
              return { draggingId: meta.sourceId, dropTarget: null };
            }
            if (meta?.type === "dragOver") {
              return { ...previous, dropTarget: meta.target };
            }
            if (meta?.type === "clearDrag" || tr.docChanged) {
              return { draggingId: null, dropTarget: null };
            }
            return previous;
          },
        },
        props: {
          decorations(state) {
            return sectionDecorations(
              state.doc,
              sectionReorderPluginKey.getState(state),
            );
          },
          handleDOMEvents: {
            dragstart(view, event) {
              const handle = eventElement(event)?.closest<HTMLElement>(
                "[data-section-drag-handle]",
              );
              const sourceId = handle?.dataset.sectionDragHandle;
              if (!sourceId) return false;
              event.dataTransfer?.setData(SECTION_DRAG_MIME, sourceId);
              if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
              view.dispatch(
                view.state.tr
                  .setMeta(sectionReorderPluginKey, {
                    type: "dragStart",
                    sourceId,
                  } satisfies SectionReorderMeta)
                  .setMeta("addToHistory", false),
              );
              return true;
            },
            dragover(view, event) {
              const pluginState = sectionReorderPluginKey.getState(view.state);
              if (!pluginState?.draggingId) return false;
              const hovered = headingAtEvent(view, event);
              if (!hovered) return false;
              const placement = dropPlacement(hovered.element, event);
              const target = { id: hovered.id, placement };
              const plan = planSectionMove(
                buildDocumentOutline(view.state.doc),
                {
                  sourceId: pluginState.draggingId,
                  targetId: target.id,
                  placement: target.placement,
                },
              );
              if (!plan) {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
                if (pluginState.dropTarget) {
                  view.dispatch(
                    view.state.tr
                      .setMeta(sectionReorderPluginKey, {
                        type: "dragOver",
                        target: null,
                      } satisfies SectionReorderMeta)
                      .setMeta("addToHistory", false),
                  );
                }
                return true;
              }
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
              if (
                pluginState.dropTarget?.id !== target.id ||
                pluginState.dropTarget.placement !== target.placement
              ) {
                view.dispatch(
                  view.state.tr
                    .setMeta(sectionReorderPluginKey, {
                      type: "dragOver",
                      target,
                    } satisfies SectionReorderMeta)
                    .setMeta("addToHistory", false),
                );
              }
              return true;
            },
            drop(view, event) {
              const pluginState = sectionReorderPluginKey.getState(view.state);
              const sourceId =
                pluginState?.draggingId ||
                event.dataTransfer?.getData(SECTION_DRAG_MIME);
              const hovered = headingAtEvent(view, event);
              if (!sourceId || !hovered) return false;
              // DOM event handlers do not implicitly cancel browser behavior.
              // Cancel before validation so an invalid self-drop cannot insert
              // the draggable widget's text into the editable manuscript.
              event.preventDefault();
              const placement = dropPlacement(hovered.element, event);
              const plan = planSectionMove(
                buildDocumentOutline(view.state.doc),
                {
                  sourceId,
                  targetId: hovered.id,
                  placement,
                },
              );
              if (!plan) {
                clearDrag(view);
                return true;
              }
              const tr = view.state.tr;
              if (!moveSectionRange(tr, plan)) {
                clearDrag(view);
                return true;
              }
              tr.setMeta(sectionReorderPluginKey, { type: "clearDrag" });
              view.dispatch(tr);
              return true;
            },
            dragend(view) {
              clearDrag(view);
              return false;
            },
          },
        },
      }),
    ];
  },
});
