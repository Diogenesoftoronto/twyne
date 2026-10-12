import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";

// Short unwrapped source passages isolate font advances from break choices.
const samples = [
  "ab/".repeat(5),
  "ab:".repeat(5),
  "ab.".repeat(5),
  "arriving/".repeat(4),
  "arriving".repeat(4),
  "/ab".repeat(5),
  "https://twyne.example/arriving/longpath",
  "ab/\u2060".repeat(5),
  "arriving/\u2060".repeat(4),
];

(window as any).twyneLongWordEditor = new Editor({
  element: document.querySelector("#fixture")!,
  extensions: [StarterKit],
  content: samples.map((text) => `<p>${text}</p>`).join(""),
});
