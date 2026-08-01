const REASONING_TAG_PATTERN = /<\/?\s*think(?:ing)?\b[^>]*\/?\s*>/gi;
/** Same shape, non-global: `.test` on a `/g` regex carries `lastIndex` state. */
const REASONING_TAG_PROBE = /<\/?\s*think(?:ing)?\b[^>]*\/?\s*>/i;

/**
 * Did the model reach for the reasoning channel at all?
 *
 * Callers use this to throw the whole reply away and ask again rather than
 * salvage it. Stripping recovers the visible half of a well-formed answer,
 * but a model that narrated its thinking mid-sentence leaves prose with the
 * seams showing — and an editor's note is short enough that a second call is
 * cheaper than a bad one.
 */
export function hasReasoningTags(text: string): boolean {
  return REASONING_TAG_PROBE.test(text);
}

/**
 * The streaming companion to {@link stripReasoningTags}.
 *
 * Returns a `push` that takes the next chunk and gives back the visible text
 * so far — or `null` when nothing visible changed, so a caller can skip the
 * repaint. It re-strips the whole accumulated string on every chunk rather
 * than filtering chunk by chunk, because a delta cannot be judged on its own:
 * tags arrive split across chunk boundaries, and an unclosed `<think>` has to
 * retract everything after it, including text already emitted.
 */
export function createVisibleTextFilter(): (delta: string) => string | null {
  let raw = "";
  let shown = "";
  return (delta: string) => {
    raw += delta;
    let visible = stripReasoningTags(raw);
    if (!hasReasoningTags(raw)) {
      // A tag may be split across chunks. Do not paint a trailing prefix that
      // could still become `<think>` or `</thinking>` on the next chunk.
      const partialTag = visible.match(/<(?:(?:\/\s*)?t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i);
      if (partialTag?.index !== undefined) {
        visible = visible.slice(0, partialTag.index).trim();
      }
    }
    if (visible === shown) return null;
    shown = visible;
    return visible;
  };
}

/**
 * Last resort: drop the tag markers and keep everything between them.
 *
 * Only for when both the first reply and its regeneration strip to nothing —
 * a note with the model's thinking in it still beats a blank card, but the
 * literal `<think>` must never reach the page.
 */
export function removeReasoningTagMarkers(text: string): string {
  return text.replace(REASONING_TAG_PATTERN, "").trim();
}

/**
 * Remove hidden chain-of-thought blocks emitted by reasoning models.
 *
 * Some OpenAI-compatible providers close reasoning with malformed self-closing
 * tags such as `<think/>`; treat those as closers when a block is open.
 */
export function stripReasoningTags(text: string): string {
  let visible = "";
  let cursor = 0;
  let depth = 0;

  for (const match of text.matchAll(REASONING_TAG_PATTERN)) {
    const tag = match[0];
    const index = match.index ?? 0;
    if (depth === 0) {
      visible += text.slice(cursor, index);
    }

    const normalized = tag.toLowerCase().replace(/\s+/g, "");
    const isClosing = normalized.startsWith("</") || normalized.endsWith("/>");
    if (isClosing) {
      depth = Math.max(0, depth - 1);
    } else {
      depth += 1;
    }

    cursor = index + tag.length;
  }

  if (depth === 0) {
    visible += text.slice(cursor);
  }

  return visible
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
