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
    const html = renderMarkdown(
      "Intro paragraph.\n\n- a\n- b\n\nClosing paragraph.",
    );
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

  test("renders blockquotes rather than a literal >", () => {
    const html = renderMarkdown("> She said no.\n\nThen left.");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("&gt; She");
  });

  test("escapes code once, not twice", () => {
    expect(renderMarkdown("say `don't <b>`")).toBe(
      "<p>say <code>don&#39;t &lt;b&gt;</code></p>\n",
    );
    expect(renderMarkdown("```\na < b && c\n```")).toContain(
      "a &lt; b &amp;&amp; c",
    );
  });

  test("keeps query strings in links intact", () => {
    expect(renderMarkdown("[q](https://x.com/?a=1&b=2)")).toContain(
      'href="https://x.com/?a=1&amp;b=2"',
    );
  });

  test("renders headings, rules, tables and strikethrough", () => {
    const html = renderMarkdown(
      "## Pace\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~cut~~",
    );
    expect(html).toContain("<h2>Pace</h2>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<table>");
    expect(html).toContain("<del>cut</del>");
  });

  test("escapes inline raw HTML and event handlers", () => {
    const html = renderMarkdown('a <img src=x onerror="alert(1)"> b');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("renders images as a safe link, never a remote load", () => {
    const html = renderMarkdown("![chart](https://t.example/p.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://t.example/p.png"');
    expect(html).toContain(">chart</a>");
  });

  test("renders inline Markdown inside link labels", () => {
    expect(renderMarkdown("[**bold** `c`](https://x.com)")).toContain(
      "><strong>bold</strong> <code>c</code></a>",
    );
  });
});
