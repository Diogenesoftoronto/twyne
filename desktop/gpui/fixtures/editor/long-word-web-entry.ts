import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
const words = [
  "Prefix " + "x".repeat(91) + " tail.",
  "Prefix https://twyne.example/" +
    "longpath".repeat(24) +
    "?query=" +
    "v".repeat(90) +
    " tail.",
  "Prefix " + "e\u0301".repeat(120) + " tail.",
  "Prefix " + "👩🏽‍💻".repeat(40) + " tail.",
  "Prefix " + "東京".repeat(50) + " tail.",
];
(window as any).twyneLongWordEditor = new Editor({
  element: document.querySelector("#fixture")!,
  extensions: [StarterKit],
  content: words
    .map((word) => `<p style="text-align:left">${word}</p>`)
    .join(""),
});
