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
  foldGutter,
  codeFolding,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippetCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { TypstSourceError } from "../../utils/typst/client";
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
  | "list"
  | "footnote"
  | "figure"
  | "package"
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
  list: { before: "- ", after: "", placeholder: "List item", block: true },
  footnote: { before: "#footnote[", after: "]", placeholder: "Note text" },
  figure: {
    before: '#figure(image("image.png"), caption: [',
    after: "])",
    placeholder: "Caption",
    block: true,
  },
  package: {
    before: '#import "@preview/',
    after: '"',
    placeholder: "",
    block: true,
  },
  pageBreak: {
    before: "#pagebreak()",
    after: "",
    placeholder: "",
    block: true,
  },
};

interface TypstTokenState {
  comment: number;
  raw: string;
  math: boolean;
  strong: boolean;
  emphasis: boolean;
}

/** Markup, code and math tokens, enough to read a manuscript at a glance. */
const typstLanguage = StreamLanguage.define<TypstTokenState>({
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"', "$"] },
  },
  startState: () => ({
    comment: 0,
    raw: "",
    math: false,
    strong: false,
    emphasis: false,
  }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.comment) {
      while (!stream.eol()) {
        if (stream.match("/*")) state.comment++;
        else if (stream.match("*/")) {
          if (!--state.comment) break;
        } else stream.next();
      }
      return "comment";
    }
    if (state.raw) {
      if (stream.skipTo(state.raw)) {
        stream.match(state.raw);
        state.raw = "";
      } else stream.skipToEnd();
      return "monospace";
    }
    if (state.math) {
      if (stream.match(/^(?:\\.|[^$\\])+/)) return "variableName.special";
      stream.next();
      state.math = false;
      return "variableName.special";
    }
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.comment = 1;
      return "comment";
    }
    if (stream.match(/^\\(?:u\{[\da-fA-F]+\}|.)?/)) return "escape";
    const fence = stream.match(/^`+/) as RegExpMatchArray | null;
    if (fence) {
      state.raw = fence[0];
      if (stream.skipTo(state.raw)) {
        stream.match(state.raw);
        state.raw = "";
      } else stream.skipToEnd();
      return "monospace";
    }
    if (stream.peek() === "$") {
      stream.next();
      state.math = true;
      return "variableName.special";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.sol() && stream.match(/^\s*=+\s/)) {
      stream.skipToEnd();
      return "heading";
    }
    if (stream.sol() && stream.match(/^\s*(?:[-+]|\d+\.|\/)\s/)) return "list";
    if (stream.match(/^<[\w:.-]+>/)) return "labelName";
    if (stream.match(/^@[\w:.-]+/)) return "link";
    if (
      stream.match(
        /^#(?:let|set|show|import|include|if|else|for|while|context|return)\b/,
      )
    )
      return "keyword";
    if (stream.match(/^#[a-zA-Z_][\w-]*(?:\.[a-zA-Z_][\w-]*)*/))
      return "function";
    if (stream.match(/^\b(?:true|false|none|auto)\b/)) return "atom";
    if (stream.match(/^\b\d+(?:\.\d+)?(?:pt|em|cm|mm|in|%|fr|deg)?\b/))
      return "number";
    const ch = stream.next();
    if (ch === "*") {
      state.strong = !state.strong;
      return "strong";
    }
    if (ch === "_" && !/\w/.test(stream.string[stream.pos - 2] ?? "")) {
      state.emphasis = !state.emphasis;
      return "emphasis";
    }
    if (state.strong && state.emphasis) return "strong emphasis";
    if (state.strong) return "strong";
    if (state.emphasis) return "emphasis";
    return null;
  },
  blankLine(state) {
    state.strong = false;
    state.emphasis = false;
  },
  tokenTable: {
    escape: tags.escape,
    labelName: tags.labelName,
    link: tags.link,
    list: tags.list,
    function: tags.function(tags.variableName),
  },
});

/** Typst's most used functions, as fill-in-the-blanks snippets. */
const FUNCTIONS: [string, string, string][] = [
  ["heading", "heading(level: ${1})[${2:Title}]", "Section heading"],
  ["emph", "emph[${1:text}]", "Italic text"],
  ["strong", "strong[${1:text}]", "Bold text"],
  ["underline", "underline[${1:text}]", "Underlined text"],
  ["strike", "strike[${1:text}]", "Struck-through text"],
  ["highlight", "highlight[${1:text}]", "Highlighted text"],
  ["smallcaps", "smallcaps[${1:text}]", "Small capitals"],
  ["super", "super[${1:text}]", "Superscript"],
  ["sub", "sub[${1:text}]", "Subscript"],
  ["link", 'link("${1:https://}")[${2:text}]', "Hyperlink"],
  ["footnote", "footnote[${1:note}]", "Footnote"],
  [
    "quote",
    "quote(block: true, attribution: [${1:Author}])[${2:quotation}]",
    "Block quotation",
  ],
  ["image", 'image("${1:path.png}", width: ${2:100%})', "Image"],
  [
    "figure",
    'figure(${1:image("path.png")}, caption: [${2:Caption}])',
    "Figure with caption",
  ],
  ["table", "table(columns: ${1:2}, [${2:A}], [${3:B}])", "Table"],
  [
    "grid",
    "grid(columns: ${1:2}, gutter: ${2:1em}, [${3}], [${4}])",
    "Layout grid",
  ],
  ["align", "align(${1:center})[${2}]", "Align content"],
  ["block", "block(inset: ${1:1em})[${2}]", "Block container"],
  ["box", "box(${1})[${2}]", "Inline box"],
  ["pad", "pad(${1:x: 1em})[${2}]", "Padding"],
  ["columns", "columns(${1:2})[${2}]", "Multiple columns"],
  ["colbreak", "colbreak()", "Column break"],
  ["pagebreak", "pagebreak()", "Page break"],
  ["linebreak", "linebreak()", "Line break"],
  ["v", "v(${1:1em})", "Vertical space"],
  ["h", "h(${1:1em})", "Horizontal space"],
  ["line", "line(length: ${1:100%})", "Horizontal rule"],
  ["rect", "rect(width: ${1:100%})[${2}]", "Rectangle"],
  ["text", "text(${1:fill: red})[${2}]", "Styled text"],
  ["par", "par(justify: ${1:true})[${2}]", "Paragraph settings"],
  ["outline", "outline()", "Table of contents"],
  ["bibliography", 'bibliography("${1:refs.bib}")', "Bibliography"],
  ["cite", "cite(<${1:key}>)", "Citation"],
  ["lorem", "lorem(${1:50})", "Placeholder text"],
  ["datetime.today", "datetime.today().display()", "Today's date"],
  ["context", "context ${1}", "Read layout state"],
  ["let", "let ${1:name} = ${2:value}", "Define a variable or function"],
  ["set", "set ${1:text}(${2:size: 12pt})", "Set rule: change defaults"],
  [
    "show",
    "show ${1:heading}: ${2:set text(fill: red)}",
    "Show rule: restyle an element",
  ],
  ["import", 'import "@preview/${1}"', "Import a Typst Universe package"],
  ["include", 'include "${1:chapter.typ}"', "Include another file"],
];
const TWYNE_FUNCTIONS: [string, string, string][] = [
  ["twyne-subtitle", "twyne-subtitle[${1}]", "Twyne subtitle"],
  ["twyne-kicker", "twyne-kicker[${1}]", "Twyne kicker"],
  ["twyne-standfirst", "twyne-standfirst[${1}]", "Twyne standfirst"],
  ["twyne-abstract", "twyne-abstract[${1}]", "Twyne abstract"],
  [
    "twyne-epigraph",
    "twyne-epigraph(attribution: [${1}])[${2}]",
    "Twyne epigraph",
  ],
  [
    "twyne-scene-break",
    'twyne-scene-break(style: "${1:ornament}")',
    "Twyne scene break",
  ],
  ["twyne-endnote", "twyne-endnote[${1}]", "Twyne endnote"],
];
const functionCompletions: Completion[] = [
  ...FUNCTIONS.map(([label, template, detail]) =>
    snippetCompletion(template, { label, detail, type: "function" }),
  ),
  ...TWYNE_FUNCTIONS.map(([label, template, detail]) =>
    snippetCompletion(template, {
      label,
      detail,
      type: "function",
      boost: -1,
    }),
  ),
];

function functionSource(context: CompletionContext) {
  const word = context.matchBefore(/#[\w.-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from + 1,
    options: functionCompletions,
    validFor: /^[\w.-]*$/,
  };
}

async function packageSource(context: CompletionContext) {
  const word = context.matchBefore(/"@preview\/[\w-]*(?::[\d.]*)?/);
  if (!word) return null;
  const { loadTypstPackageIndex } = await import("../../utils/typst/packages");
  const packages = await loadTypstPackageIndex().catch(() => []);
  return {
    from: word.from + '"@preview/'.length,
    options: packages.map(
      (pkg): Completion => ({
        label: pkg.name,
        detail: pkg.version,
        info: pkg.description,
        apply: (view, _completion, from, to) => {
          const closed = view.state.sliceDoc(to, to + 1) === '"';
          const insert = `${pkg.name}:${pkg.version}${closed ? "" : '"'}`;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length + (closed ? 1 : 0) },
            userEvent: "input.complete",
          });
        },
        type: "namespace",
      }),
    ),
    validFor: /^[\w-]*$/,
  };
}

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
        codeFolding(),
        closeBrackets(),
        autocompletion({
          override: [packageSource, functionSource],
          icons: false,
        }),
        lintGutter(),
        highlightSelectionMatches(),
        typstLanguage,
        syntaxHighlighting(
          HighlightStyle.define([
            { tag: tags.keyword, color: "var(--color-vermilion)" },
            {
              tag: tags.function(tags.variableName),
              color: "var(--color-vermilion)",
            },
            { tag: tags.atom, color: "var(--color-writer-note)" },
            { tag: tags.escape, color: "var(--color-ink-light)" },
            { tag: tags.monospace, color: "var(--color-cobalt)" },
            {
              tag: tags.special(tags.variableName),
              color: "var(--color-writer-note)",
            },
            { tag: [tags.labelName, tags.link], color: "var(--color-cobalt)" },
            { tag: tags.list, color: "var(--color-vermilion)" },
            { tag: tags.strong, fontWeight: "700" },
            { tag: tags.emphasis, fontStyle: "italic" },
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
          ...closeBracketsKeymap,
          ...completionKeymap,
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
          ".cm-tooltip": {
            backgroundColor: "var(--color-paper)",
            color: "var(--color-ink)",
            border: "1px solid var(--color-paper-3)",
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
          },
          ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
            backgroundColor:
              "color-mix(in srgb, var(--color-vermilion) 16%, transparent)",
            color: "var(--color-ink)",
          },
          ".cm-completionDetail": {
            color: "var(--color-ink-light)",
            fontStyle: "normal",
            marginLeft: "0.75em",
          },
          ".cm-completionInfo": { maxWidth: "22rem", padding: "6px 9px" },
          ".cm-diagnostic-error": {
            borderLeftColor: "var(--color-vermilion)",
          },
          ".cm-lintRange-error": {
            backgroundImage: "none",
            textDecoration: "underline wavy var(--color-vermilion) 1px",
            textUnderlineOffset: "3px",
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
      if (kind === "package") startCompletion(view);
    },
    /** Mark compiler errors on the lines the author wrote. */
    setErrors(errors: TypstSourceError[]) {
      const doc = view.state.doc;
      const position = (line: number, column: number) => {
        if (line < 1 || line > doc.lines) return null;
        const at = doc.line(line);
        return Math.min(at.to, at.from + Math.max(0, column - 1));
      };
      const diagnostics: Diagnostic[] = errors.flatMap((error) => {
        const from = position(error.line, error.column);
        if (from === null) return [];
        const to = position(error.endLine, error.endColumn) ?? from;
        return [
          {
            from,
            to: Math.max(from, to),
            severity: "error",
            message: error.message.replace(/, hints: /, "\nHint: "),
          },
        ];
      });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
    setWrapping(value: boolean) {
      view.dispatch({
        effects: wrapping.reconfigure(value ? EditorView.lineWrapping : []),
      });
    },
    setSource(next: string) {
      if (view.state.doc.toString() === next) return;
      settingValue = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
          annotations: Transaction.addToHistory.of(false),
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
