/** Rates are audio seconds generated per wall second; values below one lag. */
export interface LocalLiveBenchmark {
  adapter: string;
  lfmSpeechRate: number;
  supertonicRate: number | null;
}

export type LocalLiveSpeechPath = "lfm" | "supertonic" | "lagging";

export function selectLocalLiveSpeechPath(
  benchmark: LocalLiveBenchmark,
): LocalLiveSpeechPath {
  if (Number.isFinite(benchmark.lfmSpeechRate) && benchmark.lfmSpeechRate >= 1)
    return "lfm";
  if (
    benchmark.supertonicRate !== null &&
    Number.isFinite(benchmark.supertonicRate) &&
    benchmark.supertonicRate >= 1
  )
    return "supertonic";
  return "lagging";
}

/** A result is reusable only for the adapter on which it was measured. */
export function reusableLocalLiveBenchmark(
  value: unknown,
  adapter: string,
): LocalLiveBenchmark | null {
  if (!value || typeof value !== "object" || !adapter) return null;
  const candidate = value as Partial<LocalLiveBenchmark>;
  if (
    candidate.adapter !== adapter ||
    typeof candidate.lfmSpeechRate !== "number" ||
    !Number.isFinite(candidate.lfmSpeechRate) ||
    candidate.lfmSpeechRate <= 0 ||
    (candidate.supertonicRate !== null &&
      (typeof candidate.supertonicRate !== "number" ||
        !Number.isFinite(candidate.supertonicRate) ||
        candidate.supertonicRate <= 0))
  )
    return null;
  return candidate as LocalLiveBenchmark;
}
