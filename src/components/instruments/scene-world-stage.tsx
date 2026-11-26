import {
  $,
  component$,
  noSerialize,
  sync$,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
  type NoSerialize,
  type QRL,
} from "@qwik.dev/core";
import {
  createSceneInventory,
  SCENE_DIMENSIONS,
  type ScenePassage,
  type ScenePicture,
  type SceneProposal,
} from "../../utils/scene-bench";
import {
  createSceneWorldSetupPayload,
  createSceneWorldSteerEvent,
  createSceneWorldTransport,
  createSnapshotPicture,
  normalizeWorldControlKey,
  type SceneWorldCapability,
  type SceneWorldControlKey,
  type SceneWorldPerspective,
  type SceneWorldSessionStatus,
  type SceneWorldSessionToken,
  type SceneWorldTransport,
} from "../../utils/scene-world";
import {
  estimateWorldSessionCostMicros,
  formatCreditMicros,
  formatWorldDuration,
  SCENE_WORLD_CREDIT_WARNING,
  SCENE_WORLD_DEFAULT_IDLE_SECONDS,
  SCENE_WORLD_DEFAULT_MAX_SECONDS,
  worldLowCreditWarning,
} from "../../utils/scene-media-credit";
import styles from "./scene-world-stage.css?inline";

export interface SceneWorldStartRequest {
  preview: boolean;
}

export interface SceneWorldStopReport {
  token: SceneWorldSessionToken;
  elapsedSeconds: number;
  reason: "writer" | "idle" | "cap" | "unmount" | "error";
}

export interface SceneWorldUndockPayload {
  passage: ScenePassage;
  proposals: SceneProposal[];
  perspective: SceneWorldPerspective;
  referencePicture: ScenePicture | null;
  preview: boolean;
  autoStart: boolean;
}

export interface SceneWorldStageProps {
  passage: ScenePassage;
  proposals: readonly SceneProposal[];
  referencePicture?: ScenePicture | null;
  capability?: SceneWorldCapability;
  compact?: boolean;
  initialPerspective?: SceneWorldPerspective;
  initialPreview?: boolean;
  autoStart?: boolean;
  onStartSession$?: QRL<
    (request: SceneWorldStartRequest) => Promise<SceneWorldSessionToken>
  >;
  onFinishSession$?: QRL<(report: SceneWorldStopReport) => Promise<void>>;
  onSnapshot$?: QRL<(picture: ScenePicture) => Promise<void> | void>;
  onUndock$?: QRL<(payload: SceneWorldUndockPayload) => Promise<void> | void>;
}

