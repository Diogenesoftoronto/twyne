import { allowsMotion } from "../../utils/motion";

/**
 * The running foot: the status bar names the section the writer is reading,
 * the way a book prints its chapter at the foot of the page. It changes as the
 * writer scrolls across a section's heading, and pressing it returns to that
 * heading.
 *
 * Nothing here runs per keystroke or does layout work per scroll frame.
 * Heading offsets are measured once and cached; they are re-measured after
 * the editor's debounced `twyne:content` event (and lazily on the next scroll
 * after a resize). A scroll frame only reads `scrollTop` and walks the cache.
 */

/** Sections are second- and third-level headings; the title is not one. */
export const SECTION_SELECTOR = "#twyne-editor-mount .ProseMirror > :is(h2, h3)";

/** Dispatched on `window` with `detail: RunningSection | null`. */
export const RUNNING_SECTION_EVENT = "twyne:running-section";

export interface RunningSection {
  /** Position among the manuscript's sections, for returning to it. */
  index: number;
  text: string;
}

/** The reading line sits a quarter of the way down the visible page. */
const READING_LINE = 0.25;

/** Heading text without widgets (drag slugs, note anchors, faces). */
export function sectionText(heading: Element): string {
  let text = "";
  const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('[contenteditable="false"]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  while (walker.nextNode()) text += walker.currentNode.nodeValue ?? "";
  return text.replace(/\s+/g, " ").trim();
}

/** The section whose heading is the last one at or above the reading line. */
export function sectionAt(offsets: readonly number[], line: number): number {
  let found = -1;
  for (let index = 0; index < offsets.length; index++) {
    if (offsets[index] > line) break;
    found = index;
  }
  return found;
}

/** Bring a section's heading to the top of the page. */
export function jumpToSection(index: number): void {
  const heading = document.querySelectorAll<HTMLElement>(SECTION_SELECTOR)[index];
  heading?.scrollIntoView({
    block: "start",
    behavior: allowsMotion("feedback") ? "smooth" : "auto",
  });
}

const announce = (section: RunningSection | null) =>
  window.dispatchEvent(
    new CustomEvent<RunningSection | null>(RUNNING_SECTION_EVENT, {
      detail: section,
    }),
  );

/**
 * Follow the scroller and announce the running section whenever it changes
 * (null above the first section, or in a manuscript without sections).
 * Returns the cleanup function, which also clears the foot.
 */
export function mountRunningFoot(
  scroller: HTMLElement,
  onChange: (section: RunningSection | null) => void = announce,
): () => void {
  let offsets: number[] = [];
  let texts: string[] = [];
  let dirty = true;
  let frame = 0;
  let current: RunningSection | null = null;

  const measure = () => {
    dirty = false;
    const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const headings = scroller.querySelectorAll<HTMLElement>(SECTION_SELECTOR);
    offsets = [];
    texts = [];
    for (const heading of headings) {
      offsets.push(heading.getBoundingClientRect().top - top);
      texts.push(sectionText(heading));
    }
  };

  const pick = () => {
    if (dirty) measure();
    // At the end of the manuscript the last sections can never rise to the
    // reading line, so it drops to the foot of the page: the last heading in
    // view is the one being read.
    const atEnd =
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    const line =
      scroller.scrollTop +
      scroller.clientHeight * (atEnd ? 0.9 : READING_LINE);
    const index = sectionAt(offsets, line);
    const next =
      index >= 0 && texts[index] ? { index, text: texts[index] } : null;
    if (next?.index === current?.index && next?.text === current?.text) return;
    current = next;
    onChange(next);
  };

  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      pick();
    });
  };
  // Text changed (debounced by the editor): measure again and re-read.
  const onContent = () => {
    dirty = true;
    onScroll();
  };
  // A resize only invalidates; the next scroll re-measures.
  const resize = new ResizeObserver(() => {
    dirty = true;
  });

  scroller.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("twyne:content", onContent);
  resize.observe(scroller);
  onScroll();

  return () => {
    if (frame) cancelAnimationFrame(frame);
    scroller.removeEventListener("scroll", onScroll);
    window.removeEventListener("twyne:content", onContent);
    resize.disconnect();
    if (current) onChange(null);
  };
}
