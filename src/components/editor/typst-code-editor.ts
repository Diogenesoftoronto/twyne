import {
  EditorState,
  EditorSelection,
  Compartment,
  Transaction,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
  undoDepth,
  redoDepth,
  toggleComment,
} from "@codemirror/commands";
import {
  StreamLanguage,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  foldService,
  foldEffect,
  foldGutter,
  codeFolding,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  gotoLine,
} from "@codemirror/search";

export type TypstCodeCommand =
  | "undo"
  | "redo"
  | "find"
  | "goToLine"
  | "comment";
export type TypstSnippet =
  | "bold"
  | "italic"
  | "heading"
  | "equation"
  | "link"
  | "pageBreak";
export interface TypstCodeState {
  line: number;
  column: number;
  lines: number;
  canUndo: boolean;
  canRedo: boolean;
}

const snippets: Record<
  TypstSnippet,
  { before: string; after: string; placeholder: string; block?: boolean }
> = {
  bold: { before: "*", after: "*", placeholder: "bold text" },
  italic: { before: "_", after: "_", placeholder: "italic text" },
  heading: { before: "= ", after: "", placeholder: "Heading", block: true },
  equation: { before: "$ ", after: " $", placeholder: "x^2 + y^2 = z^2" },
  link: {
    before: '#link("https://example.com")[',
    after: "]",
    placeholder: "link text",
  },
  pageBreak: {
    before: "#pagebreak()",
    after: "",
    placeholder: "",
    block: true,
  },
};

