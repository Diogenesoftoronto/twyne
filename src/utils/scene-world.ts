/**
 * Genie 4 interactive scene worlds for Scene Bench and the dockable World Window.
 *
 * A world session streams live 24fps 16:9 video and 48kHz stereo audio over
 * WebRTC via the Gemini Interactions API (`v1beta`, `models/genie-4`), or runs
 * a zero-cost local interactive canvas preview for testing and offline work.
 *
 * Because live Genie 4 sessions bill continuously (~$0.10/sec), every session
 * requires explicit opt-in, exposes live elapsed time and estimated cost, and
 * guarantees `complete()` on stop, idle timeout, duration cap, unmount, or
 * page unload.
 */
import type { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { AiSettings, SceneMediaSettings } from "../types";
import { resolveFeatureConfig } from "./ai-client";
import {
  SCENE_DIMENSIONS,
  type SceneDimension,
  type SceneInventory,
  type ScenePassage,
  type ScenePicture,
  type SceneProposal,
} from "./scene-bench";
import {
  clampWorldIdleSeconds,
  clampWorldMaxSeconds,
  hostedSceneWorldCostLabel,
  SCENE_WORLD_MIN_CREDIT_MICROS,
} from "./scene-media-credit";
import { sceneMediaSettings } from "./scene-media";

export const SCENE_WORLD_MODEL = "models/genie-4";
export const MAX_SCENE_WORLD_EXCERPT = 3_200;

export type SceneWorldPerspective = "first-person" | "observer";
export type SceneWorldControlKey =
  | "w"
  | "a"
  | "s"
  | "d"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

export type SceneWorldSessionStatus =
  | "idle"
  | "connecting"
  | "live"
  | "stopping"
  | "stopped"
  | "error";

export interface SceneWorldSetupPayload {
  event_type: "world_setup";
  world_prompt: {
    text: string;
    reference_image?: {
      data: string;
      mime_type: string;
    };
  };
  audio: {
    enabled: true;
    sample_rate_hz: 48000;
    channels: 2;
  };
}

export interface SceneWorldUserAction {
  event_type: "user_action";
  keys: SceneWorldControlKey[];
  look_delta?: {
    dx: number;
    dy: number;
  };
}

export interface SceneWorldSteerEvent {
  event_type: "text_input";
  text: string;
}

export interface SceneWorldSessionToken {
  interactionId: string;
  authToken: string;
  model: string;
  source: "twyne" | "provider" | "preview";
  destination: string;
  maxSeconds: number;
  idleSeconds: number;
  expiresAt?: number;
  transportUrl?: string;
  completeUrl?: string;
}

export interface SceneWorldCapability {
  available: boolean;
  enabled: boolean;
  source: "twyne" | "provider";
  destination: string;
  costLabel: string;
  maxSeconds: number;
  idleSeconds: number;
  unavailableReason?: string;
  availableMicros?: number;
}

export interface SceneWorldTransport {
  readonly kind: "webrtc" | "preview";
  attachMedia(elements: {
    video?: HTMLVideoElement | null;
    canvas?: HTMLCanvasElement | null;
  }): void;
  sendSetup(payload: SceneWorldSetupPayload): Promise<void>;
  sendAction(action: SceneWorldUserAction): void;
  sendSteer(event: SceneWorldSteerEvent): Promise<void>;
  setAudio(options: { muted: boolean; volume: number }): void;
  captureFrame(): { base64: string; mediaType: "image/png" } | null;
  complete(options?: { keepalive?: boolean }): Promise<void>;
}

const hostedAccess = makeFunctionReference<
  "action",
  Record<string, never>,
  { eligible: boolean; availableMicros: number }
>("sceneMedia:access");

const hostedWorldSession = makeFunctionReference<
  "action",
  { maxSeconds: number },
  {
    interactionId: string;
    authToken: string;
    model: string;
    expiresAt: number;
    transportUrl?: string;
    completeUrl?: string;
  }
>("sceneMedia:worldSession");

const hostedCompleteWorldSession = makeFunctionReference<
  "action",
  {
    interactionId: string;
    elapsedSeconds: number;
    reason: "writer" | "idle" | "cap" | "unmount" | "error";
  },
  { ok: boolean }
>("sceneMedia:completeWorldSession");

export function worldSettingsFrom(settings: AiSettings): {
  enabled: boolean;
  source: "twyne" | "provider";
  maxSeconds: number;
  idleSeconds: number;
} {
  const media: SceneMediaSettings = sceneMediaSettings(settings);
  return {
    enabled: media.worldEnabled === true,
    source: media.worldSource ?? media.source ?? "twyne",
    maxSeconds: clampWorldMaxSeconds(media.worldMaxSeconds),
    idleSeconds: clampWorldIdleSeconds(media.worldIdleSeconds),
  };
}

/** Describe where a Genie 4 world session would connect and what it costs. */
export async function describeSceneWorld(
  settings: AiSettings,
  options: { client: ConvexClient | null; signedIn: boolean },
): Promise<SceneWorldCapability> {
  const world = worldSettingsFrom(settings);
  const base = {
    enabled: world.enabled,
    source: world.source,
    maxSeconds: world.maxSeconds,
    idleSeconds: world.idleSeconds,
  };

  if (world.source === "provider") {
    const resolved = resolveFeatureConfig(settings, "scene-world");
    return resolved
      ? {
          ...base,
          available: true,
          destination: `${resolved.provider.name} · ${resolved.model}`,
          costLabel: `Billed to your Google Gemini API key (~$0.10/sec · auto-stops at ${world.maxSeconds}s).`,
        }
      : {
          ...base,
          available: false,
          destination: "Your Google Gemini key",
          costLabel: "Billed to your Google Gemini API key (~$0.10/sec).",
          unavailableReason:
            "Turn on your own providers in Settings and add a paid-tier Google (Gemini) provider to run Genie 4 on your own key.",
        };
  }

  const hosted = {
    ...base,
    destination: "Twyne · Genie 4",
    costLabel: hostedSceneWorldCostLabel(world.maxSeconds),
  };

  if (!options.signedIn || !options.client) {
    return {
      ...hosted,
      available: false,
      unavailableReason: "Sign in to explore worlds on Twyne's hosted Genie 4.",
    };
  }
  if (!world.enabled) return { ...hosted, available: true };

  try {
    const access = await options.client.action(hostedAccess, {});
    const enoughCredit =
      access.eligible && access.availableMicros >= SCENE_WORLD_MIN_CREDIT_MICROS;
    return enoughCredit
      ? { ...hosted, available: true, availableMicros: access.availableMicros }
      : {
          ...hosted,
          available: false,
          availableMicros: access.availableMicros,
          unavailableReason: !access.eligible
            ? "Hosted Genie 4 worlds need Pro or welcome credit. You can use your own Google Gemini key in Settings, or try the local preview."
            : "Hosted Genie 4 worlds need at least $1.00 in available credit. Add credit, use your own Google Gemini key, or try the local preview.",
        };
  } catch (error) {
    return {
      ...hosted,
      available: false,
      unavailableReason:
        error instanceof Error
          ? error.message
          : "Hosted Genie 4 worlds are unavailable right now.",
    };
  }
}

function worldExcerpt(text: string): string {
  return text.length > MAX_SCENE_WORLD_EXCERPT
    ? `${text.slice(0, MAX_SCENE_WORLD_EXCERPT)}…`
    : text;
}

/**
 * Build the mandatory Genie 4 `world_setup` payload from a Scene Bench passage,
 * saved writer ideas, chosen camera perspective, and optional Scene Picture seed.
 */
export function createSceneWorldSetupPayload(
  inventory: SceneInventory,
  proposals: readonly SceneProposal[] = [],
  options: {
    perspective?: SceneWorldPerspective;
    referencePicture?: Pick<ScenePicture, "base64" | "mediaType"> | null;
  } = {},
): SceneWorldSetupPayload | null {
  if (inventory.status !== "ready") return null;
  const perspective = options.perspective ?? "first-person";
  const cueLines = SCENE_DIMENSIONS.flatMap(({ id, label }) => {
    const hits = inventory.dimensions[id];
    if (!hits.length) return [];
    const snippet = inventory.spans.find((s) => s.id === hits[0]?.spanId)?.text;
    return snippet ? [`- ${label}: ${snippet}`] : [];
  });
  const missing = SCENE_DIMENSIONS.filter(
    ({ id }) => !inventory.dimensions[id].length,
  ).map(({ label }) => label.toLowerCase());
  const ideas = proposals
    .filter((p) => p.origin === "writer" && p.text.trim())
    .map(
      (p) =>
        `- ${SCENE_DIMENSIONS.find(({ id }) => id === p.dimension)?.label ?? "Idea"}: ${p.text.trim()}`,
    );

  const text = [
    perspective === "first-person"
      ? "Interactive first-person navigable 3D world grounded in this passage of fiction. Render continuous photorealistic 16:9 spatial detail with natural physics and synchronized 48kHz stereo ambient sound."
      : "Interactive quiet-observer navigable 3D world grounded in this passage of fiction. Hold a calm, cinematic camera that can glide through the space with synchronized 48kHz stereo ambient sound.",
    `Passage:\n${worldExcerpt(inventory.passage.text)}`,
    cueLines.length
      ? `Explicit sensory anchors from the page:\n${cueLines.join("\n")}`
      : "",
    missing.length
      ? `The passage leaves these dimensions open (${missing.join(", ")}); fill them plausibly and cohesively without contradicting the page.`
      : "",
    ideas.length
      ? `Include these writer-proposed scene details:\n${ideas.join("\n")}`
      : "",
    "No on-screen text, captions, HUD overlays, or borders. Prioritize spatial detail, lighting fidelity, and layered ambient audio.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const reference_image =
    options.referencePicture?.base64 && options.referencePicture?.mediaType
      ? {
          data: options.referencePicture.base64,
          mime_type: options.referencePicture.mediaType,
        }
      : undefined;

  return {
    event_type: "world_setup",
    world_prompt: {
      text,
      ...(reference_image ? { reference_image } : {}),
    },
    audio: {
      enabled: true,
      sample_rate_hz: 48000,
      channels: 2,
    },
  };
}

export interface SceneWorldSteerInput {
  kind: "idea" | "passage-update" | "custom";
  text: string;
  dimension?: SceneDimension;
  previousPassage?: string;
}

/** Format a mid-stream Genie 4 natural-language steering event. */
export function createSceneWorldSteerEvent(
  input: SceneWorldSteerInput,
): SceneWorldSteerEvent | null {
  const trimmed = input.text.trim();
  if (!trimmed) return null;

  if (input.kind === "idea") {
    const label =
      SCENE_DIMENSIONS.find(({ id }) => id === input.dimension)?.label ??
      "Scene";
    return {
      event_type: "text_input",
      text: `Update the live world to introduce this ${label.toLowerCase()} detail seamlessly while preserving the rest of the environment: ${trimmed}`,
    };
  }

  if (input.kind === "passage-update") {
    const excerpt = worldExcerpt(trimmed);
    const diffHint =
      input.previousPassage && input.previousPassage.trim() !== trimmed
        ? "Reflect the writer's latest changes in lighting, objects, spatial layout, and ambient sound without resetting the camera position."
        : "Align the live world with the current passage.";
    return {
      event_type: "text_input",
      text: `${diffHint}\n\nUpdated passage:\n${excerpt}`,
    };
  }

  return {
    event_type: "text_input",
    text: trimmed.slice(0, 600),
  };
}

/** Valid WASD / Arrow keys accepted by Genie 4 navigation. */
const CONTROL_KEY_MAP: Record<string, SceneWorldControlKey> = {
  w: "w",
  W: "w",
  a: "a",
  A: "a",
  s: "s",
  S: "s",
  d: "d",
  D: "d",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};

export function normalizeWorldControlKey(
  key: string,
): SceneWorldControlKey | null {
  return CONTROL_KEY_MAP[key] ?? null;
}

/** Provision a Genie 4 interaction session token (hosted, BYOK Google, or local preview). */
export async function startSceneWorldSession(options: {
  settings: AiSettings;
  client: ConvexClient | null;
  preview?: boolean;
}): Promise<SceneWorldSessionToken> {
  const world = worldSettingsFrom(options.settings);

  if (options.preview) {
    return {
      interactionId: `preview-${Date.now().toString(36)}`,
      authToken: "preview-local",
      model: `${SCENE_WORLD_MODEL} (interactive preview)`,
      source: "preview",
      destination: "Interactive local preview (no charge)",
      maxSeconds: world.maxSeconds,
      idleSeconds: world.idleSeconds,
    };
  }

  if (!world.enabled) {
    throw new Error(
      "Turn on Interactive Scene Worlds in Settings → Scene Pictures before entering a live world.",
    );
  }

  if (world.source === "provider") {
    const resolved = resolveFeatureConfig(options.settings, "scene-world");
    if (!resolved || resolved.provider.type !== "google") {
      throw new Error(
        "Configure a paid-tier Google (Gemini) provider in Settings to run Genie 4 on your own key.",
      );
    }
    const apiKey = resolved.provider.apiKey?.trim();
    if (!apiKey) {
      throw new Error("Add your Google Gemini API key in Settings first.");
    }
    const baseUrl = (
      resolved.provider.baseUrl?.trim() ||
      "https://generativelanguage.googleapis.com"
    ).replace(/\/+$/, "");
    const model = resolved.model || SCENE_WORLD_MODEL;

    // Step 1: Create the Gemini v1beta Interaction session
    const createRes = await fetch(`${baseUrl}/v1beta/interactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({ model }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => "");
      throw new Error(
        `Gemini Genie 4 session failed (${createRes.status}): ${detail.slice(0, 180) || createRes.statusText}`,
      );
    }
    const created = (await createRes.json()) as { id?: string; name?: string };
    const interactionId = created.id || created.name;
    if (!interactionId) {
      throw new Error("Gemini did not return a Genie 4 interaction id.");
    }

    // Step 2: Mint a single-session ephemeral auth token for WebRTC
    const tokenRes = await fetch(
      `${baseUrl}/v1beta/interactions/${encodeURIComponent(interactionId)}/authTokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({}),
      },
    );
    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => "");
      throw new Error(
        `Gemini Genie 4 auth token failed (${tokenRes.status}): ${detail.slice(0, 180) || tokenRes.statusText}`,
      );
    }
    const minted = (await tokenRes.json()) as {
      auth_token?: string;
      authToken?: string;
      expire_time?: string;
    };
    const authToken = minted.auth_token || minted.authToken;
    if (!authToken) {
      throw new Error("Gemini did not return an ephemeral Genie 4 auth token.");
    }

    return {
      interactionId,
      authToken,
      model,
      source: "provider",
      destination: `${resolved.provider.name} · ${model}`,
      maxSeconds: world.maxSeconds,
      idleSeconds: world.idleSeconds,
      expiresAt: minted.expire_time
        ? Date.parse(minted.expire_time)
        : Date.now() + world.maxSeconds * 1000,
      transportUrl: `${baseUrl}/v1beta/interactions/${encodeURIComponent(interactionId)}:connect`,
      completeUrl: `${baseUrl}/v1beta/interactions/${encodeURIComponent(interactionId)}:complete`,
    };
  }

  if (!options.client) {
    throw new Error("Sign in to start a hosted Genie 4 world session.");
  }

  const session = await options.client.action(hostedWorldSession, {
    maxSeconds: world.maxSeconds,
  });

  return {
    interactionId: session.interactionId,
    authToken: session.authToken,
    model: session.model || SCENE_WORLD_MODEL,
    source: "twyne",
    destination: "Twyne · Genie 4",
    maxSeconds: world.maxSeconds,
    idleSeconds: world.idleSeconds,
    expiresAt: session.expiresAt,
    transportUrl: session.transportUrl,
    completeUrl: session.completeUrl,
  };
}

