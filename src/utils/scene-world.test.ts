import { describe, expect, test } from "bun:test";
import type { AiSettings } from "../types";
import { createSceneInventory, type ScenePassage } from "./scene-bench";
import {
  clampWorldIdleSeconds,
  clampWorldMaxSeconds,
  estimateWorldSessionCostMicros,
  formatWorldDuration,
  hostedSceneWorldCostLabel,
  SCENE_WORLD_COST_PER_SECOND_MICROS,
  SCENE_WORLD_MIN_CREDIT_MICROS,
  worldLowCreditWarning,
} from "./scene-media-credit";
import {
  createMockSceneWorldTransport,
  createSceneWorldSetupPayload,
  createSceneWorldSteerEvent,
  createSnapshotPicture,
  describeSceneWorld,
  normalizeWorldControlKey,
  SCENE_WORLD_MODEL,
  startSceneWorldSession,
} from "./scene-world";

const passage: ScenePassage = {
  id: "folio-1",
  sourceOffset: 0,
  text: "At dusk, Mara crossed the kitchen. The lamp above the doorway flickered. She heard footsteps stop outside.",
};

function baseSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    advancedMode: false,
    providers: [],
    defaultProviderId: null,
    perFeature: {},
    showProviderTags: false,
    ...overrides,
  };
}

describe("scene world setup payload", () => {
  test("builds grounded first-person world_setup with audio, cues, ideas, and optional picture seed", () => {
    const inventory = createSceneInventory(passage);
    const payload = createSceneWorldSetupPayload(
      inventory,
      [{ dimension: "sound", text: "rain ticking on the glass", origin: "writer" }],
      {
        perspective: "first-person",
        referencePicture: {
          base64: "iVBORw0KGgo=",
          mediaType: "image/png",
        },
      },
    )!;

    expect(payload.event_type).toBe("world_setup");
    expect(payload.audio).toEqual({
      enabled: true,
      sample_rate_hz: 48000,
      channels: 2,
    });
    expect(payload.world_prompt.text).toContain("first-person");
    expect(payload.world_prompt.text).toContain(passage.text);
    expect(payload.world_prompt.text).toContain(
      "Sound: rain ticking on the glass",
    );
    expect(payload.world_prompt.reference_image).toEqual({
      data: "iVBORw0KGgo=",
      mime_type: "image/png",
    });
  });

  test("supports quiet observer mode without a reference image", () => {
    const payload = createSceneWorldSetupPayload(
      createSceneInventory(passage),
      [],
      { perspective: "observer" },
    )!;
    expect(payload.world_prompt.text).toContain("quiet-observer");
    expect(payload.world_prompt.reference_image).toBeUndefined();
  });

  test("returns null for an empty passage", () => {
    expect(
      createSceneWorldSetupPayload(
        createSceneInventory({ ...passage, text: "   " }),
      ),
    ).toBeNull();
  });
});

describe("scene world steering", () => {
  test("formats idea, passage-update, and custom steering events", () => {
    const idea = createSceneWorldSteerEvent({
      kind: "idea",
      dimension: "light",
      text: "a storm lantern swinging near the sill",
    })!;
    expect(idea.event_type).toBe("text_input");
    expect(idea.text).toContain("light detail");
    expect(idea.text).toContain("a storm lantern swinging near the sill");

    const update = createSceneWorldSteerEvent({
      kind: "passage-update",
      text: `${passage.text} Rain began to drum on the tin roof.`,
      previousPassage: passage.text,
    })!;
    expect(update.text).toContain("latest changes");
    expect(update.text).toContain("Rain began to drum on the tin roof.");

    const custom = createSceneWorldSteerEvent({
      kind: "custom",
      text: "Pan slowly toward the darkened window",
    })!;
    expect(custom.text).toBe("Pan slowly toward the darkened window");

    expect(
      createSceneWorldSteerEvent({ kind: "custom", text: "   " }),
    ).toBeNull();
  });
});

describe("world keyboard controls", () => {
  test("maps WASD and arrow keys and ignores ordinary typing keys", () => {
    expect(normalizeWorldControlKey("w")).toBe("w");
    expect(normalizeWorldControlKey("W")).toBe("w");
    expect(normalizeWorldControlKey("ArrowUp")).toBe("ArrowUp");
    expect(normalizeWorldControlKey("ArrowLeft")).toBe("ArrowLeft");
    expect(normalizeWorldControlKey("e")).toBeNull();
    expect(normalizeWorldControlKey("Enter")).toBeNull();
  });
});

