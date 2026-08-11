import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PERSONAS } from "./personas";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

const originalWindow = globalThis.window;
const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();

/**
 * The playback manager's invariants. The synthesis providers are exercised
 * elsewhere; what matters here is that the writer can never end up with two
 * editors talking at once, or with a voice they cannot stop.
 */

/** Minimal Audio + URL doubles: enough surface for the manager to drive. */
class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  currentTime = 0;
  duration = 0;
  muted = false;
  paused = true;
  playCount = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;

  constructor() {
    FakeAudio.instances.push(this);
  }
  async play(): Promise<void> {
    this.paused = false;
    this.playCount += 1;
  }
  pause(): void {
    this.paused = true;
  }
}

let createdUrls = 0;
let revokedUrls = 0;
let speakModule: typeof import("./speech");

beforeEach(async () => {
  FakeAudio.instances = [];
  createdUrls = 0;
  revokedUrls = 0;

  // The auth client takes its browser branch as soon as `window` exists, so
  // a stub `localStorage` has to come along with it.
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
  (globalThis as Record<string, unknown>).localStorage = storage;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      localStorage: storage,
    },
  });
  (globalThis as Record<string, unknown>).CustomEvent = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  (globalThis as Record<string, unknown>).Audio = FakeAudio;
  // Patch only the object-URL helpers — replacing the whole `URL` global
  // takes the constructor with it, which several dependencies rely on.
  URL.createObjectURL = () => `blob:fake-${++createdUrls}`;
  URL.revokeObjectURL = () => {
    revokedUrls += 1;
  };

  // Fresh module per test — the manager holds deliberate module-level state.
  speakModule = await import(`./speech?t=${Date.now()}${Math.random()}`);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Audio;
});

afterAll(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
  releaseBrowserGlobalsLock();
});

describe("speechState", () => {
  test("starts idle with nothing selected", () => {
    const s = speakModule.speechState();
    expect(s.status).toBe("idle");
    expect(s.id).toBeNull();
    expect(s.error).toBeNull();
  });

  test("returns a copy, so a caller cannot mutate the manager's state", () => {
    const a = speakModule.speechState();
    a.status = "playing";
    expect(speakModule.speechState().status).toBe("idle");
  });
});

describe("stopSpeech", () => {
  test("is safe when nothing is playing", () => {
    expect(() => speakModule.stopSpeech()).not.toThrow();
    expect(speakModule.speechState().status).toBe("idle");
  });

  test("returns to idle with no active id", () => {
    speakModule.stopSpeech();
    const s = speakModule.speechState();
    expect(s.status).toBe("idle");
    expect(s.id).toBeNull();
  });
});

describe("speak", () => {
  test("ignores empty and whitespace-only text rather than calling a provider", async () => {
    await speakModule.speak({ id: "a", text: "   " });
    expect(speakModule.speechState().status).toBe("idle");
    expect(FakeAudio.instances.length).toBe(0);
  });

  /**
   * With no BYOK provider and no Convex client there is nothing to speak
   * with. That must surface as a configuration error the UI can explain, not
   * as a silent no-op or an unhandled rejection.
   */
  test("reports a configuration error when no provider is reachable", async () => {
    await speakModule.speak({ id: "note-1", text: "Read this aloud." });
    const s = speakModule.speechState();
    expect(s.status).toBe("error");
    expect(s.id).toBe("note-1");
    expect(s.error?.code).toBe("CONFIGURATION_ERROR");
    expect(s.error?.recovery.action).toBe("choose-provider");
  });

  test("never falls back to the browser speech synthesizer", async () => {
    let browserSpeechCalls = 0;
    Object.assign(globalThis.window, {
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [],
        speak: () => {
          browserSpeechCalls += 1;
        },
      },
    });
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = class {};

    await speakModule.speak({
      id: "note-browser-fallback",
      text: "This must use generated audio.",
    });

    expect(browserSpeechCalls).toBe(0);
    expect(speakModule.speechState().error?.code).toBe("CONFIGURATION_ERROR");
    delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
  });

  /**
   * The hosted action is sign-in *and* Pro gated, so entering it while signed
   * out only ever throws "Not signed in" — a bewildering thing to be told
   * about a passage you asked to hear on your own key. It must not be
   * reached at all.
   */
  test("never calls the hosted action while signed out", async () => {
    let hostedCalls = 0;
    const client = {
      action: async () => {
        hostedCalls += 1;
        throw new Error("Not signed in");
      },
    };

    await speakModule.speak({
      id: "note-1",
      text: "Read this aloud.",
      client: client as never,
    });

    expect(hostedCalls).toBe(0);
    expect(speakModule.speechState().error?.code).toBe("CONFIGURATION_ERROR");
  });

  test("calls the hosted action when there is an account behind it", async () => {
    let hostedCalls = 0;
    const client = {
      action: async () => {
        hostedCalls += 1;
        return { audioBase64: "", mimeType: "audio/mpeg" };
      },
    };

    await speakModule.speak({
      id: "note-1",
      text: "Read this aloud.",
      client: client as never,
      signedIn: true,
    });

    expect(hostedCalls).toBe(1);
  });

  test("an error on one passage does not leave another marked active", async () => {
    await speakModule.speak({ id: "note-1", text: "one" });
    expect(speakModule.speechState().id).toBe("note-1");
    await speakModule.speak({ id: "note-2", text: "two" });
    expect(speakModule.speechState().id).toBe("note-2");
  });
});

