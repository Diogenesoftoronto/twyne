import { v } from "convex/values";
export const charterExceptionValidator = v.object({ version: v.literal(1), findingId: v.string(), signatures: v.array(v.object({ key: v.string(), count: v.number() })) });
export function validateCharterException(item: { scope: string; occurrenceException?: { findingId: string; signatures: { key: string; count: number }[] } }): void {
  const exception = item.occurrenceException;
  if (!exception) return;
  if (item.scope !== "folio" || !exception.findingId || exception.findingId.length > 256 || exception.signatures.length > 100 || JSON.stringify(exception.signatures).length > 12_000 || new Set(exception.signatures.map(pair => pair.key)).size !== exception.signatures.length || exception.signatures.some(pair => !pair.key || !Number.isSafeInteger(pair.count) || pair.count < 1 || pair.count > 1000)) throw new Error("Invalid bounded folio occurrence exception");
}
