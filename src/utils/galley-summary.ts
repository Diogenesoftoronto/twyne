export const GALLEY_PANEL_SUMMARY_LENGTH = 120;

/** Compact preview used only in the constrained Galley side panel. */
export function truncateGalleySummary(
  summary: string,
  maxLength = GALLEY_PANEL_SUMMARY_LENGTH,
): string {
  if (summary.length <= maxLength) return summary;
  return `${summary.slice(0, maxLength - 1).trimEnd()}…`;
}
