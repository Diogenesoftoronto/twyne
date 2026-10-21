import { z } from "zod";

// This allowlist is shared by the browser and server. Credentials, endpoint
// URLs and machine-specific connections never enter the account snapshot.
const text = z.string().max(16000);
const strings = z.array(text).max(100);
const reasoning = z.discriminatedUnion("type", [
  z.object({ type: z.literal("effort"), value: text }),
  z.object({ type: z.literal("toggle"), value: z.boolean() }),
  z.object({ type: z.literal("budget_tokens"), value: z.number().finite() }),
]);
const override = z.object({
  providerId: text.optional(),
  model: text.optional(),
  temperature: z.number().finite().optional(),
  maxTokens: z.number().finite().optional(),
  voice: text.optional(),
  speed: z.number().finite().optional(),
  responseFormat: text.optional(),
  instructions: text.optional(),
});
const schemas = {
  language: z.object({
    preference: z.enum(["auto", "en", "fr", "es", "zh", "hi", "ja"]),
  }),
  writer: z.object({
    interviewStyle: z.enum(["form", "conversational"]),
    profile: z.object({
      displayName: text,
      personalFacts: text,
      feedbackStyle: text,
      feedbackNotes: text,
      primaryGenre: text.optional(),
      experienceLevel: text.optional(),
      feedbackFocus: strings.optional(),
      praisePreference: text.optional(),
      critiqueTone: text.optional(),
      factChecking: text.optional(),
      feedbackAvoid: text.optional(),
    }),
  }),
  ai: z.object({
    advancedMode: z.boolean(),
    showProviderTags: z.boolean(),
    defaultProviderId: text.nullable(),
    providers: z
      .array(
        z.object({
          id: text,
          name: text,
          type: text,
          modelsDevId: text.optional(),
          defaultModel: text,
          apiMode: z.enum(["chat", "responses"]).optional(),
          modelReasoning: z.record(text, reasoning).optional(),
        }),
      )
      .max(100),
    perFeature: z.record(text, override),
    judgement: z
      .object({
        source: text,
        typesafeModel: text.optional(),
        endpointModel: text.optional(),
      })
      .optional(),
    sceneMedia: z
      .object({ enabled: z.boolean(), source: z.enum(["twyne", "provider"]) })
      .optional(),
  }),
  apparatus: z.object({
    defaultCitationStyle: z.enum(["mla", "apa", "chicago"]),
    aiEnhanceCitations: z.boolean(),
    flagMissingSources: z.boolean(),
    autoInsertFootnotes: z.boolean(),
    researchProvider: text,
    maxResults: z.number().finite().min(1).max(20),
  }),
  room: z.object({
    level: text,
    maxProposals: z.number().finite(),
    maxLargeEdits: z.number().finite(),
    personaScope: strings,
    perPersona: z.record(text, text).optional(),
    backgroundRoom: z.boolean().optional(),
  }),
  appearance: z.object({
    preset: text,
    custom: z
      .record(text, z.string().regex(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i))
      .optional(),
  }),
};
export type PreferenceKind = keyof typeof schemas;
export const PREFERENCE_KINDS = Object.keys(schemas) as PreferenceKind[];
export type PreferenceValue = Record<string, unknown>;
export function portablePreference(
  kind: PreferenceKind,
  value: unknown,
): PreferenceValue {
  const parsed = schemas[kind].parse(value);
  const json = JSON.stringify(parsed);
  if (json.length > 64000) throw new Error("Account preferences exceed 64 KB.");
  return JSON.parse(json);
}

// Three-way merge: only locally changed fields override the latest server
// version. Arrays are one field. Missing fields express explicit removals.
export function mergePreference(
  base: unknown,
  local: unknown,
  remote: unknown,
): unknown {
  if (JSON.stringify(base) === JSON.stringify(local)) return remote;
  if (isObject(base) && isObject(local) && isObject(remote)) {
    const result: Record<string, unknown> = {};
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      const value = mergePreference(base[key], local[key], remote[key]);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  return local;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
