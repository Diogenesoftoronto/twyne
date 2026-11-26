import type { SceneWorldUndockPayload } from "../components/instruments/scene-world-stage";

export const SCENE_WORLD_DOCK_EVENT = "twyne:scene-world-dock";

export function openSceneWorldDock(payload: SceneWorldUndockPayload): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<SceneWorldUndockPayload>(SCENE_WORLD_DOCK_EVENT, {
        detail: payload,
      }),
    );
  }
}
