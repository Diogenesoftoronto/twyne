import type { Node as PmNode } from "@tiptap/pm/model";
import { segmentDocument, posAtOffset } from "./living-desk/segment";
import type { ScenePassage, SceneSpan } from "./scene-bench";

export interface InstrumentRoomAnchor {
  folioId: string;
  from: number;
  to: number;
  text: string;
  related?: { from: number; to: number; text: string }[];
}

/** An invitation must still refer to every exact source span it was made from. */
export function instrumentRoomAnchorMatches(
  doc: PmNode,
  folioId: string,
  anchor: InstrumentRoomAnchor,
): boolean {
  if (anchor.folioId !== folioId || !folioId) return false;
  const spans = [anchor, ...(anchor.related ?? [])];
  return (
    spans.length <= 3 &&
    spans.every(
      (span) =>
        Number.isInteger(span.from) &&
        Number.isInteger(span.to) &&
        span.from >= 0 &&
        span.to > span.from &&
        span.to <= doc.content.size &&
        !!span.text.trim() &&
        doc.textBetween(span.from, span.to, "\n\n") === span.text,
    )
  );
}

/** Built only on an explicit instrument request, never on a keystroke. */
function sourceMap(doc: PmNode): {
  text: string;
  starts: number[];
  ends: number[];
} {
  let text = "";
  const starts: number[] = [],
    ends: number[] = [];
  for (const block of segmentDocument(doc).blocks) {
    if (text) {
      text += "\n\n";
      starts.push(-1, -1);
      ends.push(-1, -1);
    }
    text += block.text;
    for (let i = 0; i < block.text.length; i++) {
      starts.push(posAtOffset(block, i));
      ends.push(posAtOffset(block, i + 1, true));
    }
  }
  return { text, starts, ends };
}

export function instrumentPassage(
  doc: PmNode,
  folioId: string,
  range?: { from: number; to: number },
): ScenePassage {
  const map = sourceMap(doc);
  const start = range
    ? map.starts.findIndex((pos) => pos >= range.from && pos < range.to)
    : 0;
  let end = map.text.length;
  if (range) {
    end = -1;
    for (let i = start; i >= 0 && i < map.ends.length; i++)
      if (map.ends[i] > range.from && map.ends[i] <= range.to) end = i + 1;
  }
  if (start < 0 || end <= start)
    return { id: folioId, text: "", sourceOffset: 0 };
  const slice = map.text.slice(start, end);
  const leading = slice.length - slice.trimStart().length;
  return { id: folioId, text: slice.trim(), sourceOffset: start + leading };
}

/** Exact snapshot and offsets prevent a repeated sentence jumping to its twin. */
export function locateInstrumentSpan(
  doc: PmNode,
  folioId: string,
  passage: ScenePassage,
  span: SceneSpan,
): { from: number; to: number } | null {
  const map = sourceMap(doc);
  if (
    folioId !== passage.id ||
    map.text.slice(
      passage.sourceOffset,
      passage.sourceOffset + passage.text.length,
    ) !== passage.text ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > passage.text.length ||
    span.sourceOffset !== passage.sourceOffset + span.start ||
    passage.text.slice(span.start, span.end) !== span.text
  )
    return null;
  const from = map.starts[span.sourceOffset],
    to = map.ends[passage.sourceOffset + span.end - 1];
  return from >= 0 && to > from ? { from, to } : null;
}