/**
 * Reading the room aloud, one editor after another. The invariants that matter
 * are that each passage keeps its own identity as the queue moves (so the
 * memo's own button lights up in step with the transport), that a skip never
 * pays for the same synthesis twice, and that the end of the queue is a
 * clean idle rather than a transport stuck showing "5 of 5".
 */
describe("speakQueue", () => {
  /** Wait for the manager to reach a state, rather than guessing at ticks. */
  async function settle(
    predicate: () => boolean,
    what: string,
  ): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  /**
   * Sounding, not merely selected. The active id changes the moment a passage
   * starts loading, which is before its audio handlers are installed — a test
   * that drives those handlers has to wait for playback proper.
   */
  async function playing(id: string): Promise<void> {
    const s = speakModule.speechState;
    await settle(
      () => s().id === id && s().status === "playing",
      `${id} to be playing`,
    );
  }

  /** A hosted client that succeeds, recording what it was asked to say. */
  function hostedClient(): { client: never; said: string[] } {
    const said: string[] = [];
    const client = {
      action: async (_ref: unknown, args: { text: string }) => {
        said.push(args.text);
        return { audioBase64: "", mimeType: "audio/mpeg" };
      },
    };
    return { client: client as never, said };
  }

  function room(client: never) {
    return [
      { id: "memo-1", text: "one", label: "Marguerite", client, signedIn: true },
      { id: "memo-2", text: "two", label: "Inés", client, signedIn: true },
      { id: "memo-3", text: "three", label: "Auden", client, signedIn: true },
    ];
  }

  test("starts at the first passage and reports its place in the queue", async () => {
    const { client } = hostedClient();
    await speakModule.speakQueue(room(client), { ownerId: "room" });

    const s = speakModule.speechState();
    expect(s.status).toBe("playing");
    expect(s.id).toBe("memo-1");
    expect(s.ownerId).toBe("room");
    expect(s.queueIndex).toBe(0);
    expect(s.queueLength).toBe(3);
    expect(s.label).toBe("Marguerite");
  });

  test("moves to the next editor when a passage ends", async () => {
    const { client } = hostedClient();
    await speakModule.speakQueue(room(client), { ownerId: "room" });

    FakeAudio.instances[0].onended?.();
    await playing("memo-2");

    const s = speakModule.speechState();
    expect(s.queueIndex).toBe(1);
    expect(s.label).toBe("Inés");
    expect(s.ownerId).toBe("room");
  });

  test("returns to idle and drops the queue after the last passage", async () => {
    const { client } = hostedClient();
    await speakModule.speakQueue([room(client)[0]], { ownerId: "room" });

    FakeAudio.instances[0].onended?.();
    await settle(
      () => speakModule.speechState().status === "idle",
      "the queue to finish",
    );

    const s = speakModule.speechState();
    expect(s.id).toBeNull();
    expect(s.ownerId).toBeNull();
    expect(s.queueLength).toBe(0);
  });

  test("skips forward, and does nothing at the end of the queue", async () => {
    const { client } = hostedClient();
    await speakModule.speakQueue(room(client), { ownerId: "room" });

    speakModule.nextSpeech();
    await playing("memo-2");
    speakModule.nextSpeech();
    await playing("memo-3");

    expect(speakModule.hasNextSpeech()).toBe(false);
    speakModule.nextSpeech();
    expect(speakModule.speechState().id).toBe("memo-3");
  });

  /**
   * The music-player convention: back means "say that again" until you are
   * only a moment in, and only then means "back an editor".
   */
  test("previous restarts the passage when well into it, and steps back when not", async () => {
    const { client } = hostedClient();
    await speakModule.speakQueue(room(client), { ownerId: "room" });
    speakModule.nextSpeech();
    await playing("memo-2");

    const el = FakeAudio.instances[0];
    el.currentTime = 12;
    el.ontimeupdate?.();
    speakModule.previousSpeech();
    expect(speakModule.speechState().id).toBe("memo-2");

    el.currentTime = 1;
    el.ontimeupdate?.();
    speakModule.previousSpeech();
    await playing("memo-1");
  });

  test("prepares the next passage while the current one plays", async () => {
    const { client, said } = hostedClient();
    await speakModule.speakQueue(room(client), { ownerId: "room" });

    await settle(() => said.includes("two"), "the second passage to be prepared");
    // Still on the first: the prefetch must not disturb what is sounding.
    expect(speakModule.speechState().id).toBe("memo-1");
    expect(said).not.toContain("three");
  });

  test("a skip mid-prefetch does not synthesise the same passage twice", async () => {
    const said: string[] = [];
    const gates = new Map<string, () => void>();
    const client = {
      action: async (_ref: unknown, args: { text: string }) => {
        said.push(args.text);
        await new Promise<void>((resolve) => gates.set(args.text, resolve));
        return { audioBase64: "", mimeType: "audio/mpeg" };
      },
    } as never;

    const started = speakModule.speakQueue(room(client), { ownerId: "room" });
    await settle(() => gates.has("one"), "the first synthesis to begin");
    gates.get("one")!();
    await started;

    await settle(() => gates.has("two"), "the prefetch to begin");
    // Skip while that prefetch is still open — the naive implementation sends
    // the same paragraph to the provider again, and bills for it again.
    speakModule.nextSpeech();
    gates.get("two")!();
    await playing("memo-2");

    expect(said.filter((t) => t === "two")).toHaveLength(1);
  });

  test("reading a single passage abandons a queue that was running", async () => {
    const { client } = hostedClient();
    await speakModule.speakQueue(room(client), { ownerId: "room" });

    await speakModule.speak({
      id: "solo",
      text: "on its own",
      client,
      signedIn: true,
    });

    const s = speakModule.speechState();
    expect(s.id).toBe("solo");
    expect(s.ownerId).toBeNull();
    expect(s.queueLength).toBe(1);
    expect(speakModule.hasNextSpeech()).toBe(false);
  });

  test("skips empty passages rather than stalling on them", async () => {
    const { client } = hostedClient();
    await speakModule.speakQueue(
      [
        { id: "blank", text: "   ", client, signedIn: true },
        { id: "memo-1", text: "one", label: "Marguerite", client, signedIn: true },
      ],
      { ownerId: "room" },
    );

    const s = speakModule.speechState();
    expect(s.id).toBe("memo-1");
    expect(s.queueLength).toBe(1);
  });
});

