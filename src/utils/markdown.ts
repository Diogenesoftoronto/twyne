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
 *   - Input is HTML-escaped before `marked` sees it. Without this,
 *     marked v18 would pass raw `<script>` blocks through unchanged.
 *     Pre-escaping guarantees that angle brackets from user text can never
 *     reach the DOM as live tags.
 *   - Links are normalized: any URL that isn't `http:`, `https:`, or
 *     `mailto:` is rewritten to `about:blank`, blocking `javascript:` and
 *     `data:` payloads. Every link gets `target="_blank"` and
 *     `rel="noopener noreferrer"` so a hostile target page can't reach
 *     back into Twyne via `window.opener`.
 *   - `breaks: true` mirrors GFM-style soft line breaks, which is what
 *     comment authors intuitively expect from short prose.
 */
import { Marked, marked as globalMarked } from "marked";

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

/**
 * Render inline-Markdown inside a link label.
 *
 * Marked v18's `parseInline` only accepts string input (a quirk in the
 * bundled build — its parameter guard types as `Token[]` but rejects
 * arrays at runtime). To stay sync and safe we re-parse the label through
 * the block parser and strip the `<p>…</p>` wrapper it adds for single-
 * line input. The label was already HTML-escaped by the caller, so this
 * recursion path is just inline-formatting.
 */
function renderLinkLabel(label: string): string {
  const html = (globalMarked.parse(label, { async: false }) as string).trim();
  return html.replace(/^<p>([\s\S]*)<\/p>\s*$/i, "$1");
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
      const inner = renderLinkLabel(token.text ?? "");
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${inner}</a>`;
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
  // Pre-escape HTML-significant characters so user text can never escape
  // into live markup. Markdown syntax itself doesn't rely on `<`/`>`/`&`
  // (it uses `*`, `_`, `[`, `` ` ``, etc.) so escaping is safe.
  const escaped = escapeHtml(text);
  return md.parse(escaped) as string;
}