/** Notify Convex when a hosted Genie 4 session ends so usage is recorded and server generation stops. */
export async function finishSceneWorldSession(options: {
  token: SceneWorldSessionToken;
  elapsedSeconds: number;
  reason: "writer" | "idle" | "cap" | "unmount" | "error";
  client: ConvexClient | null;
}): Promise<void> {
  if (options.token.source !== "twyne" || !options.client) return;
  try {
    await options.client.action(hostedCompleteWorldSession, {
      interactionId: options.token.interactionId,
      elapsedSeconds: Math.max(0, Math.round(options.elapsedSeconds)),
      reason: options.reason,
    });
  } catch {
    // Teardown errors must not block UI cleanup.
  }
}

/** Capture a PNG frame from a live HTMLVideoElement or HTMLCanvasElement. */
export function captureMediaFrame(
  source: HTMLVideoElement | HTMLCanvasElement | null | undefined,
): { base64: string; mediaType: "image/png" } | null {
  if (!source || typeof document === "undefined") return null;
  const width =
    source instanceof HTMLVideoElement
      ? source.videoWidth || 1280
      : source.width || 1280;
  const height =
    source instanceof HTMLVideoElement
      ? source.videoHeight || 720
      : source.height || 720;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(source, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/png");
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    return {
      base64: dataUrl.slice(comma + 1),
      mediaType: "image/png",
    };
  } catch {
    return null;
  }
}

