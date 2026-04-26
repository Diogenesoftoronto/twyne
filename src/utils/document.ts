import type { DocumentMeta } from "../types";

export function computeDocumentMeta(text: string): DocumentMeta {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const characterCount = text.length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 238));

  return {
    title: extractTitle(text),
    wordCount,
    characterCount,
    readingTime,
    lastEdited: Date.now(),
  };
}

function extractTitle(text: string): string {
  const firstLine = text.split("\n")[0]?.trim() || "";
  if (firstLine.startsWith("# ")) {
    return firstLine.replace(/^#+\s*/, "");
  }
  const firstSentence = firstLine.split(/[.!?]/)[0] || "";
  return firstSentence.length > 60
    ? firstSentence.slice(0, 57) + "..."
    : firstSentence || "Untitled";
}

export function formatWordCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

export function readingTimeLabel(minutes: number): string {
  if (minutes < 1) return "< 1 min read";
  if (minutes === 1) return "1 min read";
  return `${minutes} min read`;
}
