import { Extension, type CommandProps } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  TextSelection,
  Plugin,
  PluginKey,
  type EditorState,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  DEFAULT_FIND_REPLACE_QUERY,
  compileFindPattern,
  findTextMatches,
  nextMatchIndex,
  previousMatchIndex,
  replacementForMatch,
  wrapMatchIndex,
  type FindReplaceMatch,
  type FindReplaceQuery,
} from "../../../utils/find-replace";

export interface DocumentFindReplaceMatch extends FindReplaceMatch {
  /** ProseMirror document positions. */
  from: number;
  to: number;
}

export interface FindReplacePluginState {
  query: FindReplaceQuery;
  matches: DocumentFindReplaceMatch[];
  activeIndex: number;
  error: string | null;
  decorations: DecorationSet;
}

interface SetQueryMeta {
  type: "setQuery";
  query: FindReplaceQuery;
  preserveActive?: boolean;
}

interface SetActiveMeta {
  type: "setActive";
  activeIndex: number;
}

interface ClearMeta {
  type: "clear";
}

type FindReplaceMeta = SetQueryMeta | SetActiveMeta | ClearMeta;

export const findReplacePluginKey = new PluginKey<FindReplacePluginState>(
  "twyneFindReplace",
);

export function getFindReplaceState(
  state: EditorState,
): FindReplacePluginState | undefined {
  return findReplacePluginKey.getState(state);
}

function queryEquals(a: FindReplaceQuery, b: FindReplaceQuery): boolean {
  return (
    a.search === b.search &&
    a.caseSensitive === b.caseSensitive &&
    a.wholeWord === b.wholeWord &&
    a.regex === b.regex
  );
}

function normaliseQuery(
  search: string,
  options: Partial<Omit<FindReplaceQuery, "search">> = {},
): FindReplaceQuery {
  return {
    search,
    caseSensitive: options.caseSensitive ?? false,
    wholeWord: options.wholeWord ?? false,
    regex: options.regex ?? false,
  };
}

/**
 * Flatten each contiguous run of inline text to find phrases that cross mark
 * boundaries, while deliberately stopping at block and atom boundaries. The
 * position map converts string offsets back into exact ProseMirror ranges.
 */
export function findMatchesInDocument(
  doc: ProseMirrorNode,
  query: FindReplaceQuery,
): { matches: DocumentFindReplaceMatch[]; error: string | null } {
  if (!query.search) return { matches: [], error: null };

  const matches: DocumentFindReplaceMatch[] = [];
  const validation = compileFindPattern(query.search, query);
  if (validation.error) return { matches: [], error: validation.error };

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    let text = "";
    let positions: number[] = [];
    const flushRun = () => {
      if (!text) return;
      const result = findTextMatches(text, query.search, query);
      for (const match of result.matches) {
        // Empty regex matches are useful to the pure utility, but cannot
        // become inline decorations or text selections in ProseMirror.
        if (match.to <= match.from || match.from >= positions.length) continue;
        matches.push({
          ...match,
          from: positions[match.from],
          to: positions[match.to - 1] + 1,
        });
      }
      text = "";
      positions = [];
    };

    node.forEach((child, childPos) => {
      if (!child.isText || !child.text) {
        // A hard break, inline atom, or other leaf is a real content boundary.
        // Searching across it would highlight text the writer cannot select as
        // one ordinary phrase.
        flushRun();
        return;
      }
      const absoluteStart = pos + 1 + childPos;
      for (let offset = 0; offset < child.text.length; offset++) {
        positions.push(absoluteStart + offset);
      }
      text += child.text;
    });
    flushRun();
    return false;
  });

  return { matches, error: null };
}

function buildDecorations(
  doc: ProseMirrorNode,
  matches: readonly DocumentFindReplaceMatch[],
  activeIndex: number,
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class:
          index === activeIndex
            ? "twyne-find-match twyne-find-match-active"
            : "twyne-find-match",
        "data-find-match": String(index + 1),
        style:
          index === activeIndex
            ? "background:#f5bf42;color:inherit;box-shadow:0 0 0 1px #8a5b00;border-radius:2px;"
            : "background:#ffe89a;color:inherit;border-radius:2px;",
      }),
    ),
  );
}

function rebuildState(
  doc: ProseMirrorNode,
  query: FindReplaceQuery,
  preferredIndex: number,
): FindReplacePluginState {
  const result = findMatchesInDocument(doc, query);
  const activeIndex =
    result.matches.length === 0
      ? -1
      : preferredIndex < 0
        ? -1
        : wrapMatchIndex(preferredIndex, result.matches.length);
  return {
    query,
    matches: result.matches,
    activeIndex,
    error: result.error,
    decorations: buildDecorations(doc, result.matches, activeIndex),
  };
}

function selectActiveMatch(
  state: CommandProps["state"],
  dispatch: CommandProps["dispatch"],
  index: number,
): boolean {
  const pluginState = findReplacePluginKey.getState(state);
  if (!pluginState || pluginState.matches.length === 0) return false;
  const activeIndex = wrapMatchIndex(index, pluginState.matches.length);
  const match = pluginState.matches[activeIndex];
  const tr = state.tr
    .setMeta(findReplacePluginKey, {
      type: "setActive",
      activeIndex,
    } satisfies SetActiveMeta)
    .setMeta("addToHistory", false)
    .setSelection(TextSelection.create(state.doc, match.from, match.to))
    .scrollIntoView();
  dispatch?.(tr);
  return true;
}

