import type { CharterItem, HouseState } from "../house-model";
import type { Finding } from "../living-desk-contract";
import type { DeliberateBaseline } from "./deliberate";
export const DELIBERATE_CHARTER_PREFIX = "living-desk-exception:";
export function deliberateCharterId(folioId: string, findingId: string) {
  return `${DELIBERATE_CHARTER_PREFIX}${encodeURIComponent(folioId)}:${encodeURIComponent(findingId)}`;
}
export function deliberateCharterItem(
  folioId: string,
  finding: Finding,
  baseline: DeliberateBaseline,
): Omit<CharterItem, "order" | "updatedAt"> {
  const signatures = [...baseline].map(([key, count]) => ({ key, count }));
  if (
    !folioId ||
    !finding.id ||
    signatures.length > 100 ||
    JSON.stringify(signatures).length > 12_000 ||
    signatures.some(
      (pair) =>
        !pair.key ||
        !Number.isSafeInteger(pair.count) ||
        pair.count < 1 ||
        pair.count > 1000,
    )
  )
    throw new Error(
      "This exception is too large for one Charter entry. Keep fewer occurrences at a time.",
    );
  return {
    id: deliberateCharterId(folioId, finding.id),
    scope: "folio",
    ownerRef: folioId,
    text: `Keep the existing uses of “${finding.title.slice(0, 300)}” on purpose. Flag new drift.`,
    severity: "prefer",
    kind:
      finding.lens === "stance"
        ? "voice"
        : finding.lens === "style"
          ? "style"
          : "other",
    occurrenceException: { version: 1, findingId: finding.id, signatures },
  };
}
export function deliberateCharterBaselines(
  state: HouseState,
  folioId: string,
): Map<string, DeliberateBaseline> {
  const baselines = new Map<string, DeliberateBaseline>();
  for (const item of state.charter) {
    const meta = item.occurrenceException;
    if (
      item.scope !== "folio" ||
      item.ownerRef !== folioId ||
      !meta ||
      meta.version !== 1 ||
      typeof meta.findingId !== "string" ||
      !Array.isArray(meta.signatures) ||
      item.id !== deliberateCharterId(folioId, meta.findingId) ||
      meta.signatures.length > 100 ||
      JSON.stringify(meta.signatures).length > 12_000 ||
      meta.signatures.some(
        (pair) =>
          !pair ||
          typeof pair.key !== "string" ||
          !pair.key ||
          !Number.isSafeInteger(pair.count) ||
          pair.count < 1 ||
          pair.count > 1000,
      ) ||
      new Set(meta.signatures.map((pair) => pair.key)).size !==
        meta.signatures.length
    )
      continue;
    baselines.set(
      meta.findingId,
      new Map(meta.signatures.map((pair) => [pair.key, pair.count])),
    );
  }
  return baselines;
}
