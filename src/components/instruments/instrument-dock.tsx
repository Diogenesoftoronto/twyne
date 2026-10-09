import {
  component$,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
  type QRL,
} from "@qwik.dev/core";
import {
  INSTRUMENT_DOCK_EVENT,
  type InstrumentDockRequest,
} from "../../utils/instrument-dock";
import { TaskDesk } from "./task-desk";
import { InstrumentArt } from "./instrument-art";
import { InstrumentMotion } from "./instrument-motion";
import { LocalWritingTools } from "./local-writing-tools";
import { EntityInstrument } from "./entity-instrument";
import type {
  EntityInstrumentIndex,
  EntityEvidence,
} from "../../utils/entity-instrument";
import { SceneBench, type SceneProviderCapability } from "./scene-bench";
import {
  startSceneNarration,
  type ScenePassage,
  type SceneSpan,
} from "../../utils/scene-bench";
import {
  askJudgement,
  describeJudgement,
  normalizeEndpointUrl,
} from "../../utils/judgement-client";
import { getCachedAiSettings } from "../../utils/ai-orchestrator";
import { resolveFeatureConfig } from "../../utils/ai-client";
import {
  useAuth,
  hasAuthenticatedConvexIdentity,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import {
  backOffSystemOne,
  spendSystemOne,
  systemOneWait,
} from "../../utils/system-one-budget";
import type {
  InstrumentRoomRequest,
  InstrumentRoomResult,
} from "../../utils/instrument-room";

interface InstrumentDockProps {
  folioId: string;
  selectedText?: string;
  disabled?: boolean;
  onEntities$?: QRL<() => EntityInstrumentIndex | null>;
  onEntityJump$?: QRL<(span: EntityEvidence, indexKey: string) => boolean>;
  onLocate$?: QRL<
    (span: SceneSpan, passage: ScenePassage) => boolean | Promise<boolean>
  >;
  onAskRoom$?: QRL<
    (
      request: InstrumentRoomRequest,
      passage: ScenePassage,
    ) => Promise<InstrumentRoomResult>
  >;
}

/** Native dialog contains focus; closing restores the writer's active surface. */
export const InstrumentDock = component$<InstrumentDockProps>((props) => {
  const auth = useAuth();
  const client = useConvexClient();
  const dialog = useSignal<HTMLDialogElement>();
  const entities = useSignal<EntityInstrumentIndex | null>(null);
  const state = useStore<InstrumentDockRequest & { open: boolean }>({
    kind: "tasks",
    text: "",
    open: false,
  });
  const capabilities = useStore<{
    judgement?: SceneProviderCapability;
    narration?: SceneProviderCapability;
    error: string;
  }>({ error: "" });
  useStyles$(`
    .instrument-dock { margin:auto; width:min(58rem,calc(100vw - 2rem)); max-height:88dvh; padding:0; border:1px solid var(--color-ink); border-radius:3px; color:var(--color-ink); background:var(--color-paper); box-shadow:0 1rem 4rem #0004; }
    .instrument-dock::backdrop { background:#15120e66; }
    .instrument-dock__body { padding:clamp(1rem,3vw,2rem); }
    .instrument-dock nav { display:flex; flex-wrap:wrap; gap:.4rem; margin-bottom:1rem; }
    .instrument-dock__bar { display:flex; justify-content:space-between; align-items:center; gap:1rem; border-bottom:1px solid var(--color-paper-3); padding-bottom:.6rem; margin-bottom:1rem; }
    .instrument-dock__bar p { font:.75rem var(--font-typewriter); text-transform:uppercase; letter-spacing:.12em; }
    .instrument-dock__bar button { color:inherit; background:transparent; border:1px solid var(--color-ink); padding:.4rem .8rem; }
    .instrument-dock :focus-visible { outline:2px solid var(--color-ink); outline-offset:3px; }
    .writing-threads-host { position:fixed; z-index:75; right:1rem; top:7rem; width:min(30rem,calc(100vw - 2rem)); pointer-events:none; }
    .writing-threads-host > * { pointer-events:auto; box-shadow:0 .6rem 2rem #0002; }
    @media(max-width:74rem) { .writing-threads-host { top:auto; bottom:1rem; } }
    @media(prefers-reduced-motion:reduce) { .instrument-dock { scroll-behavior:auto; } }
  `);
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const folioId = track(() => props.folioId);
    const disabled = track(() => props.disabled);
    const element = dialog.value;
    let opener: HTMLElement | null = null;
    const restoreFocus = () => {
      state.open = false;
      const target =
        element?.returnValue !== "manuscript" &&
        opener?.isConnected &&
        opener !== document.body &&
        !element?.contains(opener) &&
        opener.getClientRects().length
          ? opener
          : document.querySelector<HTMLElement>(
              '.ProseMirror[contenteditable="true"]',
            );
      target?.focus({ preventScroll: true });
      opener = null;
    };
    const open = (event: Event) => {
      const request = (event as CustomEvent<InstrumentDockRequest>).detail;
      if (
        disabled ||
        !folioId ||
        !request ||
        !["tasks", "local", "scene"].includes(request.kind)
      )
        return;
      state.kind = request.kind;
      state.text = request.text ?? props.selectedText ?? "";
      state.passage = request.passage;
      entities.value = null;
      capabilities.error = "";
      if (!element?.open) {
        opener =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        if (element) element.returnValue = "";
      }
      state.open = true;
      element?.showModal();
    };
    window.addEventListener(INSTRUMENT_DOCK_EVENT, open);
    element?.addEventListener("close", restoreFocus);
    cleanup(() => {
      window.removeEventListener(INSTRUMENT_DOCK_EVENT, open);
      element?.removeEventListener("close", restoreFocus);
      element?.close();
      state.open = false;
    });
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const open = track(() => state.open);
    track(() => auth.value.user?.id);
    track(() => auth.value.convexAuthenticated);
    let disposed = false;
    const refresh = async () => {
      const settings = await getCachedAiSettings();
      if (disposed) return;
      const signedIn =
        hasAuthenticatedConvexIdentity(auth.value) && !!client.value;
      const judgement = settings.judgement;
      const available =
        judgement?.source === "endpoint"
          ? !!normalizeEndpointUrl(judgement.endpointUrl)
          : signedIn &&
            (judgement?.source !== "typesafe" ||
              !!judgement.typesafeKey?.trim());
      capabilities.judgement = {
        available,
        destination: describeJudgement(judgement ?? null),
        costLabel:
          judgement?.source === "endpoint"
            ? "Uses your endpoint; any provider charge follows its settings."
            : "Uses your selected judgement service; a per-read price is not available here.",
        unavailableReason:
          "Sign in or choose a judgement endpoint in Settings to request a model reading.",
      };
      const narrator = resolveFeatureConfig(settings, "voice-narration");
      capabilities.narration = {
        available: !!narrator || signedIn,
        destination: narrator
          ? `${narrator.provider.name} · ${narrator.model}`
          : "Twyne voice",
        costLabel:
          narrator?.provider.type === "supertonic"
            ? "Runs on this device with the downloaded voice pack; no per-read API charge."
            : "Uses your selected voice service; a per-read price is not available here.",
        unavailableReason:
          "Choose a narration provider in Settings or sign in to hear this passage.",
      };
    };
    if (open) void refresh();
    window.addEventListener("twyne:ai-settings-saved", refresh);
    cleanup(() => {
      disposed = true;
      window.removeEventListener("twyne:ai-settings-saved", refresh);
    });
  });
  return (
    <dialog
      ref={dialog}
      class="instrument-dock"
      aria-label="Writing instruments"
    >
      <div class="instrument-dock__body">
        <div class="instrument-dock__bar">
          <p>At the writing desk</p>
          <button
            type="button"
            autoFocus
            onClick$={() => dialog.value?.close()}
          >
            Close
          </button>
        </div>
        {state.open && (
          <>
            <nav aria-label="Writing instruments">
              <button
                type="button"
                class="btn-paper"
                aria-pressed={state.kind === "tasks"}
                onClick$={() => (state.kind = "tasks")}
              >
                Task desk
              </button>{" "}
              <button
                type="button"
                class="btn-paper"
                aria-pressed={state.kind === "scene"}
                onClick$={() => (state.kind = "scene")}
              >
                Scene bench
              </button>{" "}
              <button
                type="button"
                class="btn-paper"
                aria-pressed={state.kind === "entities"}
                onClick$={async () => {
                  entities.value = (await props.onEntities$?.()) ?? null;
                  state.kind = "entities";
                }}
              >
                Entities
              </button>{" "}
              <button
                type="button"
                class="btn-paper"
                aria-pressed={state.kind === "local"}
                onClick$={() => (state.kind = "local")}
              >
                On-device tools
              </button>
            </nav>
            <InstrumentMotion state="open">
              {state.kind === "entities" ? (
                entities.value ? (
                  <>
                    <p role="status">{capabilities.error}</p>
                    <EntityInstrument
                      index={entities.value}
                      contextKey={`${props.folioId}:${entities.value.key}`}
                      onJump$={async (span, indexKey) => {
                        if (await props.onEntityJump$?.(span, indexKey))
                          dialog.value?.close("manuscript");
                        else
                          capabilities.error =
                            "The source has changed. Reopen Entities to inspect the current draft.";
                      }}
                    />
                  </>
                ) : (
                  <p>Open a manuscript to inspect its entities.</p>
                )
              ) : state.kind === "local" ? (
                <LocalWritingTools
                  selectedText={state.text}
                  onCandidate$={() => dialog.value?.close("manuscript")}
                />
              ) : state.kind === "scene" ? (
                <>
                  {capabilities.error && (
                    <p role="status">{capabilities.error}</p>
                  )}
                  <SceneBench
                    passage={
                      state.passage ?? {
                        id: props.folioId,
                        text: state.text ?? "",
                        sourceOffset: 0,
                      }
                    }
                    judgement={capabilities.judgement}
                    narration={capabilities.narration}
                    onAskRoom$={async (request, passage) => {
                      const result = (await props.onAskRoom$?.(
                        request,
                        passage,
                      )) ?? {
                        ok: false,
                        message:
                          "This scene is not attached to a manuscript conversation.",
                      };
                      if (result.ok) dialog.value?.close("manuscript");
                      return result;
                    }}
                    onLocate$={async (span, passage) => {
                      if (await props.onLocate$?.(span, passage))
                        dialog.value?.close("manuscript");
                      else
                        capabilities.error =
                          "This passage has changed. Select it again to locate an exact source span.";
                    }}
                    onJudge$={async (request) => {
                      if (!capabilities.judgement?.available)
                        return { ok: false, error: "unavailable" };
                      if (systemOneWait() > 0)
                        return {
                          ok: false,
                          error:
                            "The shared judgement budget is resting. Try again shortly.",
                        };
                      const account = auth.value.user?.id;
                      const settings = (await getCachedAiSettings()).judgement;
                      spendSystemOne();
                      const result = await askJudgement(
                        client.value,
                        request,
                        settings ?? null,
                      );
                      if (
                        auth.value.user?.id !== account ||
                        JSON.stringify(
                          (await getCachedAiSettings()).judgement,
                        ) !== JSON.stringify(settings)
                      )
                        return {
                          ok: false,
                          error: "Settings changed during this reading.",
                        };
                      if (!result.ok) backOffSystemOne();
                      return result;
                    }}
                    onRead$={async (passage) => {
                      await startSceneNarration(passage, {
                        client: client.value,
                        signedIn: hasAuthenticatedConvexIdentity(auth.value),
                      });
                    }}
                  />
                </>
              ) : (
                <>
                  <InstrumentArt kind="research" size="compact" />
                  <TaskDesk
                    key={props.folioId}
                    folioId={props.folioId}
                    selectedText={state.text}
                  />
                </>
              )}
            </InstrumentMotion>
          </>
        )}
      </div>
    </dialog>
  );
});
