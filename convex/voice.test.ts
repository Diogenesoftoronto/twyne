import { afterEach, expect, spyOn, test } from "bun:test";
import { synthesizeSpeech } from "./voice";
import * as notorganic from "./lib/notorganic";
import * as entitlement from "./lib/entitlement";
import * as rateLimit from "./lib/rateLimit";

const fixtureDpop = await notorganic.createDpopKeyPair();
const restore: Array<() => void> = [];
afterEach(() => {
  restore
    .splice(0)
    .reverse()
    .forEach((off) => off());
});

function fixture() {
  const requests: Request[] = [];
  let response = new Response(new Uint8Array([1, 2, 3]), {
    headers: { "content-type": "audio/mpeg" },
  });
  let identity: { subject: string; tokenIdentifier: string } | null = {
    subject: "fixture-product-user",
    tokenIdentifier: "fixture-issuer|user",
  };
  let link: { did: string; sessionVersion: number } | null = {
    did: "did:plc:fictionalwriter",
    sessionVersion: 4,
  };
  const enabled = spyOn(notorganic, "notOrganicEnabled").mockReturnValue(true);
  const token = spyOn(
    notorganic,
    "issueNotOrganicAccessToken",
  ).mockResolvedValue({
    accessToken: "fixture-token",
    dpop: fixtureDpop,
  });
  const route = spyOn(notorganic, "notOrganicOpenAiRoute").mockReturnValue({
    baseURL: "https://gateway.example.test/v1",
    apiKey: "fixture-token",
    model: "speech-eleven-v4",
    headers: {
      "x-notorganic-product": "twyne",
      "x-notorganic-feature": "voice-narration",
    },
    fetch: (async (input, init) => {
      requests.push(new Request(input, init));
      return response.clone();
    }) as typeof fetch,
  });
  const pro = spyOn(entitlement, "userIsPro").mockResolvedValue(false);
  const limit = spyOn(rateLimit, "consumeRateLimit").mockResolvedValue(
    undefined,
  );
  for (const spy of [enabled, token, route, pro, limit])
    restore.push(() => spy.mockRestore());
  const queries: unknown[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => identity },
    runQuery: async (_ref: unknown, args: unknown) => {
      queries.push(args);
      return link;
    },
  };
  const action = synthesizeSpeech as unknown as {
    _handler: (
      ctx: unknown,
      args: {
        text: string;
        voice?: string;
        model?: string;
        responseFormat?: "mp3" | "opus" | "pcm" | "wav";
        instructions?: string;
        speed?: number;
      },
    ) => Promise<{
      audioBase64: string;
      provider: string;
      model: string;
      voice: string;
      mimeType: string;
      alignment?: { provider: string; ranges: unknown[] };
    }>;
  };
  return {
    requests,
    queries,
    enabled,
    token,
    route,
    pro,
    run: (
      args: Parameters<typeof action._handler>[1] = {
        text: "Read this aloud.",
        voice: "alloy",
        model: "untrusted-upstream-id",
      },
    ) => action._handler(ctx, args),
    signedOut: () => {
      identity = null;
    },
    unlinked: () => {
      link = null;
    },
    reject: () => {
      response = Response.json(
        { error: { message: "Add account credit to continue." } },
        { status: 402 },
      );
    },
    respond: (next: Response) => {
      response = next;
    },
  };
}

test("hosted narration uses the verified linked wallet without requiring Pro", async () => {
  const f = fixture();
  const result = await f.run();
  expect(f.queries).toEqual([{ productSubject: "fixture-product-user" }]);
  expect(f.token).toHaveBeenCalledWith({
    did: "did:plc:fictionalwriter",
    sessionVersion: 4,
    feature: "voice-narration",
    capabilities: ["infer:speech-eleven-v4"],
  });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].url).toBe(
    "https://gateway.example.test/v1/audio/speech",
  );
  expect(await f.requests[0].json()).toEqual({
    model: "speech-eleven-v4",
    input: "Read this aloud.",
    voice: "Chris",
    response_format: "mp3",
    stream: false,
    timestamps: true,
    include_timestamps: true,
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  });
  expect(result).toMatchObject({
    audioBase64: "AQID",
    provider: "notorganic",
    model: "speech-eleven-v4",
    voice: "Chris",
    mimeType: "audio/mpeg",
  });
  expect(f.pro).not.toHaveBeenCalled();
  expect(f.route.mock.calls[0]?.[1]).toBe("speech-eleven-v4");
});

