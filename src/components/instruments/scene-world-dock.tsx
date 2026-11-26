import {
  component$,
  useStore,
  useStyles$,
  useVisibleTask$,
  type QRL,
} from "@qwik.dev/core";
import {
  saveScenePicture,
  type ScenePassage,
  type ScenePicture,
  type SceneProposal,
} from "../../utils/scene-bench";
import {
  describeSceneWorld,
  finishSceneWorldSession,
  startSceneWorldSession,
  type SceneWorldCapability,
  type SceneWorldPerspective,
} from "../../utils/scene-world";
import { readScenePicture } from "../../utils/scene-media";
import { getCachedAiSettings } from "../../utils/ai-orchestrator";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { openInstrumentDock } from "../../utils/instrument-dock";
import { SCENE_WORLD_DOCK_EVENT } from "../../utils/scene-world-dock";
import {
  SceneWorldStage,
  type SceneWorldUndockPayload,
} from "./scene-world-stage";

export interface SceneWorldDockProps {
  folioId: string;
  /** Latest plain text of the active manuscript so the live world can follow edits. */
  liveDocumentText?: string;
  onSnapshotSaved$?: QRL<(picture: ScenePicture) => Promise<void> | void>;
}

/**
 * Extract the updated slice of the manuscript around the original passage's
 * offset so edits inside or near the scene stay aligned with the live world.
 */
function deriveLivePassage(
  base: ScenePassage,
  liveDocumentText: string | undefined,
): ScenePassage {
  if (!liveDocumentText || !liveDocumentText.trim()) return base;
  const start = Math.max(0, Math.min(base.sourceOffset, liveDocumentText.length));
  const windowLength = Math.max(base.text.length + 240, 600);
  const rawSlice = liveDocumentText.slice(start, start + windowLength).trim();
  if (!rawSlice) return base;
  return {
    ...base,
    text: rawSlice,
  };
}

