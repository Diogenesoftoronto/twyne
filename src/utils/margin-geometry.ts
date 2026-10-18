/**
 * One geometry for both margin systems. The tool rail (margin-rail.tsx) and
 * the conductor's room (flow-surface.tsx) must step aside to their docks at
 * the same width, or one fills the margin while the other falls back.
 */

/** Space between the page and a margin card. */
export const MARGIN_GUTTER = 28;
/** Slack left beside a card before the margin counts as roomy enough. */
export const MARGIN_SLACK = 8;
export const ROOM_CARD_WIDTH = 268;
export const TOOL_CARD_MAX = 296;
export const ARCHIVE_WIDTH = 212;
export const SHELF_WIDTH = 176;
/** Distance of a dock from the manuscript column's right edge. */
export const DOCK_INSET = 16;

export interface MarginGeometry {
  /** Right margin: cards beside the page, or a dock over the corner. */
  right: "rail" | "dock";
  /** Left margin holds the archive column. */
  archiveFits: boolean;
  /** Left margin holds the saved-tools shelf. */
  shelfFits: boolean;
  /** Tool card width: shrinks toward the room card width before giving up. */
  toolWidth: number;
}

export const marginGeometry = (
  rightRoom: number,
  leftRoom: number,
): MarginGeometry => {
  const space = rightRoom - MARGIN_GUTTER - MARGIN_SLACK;
  return {
    right: space >= ROOM_CARD_WIDTH ? "rail" : "dock",
    archiveFits: leftRoom >= ARCHIVE_WIDTH + MARGIN_GUTTER + MARGIN_SLACK,
    shelfFits: leftRoom >= SHELF_WIDTH + MARGIN_GUTTER,
    toolWidth: Math.round(
      Math.max(ROOM_CARD_WIDTH, Math.min(TOOL_CARD_MAX, space)),
    ),
  };
};

/** CSS `right` for a dock: level with the manuscript column's right edge. */
export const dockRight = (viewportWidth: number, scrollerRight: number) =>
  Math.max(DOCK_INSET, Math.round(viewportWidth - scrollerRight + DOCK_INSET));
