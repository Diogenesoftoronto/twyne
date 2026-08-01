import { stripReasoningTags } from "./reasoning-tags";

export type InterviewStreamPhase = "reasoning" | "answer";

export interface InterviewStreamSnapshot {
  text: string;
  reasoning: string;
  phase: InterviewStreamPhase;
}

const CONTRACT_TAGS = ["DOSSIER", "PROBE", "SYNTHESIZE"] as const;
const CONTRACT_MARKER = new RegExp(
  `(?:^|\\n)\\s*(?:${CONTRACT_TAGS.join("|")}):`,
  "i",
);
const PARTIAL_CONTRACT_MARKER = new RegExp(
  `\\n\\s*(?:${CONTRACT_TAGS.map((tag) =>
    Array.from({ length: tag.length }, (_, index) => tag.slice(0, index + 1)),
  )
    .flat()
    .join("|")})$`,
  "i",
);
const THINK_TAG = /<\/?\s*think(?:ing)?\b[^>]*\/?\s*>/gi;

export function hasOpenReasoningBlock(text: string): boolean {
  let depth = 0;
  for (const match of text.matchAll(THINK_TAG)) {
    const normalized = match[0].toLowerCase().replace(/\s+/g, "");
    const closing = normalized.startsWith("</") || normalized.endsWith("/>");
    depth = closing ? Math.max(0, depth - 1) : depth + 1;
  }
  return depth > 0;
}

/**
 * Extract model-authored reasoning from XML-style thinking blocks.
 *
 * Some OpenAI-compatible providers deliver reasoning in the text channel
 * instead of as native `reasoning-delta` parts. The final, unclosed block is
 * included while streaming so the writer can see the reasoning as it arrives.
 */
export function extractTaggedReasoning(text: string): string {
  let reasoning = "";
  let cursor = 0;
  let depth = 0;

  for (const match of text.matchAll(THINK_TAG)) {
    const tag = match[0];
    const index = match.index ?? 0;
    if (depth > 0) reasoning += text.slice(cursor, index);

    const normalized = tag.toLowerCase().replace(/\s+/g, "");
    const closing = normalized.startsWith("</") || normalized.endsWith("/>");
    depth = closing ? Math.max(0, depth - 1) : depth + 1;
    cursor = index + tag.length;
  }

  if (depth > 0) reasoning += text.slice(cursor);
  return reasoning
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert raw provider output into the two parts the interview UI renders.
 *
 * The structured DOSSIER/PROBE/SYNTHESIZE contract is intentionally withheld
 * from the chat bubble, including partial tag names at the end of a chunk, so
 * JSON never flashes on screen while the response streams.
 */
export function createInterviewStreamSnapshot(
  rawText: string,
  nativeReasoning = "",
): InterviewStreamSnapshot {
  const taggedReasoning = extractTaggedReasoning(rawText);
  const reasoning = [nativeReasoning.trim(), taggedReasoning]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("\n\n");

  let visible = stripReasoningTags(rawText);
  const marker = CONTRACT_MARKER.exec(visible);
  if (marker?.index !== undefined) {
    visible = visible.slice(0, marker.index);
  } else {
    const partial = PARTIAL_CONTRACT_MARKER.exec(`\n${visible}`);
    if (partial?.index !== undefined) {
      visible = `\n${visible}`.slice(0, partial.index);
    }
  }

  visible = visible.trim();
  return {
    text: visible,
    reasoning,
    phase: visible ? "answer" : "reasoning",
  };
}
