import { describe, expect, test } from "bun:test";
import { withEditor } from "../test-harness";
import { BlockMath, InlineMath } from "./math";
import { renderLatex } from "../math/math-renderer";

const extensions = [InlineMath, BlockMath];
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("LaTeX math rendering and editing", () => {
  test("renders valid inline math locally with accessible MathML", async () => {
    const result = await renderLatex("x^2 + y^2", "inline");
    expect(result.error).toBeNull();
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain("<math");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("<link");
  });

  test("reports invalid LaTeX without destroying its raw source", async () => {
    const result = await renderLatex("\\frac{", "block");
    expect(result.html).toBe("");
    expect(result.error).toBeString();
    expect(result.error?.length).toBeGreaterThan(0);
  });

  test("shows a visible recoverable invalid state in the NodeView", async () => {
    await withEditor(
      {
        content:
          '<p><span data-type="inline-math" data-latex="\\frac{">\\frac{</span></p>',
        extensions,
      },
      async ({ host }) => {
        await settle();
        const math = host.querySelector<HTMLElement>(
          '[data-type="inline-math"]',
        );
        expect(math?.getAttribute("data-math-error")).toBe("true");
        expect(math?.textContent).toContain("Invalid LaTeX");
        expect(math?.textContent).toContain("\\frac{");
      },
    );
  });

  test("opens the raw source editor from the keyboard and commits with Enter", async () => {
    await withEditor(
      {
        content: '<p><span data-type="inline-math" data-latex="x">x</span></p>',
        extensions,
      },
      async ({ dom, editor, host }) => {
        await settle();
        const math = host.querySelector<HTMLElement>(
          '[data-type="inline-math"]',
        )!;
        math.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
          }),
        );

        const input = math.querySelector<HTMLTextAreaElement>(
          "[data-math-source-editor] textarea",
        );
        expect(input).not.toBeNull();
        expect(input?.value).toBe("x");

        if (!input) return;
        input.value = "x+1";
        input.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
          }),
        );

        expect(editor.getHTML()).toContain('data-latex="x+1"');
        expect(host.querySelector("[data-math-source-editor]")).toBeNull();
      },
    );
  });

  test("Escape cancels source editing and preserves the original LaTeX", async () => {
    await withEditor(
      {
        content: '<p><span data-type="inline-math" data-latex="x">x</span></p>',
        extensions,
      },
      async ({ dom, editor, host }) => {
        await settle();
        const math = host.querySelector<HTMLElement>(
          '[data-type="inline-math"]',
        )!;
        math.click();

        const input = math.querySelector<HTMLTextAreaElement>("textarea");
        expect(input).not.toBeNull();
        if (!input) return;

        input.value = "discarded";
        input.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
          }),
        );

        expect(editor.getHTML()).toContain('data-latex="x"');
        expect(editor.getHTML()).not.toContain("discarded");
      },
    );
  });

  test("block source editor uses Mod-Enter so ordinary Enter can add lines", async () => {
    await withEditor(
      {
        content:
          '<div data-type="block-math" data-latex="x">x</div><p>After</p>',
        extensions,
      },
      async ({ dom, editor, host }) => {
        await settle();
        const math = host.querySelector<HTMLElement>(
          '[data-type="block-math"]',
        )!;
        math.click();

        const input = math.querySelector<HTMLTextAreaElement>("textarea");
        expect(input).not.toBeNull();
        if (!input) return;

        input.value = String.raw`\begin{aligned}
x &= 1
\end{aligned}`;
        input.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey: true,
            bubbles: true,
          }),
        );

        expect(editor.getHTML()).toContain("\\begin{aligned}");
        expect(host.querySelector("[data-math-source-editor]")).toBeNull();
      },
    );
  });
});
