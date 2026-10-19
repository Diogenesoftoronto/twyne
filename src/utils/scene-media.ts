/**
 * Scene Bench pictures: route one request to Twyne's hosted image model or to
 * the writer's own provider, then compare the picture with the passage.
 *
 * Nothing here runs unless the writer has switched generation on and pressed
 * Generate. The bench owns that consent; this module only does the work.
 */
import type { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { AiSettings, SceneMediaSettings } from "../types";
import { resolveFeatureConfig } from "./ai-client";
import {
  createSceneInventory,
  createScenePicturePrompt,
  createSceneReadingPrompt,
  parseSceneReading,
  SCENE_READING_SYSTEM,
  type ScenePassage,
  type ScenePicture,
  type ScenePictureMode,
  type SceneProposal,
} from "./scene-bench";
import { hostedSceneCostLabel } from "./scene-media-credit";

const hostedAccess = makeFunctionReference<
  "action",
  Record<string, never>,
  { eligible: boolean; availableMicros: number }
>("sceneMedia:access");
const hostedPicture = makeFunctionReference<
  "action",
  { prompt: string },
  { base64: string; mediaType: string; model: string }
>("sceneMedia:picture");
const hostedReading = makeFunctionReference<
  "action",
  { prompt: string; imageBase64: string; mediaType: string },
  { text: string }
>("sceneMedia:reading");

export const DEFAULT_SCENE_MEDIA: SceneMediaSettings = {
  enabled: false,
  source: "twyne",
};

export function sceneMediaSettings(settings: AiSettings): SceneMediaSettings {
  return { ...DEFAULT_SCENE_MEDIA, ...settings.sceneMedia };
}

export interface ScenePictureCapability {
  available: boolean;
  /** Generation is off until the writer turns it on in Settings. */
  enabled: boolean;
  source: SceneMediaSettings["source"];
  destination: string;
  costLabel: string;
  unavailableReason?: string;
  /** Hosted only: the wallet balance the bench warns against. */
  availableMicros?: number;
}

/** Describe where a picture would go and what it costs, without sending one. */
export async function describeScenePictures(
  settings: AiSettings,
  options: { client: ConvexClient | null; signedIn: boolean },
): Promise<ScenePictureCapability> {
  const media = sceneMediaSettings(settings);
  const base = { enabled: media.enabled, source: media.source };
  if (media.source === "provider") {
    const image = resolveFeatureConfig(settings, "scene-image");
    const reader = resolveFeatureConfig(settings, "scene-reading");
    return image
      ? {
          ...base,
          available: true,
          destination: `${image.provider.name} · ${image.model}${
            reader ? `, compared by ${reader.model}` : ""
          }`,
          costLabel: "Charged by your provider at its image price.",
        }
      : {
          ...base,
          available: false,
          destination: "Your image model",
          costLabel: "Charged by your provider.",
          unavailableReason:
            "Turn on your own providers in Settings, add an OpenAI, Google, OpenRouter, or OpenAI-compatible provider, and choose an image model for Scene Pictures.",
        };
  }
  const hosted = {
    ...base,
    destination: "Twyne's image model",
    costLabel: hostedSceneCostLabel(),
  };
  if (!options.signedIn || !options.client)
    return {
      ...hosted,
      available: false,
      unavailableReason: "Sign in to use Twyne's image model.",
    };
  if (!media.enabled) return { ...hosted, available: true };
  try {
    const access = await options.client.action(hostedAccess, {});
    return access.eligible
      ? { ...hosted, available: true, availableMicros: access.availableMicros }
      : {
          ...hosted,
          available: false,
          availableMicros: access.availableMicros,
          unavailableReason:
            "Twyne's image model needs Pro or welcome credit. You can choose your own image model in Settings.",
        };
  } catch (error) {
    return {
      ...hosted,
      available: false,
      unavailableReason:
        error instanceof Error
          ? error.message
          : "Twyne's image model is unavailable.",
    };
  }
}

export interface ScenePictureRequest {
  passage: ScenePassage;
  mode: ScenePictureMode;
  proposals: readonly SceneProposal[];
  settings: AiSettings;
  client: ConvexClient | null;
  signal?: AbortSignal;
}

/** Draw the passage. The comparison follows separately so the picture shows first. */
export async function generateScenePicture(
  request: ScenePictureRequest,
): Promise<ScenePicture> {
  const inventory = createSceneInventory(request.passage);
  const prompt = createScenePicturePrompt(
    inventory,
    request.mode,
    request.proposals,
  );
  if (!prompt) throw new Error("Select a scene before generating a picture.");
  const media = sceneMediaSettings(request.settings);
  if (!media.enabled)
    throw new Error("Turn on Scene Pictures in Settings to generate.");
  let image: { base64: string; mediaType: string };
  let destination: string;
  let model: string;
  if (media.source === "provider") {
    const { runClientScenePicture } = await import("./ai-client");
    const result = await runClientScenePicture(
      prompt,
      request.settings,
      request.signal,
    );
    if (!result)
      throw new Error("Choose an image-capable provider in Settings first.");
    image = result;
    destination = result.provider;
    model = result.model;
  } else {
    if (!request.client) throw new Error("Sign in to generate pictures.");
    const result = await request.client.action(hostedPicture, { prompt });
    image = result;
    destination = "Twyne";
    model = result.model;
  }
  return {
    passage: { ...request.passage },
    mode: request.mode,
    mediaType: image.mediaType,
    base64: image.base64,
    destination,
    model,
    createdAt: Date.now(),
    reading: null,
  };
}

/** What the picture took from the page, what it invented, what it got wrong. */
export async function readScenePicture(
  picture: ScenePicture,
  settings: AiSettings,
  client: ConvexClient | null,
  signal?: AbortSignal,
): Promise<ScenePicture["reading"]> {
  const prompt = createSceneReadingPrompt(
    createSceneInventory(picture.passage),
    picture.mode,
  );
  if (!prompt) return null;
  const image = { base64: picture.base64, mediaType: picture.mediaType };
  let raw: string | null;
  if (sceneMediaSettings(settings).source === "provider") {
    const { runClientSceneReading } = await import("./ai-client");
    raw = await runClientSceneReading(
      { system: SCENE_READING_SYSTEM, prompt, image },
      settings,
      signal,
    );
  } else {
    if (!client) return null;
    raw = (
      await client.action(hostedReading, {
        prompt,
        imageBase64: image.base64,
        mediaType: image.mediaType,
      })
    ).text;
  }
  return raw ? parseSceneReading(raw, picture.passage) : null;
}
