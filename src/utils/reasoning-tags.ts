const REASONING_TAG_PATTERN = /<\/?\s*think(?:ing)?\b[^>]*\/?\s*>/gi;

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
