import {
  $,
  component$,
  useSignal,
  useStore,
  useVisibleTask$,
  useStyles$,
} from "@qwik.dev/core";
import { makeFunctionReference } from "convex/server";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { PERSONAS } from "../../utils/personas";
import { loadPersonasFromIdb } from "../../utils/idb";
import { LIVE_OPEN_EVENT } from "../../utils/live-voice-workspace";
import {
  LOCAL_LIVE_MODEL_ID,
  downloadLocalLive,
  evictLocalLive,
  localLiveDownloadState,
} from "../../utils/live-voice-local-model";
import { onModelDownload } from "../../utils/models-cache";
import { localLiveAdapter } from "../../utils/browser-inference";
import {
  continueLocalVoiceSetup,
  endLiveVoice,
  liveVoiceLevels,
  liveVoiceState,
  LIVE_STATE_EVENT,
  muteLiveVoice,
  reviewVoiceEdit,
  startLiveVoice,
} from "../../utils/live-voice";
import { PersonaPortrait } from "../personas/persona-portrait";
import styles from "./live-voice-desk.css?inline";

type Access = {
  eligible: boolean;
  welcome: boolean;
  availableMicros: number;
  sessionBudgetMicros: number;
  consentGranted: boolean;
};

type CastMember = {
  id: string;
  name: string;
  role: string;
  color: string;
  imageUrl?: string;
};

const toCast = (p: CastMember): CastMember => ({
  id: p.id,
  name: p.name,
  role: p.role,
  color: p.color,
  imageUrl: p.imageUrl,
});

const MIC_ICON = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

/**
 * A conversation with one editor, face to face.
 *
 * The editor's portrait is the whole interface: it opens its mouth in time
 * with the voice you hear, and a halo around it follows your microphone, so
 * you can tell who is talking without reading a status line. Everything that
 * is not the conversation — credit, consent, fine print — stays folded
 * until it is needed.
 */
