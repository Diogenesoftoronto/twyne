/**
 * TipTap extension that paints a small hit-tested chip at the end of
 * every contiguous run of three "comment-like" marks: writer comments
 * (`.twyne-comment-mark`), persona notes (`.twyne-persona-note`), and
 * editor proposals (`.twyne-suggestion`).
 *
 * Why a widget and not a CSS pseudo-element:
 *   - Multi-span marks can interleave with bold/italic/links etc.,
 *     leaving no single DOM "last span" the CSS can target.
 *   - Pseudo-elements can't be hit-tested, so a chip clicked by
 *     the reader can't open the right popover.
 *   - Widgets are real DOM nodes owned by ProseMirror and survive
 *     mapping across transactions.
 *
 * The chip carries `data-anchor-kind` (note|comment|suggestion) and
 * `data-anchor-id`; the editor's click handler reads those and
 * forwards to the matching popover opener using the chip's own
 * getBoundingClientRect() (sidestepping multi-span rect issues).
 */
import {
  resolvePersonaPortrait,
  type PersonaPortraitIdentity,
} from "../../../utils/persona-portrait";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Mark, Node as PmNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type AnchorKind = "note" | "comment" | "suggestion";

const anchorPluginKey = new PluginKey<DecorationSet>("twyneMarkAnchors");

/** Helper for both compilers: name → kind. */
function kindFor(name: string): AnchorKind | null {
  switch (name) {
    case "personaNote":
      return "note";
    case "commentMark":
      return "comment";
    case "suggestion":
      return "suggestion";
    default:
      return null;
  }
}

function idForMark(mark: Mark): string | null {
  const id = mark.attrs?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

interface AnchorOptions {
  writer: () => PersonaPortraitIdentity;
  personas: () => PersonaPortraitIdentity[];
}

function buildDecorations(doc: PmNode, options: AnchorOptions): DecorationSet {
  const runs: {
    kind: AnchorKind;
    id: string;
    to: number;
    index: number;
    identity: PersonaPortraitIdentity;
  }[] = [];
  const latest = new Map<string, (typeof runs)[number]>();
  const counts = new Map<string, number>();
  // One pass, including overlapping marks. A second document walk for each
  // anchor made annotated manuscripts quadratic on every keystroke. Position
  // adjacency also keeps separate passages with the same thread id separate.
  doc.descendants((node: PmNode, pos: number) => {
    if (!node.isText || !node.marks.length) return true;

    for (const mark of node.marks) {
      const kind = kindFor(mark.type.name);
      if (!kind) continue;
      if (kind === "comment" && mark.attrs.resolved) continue;
      const id = idForMark(mark);
      if (!id) continue;

      const key = JSON.stringify([kind, id]);
      const previous = latest.get(key);
      if (previous?.to === pos) {
        previous.to = pos + node.nodeSize;
      } else {
        const index = counts.get(key) ?? 0;
        const author =
          mark.attrs.author || (kind === "comment" ? "You" : "Editor");
        const persona = options
          .personas()
          .find((entry) => entry.name === author);
        const identity =
          kind === "comment" && author === "You"
            ? {
                ...options.writer(),
                color: mark.attrs.color || "var(--color-writer-note)",
              }
            : {
                ...persona,
                name: author,
                color: mark.attrs.color || persona?.color,
              };
        const run = { kind, id, to: pos + node.nodeSize, index, identity };
        counts.set(key, index + 1);
        runs.push(run);
        latest.set(key, run);
      }
    }
    return true;
  });

  return DecorationSet.create(
    doc,
    runs.map(({ kind, id, to, index, identity }) =>
      Decoration.widget(to, () => createChip(kind, id, identity), {
        key: `twyne-anchor:${JSON.stringify([kind, id, index, identity])}`,
        side: 1,
        ignoreSelection: true,
      }),
    ),
  );
}

function createChip(
  kind: AnchorKind,
  id: string,
  identity: PersonaPortraitIdentity,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "twyne-mark-anchor";
  btn.setAttribute("data-anchor-kind", kind);
  btn.setAttribute("data-anchor-id", id);
  const portrait = resolvePersonaPortrait(identity);
  const label = `Open ${portrait.name}’s ${kind === "comment" ? "note" : kind}`;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.style.setProperty("--anchor-color", portrait.color);
  const face = document.createElement("span");
  face.className = "twyne-mark-anchor__face";
  face.setAttribute("aria-hidden", "true");
  face.setAttribute("data-initials", portrait.initials);
  if (portrait.src) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = portrait.src;
    image.draggable = false;
    if (portrait.focus) {
      image.style.width = "275%";
      image.style.height = "343.75%";
      image.style.left = `${50 - 275 * portrait.focus.fx}%`;
      image.style.top = `${53 - 343.75 * portrait.focus.fy}%`;
    }
    image.addEventListener("error", () => image.remove(), { once: true });
    face.appendChild(image);
  }
  btn.appendChild(face);
  btn.contentEditable = "false";
  // Keep ProseMirror's paragraph shortcuts from consuming button activation.
  btn.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    btn.click();
  });
  return btn;
}

export const MarkAnchorWidgets = Extension.create<AnchorOptions>({
  name: "markAnchorWidgets",

  addOptions() {
    return {
      writer: () => ({ name: "You", color: "var(--color-writer-note)" }),
      personas: () => [],
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<DecorationSet>({
        key: anchorPluginKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, options),
          apply(tr, old, _oldState, newState) {
            if (tr.docChanged || tr.getMeta("twyneAnchorIdentity")) {
              // On doc changes, rebuild — the set of runs and the
              // text nodes they live on may all have shifted, so a
              // plain mapping isn't faithful.
              return buildDecorations(newState.doc, options);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