/**
 * WebRTC transport for live Genie 4 sessions (`v1beta/interactions`).
 * Binds the incoming 720p 24fps + 48kHz stereo stream to the `<video>` element
 * and streams `world_setup`, `user_action`, and `text_input` over the data channel.
 */
export function createGenie4WebRtcTransport(
  token: SceneWorldSessionToken,
): SceneWorldTransport {
  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let completed = false;
  let muted = false;
  let volume = 0.85;
  const pendingMessages: string[] = [];

  const flushQueue = () => {
    if (!channel || channel.readyState !== "open") return;
    while (pendingMessages.length) {
      const next = pendingMessages.shift();
      if (next) channel.send(next);
    }
  };

  const sendJson = (payload: unknown) => {
    const serialized = JSON.stringify(payload);
    if (channel && channel.readyState === "open") {
      channel.send(serialized);
    } else {
      pendingMessages.push(serialized);
    }
  };

  const ensureConnected = async () => {
    if (pc) return;
    if (typeof RTCPeerConnection === "undefined") {
      throw new Error("WebRTC is not available in this browser.");
    }
    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (videoEl && stream) {
        videoEl.srcObject = stream;
        videoEl.muted = muted;
        videoEl.volume = volume;
        void videoEl.play().catch(() => undefined);
      }
    };

    channel = pc.createDataChannel("genie-events", { ordered: true });
    channel.onopen = flushQueue;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const connectUrl =
      token.transportUrl ||
      `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(token.interactionId)}:connect`;

    const res = await fetch(connectUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.authToken}`,
      },
      body: JSON.stringify({
        transport: "webrtc",
        sdp: offer.sdp,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Genie 4 WebRTC handshake failed (${res.status}): ${detail.slice(0, 180) || res.statusText}`,
      );
    }
    const answer = (await res.json()) as { sdp?: string };
    if (!answer.sdp) {
      throw new Error("Genie 4 did not return a WebRTC SDP answer.");
    }
    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
  };

  return {
    kind: "webrtc",
    attachMedia({ video }) {
      videoEl = video ?? null;
      if (videoEl) {
        videoEl.muted = muted;
        videoEl.volume = volume;
      }
    },
    async sendSetup(payload) {
      await ensureConnected();
      sendJson(payload);
    },
    sendAction(action) {
      if (completed) return;
      sendJson(action);
    },
    async sendSteer(event) {
      if (completed) return;
      sendJson(event);
    },
    setAudio(options) {
      muted = options.muted;
      volume = Math.max(0, Math.min(1, options.volume));
      if (videoEl) {
        videoEl.muted = muted;
        videoEl.volume = volume;
      }
    },
    captureFrame() {
      return captureMediaFrame(videoEl);
    },
    async complete(options) {
      if (completed) return;
      completed = true;
      try {
        channel?.close();
      } catch {
        // Ignore close errors.
      }
      try {
        pc?.close();
      } catch {
        // Ignore close errors.
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
      pc = null;
      channel = null;

      const completeUrl =
        token.completeUrl ||
        `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(token.interactionId)}:complete`;

      try {
        await fetch(completeUrl, {
          method: "POST",
          keepalive: options?.keepalive === true,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token.authToken}`,
          },
          body: JSON.stringify({}),
        });
      } catch {
        // Best-effort remote completion.
      }
    },
  };
}

/**
 * Interactive local 24fps 16:9 preview transport (zero cost, no API key).
 * Renders a responsive atmospheric perspective scene driven by the passage's
 * cues, WASD/arrow movement, mouse look, and live text steering — plus gentle
 * optional Web Audio ambient sound so writers can experience the full workflow
 * before enabling paid Genie 4 sessions.
 */
export function createMockSceneWorldTransport(): SceneWorldTransport {
  let canvas: HTMLCanvasElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let audioCtx: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let completed = false;
  let muted = false;
  let volume = 0.5;

  const world = {
    x: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    tick: 0,
    keys: new Set<SceneWorldControlKey>(),
    promptText: "",
    steers: [] as string[],
    hasLamp: false,
    hasRain: false,
    isNight: false,
    isDusk: false,
    isWarm: false,
    seedImage: null as HTMLImageElement | null,
  };

  const applyCues = (text: string) => {
    const lower = text.toLowerCase();
    if (/\b(lamp|candle|flicker|glow|hearth|lantern|fire)\b/.test(lower))
      world.hasLamp = true;
    if (/\b(rain|storm|drizzle|wet|thunder|puddle)\b/.test(lower))
      world.hasRain = true;
    if (/\b(night|midnight|dark|darkness|moonlight|shadow)\b/.test(lower))
      world.isNight = true;
    if (/\b(dusk|twilight|evening|sunset|amber|gold)\b/.test(lower))
      world.isDusk = true;
    if (/\b(dawn|morning|sunlight|noon|warm|kitchen|bright)\b/.test(lower))
      world.isWarm = true;
  };

  const startAmbientAudio = () => {
    if (typeof window === "undefined" || audioCtx) return;
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtor) return;
    try {
      audioCtx = new AudioCtor();
      const osc = audioCtx.createOscillator();
      const filter = audioCtx.createBiquadFilter();
      gainNode = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = world.isNight ? 74 : 98;
      filter.type = "lowpass";
      filter.frequency.value = 240;
      gainNode.gain.value = muted ? 0 : volume * 0.04;
      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.start();
    } catch {
      audioCtx = null;
      gainNode = null;
    }
  };

  const renderFrame = () => {
    if (!canvas || completed) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    world.tick += 1;
    const speed = 0.09;
    if (world.keys.has("w") || world.keys.has("ArrowUp")) {
      world.z += Math.cos(world.yaw) * speed;
      world.x += Math.sin(world.yaw) * speed;
    }
    if (world.keys.has("s") || world.keys.has("ArrowDown")) {
      world.z -= Math.cos(world.yaw) * speed;
      world.x -= Math.sin(world.yaw) * speed;
    }
    if (world.keys.has("a") || world.keys.has("ArrowLeft")) {
      world.yaw -= 0.035;
    }
    if (world.keys.has("d") || world.keys.has("ArrowRight")) {
      world.yaw += 0.035;
    }

    const w = canvas.width;
    const h = canvas.height;
    const horizon = h * (0.48 + Math.max(-0.18, Math.min(0.18, world.pitch)));

    // Sky / backdrop gradient
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    if (world.isNight) {
      sky.addColorStop(0, "#0b1020");
      sky.addColorStop(1, "#1e2740");
    } else if (world.isDusk) {
      sky.addColorStop(0, "#1d1a33");
      sky.addColorStop(0.65, "#5a3245");
      sky.addColorStop(1, "#c97a4b");
    } else if (world.isWarm) {
      sky.addColorStop(0, "#2f4858");
      sky.addColorStop(1, "#d9b98b");
    } else {
      sky.addColorStop(0, "#1b2430");
      sky.addColorStop(1, "#4c5c68");
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    // Optional seeded reference image blended into the horizon
    if (world.seedImage && world.seedImage.complete) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      const panX = ((world.yaw * 140) % w) * -0.25;
      ctx.drawImage(world.seedImage, panX - 40, 0, w + 80, h);
      ctx.restore();
    }

    // Ground plane
    const ground = ctx.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, world.isNight ? "#121620" : "#25211d");
    ground.addColorStop(1, "#0d0c0b");
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, w, h - horizon);

    // Perspective spatial grid reacting to position & yaw
    ctx.strokeStyle = world.isDusk
      ? "rgba(232, 166, 114, 0.22)"
      : "rgba(180, 198, 220, 0.16)";
    ctx.lineWidth = 1;
    const vanishX = w * 0.5 - Math.sin(world.yaw) * w * 0.28;
    for (let i = -8; i <= 8; i++) {
      const xOffset = (i - (world.x % 1)) * 90;
      ctx.beginPath();
      ctx.moveTo(vanishX + xOffset * 0.15, horizon);
      ctx.lineTo(w * 0.5 + xOffset * 1.9, h);
      ctx.stroke();
    }
    for (let row = 1; row <= 9; row++) {
      const depth = ((row - (world.z % 1) + 9) % 9) / 9;
      const y = horizon + Math.pow(depth, 1.8) * (h - horizon);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Architectural / landscape silhouettes
    ctx.fillStyle = world.isNight ? "#090c14" : "#181512";
    const shift = Math.sin(world.yaw) * 160;
    for (let i = -2; i <= 5; i++) {
      const bx = i * 160 - shift - (world.x * 24) % 160;
      const bh = 70 + ((Math.abs(i * 37) % 5) * 24);
      ctx.fillRect(bx, horizon - bh, 96, bh);
    }

    // Warm flickering lamp / doorway light if cued or steered
    if (world.hasLamp) {
      const flicker =
        0.82 + 0.18 * Math.sin(world.tick * 0.45) * Math.cos(world.tick * 0.17);
      const lx = vanishX + 64;
      const ly = horizon - 38;
      const glow = ctx.createRadialGradient(lx, ly, 4, lx, ly, 120 * flicker);
      glow.addColorStop(0, `rgba(255, 214, 130, ${0.88 * flicker})`);
      glow.addColorStop(0.45, `rgba(235, 146, 62, ${0.32 * flicker})`);
      glow.addColorStop(1, "rgba(235, 146, 62, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(lx, ly, 120 * flicker, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rain streaks if cued or steered
    if (world.hasRain) {
      ctx.strokeStyle = "rgba(195, 215, 240, 0.35)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 60; i++) {
        const rx = ((i * 97 + world.tick * 7) % (w + 60)) - 30;
        const ry = ((i * 53 + world.tick * 19) % h);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 5, ry + 18);
        ctx.stroke();
      }
    }

    // Subtle preview watermark in corner so writer knows this is the free preview
    ctx.fillStyle = "rgba(245, 240, 232, 0.72)";
    ctx.font = "12px monospace";
    const latestSteer = world.steers[world.steers.length - 1];
    ctx.fillText(
      latestSteer
        ? `PREVIEW · Steered: ${latestSteer.slice(0, 56)}`
        : "PREVIEW · WASD / Arrows to move · Drag to look",
      14,
      h - 14,
    );
  };

  return {
    kind: "preview",
    attachMedia({ canvas: el }) {
      canvas = el ?? null;
      if (canvas && !canvas.width) {
        canvas.width = 960;
        canvas.height = 540;
      }
    },
    async sendSetup(payload) {
      world.promptText = payload.world_prompt.text;
      applyCues(payload.world_prompt.text);
      if (
        payload.world_prompt.reference_image?.data &&
        typeof Image !== "undefined"
      ) {
        const img = new Image();
        img.src = `data:${payload.world_prompt.reference_image.mime_type};base64,${payload.world_prompt.reference_image.data}`;
        world.seedImage = img;
      }
      startAmbientAudio();
      if (!timer) {
        renderFrame();
        timer = setInterval(renderFrame, Math.round(1000 / 24));
      }
    },
    sendAction(action) {
      if (completed) return;
      world.keys = new Set(action.keys);
      if (action.look_delta) {
        world.yaw += action.look_delta.dx * 0.004;
        world.pitch = Math.max(
          -0.2,
          Math.min(0.2, world.pitch + action.look_delta.dy * 0.003),
        );
      }
    },
    async sendSteer(event) {
      if (completed) return;
      applyCues(event.text);
      world.steers.push(event.text);
      if (world.steers.length > 8) world.steers.shift();
      renderFrame();
    },
    setAudio(options) {
      muted = options.muted;
      volume = Math.max(0, Math.min(1, options.volume));
      if (gainNode) {
        gainNode.gain.value = muted ? 0 : volume * 0.04;
      }
    },
    captureFrame() {
      return captureMediaFrame(canvas);
    },
    async complete() {
      completed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (audioCtx) {
        void audioCtx.close().catch(() => undefined);
        audioCtx = null;
        gainNode = null;
      }
    },
  };
}

export function createSceneWorldTransport(
  token: SceneWorldSessionToken,
): SceneWorldTransport {
  if (token.source === "preview") {
    return createMockSceneWorldTransport();
  }
  return createGenie4WebRtcTransport(token);
}

/** Build a ScenePicture record from a captured Genie 4 frame so vision comparison works seamlessly. */
export function createSnapshotPicture(options: {
  passage: ScenePassage;
  base64: string;
  mediaType: string;
  destination: string;
  model: string;
}): ScenePicture {
  return {
    passage: { ...options.passage },
    mode: "imagined",
    mediaType: options.mediaType,
    base64: options.base64,
    destination: options.destination,
    model: `${options.model} (snapshot)`,
    createdAt: Date.now(),
    reading: null,
  };
}
