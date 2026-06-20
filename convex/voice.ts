"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { isProSubscription } from "./lib/entitlement";

const OPENAI_AUDIO_BASE = "https://api.openai.com/v1";
const MAX_SPEECH_CHARS = 4096;

const audioFormatValidator = v.union(
  v.literal("mp3"),
  v.literal("opus"),
  v.literal("aac"),
  v.literal("flac"),
  v.literal("wav"),
  v.literal("pcm"),
);

export const synthesizeSpeech = action({
  args: {
    text: v.string(),
    model: v.optional(v.string()),
    voice: v.optional(v.string()),
    instructions: v.optional(v.string()),
    responseFormat: v.optional(audioFormatValidator),
    speed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");

    // Rate limit: each synthesis is a paid OpenAI call. 20 per minute per
    // user is well above any real reading flow, and stops abuse of the
    // hosted key.
    await consumeRateLimit(ctx, {
      action: "voice:synthesize",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.voiceSynthesize,
    });

    const subscription = await ctx.runQuery(
      internal.payments.getSubscriptionByUserId,
      {
        userId: identity.tokenIdentifier,
      },
    );
    if (!isProSubscription(subscription)) {
      throw new Error("Voice narration is a Pro feature.");
    }

    const apiKey =
      process.env.VOICE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Hosted voice is not configured.");

    const input = args.text.trim().slice(0, MAX_SPEECH_CHARS);
    if (!input) throw new Error("Nothing to read.");

    const responseFormat = args.responseFormat ?? "mp3";
    const res = await fetch(`${OPENAI_AUDIO_BASE}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model:
          args.model ?? process.env.VOICE_OPENAI_MODEL ?? "gpt-4o-mini-tts",
        input,
        voice: args.voice ?? process.env.VOICE_OPENAI_VOICE ?? "alloy",
        response_format: responseFormat,
        ...(args.instructions ? { instructions: args.instructions } : {}),
        ...(args.speed ? { speed: clampSpeed(args.speed) } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Hosted voice failed (${res.status}): ${detail.slice(0, 240)}`,
      );
    }

    return {
      audioBase64: Buffer.from(await res.arrayBuffer()).toString("base64"),
      mimeType: audioMimeType(responseFormat),
      responseFormat,
      provider: "openai",
      model: args.model ?? process.env.VOICE_OPENAI_MODEL ?? "gpt-4o-mini-tts",
      voice: args.voice ?? process.env.VOICE_OPENAI_VOICE ?? "alloy",
    };
  },
});

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.25, Math.min(4, speed));
}

function audioMimeType(format: string): string {
  switch (format) {
    case "opus":
      return "audio/opus";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/L16";
    case "mp3":
    default:
      return "audio/mpeg";
  }
}