function insertReplacement(
  tr: CommandProps["tr"],
  state: CommandProps["state"],
  from: number,
  to: number,
  replacement: string,
): void {
  if (replacement.length === 0) tr.delete(from, to);
  else tr.insertText(replacement, from, to);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    findReplace: {
      setFindQuery: (
        search: string,
        options?: Partial<Omit<FindReplaceQuery, "search">>,
      ) => ReturnType;
      clearFindQuery: () => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
}

export const FindReplace = Extension.create({
  name: "findReplace",

  addCommands() {
    return {
      setFindQuery:
        (search, options = {}) =>
        ({ tr, dispatch }: CommandProps) => {
          const query = normaliseQuery(search, options);
          tr.setMeta(findReplacePluginKey, {
            type: "setQuery",
            query,
            preserveActive: true,
          } satisfies SetQueryMeta).setMeta("addToHistory", false);
          dispatch?.(tr);
          return true;
        },

      clearFindQuery:
        () =>
        ({ tr, dispatch }: CommandProps) => {
          tr.setMeta(findReplacePluginKey, {
            type: "clear",
          } satisfies ClearMeta).setMeta("addToHistory", false);
          dispatch?.(tr);
          return true;
        },

      findNext:
        () =>
        ({ state, dispatch }: CommandProps) => {
          const pluginState = findReplacePluginKey.getState(state);
          if (!pluginState || pluginState.matches.length === 0) return false;
          const activeMatch =
            pluginState.activeIndex >= 0
              ? pluginState.matches[pluginState.activeIndex]
              : undefined;
          const selectionIsActive =
            activeMatch != null &&
            state.selection.from === activeMatch.from &&
            state.selection.to === activeMatch.to;
          const index =
            pluginState.activeIndex >= 0
              ? pluginState.activeIndex + (selectionIsActive ? 1 : 0)
              : nextMatchIndex(pluginState.matches, state.selection.to);
          return selectActiveMatch(state, dispatch, index);
        },

      findPrevious:
        () =>
        ({ state, dispatch }: CommandProps) => {
          const pluginState = findReplacePluginKey.getState(state);
          if (!pluginState || pluginState.matches.length === 0) return false;
          const activeMatch =
            pluginState.activeIndex >= 0
              ? pluginState.matches[pluginState.activeIndex]
              : undefined;
          const selectionIsActive =
            activeMatch != null &&
            state.selection.from === activeMatch.from &&
            state.selection.to === activeMatch.to;
          const index =
            pluginState.activeIndex >= 0
              ? pluginState.activeIndex - (selectionIsActive ? 1 : 0)
              : previousMatchIndex(pluginState.matches, state.selection.from);
          return selectActiveMatch(state, dispatch, index);
        },

      replaceCurrent:
        (replacement) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = findReplacePluginKey.getState(state);
          if (!pluginState || pluginState.activeIndex < 0) return false;
          const match = pluginState.matches[pluginState.activeIndex];
          if (!match) return false;
          const resolved = replacementForMatch(
            match.text,
            pluginState.query.search,
            replacement,
            pluginState.query,
          );
          if (resolved.error) return false;

          insertReplacement(
            tr,
            state,
            match.from,
            match.to,
            resolved.replacement,
          );
          tr.setMeta(findReplacePluginKey, {
            type: "setQuery",
            query: pluginState.query,
            preserveActive: true,
          } satisfies SetQueryMeta);
          dispatch?.(tr.scrollIntoView());
          return true;
        },

      replaceAll:
        (replacement) =>
        ({ state, tr, dispatch }: CommandProps) => {
          const pluginState = findReplacePluginKey.getState(state);
          if (!pluginState || pluginState.matches.length === 0) return false;

          for (
            let index = pluginState.matches.length - 1;
            index >= 0;
            index--
          ) {
            const match = pluginState.matches[index];
            const resolved = replacementForMatch(
              match.text,
              pluginState.query.search,
              replacement,
              pluginState.query,
            );
            if (resolved.error) return false;
            insertReplacement(
              tr,
              state,
              match.from,
              match.to,
              resolved.replacement,
            );
          }
          tr.setMeta(findReplacePluginKey, {
            type: "setQuery",
            query: pluginState.query,
            preserveActive: false,
          } satisfies SetQueryMeta);
          dispatch?.(tr.scrollIntoView());
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindReplacePluginState>({
        key: findReplacePluginKey,
        state: {
          init(_, state) {
            return rebuildState(state.doc, DEFAULT_FIND_REPLACE_QUERY, -1);
          },
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(findReplacePluginKey) as
              | FindReplaceMeta
              | undefined;
            if (meta?.type === "clear") {
              return rebuildState(newState.doc, DEFAULT_FIND_REPLACE_QUERY, -1);
            }
            if (meta?.type === "setQuery") {
              const preferred =
                meta.preserveActive && queryEquals(previous.query, meta.query)
                  ? previous.activeIndex
                  : 0;
              return rebuildState(newState.doc, meta.query, preferred);
            }
            if (meta?.type === "setActive") {
              const activeIndex = wrapMatchIndex(
                meta.activeIndex,
                previous.matches.length,
              );
              return {
                ...previous,
                activeIndex,
                decorations: buildDecorations(
                  newState.doc,
                  previous.matches,
                  activeIndex,
                ),
              };
            }
            if (tr.docChanged) {
              return rebuildState(
                newState.doc,
                previous.query,
                previous.activeIndex,
              );
            }
            return previous;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
