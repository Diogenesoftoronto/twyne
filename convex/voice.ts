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

/** Roughly three minutes of Opus at 32kbps, base64-encoded. */
const MAX_TRANSCRIBE_BYTES = 12 * 1024 * 1024;

/**
 * Transcribe a recorded voice note.
 *
 * The mirror image of {@link synthesizeSpeech}: same identity check, same rate
 * limiter, same Pro gate, same key resolution. The audio arrives base64-encoded
 * because Convex actions take JSON — the client keeps the original Blob locally,
 * so nothing is lost by re-encoding for the wire.
 */
export const transcribeSpeech = action({
  args: {
    audioBase64: v.string(),
    mimeType: v.string(),
    /** Optional nudge for proper nouns and jargon the recording will contain. */
    prompt: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");

    await consumeRateLimit(ctx, {
      action: "voice:transcribe",
      identifier: identity.tokenIdentifier,
      ...RATE_LIMITS.voiceTranscribe,
    });

    const subscription = await ctx.runQuery(
      internal.payments.getSubscriptionByUserId,
      {
        userId: identity.tokenIdentifier,
      },
    );
    if (!isProSubscription(subscription)) {
      throw new Error("Hosted transcription is a Pro feature.");
    }

    const apiKey =
      process.env.VOICE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Hosted transcription is not configured.");

    const bytes = Buffer.from(args.audioBase64, "base64");
    if (bytes.length === 0) throw new Error("Nothing to transcribe.");
    if (bytes.length > MAX_TRANSCRIBE_BYTES) {
      throw new Error("That recording is too long to transcribe.");
    }

    const model =
      args.model ??
      process.env.VOICE_OPENAI_TRANSCRIBE_MODEL ??
      "gpt-4o-mini-transcribe";

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: args.mimeType }),
      `note.${extensionForMime(args.mimeType)}`,
    );
    form.append("model", model);
    form.append("response_format", "json");
    if (args.prompt?.trim()) form.append("prompt", args.prompt.trim().slice(0, 800));

    const res = await fetch(`${OPENAI_AUDIO_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Hosted transcription failed (${res.status}): ${detail.slice(0, 240)}`,
      );
    }

    const data = (await res.json()) as { text?: string };
    return {
      text: typeof data.text === "string" ? data.text.trim() : "",
      provider: "openai",
      model,
    };
  },
});

/** The file extension the transcription endpoint expects for a MIME type. */
function extensionForMime(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  switch (base) {
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/mp4":
    case "audio/m4a":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mpeg":
      return "mp3";
    default:
      return "webm";
  }
}

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
