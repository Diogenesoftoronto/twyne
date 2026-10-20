/**
 * Gathering connected passages into one read-only view.
 *
 * A margin card, an edge marker or a thread can ask to see every passage it
 * is connected to side by side. Each passage is a live DOM range in the
 * manuscript; the view reads its paragraph for context and never writes.
 */

export const PASSAGE_GATHER_EVENT = "twyne:passage-gather";

export interface GatherPassage {
  /** Stable within one gathering. */
  id: string;
  /** Who or what points at this passage: "Margin note · Ada". */
  label: string;
  color: string;
  range: Range;
  /** What the note or relation says about this passage, verbatim. */
  notes?: string[];
  /** Take the writer to the passage; defaults to selecting `range`. */
  go?: () => void;
}

export interface GatherRequest {
  title: string;
  /** The note or relation that connects the passages, verbatim. */
  note?: string;
  passages: GatherPassage[];
  /** The element that asked, to take focus back on close. */
  opener?: HTMLElement | null;
  /** Start from the passages' places in the page, if motion is allowed. */
  animate?: boolean;
}

export interface PassageExcerpt {
  before: string;
  match: string;
  after: string;
  /** 0..1 position of the passage in the whole manuscript. */
  at: number;
}

const BLOCKS = "p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, figcaption";

/** Keep the end of `before` and the start of `after`, at a word boundary. */
export function trimContext(
  before: string,
  after: string,
  room = 220,
): { before: string; after: string } {
  const cutStart = (text: string) => {
    if (text.length <= room) return text;
    const slice = text.slice(text.length - room);
    const space = slice.indexOf(" ");
    return `…${space > 0 && space < 40 ? slice.slice(space + 1) : slice}`;
  };
  const cutEnd = (text: string) => {
    if (text.length <= room) return text;
    const slice = text.slice(0, room);
    const space = slice.lastIndexOf(" ");
    return `${space > room - 40 ? slice.slice(0, space) : slice}…`;
  };
  return { before: cutStart(before), after: cutEnd(after) };
}

/** Where a passage sits in the document: 0 at the top, 1 at the end. */
export function documentFraction(
  top: number,
  docTop: number,
  docHeight: number,
): number {
  if (!(docHeight > 0)) return 0;
  return Math.min(1, Math.max(0, (top - docTop) / docHeight));
}

/** The passage with the rest of its paragraph around it. */
export function excerptFromRange(range: Range, doc: Element): PassageExcerpt {
  const match = range.toString();
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const block = start?.closest(BLOCKS);
  let before = "",
    after = "";
  if (block && doc.contains(block)) {
    const head = document.createRange();
    head.selectNodeContents(block);
    head.setEnd(range.startContainer, range.startOffset);
    before = head.toString();
    const tail = document.createRange();
    tail.selectNodeContents(block);
    if (block.contains(range.endContainer))
      tail.setStart(range.endContainer, range.endOffset);
    else tail.collapse(false);
    after = tail.toString();
  }
  const docRect = doc.getBoundingClientRect();
  const rect = range.getBoundingClientRect();
  return {
    ...trimContext(before, after),
    match,
    at: documentFraction(rect.top, docRect.top, docRect.height),
  };
}

/** Passages in reading order. The same span named twice is one passage
 * with both names, so a note and a reply on one sentence read as one. */
export function orderPassages<
  T extends { range: Range; label: string; notes?: string[] },
>(passages: T[]): T[] {
  const same = (a: Range, b: Range) =>
    a.startContainer === b.startContainer &&
    a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer &&
    a.endOffset === b.endOffset;
  const unique: T[] = [];
  for (const p of passages) {
    const twin = unique.find((q) => same(q.range, p.range));
    if (!twin) unique.push({ ...p, notes: [...(p.notes ?? [])] });
    else {
      if (!twin.label.split("; ").includes(p.label))
        twin.label = `${twin.label}; ${p.label}`;
      for (const note of p.notes ?? [])
        if (!twin.notes?.includes(note)) twin.notes?.push(note);
    }
  }
  return unique.sort((a, b) =>
    a.range.compareBoundaryPoints(Range.START_TO_START, b.range),
  );
}

export function openPassageGather(request: GatherRequest): void {
  if (typeof window === "undefined" || !request.passages.length) return;
  window.dispatchEvent(
    new CustomEvent<GatherRequest>(PASSAGE_GATHER_EVENT, { detail: request }),
  );
}

/** Put the caret on a passage, centre it, and mark it for a moment. */
export function revealPassage(range: Range): void {
  const doc = (
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  )?.closest<HTMLElement>(".ProseMirror");
  const target =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  target?.scrollIntoView({
    block: "center",
    behavior: still ? "auto" : "smooth",
  });
  doc?.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range.cloneRange());
  const highlights = (
    CSS as unknown as {
      highlights?: Map<string, unknown>;
    }
  ).highlights;
  const Highlight = (
    window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
  ).Highlight;
  if (highlights && Highlight) {
    highlights.set("twyne-passage-reveal", new Highlight(range.cloneRange()));
    setTimeout(() => highlights.delete("twyne-passage-reveal"), 1_800);
  }
}
