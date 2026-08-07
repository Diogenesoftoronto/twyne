const REASONING_TAG_PATTERN = /<\/?\s*think(?:ing)?\b[^>]*\/?\s*>/gi;
/** Same shape, non-global: `.test` on a `/g` regex carries `lastIndex` state. */
const REASONING_TAG_PROBE = /<\/?\s*think(?:ing)?\b[^>]*\/?\s*>/i;

/**
 * Did the model reach for the reasoning channel at all?
 *
 * A predicate, not a policy. Reasoning is an expected mode — some models open
 * a `<think>` block on every turn by template — so nothing here should be read
 * as grounds for discarding a reply. Generation paths regenerate only when
 * {@link stripReasoningTags} leaves nothing visible.
 *
 * Kept for the places that genuinely need to know: the eval harness, which
 * counts how often a candidate model reasons and whether a tag ever leaks past
 * the stripper into text a reader would see.
 */
export function hasReasoningTags(text: string): boolean {
  return REASONING_TAG_PROBE.test(text);
}

/**
 * Drop a trailing fragment that could still become a reasoning tag.
 *
 * Tags arrive split across chunk boundaries, so a chunk ending in `<th` is
 * ambiguous: it becomes `<think>` or it becomes prose. Painting it and
 * retracting it a moment later flickers, so mid-stream we withhold it. Only
 * meaningful while text is still arriving — a finished string has no next
 * chunk, and whatever trails it is what the model meant.
 */
export function trimPartialReasoningTag(visible: string): string {
  const partial = visible.match(
    /<(?:(?:\/\s*)?t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i,
  );
  if (partial?.index === undefined) return visible;
  return visible.slice(0, partial.index).trim();
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
    const visible = trimPartialReasoningTag(stripReasoningTags(raw));
    if (visible === shown) return null;
    shown = visible;
    return visible;
  };
}

/**
 * Last resort: drop the tag markers and keep everything between them.
 *
 * Only for when both the first reply and its regeneration strip to nothing —
 * an unclosed block that swallowed the answer, usually a generation the token
 * budget cut short. A note with the model's thinking in it still beats a blank
 * card, but the literal `<think>` must never reach the page.
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
