import { describe, expect, test } from "bun:test";
import { decodeEntities, htmlToMarkdown, tokenize } from "./html-to-markdown";

/**
 * The converter this replaces called `stripHtml` first, so every inline mark
 * was gone before conversion began. A writer who struck a sentence through and
 * exported to Markdown got the sentence back unmarked — which is what made
 * strikethrough look like a feature that had never been built.
 */
describe("inline marks survive", () => {
  test("bold, italic and strikethrough", () => {
    expect(htmlToMarkdown("<p><strong>bold</strong></p>")).toBe("**bold**");
    expect(htmlToMarkdown("<p><em>italic</em></p>")).toBe("*italic*");
    expect(htmlToMarkdown("<p><s>struck</s></p>")).toBe("~~struck~~");
  });

  test("the tag spellings TipTap and pasted HTML both produce", () => {
    expect(htmlToMarkdown("<p><b>b</b> <i>i</i> <del>d</del></p>")).toBe(
      "**b** *i* ~~d~~",
    );
  });

  test("highlight survives as portable inline HTML", () => {
    expect(htmlToMarkdown('<p><mark data-color="#fbeaa8">lit</mark></p>')).toBe(
      "<mark>lit</mark>",
    );
  });

  test("marks nest", () => {
    expect(
      htmlToMarkdown("<p><strong>bold and <em>italic</em></strong></p>"),
    ).toBe("**bold and *italic***");
  });

  test("inline code is not escaped inside the backticks", () => {
    expect(htmlToMarkdown("<p><code>a*b_c</code></p>")).toBe("`a*b_c`");
  });

  test("links keep their target", () => {
    expect(
      htmlToMarkdown('<p>see <a href="https://twyne.love">the site</a></p>'),
    ).toBe("see [the site](https://twyne.love)");
  });

  test("a link with no href degrades to its text", () => {
    expect(htmlToMarkdown("<p><a>bare</a></p>")).toBe("bare");
  });

  test("superscript survives as inline HTML", () => {
    // GFM has no spelling for it, and dropping the character loses meaning.
    expect(htmlToMarkdown("<p>x<sup>2</sup></p>")).toBe("x<sup>2</sup>");
  });
});

describe("block structure", () => {
  test("headings carry their level", () => {
    expect(htmlToMarkdown("<h1>One</h1><h2>Two</h2><h3>Three</h3>")).toBe(
      "# One\n\n## Two\n\n### Three",
    );
  });

  test("paragraphs are separated by a blank line", () => {
    expect(htmlToMarkdown("<p>One</p><p>Two</p>")).toBe("One\n\nTwo");
  });

  test("a horizontal rule is a rule", () => {
    expect(htmlToMarkdown("<p>a</p><hr><p>b</p>")).toBe("a\n\n---\n\nb");
  });

  test("blockquotes are prefixed", () => {
    expect(htmlToMarkdown("<blockquote><p>quoted</p></blockquote>")).toBe(
      "> quoted",
    );
  });

  test("code blocks are fenced and their contents left alone", () => {
    expect(htmlToMarkdown("<pre><code>const x = *y*;</code></pre>")).toBe(
      "```\nconst x = *y*;\n```",
    );
  });
});

describe("lists", () => {
  test("unordered", () => {
    expect(htmlToMarkdown("<ul><li>one</li><li>two</li></ul>")).toBe(
      "- one\n- two",
    );
  });

  test("ordered lists number themselves", () => {
    expect(htmlToMarkdown("<ol><li>one</li><li>two</li></ol>")).toBe(
      "1. one\n2. two",
    );
  });

  test("an ordered list honours its start attribute", () => {
    expect(htmlToMarkdown('<ol start="3"><li>three</li></ol>')).toBe(
      "3. three",
    );
  });

  test("nesting indents", () => {
    // The case regexes cannot do, and the reason this is a tokenizer.
    const md = htmlToMarkdown("<ul><li>outer<ul><li>inner</li></ul></li></ul>");
    expect(md).toContain("- outer");
    expect(md).toContain("  - inner");
  });

  test("task lists become checkboxes", () => {
    const md = htmlToMarkdown(
      '<ul data-type="taskList">' +
        '<li data-checked="true"><p>done</p></li>' +
        '<li data-checked="false"><p>todo</p></li>' +
        "</ul>",
    );
    expect(md).toContain("- [x] done");
    expect(md).toContain("- [ ] todo");
  });

  test("list items keep their inline marks", () => {
    expect(htmlToMarkdown("<ul><li><strong>bold</strong> item</li></ul>")).toBe(
      "- **bold** item",
    );
  });
});

