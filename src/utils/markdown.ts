/**
 * Safe Markdown → HTML renderer for short prose such as margin comments,
 * persona replies, and inline note bubbles.
 *
 * Backed by [`marked`](https://github.com/markedjs/marked), already a direct
 * dependency (used by `utils/exchange.ts` for paste-import conversion). We
 * instantiate our own `Marked` so we don't mutate the global options the
 * importer relies on.
 *
 * Safety:
 *   - Raw HTML never reaches the DOM. `marked` hands every raw-HTML token
 *     (block or inline) to the `html` renderer, which returns it escaped,
 *     so `<script>` shows as text. Text, code spans and code blocks are
 *     escaped by `marked` itself, and the `text` renderer escapes the text
 *     `marked` would otherwise pass through verbatim after a literal
 *     `<code>` or `<pre>`. Escaping the input *before* parsing, as this
 *     module once did, broke `>` blockquotes and double-escaped code and
 *     link URLs (`don&#39;t`, `a=1&amp;amp;b=2`).
 *   - Links are normalized: any URL that isn't `http:`, `https:`, or
 *     `mailto:` is rewritten to `about:blank`, blocking `javascript:` and
 *     `data:` payloads. Every link gets `target="_blank"` and
 *     `rel="noopener noreferrer"` so a hostile target page can't reach
 *     back into Twyne via `window.opener`. Images render as their alt text
 *     linked the same way, so a note can't load a remote tracker.
 *   - `breaks: true` mirrors GFM-style soft line breaks, which is what
 *     comment authors intuitively expect from short prose.
 *
 * Excerpts (`renderMarkdownExcerpt`) are cut in the token tree, before any
 * HTML exists, so a cut through `**bold**` closes the bold rather than
 * leaking its asterisks, and the output is always well-formed.
 */
import { Marked, type Token } from "marked";

const SAFE_URL = /^(https?:|mailto:)/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(href: string | null | undefined): string {
  if (!href) return "about:blank";
  return SAFE_URL.test(href.trim()) ? href : "about:blank";
}

const md = new Marked({
  gfm: true,
  breaks: true,
  pedantic: false,
  async: false,
});

md.use({
  renderer: {
    /**
     * Override the link renderer so every `[label](url)`:
     *   - has a sanitized `href` (only http/https/mailto allowed)
     *   - opens in a new tab with no referrer / no opener inheritance
     *   - renders any inline Markdown in its label (`**bold**`, `code`,
     *     nested `*italic*`, etc.) for parity with the surrounding prose
     */
    link(token): string {
      const href = safeHref(token.href);
      const titleAttr = token.title
        ? ` title="${escapeHtml(token.title)}"`
        : "";
      const inner = this.parser.parseInline(token.tokens);
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
    /** Remote images would load on render; a note shows the alt text as a link. */
    image(token): string {
      const href = safeHref(token.href);
      const label = escapeHtml(token.text || token.href || "image");
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    /** Raw HTML, block or inline, is shown as the text it is. */
    html(token): string {
      return escapeHtml(token.text);
    },
    /**
     * After a literal `<code>`, `<pre>`, `<kbd>` or `<script>` tag, `marked`
     * flags the following text as already escaped and emits it verbatim,
     * so `<code> <img src=x onerror=…>` would reach the DOM live.
     */
    text(token): string | false {
      if ("escaped" in token && token.escaped && !("tokens" in token))
        return escapeHtml(token.text);
      return false;
    },
  },
});

function normalize(input: string | null | undefined): string {
  return input ? input.replace(/\r\n?/g, "\n").trim() : "";
}

/**
 * Render Markdown to a safe HTML string suitable for use with
 * `dangerouslySetInnerHTML`. Empty / nullish input returns an empty string.
 *
 * Output is guaranteed not to contain raw HTML-special characters from
 * user text, scripts, event-handler attributes, or non-http(s)/mailto
 * URLs. Inline Markdown (bold, italic, code, lists, soft breaks) renders
 * normally.
 */
export function renderMarkdown(input: string | null | undefined): string {
  const text = normalize(input);
  if (!text) return "";
  return md.parse(text) as string;
}

/** Visible characters are counted as graphemes, so an emoji is one and is never split. */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const size = (text: string) => Array.from(graphemes.segment(text)).length;

/** The first `room` graphemes, pulled back to a word boundary when one is near. */
function cutText(text: string, room: number): string {
  const head = Array.from(graphemes.segment(text), (s) => s.segment)
    .slice(0, room)
    .join("");
  const space = head.search(/\s\S*$/);
  return (space > head.length * 0.6 ? head.slice(0, space) : head).trimEnd();
}

const ELLIPSIS = { type: "text", raw: "…", text: "…" } as Token;

interface Budget {
  left: number;
  cut: boolean;
}

function clampTokens(tokens: Token[], budget: Budget): Token[] {
  const kept: Token[] = [];
  for (const token of tokens) {
    if (budget.cut) break;
    kept.push(clampToken(token, budget));
  }
  return kept;
}

/** Spend the budget on a token's visible text; the token that runs out is cut and marked. */
function clampToken(token: Token, budget: Budget): Token {
  if (token.type === "list")
    return { ...token, items: clampTokens(token.items, budget) } as Token;
  // A table or an image is whole or not at all.
  if (token.type === "table" || token.type === "image") {
    const n = size(token.type === "image" ? token.text : token.raw);
    if (n <= budget.left) {
      budget.left -= n;
      return token;
    }
    budget.cut = true;
    return token.type === "image"
      ? ELLIPSIS
      : ({
          type: "paragraph",
          raw: "…",
          text: "…",
          tokens: [ELLIPSIS],
        } as Token);
  }
  if ("tokens" in token && token.tokens)
    return { ...token, tokens: clampTokens(token.tokens, budget) } as Token;
  if ("text" in token && typeof token.text === "string") {
    const n = size(token.text);
    if (n <= budget.left) {
      budget.left -= n;
      return token;
    }
    budget.cut = true;
    return { ...token, text: `${cutText(token.text, budget.left)}…` } as Token;
  }
  return token;
}

/**
 * Render at most `limit` visible characters of Markdown, for a card that
 * previews a note. Formatting survives the cut and the result ends in `…`
 * when anything was left out; the full note is rendered with
 * `renderMarkdown` wherever it is read in full.
 */
export function renderMarkdownExcerpt(
  input: string | null | undefined,
  limit: number,
): string {
  const text = normalize(input);
  if (!text) return "";
  const kept = clampTokens(md.lexer(text), { left: limit, cut: false });
  return md.parser(kept) as string;
}

/** Escape `text` so either renderer shows it exactly as written. */
export function markdownLiteral(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, "\\$&");
}