export const SceneWorldStage = component$<SceneWorldStageProps>((props) => {
  useStyles$(styles);

  const videoRef = useSignal<HTMLVideoElement>();
  const canvasRef = useSignal<HTMLCanvasElement>();
  const viewportRef = useSignal<HTMLDivElement>();
  const transportRef = useSignal<NoSerialize<SceneWorldTransport> | null>(null);
  const tokenRef = useSignal<NoSerialize<SceneWorldSessionToken> | null>(null);
  const activeKeysRef = useSignal<NoSerialize<Set<SceneWorldControlKey>> | null>(
    null,
  );
  const pointerStateRef = useSignal<
    NoSerialize<{ dragging: boolean; lastX: number; lastY: number }> | null
  >(null);

  const ui = useStore({
    status: "idle" as SceneWorldSessionStatus,
    perspective: (props.initialPerspective ??
      "first-person") as SceneWorldPerspective,
    seedFromPicture: Boolean(props.referencePicture),
    isPreview: Boolean(props.initialPreview),
    elapsedSeconds: 0,
    idleSecondsLeft:
      props.capability?.idleSeconds ?? SCENE_WORLD_DEFAULT_IDLE_SECONDS,
    maxSeconds: props.capability?.maxSeconds ?? SCENE_WORLD_DEFAULT_MAX_SECONDS,
    muted: false,
    volume: 0.75,
    focused: false,
    steerDraft: "",
    steering: false,
    steerLog: [] as string[],
    error: "",
    notice: "",
    capturing: false,
    lastSyncedText: props.passage.text,
    autoSteerOnPause: false,
    autoStarted: false,
  });

  const touchActivity = $(() => {
    const token = tokenRef.value;
    ui.idleSecondsLeft =
      token?.idleSeconds ??
      props.capability?.idleSeconds ??
      SCENE_WORLD_DEFAULT_IDLE_SECONDS;
  });

  const stopWorld = $(
    async (
      reason: "writer" | "idle" | "cap" | "unmount" | "error",
      keepalive = false,
    ) => {
      const transport = transportRef.value;
      const token = tokenRef.value;
      const elapsed = ui.elapsedSeconds;

      transportRef.value = null;
      tokenRef.value = null;
      activeKeysRef.value?.clear();

      if (transport) {
        ui.status = "stopping";
        await transport.complete({ keepalive }).catch(() => undefined);
      }

      if (token && props.onFinishSession$ && !keepalive) {
        await props
          .onFinishSession$({ token, elapsedSeconds: elapsed, reason })
          .catch(() => undefined);
      }

      if (reason !== "unmount") {
        ui.status = reason === "error" ? "error" : "stopped";
        ui.focused = false;
        if (reason === "idle") {
          ui.notice =
            "World stopped automatically after inactivity so no extra credit was spent.";
        } else if (reason === "cap") {
          ui.notice =
            "World reached its session cap and stopped automatically.";
        } else if (reason === "writer") {
          ui.notice = "World session ended.";
        }
      }
    },
  );

  const startWorld = $(async (preview: boolean) => {
    if (ui.status === "connecting" || ui.status === "live") return;
    const inventory = createSceneInventory(props.passage);
    if (inventory.status !== "ready") {
      ui.error =
        inventory.reason ?? "Select a scene passage before entering the world.";
      return;
    }

    ui.error = "";
    ui.notice = "";
    ui.status = "connecting";
    ui.isPreview = preview;
    ui.elapsedSeconds = 0;
    ui.steerLog = [];

    try {
      const token: SceneWorldSessionToken = props.onStartSession$
        ? await props.onStartSession$({ preview })
        : {
            interactionId: `preview-${Date.now().toString(36)}`,
            authToken: "preview-local",
            model: "models/genie-4 (interactive preview)",
            source: "preview",
            destination: "Interactive local preview (no charge)",
            maxSeconds:
              props.capability?.maxSeconds ?? SCENE_WORLD_DEFAULT_MAX_SECONDS,
            idleSeconds:
              props.capability?.idleSeconds ?? SCENE_WORLD_DEFAULT_IDLE_SECONDS,
          };

      const setup = createSceneWorldSetupPayload(inventory, props.proposals, {
        perspective: ui.perspective,
        referencePicture: ui.seedFromPicture ? props.referencePicture : null,
      });
      if (!setup) {
        throw new Error("Could not build a world prompt from this passage.");
      }

      const transport = createSceneWorldTransport(token);
      transport.attachMedia({
        video: videoRef.value ?? null,
        canvas: canvasRef.value ?? null,
      });
      transport.setAudio({ muted: ui.muted, volume: ui.volume });

      await transport.sendSetup(setup);

      tokenRef.value = noSerialize(token);
      transportRef.value = noSerialize(transport);
      activeKeysRef.value = noSerialize(new Set<SceneWorldControlKey>());
      pointerStateRef.value = noSerialize({
        dragging: false,
        lastX: 0,
        lastY: 0,
      });

      ui.maxSeconds = token.maxSeconds;
      ui.idleSecondsLeft = token.idleSeconds;
      ui.lastSyncedText = props.passage.text;
      ui.isPreview = token.source === "preview";
      ui.status = "live";
      ui.notice =
        token.source === "preview"
          ? "Preview active (no charge). Click the viewport to move with WASD or arrow keys."
          : `Live on ${token.destination}. Click the viewport to walk; press Esc to return to writing.`;
    } catch (error) {
      ui.status = "error";
      ui.error =
        error instanceof Error && error.message
          ? error.message
          : "Could not start the interactive world session.";
    }
  });

  const pushSteer = $(
    async (
      kind: "idea" | "passage-update" | "custom",
      text: string,
      dimension?: SceneProposal["dimension"],
    ) => {
      const transport = transportRef.value;
      if (!transport || ui.status !== "live" || ui.steering) return;
      const event = createSceneWorldSteerEvent({
        kind,
        text,
        dimension,
        previousPassage: ui.lastSyncedText,
      });
      if (!event) return;
      ui.steering = true;
      ui.error = "";
      try {
        await transport.sendSteer(event);
        await touchActivity();
        if (kind === "passage-update") {
          ui.lastSyncedText = text;
        }
        const summary =
          kind === "passage-update"
            ? "Synced latest manuscript edit into the live world"
            : text.trim().slice(0, 80);
        ui.steerLog = [summary, ...ui.steerLog].slice(0, 4);
        if (kind === "custom") ui.steerDraft = "";
      } catch (error) {
        ui.error =
          error instanceof Error && error.message
            ? error.message
            : "Could not steer the live world.";
      } finally {
        ui.steering = false;
      }
    },
  );

  // Auto-start when undocked into the side-by-side World Window.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const shouldAuto = track(() => props.autoStart);
    if (shouldAuto && !ui.autoStarted && ui.status === "idle") {
      ui.autoStarted = true;
      void startWorld(Boolean(props.initialPreview));
    }
  });

  // Live 1s timer for duration cap, idle auto-stop, and cost meter.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const status = track(() => ui.status);
    if (status !== "live") return;
    const interval = setInterval(() => {
      ui.elapsedSeconds += 1;
      ui.idleSecondsLeft = Math.max(0, ui.idleSecondsLeft - 1);
      if (ui.elapsedSeconds >= ui.maxSeconds) {
        void stopWorld("cap");
      } else if (ui.idleSecondsLeft <= 0) {
        void stopWorld("idle");
      }
    }, 1000);
    cleanup(() => clearInterval(interval));
  });

  // Guaranteed teardown on unmount, tab close, or page navigation so billing never leaks.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const onUnload = () => {
      const transport = transportRef.value;
      if (transport) {
        void transport.complete({ keepalive: true });
      }
    };
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    cleanup(() => {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
      if (transportRef.value) {
        void stopWorld("unmount", true);
      }
    });
  });

  // Optional auto-steer when writer pauses typing while docked beside the editor.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const text = track(() => props.passage.text);
    const live = track(() => ui.status === "live");
    const autoSteer = track(() => ui.autoSteerOnPause);
    if (!live || !autoSteer || text === ui.lastSyncedText || !text.trim())
      return;
    const timer = setTimeout(() => {
      void pushSteer("passage-update", text);
    }, 2500);
    cleanup(() => clearTimeout(timer));
  });

  const live = ui.status === "live";
  const connecting = ui.status === "connecting";
  const passageChanged =
    live && props.passage.text.trim() !== ui.lastSyncedText.trim();
  const canStartLive =
    !!props.capability?.enabled && !!props.capability?.available;
  const estimatedCost = ui.isPreview
    ? "$0.00 (preview)"
    : `~${formatCreditMicros(estimateWorldSessionCostMicros(ui.elapsedSeconds))}`;

  return (
    <div
      class={["scene-world", props.compact ? "scene-world--compact" : ""]}
      data-scene-world-status={ui.status}
    >
      <div class="scene-world__head">
        <div>
          <h3>{props.compact ? "Live Scene World" : "Walk inside the scene"}</h3>
          {!props.compact && (
            <p class="scene-bench__method">
              Explore your passage as an interactive 24fps world with stereo
              ambient audio powered by Genie 4. Steer it as you write, then
              capture any view back into your page comparison.
            </p>
          )}
        </div>
        <div class="scene-world__badges">
          <span
            class={[
              "scene-world__badge",
              live ? "scene-world__badge--live" : "",
            ]}
          >
            {live && <span class="scene-world__dot" aria-hidden="true" />}
            {live
              ? ui.isPreview
                ? "Preview · 24fps"
                : "Live · 24fps · 48kHz"
              : connecting
                ? "Connecting…"
                : "Idle"}
          </span>
          {live && (
            <>
              <span class="scene-world__badge">
                {formatWorldDuration(ui.elapsedSeconds)} /{" "}
                {formatWorldDuration(ui.maxSeconds)}
              </span>
              <span class="scene-world__badge">{estimatedCost}</span>
              {ui.idleSecondsLeft <= 15 && (
                <span class="scene-world__badge scene-world__badge--warn">
                  Idle stop in {ui.idleSecondsLeft}s
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {!live && (
        <div class="scene-world__setup">
          {!props.capability?.enabled ? (
            <p class="scene-bench__method">
              Live Genie 4 worlds are off. Live video streams at ~$0.10/sec, so
              turn it on in{" "}
              <a href="/settings#scene-worlds">
                Settings → Interactive Scene Worlds
              </a>
              , or try the zero-cost interactive preview below.
            </p>
          ) : !props.capability?.available ? (
            <p class="scene-bench__method">
              {props.capability.unavailableReason ??
                "Genie 4 is not connected here. You can still try the local interactive preview."}
            </p>
          ) : (
            <>
              <p class="scene-bench__method">
                Streams from {props.capability.destination}.{" "}
                {props.capability.costLabel}
              </p>
              {props.capability.source === "twyne" && (
                <p class="scene-bench__credit">{SCENE_WORLD_CREDIT_WARNING}</p>
              )}
              {props.capability.availableMicros !== undefined &&
                worldLowCreditWarning(props.capability.availableMicros) && (
                  <p class="scene-bench__credit" role="status">
                    {worldLowCreditWarning(props.capability.availableMicros)}{" "}
                    <a href="/pricing">Add credit</a>
                  </p>
                )}
            </>
          )}

          <div class="scene-world__row">
            <label class="scene-world__check">
              <input
                type="radio"
                name={`world-pov-${props.compact ? "dock" : "bench"}`}
                checked={ui.perspective === "first-person"}
                onChange$={() => {
                  ui.perspective = "first-person";
                }}
              />
              First-person POV
            </label>
            <label class="scene-world__check">
              <input
                type="radio"
                name={`world-pov-${props.compact ? "dock" : "bench"}`}
                checked={ui.perspective === "observer"}
                onChange$={() => {
                  ui.perspective = "observer";
                }}
              />
              Quiet observer
            </label>
            {props.referencePicture && (
              <label class="scene-world__check">
                <input
                  type="checkbox"
                  checked={ui.seedFromPicture}
                  onChange$={(_, el) => {
                    ui.seedFromPicture = el.checked;
                  }}
                />
                Seed from current Scene Picture
              </label>
            )}
          </div>

          <div class="scene-bench__actions">
            <button
              type="button"
              disabled={connecting || !canStartLive}
              onClick$={() => startWorld(false)}
            >
              {connecting && !ui.isPreview
                ? "Entering Genie 4 world…"
                : "Enter Genie 4 world"}
            </button>
            <button
              type="button"
              disabled={connecting}
              onClick$={() => startWorld(true)}
            >
              {connecting && ui.isPreview
                ? "Opening preview…"
                : "Try interactive preview (free)"}
            </button>
            {props.onUndock$ && (
              <button
                type="button"
                onClick$={async () => {
                  await props.onUndock$?.({
                    passage: { ...props.passage },
                    proposals: [...props.proposals],
                    perspective: ui.perspective,
                    referencePicture: ui.seedFromPicture
                      ? (props.referencePicture ?? null)
                      : null,
                    preview: !canStartLive,
                    autoStart: true,
                  });
                }}
              >
                Open beside manuscript
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={viewportRef}
        class="scene-world__viewport-wrap"
        tabIndex={0}
        role="application"
        aria-label="Interactive scene world viewport. Click to navigate with WASD or arrow keys. Press Escape to return to writing."
        data-focused={ui.focused ? "true" : "false"}
        style={{ display: live || connecting ? "block" : "none" }}
        onFocus$={() => {
          ui.focused = true;
        }}
        onBlur$={() => {
          ui.focused = false;
          const keys = activeKeysRef.value;
          if (keys && keys.size > 0) {
            keys.clear();
            transportRef.value?.sendAction({
              event_type: "user_action",
              keys: [],
            });
          }
        }}
        onKeyDown$={[
          sync$((event: KeyboardEvent) => {
            if (
              event.key === "ArrowUp" ||
              event.key === "ArrowDown" ||
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight" ||
              event.key === " "
            ) {
              event.preventDefault();
            }
          }),
          $((event: KeyboardEvent) => {
            if (!live) return;
            if (event.key === "Escape") {
              viewportRef.value?.blur();
              return;
            }
            const mapped = normalizeWorldControlKey(event.key);
            if (!mapped) return;
            const keys = activeKeysRef.value;
            if (!keys) return;
            keys.add(mapped);
            transportRef.value?.sendAction({
              event_type: "user_action",
              keys: [...keys],
            });
            void touchActivity();
          }),
        ]}
        onKeyUp$={(event) => {
          if (!live) return;
          const mapped = normalizeWorldControlKey(event.key);
          if (!mapped) return;
          const keys = activeKeysRef.value;
          if (!keys) return;
          keys.delete(mapped);
          transportRef.value?.sendAction({
            event_type: "user_action",
            keys: [...keys],
          });
        }}
        onPointerDown$={(event) => {
          viewportRef.value?.focus();
          const p = pointerStateRef.value;
          if (p) {
            p.dragging = true;
            p.lastX = event.clientX;
            p.lastY = event.clientY;
          }
        }}
        onPointerMove$={(event) => {
          const p = pointerStateRef.value;
          if (!live || !p?.dragging) return;
          const dx = event.clientX - p.lastX;
          const dy = event.clientY - p.lastY;
          p.lastX = event.clientX;
          p.lastY = event.clientY;
          if (dx === 0 && dy === 0) return;
          transportRef.value?.sendAction({
            event_type: "user_action",
            keys: [...(activeKeysRef.value ?? [])],
            look_delta: { dx, dy },
          });
          void touchActivity();
        }}
        onPointerUp$={() => {
          const p = pointerStateRef.value;
          if (p) p.dragging = false;
        }}
        onPointerLeave$={() => {
          const p = pointerStateRef.value;
          if (p) p.dragging = false;
        }}
      >
        <video
          ref={videoRef}
          class="scene-world__media"
          autoplay
          playsInline
          style={{ display: ui.isPreview ? "none" : "block" }}
        />
        <canvas
          ref={canvasRef}
          class="scene-world__media"
          width={960}
          height={540}
          style={{ display: ui.isPreview ? "block" : "none" }}
        />
        <div class="scene-world__overlay">
          <span class="scene-world__hint">
            {ui.focused
              ? "Walking · WASD / Arrows + drag · Esc to type"
              : "Click world to walk · Typing stays in manuscript"}
          </span>
        </div>
      </div>

      {live && (
        <>
          <div class="scene-world__controls">
            <div class="scene-world__dpad" aria-label="Movement controls">
              {(
                [
                  ["ArrowLeft", "←", "Turn left"],
                  ["w", "↑", "Move forward"],
                  ["s", "↓", "Move back"],
                  ["ArrowRight", "→", "Turn right"],
                ] as const
              ).map(([key, glyph, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-label={label}
                  onPointerDown$={() => {
                    transportRef.value?.sendAction({
                      event_type: "user_action",
                      keys: [key],
                    });
                    void touchActivity();
                  }}
                  onPointerUp$={() => {
                    transportRef.value?.sendAction({
                      event_type: "user_action",
                      keys: [],
                    });
                  }}
                >
                  {glyph}
                </button>
              ))}
            </div>

            <div class="scene-world__audio">
              <button
                type="button"
                onClick$={() => {
                  ui.muted = !ui.muted;
                  transportRef.value?.setAudio({
                    muted: ui.muted,
                    volume: ui.volume,
                  });
                }}
              >
                {ui.muted ? "Unmute audio" : "Mute audio"}
              </button>
              <label>
                <span class="sr-only">World audio volume</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ui.volume}
                  onInput$={(_, el) => {
                    ui.volume = Number(el.value);
                    transportRef.value?.setAudio({
                      muted: ui.muted,
                      volume: ui.volume,
                    });
                  }}
                />
              </label>
            </div>
          </div>

          {passageChanged && (
            <div class="scene-world__sync" role="status">
              <span>Your manuscript passage changed.</span>
              <button
                type="button"
                disabled={ui.steering}
                onClick$={() =>
                  pushSteer("passage-update", props.passage.text)
                }
              >
                {ui.steering ? "Steering…" : "Steer world with latest edit"}
              </button>
            </div>
          )}

          {props.compact && (
            <label class="scene-world__check">
              <input
                type="checkbox"
                checked={ui.autoSteerOnPause}
                onChange$={(_, el) => {
                  ui.autoSteerOnPause = el.checked;
                }}
              />
              Auto-steer world 2.5s after I pause typing
            </label>
          )}

          <form
            class="scene-world__steer-form"
            preventdefault:submit
            onSubmit$={() => {
              if (ui.steerDraft.trim()) {
                void pushSteer("custom", ui.steerDraft);
              }
            }}
          >
            <input
              type="text"
              value={ui.steerDraft}
              maxLength={600}
              placeholder="Steer live: e.g. 'make the lamp flicker' or 'add rain on the glass'"
              onInput$={(_, el) => {
                ui.steerDraft = el.value;
              }}
            />
            <button
              type="submit"
              disabled={ui.steering || !ui.steerDraft.trim()}
            >
              {ui.steering ? "Steering…" : "Steer"}
            </button>
          </form>

          {props.proposals.length > 0 && (
            <div class="scene-world__idea-pills">
              {props.proposals.map((proposal, index) => {
                const label =
                  SCENE_DIMENSIONS.find(({ id }) => id === proposal.dimension)
                    ?.label ?? "Idea";
                return (
                  <button
                    key={`${index}:${proposal.text}`}
                    type="button"
                    disabled={ui.steering}
                    title={`Push into live world: ${proposal.text}`}
                    onClick$={() =>
                      pushSteer("idea", proposal.text, proposal.dimension)
                    }
                  >
                    + {label}: {proposal.text.slice(0, 36)}
                    {proposal.text.length > 36 ? "…" : ""}
                  </button>
                );
              })}
            </div>
          )}

          <div class="scene-bench__actions">
            {props.onSnapshot$ && (
              <button
                type="button"
                disabled={ui.capturing}
                onClick$={async () => {
                  const transport = transportRef.value;
                  const token = tokenRef.value;
                  if (!transport || !token || ui.capturing) return;
                  ui.capturing = true;
                  ui.error = "";
                  try {
                    const frame = transport.captureFrame();
                    if (!frame) {
                      ui.error =
                        "Could not capture a frame from the live stream yet.";
                      return;
                    }
                    const picture = createSnapshotPicture({
                      passage: props.passage,
                      base64: frame.base64,
                      mediaType: frame.mediaType,
                      destination: token.destination,
                      model: token.model,
                    });
                    await props.onSnapshot$?.(picture);
                    ui.notice =
                      "Frame captured and sent to Scene Bench comparison.";
                    await touchActivity();
                  } finally {
                    ui.capturing = false;
                  }
                }}
              >
                {ui.capturing
                  ? "Capturing frame…"
                  : "Capture frame & compare with page"}
              </button>
            )}

            {props.onUndock$ && (
              <button
                type="button"
                onClick$={async () => {
                  const preview = ui.isPreview;
                  await stopWorld("writer");
                  await props.onUndock$?.({
                    passage: { ...props.passage },
                    proposals: [...props.proposals],
                    perspective: ui.perspective,
                    referencePicture: ui.seedFromPicture
                      ? (props.referencePicture ?? null)
                      : null,
                    preview,
                    autoStart: true,
                  });
                }}
              >
                Keep open while writing
              </button>
            )}

            <button
              type="button"
              class="scene-world__stop"
              onClick$={() => stopWorld("writer")}
            >
              Stop world & end session
            </button>
          </div>

          {ui.steerLog.length > 0 && (
            <ul class="scene-world__log" aria-label="Recent world steering">
              {ui.steerLog.map((entry, idx) => (
                <li key={`${idx}:${entry}`}>Steered: {entry}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {ui.error && (
        <p class="scene-bench__notice" role="status">
          {ui.error}
        </p>
      )}
      {ui.notice && !ui.error && (
        <p class="scene-bench__method" role="status">
          {ui.notice}
        </p>
      )}
    </div>
  );
});
