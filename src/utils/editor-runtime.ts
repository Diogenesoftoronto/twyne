// Fetch the editing engine while the route restores the local draft.
// Imports are cached by the browser; draft and persona data are never cached here.
export function loadEditorRuntime() {
  return import("@tiptap/core");
}
