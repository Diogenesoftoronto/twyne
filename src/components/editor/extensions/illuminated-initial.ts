import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  illuminatedInitialArtwork,
  openingInitial,
} from "../../../utils/illuminated-initials";
import {
  DEFAULT_OPENING_INITIAL,
  resolveOpeningInitial,
  type OpeningInitialSettings,
} from "../../../types";

interface InitialLocation {
  paragraphFrom: number;
  paragraphTo: number;
  prefixFrom: number | null;
  from: number;
  to: number;
  artwork: string | null;
}

interface IlluminatedInitialState {
  initial: InitialLocation | null;
  settings: OpeningInitialSettings;
  loaded: ReadonlySet<string>;
  decorations: DecorationSet;
}

type InitialMeta =
  | { type: "settings"; settings: OpeningInitialSettings }
  | { type: "loaded"; artwork: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    illuminatedInitial: {
      setOpeningInitial: (settings: OpeningInitialSettings) => ReturnType;
    };
  }
}

export const illuminatedInitialPluginKey =
  new PluginKey<IlluminatedInitialState>("twyneIlluminatedInitial");

function findInitial(
  doc: ProseMirrorNode,
  settings: OpeningInitialSettings,
): InitialLocation | null {
  if (settings.mode === "off") return null;
  let initial: InitialLocation | null = null;
  let foundParagraph = false;
  doc.forEach((node, offset) => {
    if (foundParagraph || node.type.name !== "paragraph") return;
    foundParagraph = true;
    // Leaf atoms occupy one position, so text offsets still match the document.
    // An opening image/note/equation must not illuminate unrelated later text.
    const text = node.textBetween(0, node.content.size, "", "\ufffc");
    const opening = openingInitial(text);
    // Keep the existing typographic cap for unsupported graphemes. In
    // particular, a combining accent can straddle differently marked nodes;
    // floating multiple decoration fragments would separate that grapheme.
    if (!opening?.artwork) return;
    const prefixStart = text.slice(0, opening.from).search(/\S/u);
    initial = {
      paragraphFrom: offset,
      paragraphTo: offset + node.nodeSize,
      prefixFrom: prefixStart < 0 ? null : offset + 1 + prefixStart,
      from: offset + 1 + opening.from,
      to: offset + 1 + opening.to,
      artwork:
        settings.mode === "illuminated"
          ? illuminatedInitialArtwork(opening.glyph, settings.collection)
          : null,
    };
  });
  return initial;
}

function decorate(
  doc: ProseMirrorNode,
  loaded: ReadonlySet<string>,
  settings: OpeningInitialSettings,
): IlluminatedInitialState {
  const initial = findInitial(doc, settings);
  if (!initial)
    return { initial, settings, loaded, decorations: DecorationSet.empty };
  const ready = initial.artwork && loaded.has(initial.artwork);
  return {
    initial,
    settings,
    loaded,
    decorations: DecorationSet.create(doc, [
      Decoration.node(initial.paragraphFrom, initial.paragraphTo, {
        class: "twyne-illuminated-paragraph",
      }),
      // Floats otherwise pass preceding inline punctuation and make “At read
      // as A “t. Keep the real quote/bracket to the left of the initial.
      ...(initial.prefixFrom === null
        ? []
        : [
            Decoration.inline(initial.prefixFrom, initial.from, {
              nodeName: "span",
              class: "twyne-illuminated-prefix",
            }),
          ]),
      Decoration.inline(initial.from, initial.to, {
        nodeName: "span",
        class: `twyne-illuminated-initial${ready ? " is-illuminated" : ""}`,
        ...(ready
          ? { style: `--twyne-initial-artwork: url("${initial.artwork}")` }
          : {}),
      }),
    ]),
  };
}

/** A view decoration, never a mark/node: copy, autosave and source retain text. */
export const IlluminatedInitial = Extension.create<{
  settings: OpeningInitialSettings;
}>({
  name: "illuminatedInitial",

  addOptions() {
    return { settings: { ...DEFAULT_OPENING_INITIAL } };
  },

  addCommands() {
    return {
      setOpeningInitial:
        (settings) =>
        ({ tr, dispatch }) => {
          if (dispatch)
            tr.setMeta(illuminatedInitialPluginKey, {
              type: "settings",
              settings: resolveOpeningInitial({ openingInitial: settings }),
            } satisfies InitialMeta).setMeta("addToHistory", false);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const settings = resolveOpeningInitial({
      openingInitial: this.options.settings,
    });
    return [
      new Plugin<IlluminatedInitialState>({
        key: illuminatedInitialPluginKey,
        state: {
          init: (_, state) => decorate(state.doc, new Set(), settings),
          apply(tr, previous) {
            const meta = tr.getMeta(illuminatedInitialPluginKey) as
              | InitialMeta
              | undefined;
            if (meta?.type === "settings")
              return decorate(tr.doc, previous.loaded, meta.settings);
            if (meta?.type === "loaded")
              return decorate(
                tr.doc,
                new Set([...previous.loaded, meta.artwork]),
                previous.settings,
              );
            return tr.docChanged
              ? decorate(tr.doc, previous.loaded, previous.settings)
              : previous;
          },
        },
        props: {
          attributes(state) {
            const settings =
              illuminatedInitialPluginKey.getState(state)?.settings;
            return {
              "data-opening-initial-mode": settings?.mode ?? "illuminated",
              "data-opening-initial-size": settings?.size ?? "medium",
              "data-opening-initial-collection":
                settings?.collection ?? "botanical",
            };
          },
          decorations: (state) =>
            illuminatedInitialPluginKey.getState(state)?.decorations,
        },
        view(view) {
          const attempted = new Set<string>();
          const pending = new Set<HTMLImageElement>();
          let destroyed = false;
          const preload = () => {
            const artwork = illuminatedInitialPluginKey.getState(view.state)
              ?.initial?.artwork;
            if (!artwork || attempted.has(artwork)) return;
            attempted.add(artwork);
            const image = view.dom.ownerDocument.createElement("img");
            image.decoding = "async";
            pending.add(image);
            let settled = false;
            const done = (loaded: boolean) => {
              if (settled) return;
              settled = true;
              image.onload = image.onerror = null;
              pending.delete(image);
              if (!loaded || destroyed || view.isDestroyed) return;
              view.dispatch(
                view.state.tr
                  .setMeta(illuminatedInitialPluginKey, {
                    type: "loaded",
                    artwork,
                  } satisfies InitialMeta)
                  .setMeta("addToHistory", false),
              );
            };
            image.onload = () => done(image.naturalWidth > 0);
            image.onerror = () => done(false);
            image.src = artwork;
            if (image.complete && image.naturalWidth > 0)
              queueMicrotask(() => done(true));
          };
          preload();
          return {
            update: preload,
            destroy() {
              destroyed = true;
              for (const image of pending) image.onload = image.onerror = null;
              pending.clear();
            },
          };
        },
      }),
    ];
  },
});
