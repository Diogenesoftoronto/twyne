/**
 * Unread counts for the editorial board tabs.
 *
 * The four panels sit mounted-but-hidden, so work that lands in a panel the
 * writer isn't looking at is invisible — the background room can leave five
 * notes in Cast and the writer, staring at Marginalia, never knows. This is
 * the smallest thing that fixes it: a count per tab, cleared when the tab is
 * opened.
 *
 * It listens to events the app already emits rather than asking the panels to
 * report in, so the panels stay unaware of it and no wiring can drift.
 */

export type PanelId = "personas" | "rubric" | "comments" | "citations";

export type ActivityCounts = Record<PanelId, number>;

const EMPTY: ActivityCounts = {
  personas: 0,
  rubric: 0,
  comments: 0,
  citations: 0,
};

const counts: ActivityCounts = { ...EMPTY };

/** The tab currently on screen. Activity there is seen, not unread. */
let visiblePanel: PanelId | null = null;

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("twyne:panel-activity", { detail: { ...counts } }),
  );
}

export function panelActivity(): ActivityCounts {
  return { ...counts };
}

export function bump(panel: PanelId, by = 1): void {
  if (panel === visiblePanel) return;
  counts[panel] += by;
  emit();
}

export function clearPanel(panel: PanelId): void {
  if (counts[panel] === 0) return;
  counts[panel] = 0;
  emit();
}

/**
 * Tell the tracker which tab is on screen. Clears that tab's count, because
 * looking at a panel is what "read" means here.
 */
export function setVisiblePanel(panel: PanelId | null): void {
  visiblePanel = panel;
  if (panel) clearPanel(panel);
}

/**
 * Subscribe to the events that constitute activity. Returns a teardown.
 *
 * Only counts what arrived without being asked for. A writer who presses
 * "Convene the room" and then switches tabs does not need a badge telling them
 * the thing they just requested has happened.
 */
export function startPanelActivity(): () => void {
  if (typeof window === "undefined") return () => {};

  const onBackgroundNotes = (e: Event) => {
    const notes = (e as CustomEvent).detail;
    bump("personas", Array.isArray(notes) ? notes.length : 1);
  };
  const onBackgroundSources = (e: Event) => {
    const detail = (e as CustomEvent).detail as { saved?: number };
    bump("citations", detail?.saved ?? 1);
  };
  const onCommentsChanged = () => bump("comments");

  window.addEventListener("twyne:background-room-notes", onBackgroundNotes);
  window.addEventListener("twyne:background-sources", onBackgroundSources);
  window.addEventListener("twyne:user-comments-changed", onCommentsChanged);

  return () => {
    window.removeEventListener("twyne:background-room-notes", onBackgroundNotes);
    window.removeEventListener(
      "twyne:background-sources",
      onBackgroundSources,
    );
    window.removeEventListener(
      "twyne:user-comments-changed",
      onCommentsChanged,
    );
  };
}

/** Test seam. */
export function __resetForTests(): void {
  Object.assign(counts, EMPTY);
  visiblePanel = null;
}
