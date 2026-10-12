// Verification only: expose the original editor and its installed parser/state.
export { mountTypstCodeEditor } from "../../../../src/components/editor/typst-code-editor";
export { htmlToTypst } from "../../../../src/utils/typst/document";
export { applyTheme } from "../../../../src/utils/theme";
export { EditorView } from "@codemirror/view";
export { undoDepth, redoDepth } from "@codemirror/commands";