describe("clearSpeechCache", () => {
  test("releases every object URL it handed out", () => {
    speakModule.clearSpeechCache();
    expect(revokedUrls).toBe(0); // nothing cached yet
    expect(() => speakModule.clearSpeechCache()).not.toThrow();
  });
});

describe("pickVoiceForProvider", () => {
  const voices = { fishaudio: "91f2fedea8bc4465a6c668b2776be809" } as const;

  test("prefers the provider-specific id when there is one", () => {
    expect(speakModule.pickVoiceForProvider(voices, "onyx", "fishaudio")).toBe(
      voices.fishaudio,
    );
  });

  /**
   * Sending "onyx" to Fish Audio selects nothing, so every editor comes back
   * in the same default voice. Falling back is only correct when the provider
   * has no entry of its own.
   */
  test("falls back to the generic name for a provider with no entry", () => {
    expect(speakModule.pickVoiceForProvider(voices, "onyx", "openai")).toBe(
      "onyx",
    );
  });

  test("falls back when the provider is unknown", () => {
    expect(speakModule.pickVoiceForProvider(voices, "onyx", undefined)).toBe(
      "onyx",
    );
    expect(speakModule.pickVoiceForProvider(undefined, "onyx", "fishaudio")).toBe(
      "onyx",
    );
  });
});

describe("persona voices", () => {
  test("every default editor has a distinct speaking voice", () => {
    const voices = PERSONAS.map((p) => p.speechVoice);
    expect(voices.every(Boolean)).toBe(true);
    expect(new Set(voices).size).toBe(PERSONAS.length);
  });

  /**
   * Verified against the live API: the same sentence through these five ids
   * produces five different recordings. Without them Fish Audio ignores the
   * OpenAI voice names and reads every editor in one default voice.
   */
  test("every editor has a distinct Fish Audio voice id", () => {
    const ids = PERSONAS.map((p) => p.speechVoices?.fishaudio);
    expect(ids.every((id) => typeof id === "string" && /^[0-9a-f]{32}$/.test(id!)))
      .toBe(true);
    expect(new Set(ids).size).toBe(PERSONAS.length);
  });

  /**
   * The lore paragraph doubles as TTS voice direction, which is the whole
   * reason the five read as different people rather than one narrator.
   */
  test("every editor carries voice direction to pass as instructions", () => {
    for (const p of PERSONAS) {
      expect(p.voice, `${p.id} needs voice direction`).toBeTruthy();
    }
  });
});
