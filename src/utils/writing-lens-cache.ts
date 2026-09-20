import {
  runWritingLens,
  type WritingLensCaller,
  type WritingLensId,
  type WritingLensInput,
  type WritingLensResult,
} from "./writing-lenses";
import { rubricDraftFingerprint } from "./rubric-judgement-result";

const results = new Map<string, WritingLensResult>();
const pending = new Map<string, Promise<WritingLensResult>>();
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined && v !== "")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
/** The board and background loop share work, including requests already in flight. */
export async function cachedWritingLens(
  folioId: string,
  id: WritingLensId,
  input: WritingLensInput,
  call: WritingLensCaller,
): Promise<WritingLensResult> {
  const key = await rubricDraftFingerprint(
    JSON.stringify(canonical([folioId, id, input])),
  );
  const cached = results.get(key);
  if (cached) return cached;
  const active = pending.get(key);
  if (active) return active;
  const task = runWritingLens(id, input, call)
    .then((result) => {
      if (result.status !== "unavailable" && !result.incomplete) {
        results.set(key, result);
        if (results.size > 48) results.delete(results.keys().next().value!);
      }
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
