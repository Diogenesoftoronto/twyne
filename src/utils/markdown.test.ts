import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  test("returns empty string for empty / nullish input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n  ")).toBe("");
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
  });

  test("wraps a single line in a paragraph", () => {
    expect(renderMarkdown("Hello there.")).toBe("<p>Hello there.</p>\n");
  });

  test("splits paragraphs on blank lines", () => {
    expect(renderMarkdown("First paragraph.\n\nSecond paragraph.")).toBe(
      "<p>First paragraph.</p>\n<p>Second paragraph.</p>\n",
    );
  });

  test("soft line breaks inside a paragraph become <br>", () => {
    expect(renderMarkdown("line one\nline two")).toBe(
      "<p>line one<br>line two</p>\n",
    );
  });

  test("renders bold and italic", () => {
    expect(renderMarkdown("**bold** and *italic* and _also italic_.")).toBe(
      "<p><strong>bold</strong> and <em>italic</em> and <em>also italic</em>.</p>\n",
    );
  });

  test("renders inline code without further interpretation", () => {
    expect(renderMarkdown("run `npm install` first")).toBe(
      "<p>run <code>npm install</code> first</p>\n",
    );
  });

  test("inline code protects Markdown inside backticks", () => {
    expect(renderMarkdown("here is `**not bold**` text")).toBe(
      "<p>here is <code>**not bold**</code> text</p>\n",
    );
  });

  test("renders safe https links with the right attributes", () => {
    const html = renderMarkdown("see [docs](https://example.com/docs)");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">docs</a>");
  });

  test("rejects javascript: links with about:blank", () => {
    const html = renderMarkdown("[evil](javascript:alert(1))");
    expect(html).toContain('href="about:blank"');
    expect(html).toContain(">evil</a>");
  });

  test("rejects data: links with about:blank", () => {
    const html = renderMarkdown("[leak](data:text/html,<script>1</script>)");
    expect(html).toContain('href="about:blank"');
    expect(html).toContain(">leak</a>");
  });

  test("escapes raw HTML rather than passing it through", () => {
    const html = renderMarkdown("<script>alert('x')</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&#39;x&#39;");
  });

  test("renders unordered lists", () => {
    expect(renderMarkdown("- apples\n- pears\n- figs")).toBe(
      "<ul>\n<li>apples</li>\n<li>pears</li>\n<li>figs</li>\n</ul>\n",
    );
  });

  test("renders ordered lists", () => {
    expect(renderMarkdown("1. first\n2. second\n3. third")).toBe(
      "<ol>\n<li>first</li>\n<li>second</li>\n<li>third</li>\n</ol>\n",
    );
  });

  test("mixes lists and paragraphs across blocks", () => {
    const html = renderMarkdown("Intro paragraph.\n\n- a\n- b\n\nClosing paragraph.");
    expect(html).toContain("<p>Intro paragraph.</p>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<li>b</li>");
    expect(html).toContain("<p>Closing paragraph.</p>");
  });

  test("handles CRLF input as if normalized", () => {
    const html = renderMarkdown("first\r\n\r\nsecond\r\n");
    expect(html).toContain("<p>first</p>");
    expect(html).toContain("<p>second</p>");
  });
});