describe("scene world capability & provisioning", () => {
  test("reports opt-out when worldEnabled is false", async () => {
    const cap = await describeSceneWorld(baseSettings(), {
      client: null,
      signedIn: false,
    });
    expect(cap.enabled).toBe(false);
    expect(cap.available).toBe(false);
    expect(cap.source).toBe("twyne");
  });

  test("checks hosted Not Organic credit eligibility via Convex action", async () => {
    const mockClient = {
      action: async () => ({
        eligible: true,
        availableMicros: SCENE_WORLD_MIN_CREDIT_MICROS * 4,
      }),
    } as unknown as import("convex/browser").ConvexClient;

    const cap = await describeSceneWorld(
      baseSettings({
        sceneMedia: {
          enabled: true,
          source: "twyne",
          worldEnabled: true,
          worldSource: "twyne",
          worldMaxSeconds: 90,
          worldIdleSeconds: 30,
        },
      }),
      { client: mockClient, signedIn: true },
    );

    expect(cap.enabled).toBe(true);
    expect(cap.available).toBe(true);
    expect(cap.maxSeconds).toBe(90);
    expect(cap.idleSeconds).toBe(30);
    expect(cap.availableMicros).toBe(SCENE_WORLD_MIN_CREDIT_MICROS * 4);
  });

  test("resolves BYOK Google Gemini provider for scene-world", async () => {
    const settings = baseSettings({
      advancedMode: true,
      defaultProviderId: "google-1",
      providers: [
        {
          id: "google-1",
          name: "My Gemini",
          type: "google",
          apiKey: "test-key",
          defaultModel: "gemini-2.5-flash",
        },
      ],
      sceneMedia: {
        enabled: true,
        source: "provider",
        worldEnabled: true,
        worldSource: "provider",
      },
    });

    const cap = await describeSceneWorld(settings, {
      client: null,
      signedIn: false,
    });
    expect(cap.enabled).toBe(true);
    expect(cap.available).toBe(true);
    expect(cap.destination).toContain("My Gemini");
    expect(cap.destination).toContain(SCENE_WORLD_MODEL);
  });

  test("starts a zero-cost preview session without requiring opt-in or credit", async () => {
    const token = await startSceneWorldSession({
      settings: baseSettings(),
      client: null,
      preview: true,
    });
    expect(token.source).toBe("preview");
    expect(token.authToken).toBe("preview-local");
  });

  test("starts a hosted session via Convex sceneMedia:worldSession mock", async () => {
    const mockClient = {
      action: async () => ({
        interactionId: "int-hosted-42",
        authToken: "ephemeral-token-xyz",
        model: SCENE_WORLD_MODEL,
        expiresAt: Date.now() + 120_000,
      }),
    } as unknown as import("convex/browser").ConvexClient;

    const token = await startSceneWorldSession({
      settings: baseSettings({
        sceneMedia: {
          enabled: true,
          source: "twyne",
          worldEnabled: true,
          worldSource: "twyne",
          worldMaxSeconds: 60,
        },
      }),
      client: mockClient,
      preview: false,
    });

    expect(token.source).toBe("twyne");
    expect(token.interactionId).toBe("int-hosted-42");
    expect(token.authToken).toBe("ephemeral-token-xyz");
    expect(token.maxSeconds).toBe(60);
  });
});

describe("world credit math, guardrails, and snapshots", () => {
  test("computes cost, clamping, formatting, and low-credit warnings", () => {
    expect(estimateWorldSessionCostMicros(10)).toBe(
      10 * SCENE_WORLD_COST_PER_SECOND_MICROS,
    );
    expect(clampWorldMaxSeconds(5)).toBe(30);
    expect(clampWorldMaxSeconds(999)).toBe(300);
    expect(clampWorldIdleSeconds(3)).toBe(15);
    expect(clampWorldIdleSeconds(999)).toBe(120);
    expect(formatWorldDuration(125)).toBe("02:05");
    expect(hostedSceneWorldCostLabel(60)).toContain("01:00");
    expect(hostedSceneWorldCostLabel(60)).toContain("$6.00");
    expect(worldLowCreditWarning(SCENE_WORLD_MIN_CREDIT_MICROS - 1)).toContain(
      "$1.00",
    );
    expect(worldLowCreditWarning(SCENE_WORLD_MIN_CREDIT_MICROS * 5)).toBeNull();
  });

  test("creates a ScenePicture snapshot compatible with Scene Bench comparison", () => {
    const snapshot = createSnapshotPicture({
      passage,
      base64: "iVBORw0KGgo=",
      mediaType: "image/png",
      destination: "Twyne · Genie 4",
      model: SCENE_WORLD_MODEL,
    });
    expect(snapshot.mode).toBe("imagined");
    expect(snapshot.model).toContain("snapshot");
    expect(snapshot.reading).toBeNull();
  });

  test("mock transport accepts setup, action, steer, audio, and clean completion", async () => {
    const transport = createMockSceneWorldTransport();
    const setup = createSceneWorldSetupPayload(createSceneInventory(passage))!;
    await transport.sendSetup(setup);
    transport.sendAction({
      event_type: "user_action",
      keys: ["w"],
      look_delta: { dx: 12, dy: -4 },
    });
    await transport.sendSteer({
      event_type: "text_input",
      text: "add rain on the window",
    });
    transport.setAudio({ muted: true, volume: 0.4 });
    await transport.complete();
    expect(transport.kind).toBe("preview");
  });
});
