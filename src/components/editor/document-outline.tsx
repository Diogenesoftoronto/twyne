import {
  $,
  component$,
  type JSXOutput,
  type NoSerialize,
  type PropFunction,
  type QRL,
} from "@builder.io/qwik";
import {
  focusOutlineHeading,
  type DocumentOutlineHeading,
  type DocumentOutlineModel,
  type OutlineFocusableEditor,
} from "../../utils/document-outline";

export interface DocumentOutlineProps {
  outline: DocumentOutlineModel | readonly DocumentOutlineHeading[];
  activeId?: string | null;
  editor?: NoSerialize<OutlineFocusableEditor>;
  onNavigate$?: PropFunction<(heading: DocumentOutlineHeading) => void>;
  label?: string;
  emptyLabel?: string;
}

function outlineItems(
  outline: DocumentOutlineProps["outline"],
): readonly DocumentOutlineHeading[] {
  return Array.isArray(outline)
    ? outline
    : (outline as DocumentOutlineModel).items;
}

/**
 * DOM fallback for consumers that render generated ids directly onto their
 * headings. The editor integration normally supplies the live Tiptap editor,
 * but this keeps the navigation component useful in published/static readers.
 */
export function focusOutlineHeadingElement(
  id: string,
  root: ParentNode = document,
): boolean {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/["\\]/g, "\\$&");
  const element = root.querySelector<HTMLElement>(
    `[data-outline-id="${escaped}"], #${escaped}`,
  );
  if (!element) return false;
  if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "center", behavior: "auto" });
  return true;
}

function renderBranch(
  headings: readonly DocumentOutlineHeading[],
  props: DocumentOutlineProps,
  navigate$: QRL<(heading: DocumentOutlineHeading) => void>,
): JSXOutput {
  return (
    <ol class="m-0 list-none p-0" role="list">
      {headings.map((heading) => {
        const active = props.activeId === heading.id;
        return (
          <li key={heading.id} class="m-0 p-0">
            <button
              type="button"
              class={[
                "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
                "text-sm leading-5 transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-1",
                active
                  ? "bg-[var(--color-paper-2)] font-semibold text-[var(--color-ink)]"
                  : "text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-2)] hover:text-[var(--color-ink)]",
              ]}
              aria-current={active ? "location" : undefined}
              title={`Go to ${heading.label}`}
              onClick$={() => navigate$(heading)}
            >
              <span
                aria-hidden="true"
                class="mt-[0.15rem] w-4 shrink-0 text-right font-mono text-[0.65rem] text-[var(--color-ink-muted)] opacity-70"
              >
                {heading.level}
              </span>
              <span class="min-w-0 flex-1 break-words">{heading.label}</span>
            </button>
            {heading.children.length > 0 && (
              <div class="ml-3 border-l border-[var(--color-paper-3)] pl-1">
                {renderBranch(heading.children, props, navigate$)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Compact outline navigation for the editor sidebar.
 *
 * The component owns no editor state and can therefore be integrated without
 * racing the central editor. A consumer may pass the live editor, provide an
 * explicit navigation callback, or rely on generated ids in static HTML.
 */
export const DocumentOutline = component$<DocumentOutlineProps>((props) => {
  const items = outlineItems(props.outline);
  const navigate$ = $((heading: DocumentOutlineHeading) => {
    if (props.onNavigate$) {
      void props.onNavigate$(heading);
      return;
    }
    if (props.editor && focusOutlineHeading(props.editor, heading)) return;
    if (typeof document !== "undefined") {
      focusOutlineHeadingElement(heading.id);
    }
  });

  return (
    <nav
      aria-label={props.label || "Document outline"}
      class="min-h-0 overflow-y-auto"
    >
      {items.length > 0 ? (
        renderBranch(items, props, navigate$)
      ) : (
        <p
          class="m-0 px-2 py-3 text-sm leading-5 text-[var(--color-ink-muted)]"
          role="status"
        >
          {props.emptyLabel || "Add a heading to build the outline."}
        </p>
      )}
    </nav>
  );
});