describe("tables", () => {
  test("a table becomes a GFM pipe table", () => {
    const md = htmlToMarkdown(
      "<table><tbody>" +
        "<tr><th>Name</th><th>Role</th></tr>" +
        "<tr><td>Ada</td><td>Analyst</td></tr>" +
        "</tbody></table>",
    );
    expect(md).toBe("| Name | Role |\n| --- | --- |\n| Ada | Analyst |");
  });

  test("a paragraph inside a cell does not break the row", () => {
    const md = htmlToMarkdown(
      "<table><tbody><tr><td><p>one</p></td><td><p>two</p></td></tr></tbody></table>",
    );
    expect(md).toBe("| one | two |\n| --- | --- |");
  });

  test("a pipe in a cell is escaped rather than breaking the table", () => {
    const md = htmlToMarkdown(
      "<table><tbody><tr><td>a|b</td></tr></tbody></table>",
    );
    expect(md).toContain("a\\|b");
  });

  test("ragged rows are padded to a rectangle", () => {
    const md = htmlToMarkdown(
      "<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>",
    );
    expect(md.split("\n")[2]).toBe("| c |  |");
  });

  test("marks inside cells survive", () => {
    const md = htmlToMarkdown(
      "<table><tbody><tr><td><s>gone</s></td></tr></tbody></table>",
    );
    expect(md).toContain("~~gone~~");
  });

  test("a table caption is preserved immediately before the table", () => {
    const md = htmlToMarkdown(
      "<table><caption>Quarterly totals</caption><tbody>" +
        "<tr><th>Quarter</th><th>Total</th></tr>" +
        "<tr><td>Q1</td><td>12</td></tr></tbody></table>",
    );
    expect(md).toBe(
      "*Quarterly totals*\n\n| Quarter | Total |\n| --- | --- |\n| Q1 | 12 |",
    );
  });
});

describe("images and page breaks", () => {
  test("an image keeps its alt text and source", () => {
    expect(htmlToMarkdown('<p><img src="/a.png" alt="A plate"></p>')).toBe(
      "![A plate](/a.png)",
    );
  });

  test("an image caption remains readable after the image", () => {
    expect(
      htmlToMarkdown(
        '<figure data-type="image"><img src="/a.png" alt="A plate"><figcaption>Figure one</figcaption></figure>',
      ),
    ).toBe("![A plate](/a.png)\n\n*Figure one*");
  });

  test("a base64 image is named rather than pasted", () => {
    // Otherwise a single inlined photograph is megabytes of noise in a file
    // whose whole point is being readable as text.
    const md = htmlToMarkdown(
      '<p><img src="data:image/png;base64,AAAA" alt="x"></p>',
    );
    expect(md).toBe("![x](embedded-image)");
    expect(md).not.toContain("base64");
  });

  test("a page break is dropped rather than mistaken for a rule", () => {
    // `---` is a horizontal rule, which the schema has separately. Emitting
    // one here would put a visible line in the document that the writer
    // never asked for.
    const md = htmlToMarkdown(
      '<p>a</p><div data-page-break="true"></div><p>b</p>',
    );
    expect(md).toBe("a\n\nb");
  });
});

describe("math", () => {
  test("inline math exports as LaTeX delimiters without duplicate source", () => {
    expect(
      htmlToMarkdown(
        '<p>Area is <span data-type="inline-math" data-latex="\\pi r^2">ignored</span>.</p>',
      ),
    ).toBe("Area is $\\pi r^2$.");
  });

  test("block math exports as a display equation", () => {
    expect(
      htmlToMarkdown(
        '<p>Before</p><div data-type="block-math" data-latex="x^2 + y^2">ignored</div><p>After</p>',
      ),
    ).toBe("Before\n\n$$\nx^2 + y^2\n$$\n\nAfter");
  });
});

describe("escaping and entities", () => {
  test("Markdown punctuation in prose is escaped", () => {
    expect(htmlToMarkdown("<p>a * b _ c</p>")).toBe("a \\* b \\_ c");
  });

  test("entities decode", () => {
    expect(decodeEntities("a &amp; b &mdash; c &#39;d&#39;")).toBe(
      "a & b — c 'd'",
    );
  });

  test("a doubly-encoded ampersand decodes only once", () => {
    // &amp; must resolve last, or &amp;lt; becomes a literal "<".
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  test("style and script contents are dropped entirely", () => {
    expect(htmlToMarkdown("<style>p{color:red}</style><p>kept</p>")).toBe(
      "kept",
    );
  });
});

describe("tokenizer", () => {
  test("attributes with > inside quotes do not end the tag", () => {
    const tokens = tokenize('<a title="a > b">x</a>');
    expect(tokens[0].attrs?.title).toBe("a > b");
  });

  test("self-closing and void tags are marked", () => {
    expect(tokenize("<br>")[0].void).toBe(true);
    expect(tokenize("<img />")[0].void).toBe(true);
  });

  test("unclosed tags do not throw", () => {
    expect(() => htmlToMarkdown("<p>dangling")).not.toThrow();
    expect(htmlToMarkdown("<p>dangling")).toBe("dangling");
  });

  test("empty input is empty output", () => {
    expect(htmlToMarkdown("")).toBe("");
  });
});

describe("a realistic manuscript", () => {
  test("everything at once round-trips into readable Markdown", () => {
    const html =
      "<h2>The Argument</h2>" +
      "<p>A <strong>strong</strong> claim, a <em>softer</em> one, and a " +
      "<s>retracted</s> one, with <a href='/notes'>a reference</a>.</p>" +
      "<ul><li>first</li><li>second</li></ul>" +
      "<blockquote><p>Someone else said it better.</p></blockquote>";
    const md = htmlToMarkdown(html);

    expect(md).toContain("## The Argument");
    expect(md).toContain("**strong**");
    expect(md).toContain("*softer*");
    expect(md).toContain("~~retracted~~");
    expect(md).toContain("[a reference](/notes)");
    expect(md).toContain("- first");
    expect(md).toContain("> Someone else said it better.");
  });
});