export const SceneWorldDock = component$<SceneWorldDockProps>((props) => {
  const auth = useAuth();
  const client = useConvexClient();

  const state = useStore({
    open: false,
    minimized: false,
    expanded: false,
    passage: null as ScenePassage | null,
    proposals: [] as SceneProposal[],
    perspective: "first-person" as SceneWorldPerspective,
    referencePicture: null as ScenePicture | null,
    preview: false,
    autoStart: false,
    capability: undefined as SceneWorldCapability | undefined,
    snapshotStatus: "",
    liveContentText: "",
  });

  useStyles$(`
    .scene-world-dock {
      position: fixed;
      z-index: 76;
      right: 1rem;
      bottom: 1rem;
      width: min(30rem, calc(100vw - 2rem));
      max-height: min(82dvh, 46rem);
      overflow-y: auto;
      border: 1px solid var(--color-ink);
      border-radius: 3px;
      background: var(--color-paper);
      color: var(--color-ink);
      box-shadow: 0 1rem 3rem #0004;
      font: 0.875rem/1.5 var(--font-sans);
    }
    .scene-world-dock--expanded {
      width: min(44rem, calc(100vw - 2rem));
    }
    .scene-world-dock__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--color-paper-3);
      background: var(--color-paper-soft);
    }
    .scene-world-dock__title {
      font: 0.72rem/1.2 var(--font-typewriter, monospace);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--color-ink-light);
    }
    .scene-world-dock__actions {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .scene-world-dock__actions button {
      border: 1px solid var(--color-ink-light);
      background: transparent;
      color: var(--color-ink);
      padding: 0.2rem 0.5rem;
      font: 500 0.75rem/1.3 var(--font-sans);
      cursor: pointer;
    }
    .scene-world-dock__body {
      padding: 0.875rem;
    }
    .scene-world-dock__body button {
      padding: 0.45rem 0.65rem;
      border: 1px solid var(--color-ink-light);
      min-block-size: 2.25rem;
      background: transparent;
      color: var(--color-ink);
      font: 500 0.8125rem/1.3 var(--font-sans);
      cursor: pointer;
    }
    .scene-world-dock__body button:disabled {
      opacity: 0.6;
      cursor: default;
    }
  `);

  // Close the dock if the writer switches to a different folio.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const folioId = track(() => props.folioId);
    if (state.open && state.passage && state.passage.id !== folioId) {
      state.open = false;
    }
  });

  // Listen for undock requests from Scene Bench.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const onOpen = async (event: Event) => {
      const detail = (event as CustomEvent<SceneWorldUndockPayload>).detail;
      if (!detail?.passage) return;
      state.passage = detail.passage;
      state.proposals = detail.proposals ?? [];
      state.perspective = detail.perspective ?? "first-person";
      state.referencePicture = detail.referencePicture ?? null;
      state.preview = Boolean(detail.preview);
      state.autoStart = Boolean(detail.autoStart);
      state.minimized = false;
      state.snapshotStatus = "";
      state.open = true;

      try {
        const settings = await getCachedAiSettings();
        state.capability = await describeSceneWorld(settings, {
          client: client.value ?? null,
          signedIn: hasAuthenticatedConvexIdentity(auth.value),
        });
      } catch {
        // Keep previous capability if lookup fails.
      }
    };
    const onContent = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      if (typeof detail?.text === "string") {
        state.liveContentText = detail.text;
      }
    };
    window.addEventListener(SCENE_WORLD_DOCK_EVENT, onOpen);
    window.addEventListener("twyne:content", onContent);
    cleanup(() => {
      window.removeEventListener(SCENE_WORLD_DOCK_EVENT, onOpen);
      window.removeEventListener("twyne:content", onContent);
    });
  });

  if (!state.open || !state.passage) return null;

  const livePassage = deriveLivePassage(
    state.passage,
    props.liveDocumentText || state.liveContentText || undefined,
  );

  return (
    <aside
      class={[
        "scene-world-dock",
        state.expanded ? "scene-world-dock--expanded" : "",
      ]}
      aria-label="Interactive Scene World"
    >
      <div class="scene-world-dock__bar">
        <span class="scene-world-dock__title">Scene World · Genie 4</span>
        <div class="scene-world-dock__actions">
          <button
            type="button"
            onClick$={() => {
              state.expanded = !state.expanded;
            }}
          >
            {state.expanded ? "Narrow" : "Widen"}
          </button>
          <button
            type="button"
            onClick$={() => {
              state.minimized = !state.minimized;
            }}
          >
            {state.minimized ? "Show" : "Hide"}
          </button>
          <button
            type="button"
            onClick$={() => {
              openInstrumentDock("scene", livePassage.text, livePassage);
            }}
          >
            Scene Bench
          </button>
          <button
            type="button"
            onClick$={() => {
              state.open = false;
            }}
          >
            Close
          </button>
        </div>
      </div>

      {!state.minimized && (
        <div class="scene-world-dock__body">
          <SceneWorldStage
            passage={livePassage}
            proposals={state.proposals}
            referencePicture={state.referencePicture}
            capability={state.capability}
            compact
            initialPerspective={state.perspective}
            initialPreview={state.preview}
            autoStart={state.autoStart}
            onStartSession$={async ({ preview }) => {
              const settings = await getCachedAiSettings();
              return startSceneWorldSession({
                settings,
                client: client.value ?? null,
                preview,
              });
            }}
            onFinishSession$={async ({ token, elapsedSeconds, reason }) => {
              await finishSceneWorldSession({
                token,
                elapsedSeconds,
                reason,
                client: client.value ?? null,
              });
              if (token.source === "twyne") {
                const settings = await getCachedAiSettings();
                state.capability = await describeSceneWorld(settings, {
                  client: client.value ?? null,
                  signedIn: hasAuthenticatedConvexIdentity(auth.value),
                });
              }
            }}
            onSnapshot$={async (picture) => {
              state.snapshotStatus =
                "Saved snapshot. Comparing with your passage…";
              await saveScenePicture(picture).catch(() => undefined);
              try {
                const settings = await getCachedAiSettings();
                const reading = await readScenePicture(
                  picture,
                  settings,
                  client.value ?? null,
                );
                const full = reading ? { ...picture, reading } : picture;
                await saveScenePicture(full).catch(() => undefined);
                await props.onSnapshotSaved$?.(full);
                state.snapshotStatus = reading
                  ? "Snapshot compared with your page. Open Scene Bench to inspect."
                  : "Snapshot saved to Scene Bench.";
              } catch {
                state.snapshotStatus = "Snapshot saved to Scene Bench.";
              }
            }}
          />
          {state.snapshotStatus && (
            <p class="scene-bench__method" role="status">
              {state.snapshotStatus}
            </p>
          )}
        </div>
      )}
    </aside>
  );
});
