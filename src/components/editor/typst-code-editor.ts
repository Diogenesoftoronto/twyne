import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  StreamLanguage,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";

const typstLanguage = StreamLanguage.define<{ comment: boolean }>({
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
  },
) {
  const readOnly = new Compartment();
  let settingValue = false;
  const view = new EditorView({
    parent: element,
    state: EditorState.create({
      doc: source,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        highlightSelectionMatches(),
        typstLanguage,
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Typst source",
          spellcheck: "false",
        }),
        readOnly.of(EditorState.readOnly.of(options.readOnly)),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              options.onApply();
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
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            backgroundColor: "var(--color-paper)",
            color: "var(--color-ink)",
            fontSize: "13px",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--font-typewriter, monospace)",
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
          "&.cm-focused": {
            outline: "2px solid var(--color-cobalt)",
            outlineOffset: "-2px",
          },
        }),
      ],
    }),
  });
  return {
    setSource(next: string) {
      if (view.state.doc.toString() === next) return;
      settingValue = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
        });
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
