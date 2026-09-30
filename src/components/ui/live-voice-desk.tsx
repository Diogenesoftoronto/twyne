import {
  $,
  component$,
  useStore,
  useVisibleTask$,
  useStyles$,
} from "@qwik.dev/core";
import { makeFunctionReference } from "convex/server";
import { useAuth } from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { PERSONAS } from "../../utils/personas";
import { loadPersonasFromIdb } from "../../utils/idb";
import { LIVE_OPEN_EVENT } from "../../utils/live-voice-workspace";
import {
  endLiveVoice,
  liveVoiceState,
  LIVE_STATE_EVENT,
  muteLiveVoice,
  reviewVoiceEdit,
  startLiveVoice,
} from "../../utils/live-voice";
import styles from "./live-voice-desk.css?inline";

type Access = {
  eligible: boolean;
  welcome: boolean;
  availableMicros: number;
  sessionBudgetMicros: number;
  consentGranted: boolean;
};
export const LiveVoiceDesk = component$(() => {
  useStyles$(styles);
  const client = useConvexClient();
  const auth = useAuth();
  const live = useStore(liveVoiceState());
  const ui = useStore({
    open: false,
    compact: false,
    author: "Le Lecteur",
    passage: "",
    cast: PERSONAS.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      icon: p.icon,
    })),
    access: null as Access | null,
    loading: false,
    error: "",
    consent: false,
    elapsed: 0,
  });
  const refresh = $(async () => {
    if (!client.value || !auth.value.user) return;
    ui.loading = true;
    ui.error = "";
    try {
      ui.access = await client.value.action(
        makeFunctionReference<"action", Record<string, never>, Access>(
          "liveVoice:access",
        ),
        {},
      );
      ui.consent = ui.access.consentGranted;
    } catch {
      ui.error =
        "Could not check Live access. Retry, or check your account in Settings.";
    } finally {
      ui.loading = false;
    }
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track }) => {
      track(() => auth.value.user?.id);
      endLiveVoice();
      ui.access = null;
      ui.consent = false;
      ui.open = false;
    },
    { strategy: "document-ready" },
  );
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      const sync = () => {
        const wasActive = !["idle", "error"].includes(live.status);
        Object.assign(live, liveVoiceState());
        if (wasActive && ["idle", "error"].includes(live.status))
          void refresh();
      };
      const open = async (event: Event) => {
        const detail = (
          event as CustomEvent<{ author?: string; passage?: string }>
        ).detail;
        if (["idle", "error"].includes(live.status)) {
          const cast = await loadPersonasFromIdb().catch(() => null);
          if (cast?.length)
            ui.cast = cast.map((p) => ({
              id: p.id,
              name: p.name,
              role: p.role,
              icon: p.icon,
            }));
          ui.author =
            ui.cast.find(
              (p) => p.name === detail?.author || p.id === detail?.author,
            )?.name ?? "Le Lecteur";
          if (!ui.cast.some((p) => p.name === ui.author))
            ui.author = ui.cast[0]?.name ?? "Le Lecteur";
          ui.passage = detail?.passage ?? "";
          ui.access = null;
        }
        ui.open = true;
        ui.compact = false;
        await refresh();
        document.getElementById("live-voice-heading")?.focus();
      };
      const tick = setInterval(() => {
        ui.elapsed = live.startedAt
          ? Math.floor((Date.now() - live.startedAt) / 1000)
          : 0;
      }, 1000);
      window.addEventListener(LIVE_STATE_EVENT, sync);
      window.addEventListener(LIVE_OPEN_EVENT, open);
      cleanup(() => {
        clearInterval(tick);
        window.removeEventListener(LIVE_STATE_EVENT, sync);
        window.removeEventListener(LIVE_OPEN_EVENT, open);
        endLiveVoice();
      });
    },
    { strategy: "document-ready" },
  );

  const active = !["idle", "error"].includes(live.status);
  const connected = ["listening", "speaking"].includes(live.status);
  const speaker = ui.cast.find(
    (p) => p.name === (active ? live.author : ui.author),
  );
  const status =
    live.status === "connecting"
      ? "Connecting microphone…"
      : live.status === "closing"
        ? "Finishing and settling credit…"
        : live.status === "speaking"
          ? "Speaking · you can interrupt"
          : live.status === "listening"
            ? live.muted
              ? "Microphone muted"
              : "Listening"
            : live.finalized
              ? "Conversation ended"
              : "Talk through your next draft";
  return (
    // Keep the host mounted: returning null reruns visible tasks on close,
    // whose voice-state reset would schedule another render indefinitely.
    <aside
      class={`live-voice-desk ${ui.compact ? "is-compact" : ""}`}
      hidden={!ui.open}
      aria-label="Live voice desk"
    >
      <header class="live-voice-head">
        <span class="live-voice-character" aria-hidden="true">
          {speaker?.icon ?? "♧"}
        </span>
        <div class="live-voice-heading">
          <h2 id="live-voice-heading" tabIndex={-1}>
            The voice desk <span>Pro</span>
          </h2>
          <p role="status">{status}</p>
        </div>
        <button
          type="button"
          class="tool-btn"
          aria-label={ui.compact ? "Expand voice desk" : "Minimize voice desk"}
          onClick$={() => {
            ui.compact = !ui.compact;
          }}
        >
          {ui.compact ? "↗" : "−"}
        </button>
        {!active && (
          <button
            type="button"
            class="tool-btn"
            aria-label="Close voice desk"
            onClick$={() => {
              ui.open = false;
            }}
          >
            ×
          </button>
        )}
      </header>
      {!ui.compact && (
        <div class="live-voice-body">
          <label class="live-voice-speaker">
            Your editor
            <select
              value={active ? live.author : ui.author}
              disabled={active}
              onChange$={(_, element) => {
                ui.author = element.value;
              }}
            >
              {ui.cast.map((p) => (
                <option
                  key={p.id}
                  value={p.name}
                >{`${p.name} · ${p.role}`}</option>
              ))}
            </select>
          </label>
          {!active && !live.startedAt && (
            <p class="live-voice-intro">
              Talk, interrupt, and keep writing. Ask your editor to find a
              passage, look up a source, or help rewrite a sentence.
            </p>
          )}
          {ui.passage && !active && (
            <blockquote class="live-voice-context">
              Starting from this comment: {ui.passage.slice(0, 220)}
              {ui.passage.length > 220 ? "…" : ""}
            </blockquote>
          )}
          {(live.userTranscript || live.assistantTranscript || active) && (
            <div class="live-voice-captions" aria-label="Conversation captions">
              <div>
                <h3>You</h3>
                <p>
                  {live.userTranscript.slice(-1000) ||
                    "Your words will appear here."}
                </p>
              </div>
              <div>
                <h3>{active ? live.author : ui.author}</h3>
                <p>
                  {live.assistantTranscript.slice(-1000) ||
                    "Ready when you are."}
                </p>
              </div>
            </div>
          )}
          {live.working && (
            <p class="live-voice-notice" role="status">
              Working on your request…
            </p>
          )}
          {live.notice && (
            <p class="live-voice-notice" role="status">
              {live.notice}
            </p>
          )}
          {live.pending && (
            <section class="live-voice-edit" aria-label="Proposed draft edit">
              <h3>
                {live.pending.kind === "append"
                  ? "Add to the draft"
                  : "Proposed revision"}
              </h3>
              {live.pending.original && <del>{live.pending.original}</del>}
              <ins>{live.pending.text || "Remove this passage"}</ins>
              <p>Say “apply the edit” or “discard it”.</p>
              <div class="live-voice-actions">
                <button
                  type="button"
                  class="btn-press"
                  disabled={live.working}
                  onClick$={() => reviewVoiceEdit(true)}
                >
                  Apply edit
                </button>
                <button
                  type="button"
                  class="btn-paper"
                  disabled={live.working}
                  onClick$={() => reviewVoiceEdit(false)}
                >
                  Discard
                </button>
              </div>
            </section>
          )}
          {live.sources.length > 0 && (
            <ul class="live-voice-sources">
              {live.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.title} ↗
                  </a>
                  <p>{source.snippet.slice(0, 180)}</p>
                </li>
              ))}
            </ul>
          )}
          {(live.error || ui.error) && (
            <p role="alert" class="live-voice-error">
              {live.error || ui.error}
            </p>
          )}
          {!active && (
            <div class="live-voice-credit">
              {!auth.value.user ? (
                <p>
                  <a href="/signin/">Sign in</a> to use Pro voice or your
                  welcome credit.
                </p>
              ) : ui.loading ? (
                <p>Checking your credit…</p>
              ) : ui.access ? (
                <>
                  <p>
                    <strong>
                      ${(ui.access.availableMicros / 1_000_000).toFixed(2)}
                    </strong>{" "}
                    available{" "}
                    {ui.access.welcome
                      ? "· welcome credit included"
                      : "in your wallet"}
                  </p>
                  {!ui.access.eligible && (
                    <p>
                      <a href="/pricing/">Get Pro</a> to continue after your
                      welcome credit.
                    </p>
                  )}
                  <p>
                    Up to $0.50 credit reserved per conversation. App requests
                    use up to $0.05 each in addition. Unused voice credit is
                    released when the session settles.
                  </p>
                  {!ui.access.consentGranted && (
                    <label class="live-voice-consent">
                      <input
                        type="checkbox"
                        checked={ui.consent}
                        onChange$={(_, element) => {
                          ui.consent = element.checked;
                        }}
                      />
                      <span>
                        I allow microphone audio and supplied draft context to
                        be processed and logged by the voice provider through
                        Not Organic.
                      </span>
                    </label>
                  )}
                </>
              ) : (
                <button type="button" class="btn-paper" onClick$={refresh}>
                  Check voice access
                </button>
              )}
              <p class="live-voice-detail">
                GPT Live · Marin voice · your editor’s perspective. Audio isn’t
                recorded in Twyne. Transcript captions stay in this session.
              </p>
            </div>
          )}
        </div>
      )}
      <footer class="live-voice-footer">
        {active ? (
          <>
            <div class="live-voice-meter" aria-hidden="true">
              {[0.5, 0.8, 1, 0.7, 0.4].map((scale, i) => (
                <span
                  key={i}
                  style={{
                    transform: `scaleY(${live.muted ? 0.15 : 0.15 + live.level * scale})`,
                  }}
                />
              ))}
            </div>
            <span class="live-voice-time">
              {Math.floor(ui.elapsed / 60)}:
              {String(ui.elapsed % 60).padStart(2, "0")}
            </span>
            <button
              type="button"
              class="btn-paper"
              disabled={!connected}
              aria-pressed={live.muted}
              onClick$={() => muteLiveVoice()}
            >
              {live.muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              class="btn-press"
              disabled={live.status === "closing"}
              onClick$={() => {
                endLiveVoice();
              }}
            >
              {live.status === "connecting" ? "Cancel" : "End conversation"}
            </button>
          </>
        ) : (
          <>
            <a href="/pricing/">Plans & credits</a>
            <button
              type="button"
              class="btn-press"
              disabled={
                !auth.value.user ||
                !ui.access?.eligible ||
                ui.access.availableMicros < 500_000 ||
                !ui.consent ||
                ui.loading
              }
              onClick$={async () => {
                if (!client.value) return;
                await startLiveVoice(
                  client.value,
                  ui.author,
                  ui.passage,
                  !ui.access?.consentGranted && ui.consent,
                );
              }}
            >
              Start conversation
            </button>
          </>
        )}
      </footer>
    </aside>
  );
});
