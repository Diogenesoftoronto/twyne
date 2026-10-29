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
 *     escaped by `marked` itself. Escaping the input *before* parsing, as
 *     this module once did, broke `>` blockquotes and double-escaped code
 *     and link URLs (`don&#39;t`, `a=1&amp;amp;b=2`).
 *   - Links are normalized: any URL that isn't `http:`, `https:`, or
 *     `mailto:` is rewritten to `about:blank`, blocking `javascript:` and
 *     `data:` payloads. Every link gets `target="_blank"` and
 *     `rel="noopener noreferrer"` so a hostile target page can't reach
 *     back into Twyne via `window.opener`. Images render as their alt text
 *     linked the same way, so a note can't load a remote tracker.
 *   - `breaks: true` mirrors GFM-style soft line breaks, which is what
 *     comment authors intuitively expect from short prose.
 */
import { Marked } from "marked";

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
  },
});

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
  if (!input) return "";
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  return md.parse(text) as string;
}
