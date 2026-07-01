import { stripReasoningTags } from "./reasoning-tags";

export interface TaggedJsonSegment {
  value: unknown;
  start: number;
  end: number;
}

export function stripJsonFences(text: string): string {
  return text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

export function extractFirstJsonObject(text: string): string | null {
  const open = text.indexOf("{");
  if (open < 0) return null;
  const end = findJsonObjectEnd(text, open);
  return end === null ? null : text.slice(open, end + 1);
}

export function extractTaggedJson(
  text: string,
  tag: "DOSSIER" | "SYNTHESIZE",
): TaggedJsonSegment | null {
  const marker = new RegExp(`${tag}:`, "i").exec(text);
  if (!marker) return null;
  const open = text.indexOf("{", marker.index + marker[0].length);
  if (open < 0) return null;
  const end = findJsonObjectEnd(text, open);
  if (end === null) return null;
  try {
    return {
      value: JSON.parse(text.slice(open, end + 1)),
      start: marker.index,
      end: end + 1,
    };
  } catch {
    return null;
  }
}

export function stripTaggedJson(
  text: string,
  segment: Pick<TaggedJsonSegment, "start" | "end">,
): string {
  return `${text.slice(0, segment.start)}${text.slice(segment.end)}`.trim();
}

export function parseJudgeOutput(
  text: string,
): { score: number; rationale: string } | null {
  const stripped = stripJsonFences(stripReasoningTags(text));
  const candidate = extractFirstJsonObject(stripped) ?? stripped;
  try {
    const obj = JSON.parse(candidate) as {
      score?: unknown;
      rationale?: unknown;
    };
    if (typeof obj.score === "number" && typeof obj.rationale === "string") {
      return { score: clampScore(obj.score), rationale: obj.rationale };
    }
  } catch {
    // Fall through to the looser parser below.
  }
  const scoreMatch = candidate.match(/"?score"?\s*[:=]\s*(\d+)/i);
  const rationaleMatch = candidate.match(/"?rationale"?\s*[:=]\s*"([^"]+)"/i);
  if (scoreMatch) {
    return {
      score: clampScore(parseInt(scoreMatch[1], 10)),
      rationale:
        rationaleMatch?.[1] ??
        "The draft does part of the work and leaves the rest to the writer.",
    };
  }
  return null;
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 5;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function findJsonObjectEnd(text: string, open: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}
