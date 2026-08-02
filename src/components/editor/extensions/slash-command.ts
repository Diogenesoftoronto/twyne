import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface SlashCommandState {
  open: boolean;
  query: string;
  /** Range containing the slash and query, removed before command execution. */
  from: number;
  to: number;
}

const CLOSED: SlashCommandState = { open: false, query: "", from: 0, to: 0 };
export const slashCommandPluginKey = new PluginKey<SlashCommandState>(
  "slashCommand",
);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    slashCommand: {
      closeSlashCommand: () => ReturnType;
      removeSlashCommandQuery: () => ReturnType;
    };
  }
}

function stateAtCursor(state: {
  selection: { empty: boolean; from: number; $from: any };
}): SlashCommandState {
  const selection = state.selection;
  if (!selection.empty) return CLOSED;
  const $from = selection.$from;
  if (!$from.parent.isTextblock) return CLOSED;
  const before = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "\0",
  );
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  if (!match) return CLOSED;
  const query = match[1] ?? "";
  const slashOffset = before.length - query.length - 1;
  return {
    open: true,
    query,
    from: $from.start() + slashOffset,
    to: selection.from,
  };
}

/**
 * Detects a slash query without adding content or decorations to the document.
 *
 * The UI reads plugin state and executes registry command IDs. When a command
 * is chosen, `removeSlashCommandQuery` removes only `/query`; the command then
 * acts at the retained cursor position.
 */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addCommands() {
    return {
      closeSlashCommand:
        () =>
        ({ tr }: CommandProps) => {
          tr.setMeta(slashCommandPluginKey, { close: true });
          return true;
        },
      removeSlashCommandQuery:
        () =>
        ({ state, tr, dispatch }: CommandProps) => {
          const current = slashCommandPluginKey.getState(state);
          if (!current?.open) return false;
          tr.delete(current.from, current.to);
          tr.setMeta(slashCommandPluginKey, { close: true });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Escape: () => {
        const current = slashCommandPluginKey.getState(this.editor.state);
        if (!current?.open) return false;
        return this.editor.commands.closeSlashCommand();
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SlashCommandState>({
        key: slashCommandPluginKey,
        state: {
          init: (_, state) => stateAtCursor(state),
          apply: (tr, previous, _oldState, newState) => {
            if (tr.getMeta(slashCommandPluginKey)?.close) return CLOSED;
            if (!tr.docChanged && !tr.selectionSet) return previous;
            return stateAtCursor(newState);
          },
        },
      }),
    ];
  },
});

export function getSlashCommandState(
  state: Parameters<typeof slashCommandPluginKey.getState>[0],
): SlashCommandState {
  return slashCommandPluginKey.getState(state) ?? CLOSED;
}