test("missing identity or verified link cannot spend account credit", async () => {
  const f = fixture();
  f.unlinked();
  await expect(f.run()).rejects.toThrow("Link your Not Organic account");
  f.signedOut();
  await expect(f.run()).rejects.toThrow("Not signed in");
  expect(f.token).not.toHaveBeenCalled();
  expect(f.requests).toHaveLength(0);
});

test("a credit rejection stays visible and never falls back to the legacy paid key", async () => {
  const f = fixture();
  f.reject();
  await expect(f.run()).rejects.toThrow("Add Not Organic wallet credit");
  expect(f.requests).toHaveLength(1);
  expect(f.pro).not.toHaveBeenCalled();
});

test("disabled hosted narration cannot fall back to OpenAI", async () => {
  const f = fixture();
  f.enabled.mockReturnValue(false);
  await expect(f.run()).rejects.toThrow(
    "Hosted ElevenLabs narration is not configured",
  );
  expect(f.requests).toHaveLength(0);
  expect(f.token).not.toHaveBeenCalled();
  expect(f.pro).not.toHaveBeenCalled();
});

test("a rejected hosted route preserves its classification and support reference", async () => {
  const f = fixture();
  f.respond(Response.json({ error: "private upstream body" }, { status: 400 }));
  let failure: any;
  try {
    await f.run();
  } catch (error) {
    failure = error;
  }
  expect(failure.data).toMatchObject({
    code: "configuration_required",
    retryable: false,
  });
  expect(failure.data.referenceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(String(failure)).not.toContain("private upstream body");
  expect(f.requests).toHaveLength(1);
});

test("empty or JSON success responses do not become silent cached audio", async () => {
  const f = fixture();
  for (const response of [
    new Response(null),
    Response.json({ error: "upstream failed" }),
  ]) {
    f.respond(response);
    await expect(f.run()).rejects.toThrow("malformed_response");
  }
});

test("changing the selected hosted voice changes the speech request", async () => {
  const f = fixture();
  for (const [voice, expected] of [
    ["alloy", "Chris"],
    ["shimmer", "Matilda"],
    ["echo", "Daniel"],
    ["ash", "George"],
    ["onyx", "Alice"],
    ["Aria", "Aria"],
    ["EXAVITQu4vr4xnSDxMaL", "EXAVITQu4vr4xnSDxMaL"],
  ]) {
    const result = await f.run({
      text: "A fictional note.",
      voice,
      model: "ignored-client-model",
    });
    expect((await f.requests.at(-1)!.json()).voice).toBe(expected);
    expect(result.voice).toBe(expected);
  }
});

test("unsupported ElevenLabs formats fail before requesting wallet access", async () => {
  const f = fixture();
  await expect(
    f.run({ text: "A fictional note.", responseFormat: "wav" }),
  ).rejects.toThrow("Hosted ElevenLabs narration supports MP3, Opus or PCM");
  expect(f.token).not.toHaveBeenCalled();
  expect(f.requests).toHaveLength(0);
});

test("hosted audio uses its actual MIME type and supported ElevenLabs controls", async () => {
  const f = fixture();
  f.respond(
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "audio/ogg;codecs=opus" },
    }),
  );
  const result = await f.run({
    text: "A fictional note.",
    voice: "Alice",
    responseFormat: "opus",
    instructions: "A private editorial direction, not spoken text.",
    speed: 1.5,
  });
  expect(result.mimeType).toBe("audio/ogg");
  expect(await f.requests[0].json()).toEqual({
    model: "speech-eleven-v4",
    input: "A fictional note.",
    voice: "Alice",
    response_format: "opus",
    stream: false,
    timestamps: true,
    include_timestamps: true,
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  });
});

test("timed gateway audio preserves native word alignment for the exact requested clip", async () => {
  const f = fixture();
  f.respond(
    Response.json({
      audio_base64: "AQID",
      content_type: "audio/mpeg",
      timestamps: [
        {
          characters: ["H", "i", " ", "a", "g", "a", "i", "n", "."],
          character_start_times_seconds: [
            0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8,
          ],
          character_end_times_seconds: [
            0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
          ],
        },
      ],
    }),
  );
  const result = await f.run({ text: "Hi again.", voice: "Alice" });
  expect(result.audioBase64).toBe("AQID");
  expect(result.alignment).toEqual({
    provider: "elevenlabs",
    ranges: [
      {
        sourceStart: 0,
        sourceEnd: 2,
        audioStart: 0,
        audioEnd: 0.2,
        precision: "word",
      },
      {
        sourceStart: 3,
        sourceEnd: 8,
        audioStart: 0.3,
        audioEnd: 0.8,
        precision: "word",
      },
    ],
  });
});
