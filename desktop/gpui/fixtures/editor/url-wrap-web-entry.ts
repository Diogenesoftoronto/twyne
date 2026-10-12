import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";

// Source-only paragraphs exercise the original editor's inherited CSS.
// Paired auto/manual rows isolate dictionary-related URL line tailoring.
const path = "longpath".repeat(24);
const cases = [
  ["", `Prefix https://twyne.example/${path}?query=${"v".repeat(90)} tail.`],
  [
    "hyphens: manual",
    `Prefix https://twyne.example/${path}?query=${"v".repeat(90)} tail.`,
  ],
  ["", `Prefix twyne.example/${path} tail.`],
  ["hyphens: manual", `Prefix twyne.example/${path} tail.`],
  ["", `Prefix /${path}/part tail.`],
  ["hyphens: manual", `Prefix /${path}/part tail.`],
  ["", `Prefix ${"ab/".repeat(55)}ending tail.`],
  ["", `Prefix ${"ab.".repeat(55)}ending tail.`],
  ["", `Prefix ${"ab:".repeat(55)}ending tail.`],
  ["", `Prefix https://twyne.example/short/${"東京/".repeat(28)} tail.`],
  ["", `Prefix https://twyne.example/arriving/${path} tail.`],
  ["", `Prefix arriving/${path} tail.`],
  ["", `Prefix ${"arriving/".repeat(24)} tail.`],
  ["", `Prefix ${"arriving-".repeat(24)} tail.`],
];

(window as any).twyneLongWordEditor = new Editor({
  element: document.querySelector("#fixture")!,
  extensions: [StarterKit],
  content: cases
    .map(([style, text]) => `<p${style ? ` style="${style}"` : ""}>${text}</p>`)
    .join(""),
});
