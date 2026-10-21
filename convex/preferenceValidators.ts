import { v } from "convex/values";
export const preferenceKind = v.union(
  v.literal("language"),
  v.literal("writer"),
  v.literal("ai"),
  v.literal("apparatus"),
  v.literal("room"),
  v.literal("appearance"),
);
