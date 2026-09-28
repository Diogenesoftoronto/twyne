import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import type { liveVoiceAudio } from "./live-voice-audio";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";
// @ts-expect-error jsdom is a test-only dependency without declarations.
import { JSDOM } from "jsdom";

const release = await lockBrowserGlobalsForTestFile();
const names = [
  "window",
  "location",
  "localStorage",
  "WebSocket",
  "CustomEvent",
  "Event",
] as const;
const previous = new Map(
  names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);
const storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
class Socket {
  static OPEN = 1;
  static CLOSING = 2;
  readyState = 1;
  bufferedAmount = 0;
  sent: Array<Record<string, any>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  event(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
let live: typeof import("./live-voice");
let socket: Socket;
let stops = 0;
let chunks: (audio: string, level: number) => void;
let plays = 0;
let muted = false;
let capture: Awaited<ReturnType<typeof liveVoiceAudio>>;
let dom: InstanceType<typeof JSDOM>;
beforeEach(async () => {
  dom = new JSDOM("", { url: "https://twyne.test/editor/" });
  const window = dom.window;
  const values = {
    window,
    localStorage: storage,
    location: { href: "https://twyne.test/editor/", protocol: "https:" },
    WebSocket: Socket,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
  };
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: values[name],
    });
  live = await import(`./live-voice?test=${Math.random()}`);
  socket = new Socket();
  stops = 0;
  plays = 0;
  muted = false;
  capture = {
    stop: () => {
      stops++;
    },
    mute: (value) => {
      muted = value;
    },
    play: () => {
      plays++;
    },
  };
});
afterEach(() => {
  live.endLiveVoice();
  socket.event({ type: "session.closed", usage: { seconds: 1 } });
  dom.window.close();
});
afterAll(() => {
  for (const name of names) {
    const descriptor = previous.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  release();
});
const credentials = {
  authorization: "DPoP token",
  dpop: "proof",
  idempotencyKey: "once",
  maxCostMicrousd: 500_000,
};
async function connect(
  action: (ref: unknown, args: unknown) => Promise<unknown> = async () =>
    credentials,
) {
  await live.startLiveVoice(
    { action } as unknown as ConvexClient,
    "Le Lecteur",
    "This comment",
    true,
    {
      audio: async (onChunk) => {
        chunks = onChunk;
        return capture;
      },
      socket: () => socket as unknown as WebSocket,
    },
  );
  socket.onopen?.();
  socket.event({ type: "twyne.live.ready" });
  socket.event({ type: "session.started" });
}
test("microphone stays live during output and transcripts grow independently", async () => {
  await connect();
  socket.event({ type: "session.output_audio.delta", delta: "AAA=" });
  chunks("AAA=", 0.5);
  expect(plays).toBe(1);
  expect(socket.sent.at(-1)?.type).toBe("session.input_audio.append");
  socket.event({
    type: "session.input_transcript.delta",
    delta: "Please ",
    start_ms: 1,
    end_ms: 2,
  });
  socket.event({
    type: "session.output_transcript.delta",
    delta: "I'm listening.",
    start_ms: 1,
    end_ms: 3,
  });
  socket.event({
    type: "session.input_transcript.delta",
    delta: "revise this.",
    start_ms: 2,
    end_ms: 4,
  });
  expect(live.liveVoiceState()).toMatchObject({
    userTranscript: "Please revise this.",
    assistantTranscript: "I'm listening.",
  });
  live.muteLiveVoice();
  expect(muted).toBe(true);
  const before = socket.sent.length;
  chunks("AAA=", 0.2);
  expect(socket.sent.length).toBe(before);
  live.endLiveVoice();
  expect(stops).toBe(1);
  expect(live.liveVoiceState().status).toBe("closing");
  expect(socket.sent.at(-1)?.type).toBe("session.close");
  socket.event({ type: "session.closed", usage: { seconds: 10 } });
  expect(live.liveVoiceState()).toMatchObject({
    status: "idle",
    finalized: true,
  });
});
test("cancel during microphone permission stops late capture without purchasing a session", async () => {
  let resolve!: (value: typeof capture) => void;
  let requests = 0;
  const start = live.startLiveVoice(
    {
      action: async () => {
        requests++;
        return credentials;
      },
    } as unknown as ConvexClient,
    "Le Lecteur",
    "",
    true,
    {
      audio: () =>
        new Promise((done) => {
          resolve = done;
        }),
      socket: () => socket as unknown as WebSocket,
    },
  );
  live.endLiveVoice();
  resolve(capture);
  await start;
  expect(stops).toBe(1);
  expect(requests).toBe(0);
  expect(live.liveVoiceState().status).toBe("idle");
});
test("repeated delegations run once and results after end cannot act or speak", async () => {
  let calls = 0;
  let resolve!: (result: unknown) => void;
  await connect(async () => {
    calls++;
    return calls === 1
      ? credentials
      : new Promise((done) => {
          resolve = done;
        });
  });
  const event = {
    type: "session.delegation.created",
    delegation: { id: "task_1", target: "client" },
  };
  socket.event(event);
  socket.event(event);
  expect(calls).toBe(2);
  live.endLiveVoice();
  socket.event({ type: "session.closed" });
  resolve({ kind: "answer", text: "A late result", original: "", target: "" });
  await new Promise((done) => setTimeout(done, 0));
  expect(
    socket.sent.some((event) => event.type === "session.commentary.append"),
  ).toBe(false);
  expect(live.liveVoiceState().pending).toBeNull();
});
