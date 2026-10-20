import { v } from "convex/values";

/**
 * Evidence stored on a persona note: further passages and continuity facts.
 * Mirrors `src/utils/note-evidence.ts` `NoteFact`; values are already
 * formatted for the card, so no probabilities travel with them.
 */
export const noteFactValidator = v.object({
  id: v.string(),
  label: v.string(),
  value: v.string(),
  near: v.optional(v.boolean()),
  passages: v.array(v.string()),
});

export const noteEvidenceFields = {
  anchors: v.optional(v.array(v.string())),
  facts: v.optional(v.array(noteFactValidator)),
};
