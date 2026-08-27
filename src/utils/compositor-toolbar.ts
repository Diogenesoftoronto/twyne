export const COMPOSITOR_TABS = [
  {
    id: "home",
    label: "Home",
    groups: ["Character", "Type", "Styles", "Lists", "Alignment"],
  },
  {
    id: "insert",
    label: "Insert",
    groups: ["Objects", "Breaks", "Notes"],
  },
  {
    id: "review",
    label: "Review",
    groups: ["Comments", "Listening", "Versions", "Proofing"],
  },
  {
    id: "view",
    label: "View",
    groups: ["Navigation", "Page", "Focus", "Help"],
  },
] as const;

export type CompositorTab = (typeof COMPOSITOR_TABS)[number]["id"];

export const DEFAULT_COMPOSITOR_TAB: CompositorTab = "home";

export function isCompositorTab(value: string): value is CompositorTab {
  return COMPOSITOR_TABS.some((tab) => tab.id === value);
}

export function moveCompositorTab(
  current: CompositorTab,
  direction: 1 | -1,
): CompositorTab {
  const currentIndex = COMPOSITOR_TABS.findIndex((tab) => tab.id === current);
  const nextIndex =
    (currentIndex + direction + COMPOSITOR_TABS.length) %
    COMPOSITOR_TABS.length;
  return COMPOSITOR_TABS[nextIndex].id;
}