const typstLanguage = StreamLanguage.define<{ comment: boolean }>({
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
  startState: () => ({ comment: false }),
  token(stream, state) {
    if (state.comment) {
      if (stream.skipTo("*/")) {
        stream.match("*/");
        state.comment = false;
      } else stream.skipToEnd();
      return "comment";
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.comment = true;
      return "comment";
    }
    if (stream.match(/"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.sol() && stream.match(/=+\s/)) {
      stream.skipToEnd();
      return "heading";
    }
    if (stream.match(/#[a-zA-Z_][\w-]*/)) return "keyword";
    if (
      stream.match(/\b(?:true|false|none|auto|let|set|show|import|include)\b/)
    )
      return "keyword";
    if (stream.match(/\b\d+(?:\.\d+)?(?:pt|em|cm|mm|in|%)?/)) return "number";
    stream.next();
    return null;
  },
});

export function mountTypstCodeEditor(
  element: HTMLElement,
  source: string,
  options: {
    readOnly: boolean;
    onChange(source: string): void;
    onApply(): void;
    onState?(state: TypstCodeState): void;
  },
) {
  const readOnly = new Compartment();
  const wrapping = new Compartment();
  let settingValue = false;
  const reportState = (state: EditorState) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    options.onState?.({
      line: line.number,
      column: head - line.from + 1,
      lines: state.doc.lines,
      canUndo: undoDepth(state) > 0,
      canRedo: redoDepth(state) > 0,
    });
  };
  const view = new EditorView({
    parent: element,
    state: EditorState.create({
      doc: source,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        foldGutter(),
        codeFolding({ placeholderText: "Document helpers" }),
        foldService.of((state, lineStart, lineEnd) => {
          if (
            lineStart !== 0 ||
            state.doc.line(1).text !== "// twyne-document:1"
          )
            return null;
          const end = state.doc.toString().indexOf("// twyne-document:body");
          return end > lineEnd
            ? { from: lineEnd, to: end + "// twyne-document:body".length }
            : null;
        }),
        highlightSelectionMatches(),
        typstLanguage,
        syntaxHighlighting(
          HighlightStyle.define([
            { tag: tags.keyword, color: "var(--color-vermilion)" },
            { tag: tags.string, color: "var(--color-cobalt)" },
            { tag: tags.number, color: "var(--color-writer-note)" },
            { tag: tags.heading, color: "var(--color-ink)", fontWeight: "600" },
            {
              tag: tags.comment,
              color: "var(--color-ink-light)",
              fontStyle: "italic",
            },
          ]),
        ),
        wrapping.of(EditorView.lineWrapping),
        search({ top: true }),
        EditorView.contentAttributes.of({
          "aria-label": "Typst source",
          spellcheck: "false",
        }),
        readOnly.of(EditorState.readOnly.of(options.readOnly)),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              if (!view.state.readOnly) options.onApply();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !settingValue)
            options.onChange(update.state.doc.toString());
          if (
            update.docChanged ||
            update.selectionSet ||
            update.transactions.length
          )
            reportState(update.state);
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            backgroundColor: "var(--color-editor-bg)",
            color: "var(--color-ink)",
            fontSize: "13px",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--font-mono)",
            lineHeight: "1.65",
          },
          ".cm-content": { padding: "1rem 0" },
          ".cm-line": { padding: "0 1rem" },
          ".cm-gutters": {
            backgroundColor: "var(--color-paper-soft)",
            color: "var(--color-ink-light)",
            borderColor: "var(--color-paper-3)",
          },
          ".cm-activeLine, .cm-activeLineGutter": {
            backgroundColor: "var(--color-paper-soft)",
          },
          ".cm-cursor": { borderLeftColor: "var(--color-ink)" },
          ".cm-foldPlaceholder": {
            background: "var(--color-paper-soft)",
            color: "var(--color-ink-light)",
            border: "1px solid var(--color-paper-3)",
            padding: "2px 6px",
            fontFamily: "var(--font-sans)",
            fontSize: "11px",
          },
          "&.cm-focused": {
            outline: "none",
          },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
            {
              backgroundColor:
                "color-mix(in srgb, var(--color-vermilion) 16%, transparent)",
            },
          ".cm-panels": {
            backgroundColor: "var(--color-paper-soft)",
            color: "var(--color-ink)",
            fontFamily: "var(--font-sans)",
          },
          ".cm-panels-top": { borderBottom: "1px solid var(--color-paper-3)" },
          ".cm-search": { padding: ".5rem .75rem", fontSize: "12px" },
          ".cm-textfield": {
            background: "var(--color-paper)",
            color: "var(--color-ink)",
            border: "1px solid var(--color-paper-3)",
            borderRadius: "2px",
          },
          ".cm-button": {
            background: "var(--color-paper)",
            color: "var(--color-ink-light)",
            border: "1px solid var(--color-paper-3)",
            borderRadius: "2px",
            fontSize: "12px",
            textTransform: "none",
          },
          ".cm-button:hover": { background: "var(--color-paper-2)" },
          ".cm-textfield:focus-visible, .cm-button:focus-visible": {
            outline: "2px solid var(--color-vermilion)",
            outlineOffset: "1px",
          },
          ".cm-searchMatch": {
            backgroundColor:
              "color-mix(in srgb, var(--color-mustard) 25%, transparent)",
          },
          ".cm-searchMatch-selected": {
            outline: "1px solid var(--color-vermilion)",
          },
        }),
      ],
    }),
  });
  reportState(view.state);
  return {
    command(command: TypstCodeCommand) {
      if (view.state.readOnly && command !== "find" && command !== "goToLine")
        return;
      const commands = {
        undo,
        redo,
        find: openSearchPanel,
        goToLine: gotoLine,
        comment: toggleComment,
      };
      if (command !== "find" && command !== "goToLine") view.focus();
      commands[command](view);
    },
    insert(kind: TypstSnippet) {
      if (view.state.readOnly) return;
      const snippet = snippets[kind];
      view.dispatch(
        view.state.changeByRange((range) => {
          const selected = view.state.sliceDoc(range.from, range.to);
          const content = selected || snippet.placeholder;
          const prefix =
            snippet.block && range.from > view.state.doc.lineAt(range.from).from
              ? "\n"
              : "";
          const suffix = snippet.block ? "\n" : "";
          const from = range.from + prefix.length + snippet.before.length;
          return {
            changes: {
              from: range.from,
              to: range.to,
              insert:
                prefix + snippet.before + content + snippet.after + suffix,
            },
            range: EditorSelection.range(from, from + content.length),
          };
        }),
        { scrollIntoView: true, userEvent: "input" },
      );
      view.focus();
    },
    setWrapping(value: boolean) {
      view.dispatch({
        effects: wrapping.reconfigure(value ? EditorView.lineWrapping : []),
      });
    },
    setSource(next: string) {
      if (view.state.doc.toString() === next) return;
      const initial = view.state.doc.length === 0;
      settingValue = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
          annotations: Transaction.addToHistory.of(false),
        });
        if (initial && next.startsWith("// twyne-document:1\n")) {
          const end = next.indexOf("// twyne-document:body");
          if (end > 0)
            view.dispatch({
              effects: foldEffect.of({
                from: view.state.doc.line(1).to,
                to: end + "// twyne-document:body".length,
              }),
              selection: {
                anchor: Math.min(
                  next.length,
                  end + "// twyne-document:body".length + 1,
                ),
              },
            });
        }
      } finally {
        settingValue = false;
      }
    },
    setReadOnly(value: boolean) {
      view.dispatch({
        effects: readOnly.reconfigure(EditorState.readOnly.of(value)),
      });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
