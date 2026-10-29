import { describe, expect, test } from "bun:test";
import {
  HOSTILE_NOTE,
  LONG_NOTE,
  LONG_NOTE_TAIL,
  RICH_NOTE,
  STREAMING_REPLY,
} from "./comment-markdown.fixtures";
import {
  markdownLiteral,
  renderMarkdown,
  renderMarkdownExcerpt,
} from "./markdown";

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

  // marked marks text after these tags as pre-escaped and would emit it raw.
  test.each(["<code>", "<pre>\n", "<kbd>", "<script>"])(
    "escapes the text that follows a literal %p tag",
    (tag) => {
      const html = renderMarkdown(`a ${tag} <img/src=x onerror=alert(1)>`);
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img/src=x onerror=alert(1)&gt;");
    },
  );

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

  test("the shared hostile fixture renders as inert text", () => {
    const html = renderMarkdown(HOSTILE_NOTE);
    expect(html).not.toMatch(/<(img|script|svg)\b/);
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/href="data:/);
  });
});

describe("renderMarkdownExcerpt", () => {
  test("renders a note that fits exactly as renderMarkdown does", () => {
    expect(renderMarkdownExcerpt(RICH_NOTE, 280)).toBe(
      renderMarkdown(RICH_NOTE),
    );
  });

  test("keeps every kind of formatting in the shared fixture", () => {
    const html = renderMarkdownExcerpt(RICH_NOTE, 280);
    expect(html).toContain("<strong>Bold claim</strong>");
    expect(html).toContain("<em>aside</em>");
    expect(html).toContain("<code>the_map()</code>");
    expect(html).toContain('href="https://example.com/map?a=1&amp;b=2"');
    expect(html).toContain("🧭<br>A second line");
    expect(html).toContain("<li>second, <strong>stressed</strong></li>");
  });

  test("a cut inside bold closes the bold and leaks no asterisks", () => {
    const html = renderMarkdownExcerpt(LONG_NOTE, 280);
    expect(html).not.toContain("*");
    expect(html).toMatch(/<strong>The inland turn[^<]*…<\/strong><\/p>\n$/);
    expect(html).not.toContain(LONG_NOTE_TAIL);
    expect(renderMarkdown(LONG_NOTE)).toContain(LONG_NOTE_TAIL);
  });

  test("cuts at a word boundary and counts an emoji as one character", () => {
    expect(renderMarkdownExcerpt("one two three four", 11)).toBe(
      "<p>one two…</p>\n",
    );
    expect(renderMarkdownExcerpt("ab🧭👨‍👩‍👧cd", 4)).toBe("<p>ab🧭👨‍👩‍👧…</p>\n");
  });

  test("drops whole list items past the budget", () => {
    const html = renderMarkdownExcerpt("- alpha\n- beta\n- gamma", 7);
    expect(html).toBe("<ul>\n<li>alpha</li>\n<li>be…</li>\n</ul>\n");
    // Spent exactly: what is left out is still marked as left out.
    expect(renderMarkdownExcerpt("- alpha\n- beta\n- gamma", 9)).toBe(
      "<ul>\n<li>alpha</li>\n<li>beta</li>\n<li>…</li>\n</ul>\n",
    );
  });

  test("keeps a table whole or leaves it out", () => {
    const html = renderMarkdownExcerpt(
      "Before.\n\n| a | b |\n|---|---|\n| 1 | 2 |",
      10,
    );
    expect(html).not.toContain("<table>");
    expect(html).toContain("<p>Before.</p>");
    expect(html).toContain("…");
  });

  test("stays inert when cut", () => {
    for (const limit of [5, 40, 80, 160])
      expect(renderMarkdownExcerpt(HOSTILE_NOTE, limit)).not.toMatch(
        /<(img|script|svg)\b|javascript:/,
      );
  });

  test("every prefix of a streaming reply renders without throwing", () => {
    const final = STREAMING_REPLY[STREAMING_REPLY.length - 1];
    for (let i = 1; i <= final.length; i++)
      expect(() => renderMarkdownExcerpt(final.slice(0, i), 420)).not.toThrow();
    expect(renderMarkdownExcerpt(final, 420)).toBe(renderMarkdown(final));
  });
});

describe("markdownLiteral", () => {
  test("shows manuscript text exactly, Markdown characters and all", () => {
    const text = "1984. The *road* - [x](y) # not a heading <b> a_b";
    const html = renderMarkdown(markdownLiteral(text));
    expect(html).toBe(
      "<p>1984. The *road* - [x](y) # not a heading &lt;b&gt; a_b</p>\n",
    );
  });
});
