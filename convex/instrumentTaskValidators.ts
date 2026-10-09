import { v } from "convex/values";
export const taskKind = v.union(
  v.literal("writing-review"),
  v.literal("source-research"),
);
export const taskStatus = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("running"),
  v.literal("complete"),
  v.literal("failed"),
  v.literal("cancelled"),
);
export const sourceRef = v.object({
  sourceId: v.string(),
  uri: v.string(),
  label: v.string(),
});
export const citation = sourceRef.extend({
  excerpt: v.string(),
  fingerprint: v.string(),
  retrievedAt: v.number(),
});
export const taskResult = v.object({
  text: v.string(),
  citations: v.array(citation),
  provider: v.string(),
  model: v.string(),
  completedAt: v.number(),
});
export const feedback = v.object({
  verdict: v.union(v.literal("useful"), v.literal("not-useful")),
  comment: v.string(),
  updatedAt: v.number(),
});
export const failureKind = v.union(
  v.literal("needs-input"),
  v.literal("provider-unavailable"),
  v.literal("outcome-unknown"),
);
export const taskFields = {
  userId: v.string(),
  productSubject: v.string(),
  did: v.string(),
  sessionVersion: v.number(),
  requestId: v.string(),
  folioId: v.string(),
  kind: taskKind,
  instruction: v.string(),
  selectedText: v.string(),
  fingerprint: v.string(),
  sources: v.array(sourceRef),
  status: taskStatus,
  attempts: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  leaseToken: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  scheduledId: v.optional(v.id("_scheduled_functions")),
  result: v.optional(taskResult),
  error: v.optional(v.string()),
  failureKind: v.optional(failureKind),
  feedback: v.optional(feedback),
};
export const taskDocument = v.object({
  _id: v.id("instrumentTasks"),
  _creationTime: v.number(),
  ...taskFields,
});
