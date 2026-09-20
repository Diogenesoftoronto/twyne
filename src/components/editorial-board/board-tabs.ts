import type { EditorialBoardTab } from "./editorial-board-overlay";

/**
 * The Editorial Board's five tabs, shared by the live editor
 * (`src/routes/editor/index.tsx`) and the landing preview
 * (`src/components/landing/workspace-preview.tsx`).
 *
 * One list so the preview can never silently drop, rename, or reorder a
 * tab the room actually has. Add a tab here and both surfaces follow.
 */
export const BOARD_TABS: EditorialBoardTab[] = [
  {
    id: "personas",
    numeral: "I",
    label: "Cast",
    kicker: "Editors in residence",
    accent: "var(--color-vermilion)",
  },
  {
    id: "rubric",
    numeral: "II",
    label: "Rubric",
    kicker: "Dept. of Rigor",
    accent: "var(--color-cobalt)",
  },
  {
    id: "comments",
    numeral: "III",
    label: "Marginalia",
    kicker: "Notes in the margin",
    accent: "var(--color-mustard)",
  },
  {
    id: "citations",
    numeral: "IV",
    label: "Apparatus",
    kicker: "Sources & sourcerers",
    accent: "var(--color-periwinkle)",
  },
  {
    id: "history",
    numeral: "V",
    label: "Versions",
    kicker: "Version history",
    accent: "var(--color-sage)",
  },
];