export const LiveVoiceDesk = component$(() => {
  useStyles$(styles);
  const client = useConvexClient();
  const auth = useAuth();
  const live = useStore(liveVoiceState());
  const stage = useSignal<HTMLElement>();
  const ui = useStore({
    open: false,
    compact: false,
    author: "Le Lecteur",
    passage: "",
    cast: PERSONAS.map(toCast),
    access: null as Access | null,
    accountUserId: null as string | null,
    loading: false,
    accessRequest: 0,
    error: "",
    consent: false,
    elapsed: 0,
    transcript: false,
    localReady: false,
    localSelected: false,
    localSupported: false,
    localChecked: false,
    localDownloading: false,
    localProgress: 0,
  });
  const refreshLocal = $(async () => {
    ui.localSelected = localStorage.getItem("twyne.live.local") === "selected";
    const [adapter, download] = await Promise.all([
      localLiveAdapter(),
      localLiveDownloadState(),
    ]);
    ui.localSupported = !!adapter && adapter.features.has("shader-f16");
    ui.localReady = download.phase === "ready";
    ui.localChecked = true;
  });
  const refresh = $(async () => {
    const connection = client.value;
    const userId = auth.value.user?.id;
    if (
      !connection ||
      !userId ||
      !hasAuthenticatedConvexIdentity(auth.value) ||
      ui.loading
    )
      return;
    const request = ++ui.accessRequest;
    const current = () =>
      ui.accessRequest === request &&
      client.value === connection &&
      auth.value.user?.id === userId &&
      hasAuthenticatedConvexIdentity(auth.value);
    ui.loading = true;
    ui.error = "";
    try {
      const access = await connection.action(
        makeFunctionReference<"action", Record<string, never>, Access>(
          "liveVoice:access",
        ),
        {},
      );
      if (current()) {
        ui.access = access;
        ui.consent = access.consentGranted;
      }
    } catch {
      if (current()) {
        ui.access = null;
        ui.error =
          "Could not check Live access. Retry, or check your account in Settings.";
      }
    } finally {
      if (current()) ui.loading = false;
    }
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track }) => {
      const userId = track(() => auth.value.user?.id ?? null);
      if (userId === ui.accountUserId) return;
      ui.accountUserId = userId;
      endLiveVoice();
      ui.access = null;
      ui.accessRequest++;
      ui.loading = false;
      ui.error = "";
      ui.consent = false;
      ui.open = false;
    },
    { strategy: "document-ready" },
  );
  // A Better Auth session can be visible before its token is accepted by Convex.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track }) => {
      const open = track(() => ui.open);
      const local = track(() => ui.localSelected);
      const ready = track(
        () => hasAuthenticatedConvexIdentity(auth.value) && !!client.value,
      );
      if (!ready) {
        if (!local && !["idle", "error"].includes(live.status)) endLiveVoice();
        ui.accessRequest++;
        ui.loading = false;
        ui.access = null;
        return;
      }
      if (open && !local) void refresh();
    },
    { strategy: "document-ready" },
  );

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      const sync = () => {
        const wasActive = !["idle", "error"].includes(live.status);
        Object.assign(live, liveVoiceState());
        if (
          wasActive &&
          ["idle", "error"].includes(live.status) &&
          !ui.localSelected
        )
          void refresh();
      };
      const open = async (event: Event) => {
        const detail = (
          event as CustomEvent<{ author?: string; passage?: string }>
        ).detail;
        if (["idle", "error"].includes(live.status)) {
          const cast = await loadPersonasFromIdb().catch(() => null);
          if (cast?.length) ui.cast = cast.map(toCast);
          ui.author =
            ui.cast.find(
              (p) => p.name === detail?.author || p.id === detail?.author,
            )?.name ?? "Le Lecteur";
          if (!ui.cast.some((p) => p.name === ui.author))
            ui.author = ui.cast[0]?.name ?? "Le Lecteur";
          ui.passage = detail?.passage ?? "";
          ui.access = null;
          ui.localSelected =
            localStorage.getItem("twyne.live.local") === "selected";
        }
        ui.open = true;
        ui.compact = false;
        await refreshLocal();
        document.getElementById("live-voice-heading")?.focus();
      };
      const tick = setInterval(() => {
        ui.elapsed = live.startedAt
          ? Math.floor((Date.now() - live.startedAt) / 1000)
          : 0;
      }, 1000);
      // Levels go straight onto the stage's custom properties each frame;
      // routing 60 updates a second through the store would re-render the
      // desk for nothing. Smoothed so the jaw eases rather than flickers.
      let frame = 0;
      let voice = 0;
      let mic = 0;
      const animate = () => {
        frame = requestAnimationFrame(animate);
        const el = stage.value;
        if (!el) return;
        const { input, output } = liveVoiceLevels();
        voice += (output - voice) * (output > voice ? 0.55 : 0.2);
        mic += (input - mic) * (input > mic ? 0.5 : 0.12);
        el.style.setProperty("--pp-level", voice.toFixed(3));
        el.style.setProperty("--mic-level", mic.toFixed(3));
      };
      frame = requestAnimationFrame(animate);
      window.addEventListener(LIVE_STATE_EVENT, sync);
      window.addEventListener(LIVE_OPEN_EVENT, open);
      const unsubscribe = onModelDownload(LOCAL_LIVE_MODEL_ID, (state) => {
        ui.localDownloading = state.phase === "downloading";
        ui.localProgress = state.progress;
        ui.localReady = state.phase === "ready";
      });
      cleanup(() => {
        unsubscribe();
        cancelAnimationFrame(frame);
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
  const author = active ? live.author : ui.author;
  const speaker = ui.cast.find((p) => p.name === author) ?? ui.cast[0];
  const firstName = (speaker?.name ?? author).split(" ").at(-1);
  const signedIn = Boolean(auth.value.user);
  const hostedAuthenticated = hasAuthenticatedConvexIdentity(auth.value);
  const access = ui.access;
  const affordable =
    !!access && access.availableMicros >= access.sessionBudgetMicros;
  const canStart = ui.localSelected
    ? ui.localReady && ui.localSupported
    : hostedAuthenticated &&
      !!access?.eligible &&
      affordable &&
      ui.consent &&
      !ui.loading;
  const status =
    live.status === "connecting"
      ? live.localSetup
        ? "Local voice"
        : "Connecting…"
      : live.status === "closing"
        ? "Wrapping up…"
        : live.status === "speaking"
          ? `${firstName} is speaking — just talk to interrupt`
          : live.status === "listening"
            ? live.muted
              ? "You’re muted"
              : "Listening…"
            : live.finalized
              ? "Conversation ended"
              : `Talk your draft through with ${firstName}`;
  const lastUser = [...live.turns].reverse().find((t) => t.role === "user");
  const lastEditor = [...live.turns]
    .reverse()
    .find((t) => t.role === "assistant");
  const clock = `${Math.floor(ui.elapsed / 60)}:${String(ui.elapsed % 60).padStart(2, "0")}`;

  return (
    // Keep the host mounted: returning null reruns visible tasks on close,
    // whose voice-state reset would schedule another render indefinitely.
    <aside
      class={["live-voice-desk", { "is-compact": ui.compact }]}
      hidden={!ui.open}
      aria-label="Live voice desk"
      data-status={live.status}
      style={{ "--pp-color": speaker?.color }}
    >
      <header class="lvd-bar">
        <h2 id="live-voice-heading" tabIndex={-1}>
          <span class="lvd-live-dot" aria-hidden="true" />
          {active ? "Live" : "Voice"}
          {active && <span class="lvd-clock">{clock}</span>}
        </h2>
        <button
          type="button"
          class="lvd-icon-btn"
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
            class="lvd-icon-btn"
            aria-label="Close voice desk"
            onClick$={() => {
              ui.open = false;
            }}
          >
            ×
          </button>
        )}
      </header>

      <section
        ref={stage}
        class="lvd-stage"
        data-muted={live.muted ? "true" : undefined}
      >
        <div class="lvd-face">
          <span class="lvd-halo" aria-hidden="true" />
          <PersonaPortrait
            personaId={speaker?.id}
            name={speaker?.name ?? author}
            color={speaker?.color}
            imageUrl={speaker?.imageUrl}
            size={ui.compact ? 56 : 148}
            speaking={connected ? "live" : undefined}
            activity={
              live.status === "listening"
                ? live.working
                  ? "thinking"
                  : "listening"
                : undefined
            }
          />
        </div>
        {!ui.compact && (
          <div class="lvd-identity">
            <p class="lvd-name">{speaker?.name ?? author}</p>
            <p class="lvd-role">{speaker?.role}</p>
          </div>
        )}
        <p class="lvd-status" role="status">
          {live.working ? "Working on it…" : status}
        </p>
      </section>

      {live.localSetup && (
        <section
          class="lvd-setup"
          aria-label="Local voice setup"
          data-phase={live.localSetup.phase}
        >
          {live.localSetup.phase === "loading" ? (
            <>
              <div class="lvd-setup-heading">
                <strong>Loading the voice model</strong>
                <span>{live.localSetup.completed} of 4</span>
              </div>
              <progress
                max={4}
                value={live.localSetup.completed}
                aria-label="Voice model components loaded"
              />
              <p role="status">
                {
                  [
                    "Loading the language model…",
                    "Loading speech recognition…",
                    "Loading the speech generator…",
                    "Loading audio playback…",
                    "Model loaded.",
                  ][live.localSetup.completed]
                }
              </p>
            </>
          ) : live.localSetup.phase === "profiling" ? (
            <>
              <div class="lvd-setup-heading">
                <strong>Checking response speed</strong>
              </div>
              <div
                class="lvd-setup-sweep"
                role="progressbar"
                aria-label="Checking local voice response speed"
              />
              <p role="status">Running a short sample on this device.</p>
              <button
                type="button"
                class="lvd-link"
                onClick$={() => continueLocalVoiceSetup()}
              >
                Skip speed check
              </button>
            </>
          ) : (
            <>
              <div class="lvd-setup-heading">
                <strong>Local replies may be slow</strong>
              </div>
              <p role="status">
                {live.localSetup.result === "slow"
                  ? "This device struggled to keep up with the sample. You can still use local voice."
                  : "Twyne could not measure response speed. You can still use local voice."}
              </p>
              <button
                type="button"
                class="lvd-pill lvd-pill--solid"
                onClick$={() => continueLocalVoiceSetup()}
              >
                Continue with local voice
              </button>
            </>
          )}
        </section>
      )}

      {!ui.compact && (
        <div class="lvd-body">
          {!active && (
            <div
              class="lvd-cast"
              role="radiogroup"
              aria-label="Choose who to talk with"
            >
              {ui.cast.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  class="lvd-cast-pick"
                  aria-checked={p.name === ui.author}
                  aria-label={`${p.name}, ${p.role}`}
                  title={`${p.name} · ${p.role}`}
                  style={{ "--pp-color": p.color }}
                  onClick$={() => {
                    ui.author = p.name;
                  }}
                >
                  <PersonaPortrait
                    personaId={p.id}
                    name={p.name}
                    color={p.color}
                    imageUrl={p.imageUrl}
                    size={40}
                  />
                </button>
              ))}
            </div>
          )}

          {ui.passage && !active && (
            <blockquote class="lvd-context">
              <span>About this note</span>
              {ui.passage.slice(0, 220)}
              {ui.passage.length > 220 ? "…" : ""}
            </blockquote>
          )}

          {!live.localSetup && (active || live.turns.length > 0) && (
            <div class="lvd-captions" aria-label="Conversation captions">
              {ui.transcript ? (
                <ol class="lvd-transcript">
                  {live.turns.map((turn, i) => (
                    <li key={i} data-role={turn.role}>
                      <span>{turn.role === "user" ? "You" : firstName}</span>
                      {turn.text.trim()}
                    </li>
                  ))}
                </ol>
              ) : (
                <>
                  {lastEditor && (
                    <p class="lvd-caption lvd-caption--editor">
                      {lastEditor.text.trim().slice(-320)}
                    </p>
                  )}
                  {lastUser && (
                    <p class="lvd-caption lvd-caption--you">
                      <span>You</span>
                      {lastUser.text.trim().slice(-200)}
                    </p>
                  )}
                  {!lastEditor && !lastUser && (
                    <p class="lvd-caption lvd-caption--hint">
                      Say hello — or ask about the passage you’re stuck on.
                    </p>
                  )}
                </>
              )}
              {live.turns.length > 2 && (
                <button
                  type="button"
                  class="lvd-link"
                  onClick$={() => {
                    ui.transcript = !ui.transcript;
                  }}
                >
                  {ui.transcript ? "Latest only" : "Full transcript"}
                </button>
              )}
            </div>
          )}

          {live.notice && (
            <p class="lvd-notice" role="status">
              {live.notice}
            </p>
          )}

          {live.pending && (
            <section class="lvd-edit" aria-label="Proposed draft edit">
              <p class="lvd-edit-kicker">
                {live.pending.kind === "append"
                  ? `${firstName} suggests adding`
                  : `${firstName} suggests`}
              </p>
              {live.pending.original && <del>{live.pending.original}</del>}
              <ins>{live.pending.text || "Remove this passage"}</ins>
              <div class="lvd-edit-actions">
                <button
                  type="button"
                  class="lvd-pill lvd-pill--solid"
                  disabled={live.working}
                  onClick$={() => reviewVoiceEdit(true)}
                >
                  Apply edit
                </button>
                <button
                  type="button"
                  class="lvd-pill"
                  disabled={live.working}
                  onClick$={() => reviewVoiceEdit(false)}
                >
                  Discard
                </button>
                <span>or just say so</span>
              </div>
            </section>
          )}

          {live.sources.length > 0 && (
            <ul class="lvd-sources">
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
            <p role="alert" class="lvd-error">
              {live.error || ui.error}
            </p>
          )}

          {!active && (
            <div class="lvd-gate">
              <section aria-label="Local Live voice">
                <p>Local voice · 2.44 GB · runs on this device</p>
                {!ui.localChecked ? (
                  <p>Checking this device…</p>
                ) : !ui.localSupported ? (
                  <p>
                    Local voice needs WebGPU with 16-bit shader support
                    (shader-f16).
                  </p>
                ) : ui.localReady ? (
                  <>
                    {ui.localSelected ? (
                      <span>Using local voice</span>
                    ) : (
                      <button
                        type="button"
                        class="lvd-link"
                        onClick$={() => {
                          ui.localSelected = true;
                          ui.error = "";
                          localStorage.setItem("twyne.live.local", "selected");
                        }}
                      >
                        Use local voice
                      </button>
                    )}{" "}
                    <button
                      type="button"
                      class="lvd-link"
                      onClick$={async () => {
                        await evictLocalLive();
                        ui.localReady = false;
                        ui.localSelected = false;
                        localStorage.removeItem("twyne.live.local");
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    class="lvd-link"
                    disabled={ui.localDownloading}
                    onClick$={async () => {
                      ui.error = "";
                      try {
                        await downloadLocalLive();
                        ui.localSelected = true;
                        localStorage.setItem("twyne.live.local", "selected");
                      } catch (error) {
                        ui.localDownloading = false;
                        ui.error =
                          error instanceof Error
                            ? error.message
                            : "Local voice could not be downloaded.";
                      }
                    }}
                  >
                    {ui.localDownloading
                      ? `Downloading ${Math.round(ui.localProgress * 100)}%`
                      : "Download local voice"}
                  </button>
                )}
                {ui.localDownloading && (
                  <progress
                    class="lvd-download-meter"
                    max={1}
                    value={ui.localProgress}
                    aria-label="Local voice download"
                  />
                )}
                {ui.localSelected && (
                  <button
                    type="button"
                    class="lvd-link"
                    onClick$={() => {
                      ui.localSelected = false;
                      ui.error = "";
                      localStorage.setItem("twyne.live.local", "hosted");
                    }}
                  >
                    {signedIn ? "Use hosted voice" : "Switch to hosted voice"}
                  </button>
                )}
              </section>
              {!ui.localSelected && (
                <>
                  {!signedIn ? (
                    <p>
                      <a href="/signin/">Sign in</a> to talk with your editors.
                      New accounts start with welcome credit.
                    </p>
                  ) : !hostedAuthenticated ? (
                    <p>Waiting for your account to connect…</p>
                  ) : ui.loading && !access ? (
                    <p>Checking your credit…</p>
                  ) : !access ? (
                    <button type="button" class="lvd-link" onClick$={refresh}>
                      Check voice access
                    </button>
                  ) : !access.eligible ? (
                    <p>
                      Voice is part of Pro. <a href="/pricing/">See plans</a>
                    </p>
                  ) : !affordable ? (
                    <p>
                      ${(access.availableMicros / 1_000_000).toFixed(2)} left —
                      a conversation needs $0.50.{" "}
                      <a href="/pricing/">Add credit</a>
                    </p>
                  ) : (
                    !access.consentGranted && (
                      <label class="lvd-consent">
                        <input
                          type="checkbox"
                          checked={ui.consent}
                          onChange$={(_, element) => {
                            ui.consent = element.checked;
                          }}
                        />
                        <span>
                          Let the voice provider process and log my microphone
                          audio and the draft I share, through Not Organic.
                        </span>
                      </label>
                    )
                  )}
                  {access && (
                    <details class="lvd-fine">
                      <summary>
                        ${(access.availableMicros / 1_000_000).toFixed(2)}{" "}
                        {access.welcome ? "welcome credit" : "in your wallet"} ·
                        how billing works
                      </summary>
                      <p>
                        Up to $0.50 is reserved per conversation; app requests
                        use up to $0.05 each on top. Unused credit is released
                        when the session settles. GPT Live voice, speaking from
                        your editor’s perspective. Audio isn’t recorded in
                        Twyne; captions stay in this session.
                      </p>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <footer class="lvd-controls">
        {active ? (
          <>
            <button
              type="button"
              class="lvd-round"
              disabled={!connected}
              aria-pressed={live.muted}
              aria-label={live.muted ? "Unmute microphone" : "Mute microphone"}
              title={live.muted ? "Unmute" : "Mute"}
              onClick$={() => muteLiveVoice()}
            >
              {MIC_ICON}
              {live.muted && <span class="lvd-slash" aria-hidden="true" />}
            </button>
            <button
              type="button"
              class="lvd-end"
              disabled={live.status === "closing"}
              onClick$={() => {
                endLiveVoice();
              }}
            >
              {live.status === "connecting" ? "Cancel" : "End"}
            </button>
          </>
        ) : (
          <button
            type="button"
            class="lvd-start"
            disabled={!canStart}
            onClick$={async () => {
              if (!canStart || (!client.value && !ui.localSelected)) return;
              await startLiveVoice(
                client.value ?? null,
                ui.author,
                ui.passage,
                !ui.access?.consentGranted && ui.consent,
                { local: ui.localSelected, profileLocal: ui.localSelected },
              );
            }}
          >
            {MIC_ICON}
            {live.finalized ? "Talk again" : "Start talking"}
          </button>
        )}
      </footer>
    </aside>
  );
});
