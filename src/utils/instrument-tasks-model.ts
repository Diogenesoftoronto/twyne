/** Immutable, user-triggered instruments. No task can apply manuscript changes. */
export type InstrumentTaskKind = "writing-review" | "source-research";
export type InstrumentTaskStatus =
  | "queued"
  | "claimed"
  | "running"
  | "complete"
  | "failed"
  | "cancelled";
export interface InstrumentSourceRef {
  sourceId: string;
  uri: string;
  label: string;
}
export interface InstrumentCitation extends InstrumentSourceRef {
  excerpt: string;
  fingerprint: string;
  retrievedAt: number;
}
export interface InstrumentTaskRequest {
  requestId: string;
  folioId: string;
  kind: InstrumentTaskKind;
  instruction: string;
  selectedText: string;
  sources: InstrumentSourceRef[];
}
export interface InstrumentTaskResult {
  text: string;
  citations: InstrumentCitation[];
  provider: string;
  model: string;
  completedAt: number;
}
export interface InstrumentTaskView extends InstrumentTaskRequest {
  _id: string;
  fingerprint: string;
  status: InstrumentTaskStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  result?: InstrumentTaskResult;
  error?: string;
  failureKind?: "needs-input" | "provider-unavailable" | "outcome-unknown";
  feedback?: {
    verdict: "useful" | "not-useful";
    comment: string;
    updatedAt: number;
  };
}
/** Versioned content identity; exact snapshot remains the final stale-context check. */
export function instrumentTextFingerprint(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64-v1:${hash.toString(16).padStart(16, "0")}`;
}
export function instrumentContextIsStale(
  task: Pick<InstrumentTaskView, "selectedText" | "fingerprint">,
  currentText: string,
): boolean {
  return (
    task.fingerprint !== instrumentTextFingerprint(currentText) ||
    task.selectedText !== currentText
  );
}
export function instrumentTaskCanCancel(status: InstrumentTaskStatus): boolean {
  return status === "queued" || status === "claimed" || status === "running";
}
