import {
  component$,
  useSignal,
  useStylesScoped$,
  useVisibleTask$,
  $,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { LegalPage } from "../../components/legal/legal-page";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";

/** Where the native desktop bundles are published (one asset per platform). */
const RELEASES_LATEST =
  "https://github.com/Diogenesoftoronto/twyne/releases/latest";

type DesktopPlatformId = "macos" | "windows" | "linux";

interface Platform {
  id: DesktopPlatformId;
  name: string;
  glyph: string;
  format: string;
  note: string;
  href: string;
}

const PLATFORMS: Platform[] = [
  {
    id: "macos",
    name: "macOS",
    glyph: "⌘",
    format: "Apple silicon & Intel · .tar.gz",
    note: "Universal native shell. Unzip and drag Twyne to Applications.",
    href: "/download/macos",
  },
  {
    id: "windows",
    name: "Windows",
    glyph: "⊞",
    format: "Windows 10/11 · .tar.gz",
    note: "Native window over the live app. Extract and run the bundled executable.",
    href: "/download/windows",
  },
  {
    id: "linux",
    name: "Linux",
    glyph: "⌂",
    format: "x86_64 · .tar.gz",
    note: "Native shell for most modern distributions. Extract and launch.",
    href: "/download/linux",
  },
];

/** Best-effort client-side OS sniff, purely cosmetic (highlights a card). */
function detectPlatform(): DesktopPlatformId | null {
  if (typeof navigator === "undefined") return null;
  const uaDataPlatform =
    (navigator as unknown as { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? "";
  const combined =
    `${uaDataPlatform} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  if (/mac|darwin/.test(combined)) return "macos";
  if (/win/.test(combined)) return "windows";
  if (/linux|x11/.test(combined)) return "linux";
  return null;
}

type WaitlistStatus = "idle" | "submitting" | "joined" | "error";

interface MobilePlatform {
  id: "ios" | "android";
  name: string;
  glyph: string;
  note: string;
}

const MOBILE_PLATFORMS: MobilePlatform[] = [
  {
    id: "ios",
    name: "iOS",
    glyph: "◈",
    note: "A pocket-sized folio: draft, review persona notes, and publish from your phone.",
  },
  {
    id: "android",
    name: "Android",
    glyph: "▲",
    note: "Same room, same personas — built for the phone in your other pocket.",
  },
];

/**
 * Renders one mobile "coming soon" card. A plain function rather than a
 * component$ so its markup shares the parent's scoped-style hash (see the
 * note on LegalPage about Slot-projected content needing global classes —
 * the same boundary applies to child components' own render trees).
 */
function mobileWaitlistCard(props: {
  platform: MobilePlatform;
  email: Signal<string>;
  status: Signal<WaitlistStatus>;
  error: Signal<string | null>;
  onSubmit: QRL<() => void>;
}) {
  const { platform, email, status, error, onSubmit } = props;
  return (
    <div key={platform.id} class="dl-card dl-card-soon">
      <img
        src="/approval-stamp.svg"
        alt=""
        class="dl-stamp dl-stamp-soon stamp-tilt-r"
        aria-hidden="true"
      />
      <span class="dl-glyph" aria-hidden="true">
        {platform.glyph}
      </span>
      <span class="dl-name">{platform.name}</span>
      <span class="dl-format">Coming soon</span>
      <p class="dl-note">{platform.note}</p>
      {status.value === "joined" ? (
        <p class="dl-joined">
          You're on the list — we'll email you the moment it ships.
        </p>
      ) : (
        <form
          preventdefault:submit
          onSubmit$={onSubmit}
          class="dl-waitlist-form"
        >
          <input
            type="email"
            required
            placeholder="you@email.com"
            value={email.value}
            onInput$={(_, el) => (email.value = el.value)}
            class="dl-waitlist-input"
            aria-label={`Email for the ${platform.name} waitlist`}
          />
          <button
            type="submit"
            class="dl-btn dl-btn-small"
            disabled={status.value === "submitting"}
          >
            {status.value === "submitting" ? "Joining…" : "Notify me"}
          </button>
        </form>
      )}
      {status.value === "error" && error.value && (
        <p class="dl-waitlist-error">{error.value}</p>
      )}
    </div>
  );
}

export default component$(() => {
  const detected = useSignal<DesktopPlatformId | null>(null);
  const detecting = useSignal(true);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    detected.value = detectPlatform();
    detecting.value = false;
  });

  const client = useConvexClient();

  const iosEmail = useSignal("");
  const iosStatus = useSignal<WaitlistStatus>("idle");
  const iosError = useSignal<string | null>(null);

  const androidEmail = useSignal("");
  const androidStatus = useSignal<WaitlistStatus>("idle");
  const androidError = useSignal<string | null>(null);

  const joinWaitlist = $(
    async (
      platform: "ios" | "android",
      email: Signal<string>,
      status: Signal<WaitlistStatus>,
      error: Signal<string | null>,
    ) => {
      const c = client.value;
      if (!c) {
        status.value = "error";
        error.value = "Not connected yet — try again in a moment.";
        return;
      }
      status.value = "submitting";
      error.value = null;
      try {
        const result = await c.mutation(api.waitlist.join, {
          email: email.value,
          platform,
        });
        if (result.ok) {
          status.value = "joined";
        } else {
          status.value = "error";
          error.value = result.error;
        }
      } catch {
        status.value = "error";
        error.value = "Something went wrong. Try again.";
      }
    },
  );

  const submitIos = $(() =>
    joinWaitlist("ios", iosEmail, iosStatus, iosError),
  );
  const submitAndroid = $(() =>
    joinWaitlist("android", androidEmail, androidStatus, androidError),
  );

  useStylesScoped$(`
    .dl-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.85rem;
      margin: 0.4rem 0 0.5rem;
    }
    @media (min-width: 720px) {
      .dl-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    .dl-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1.1rem 1.1rem 1.2rem;
      background: var(--color-paper-soft);
      border: 1px solid var(--color-paper-3);
      border-radius: 3px;
      box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.6) inset,
        0 10px 26px -22px rgba(31, 27, 22, 0.45);
      transition:
        transform 0.15s ease,
        box-shadow 0.15s ease,
        border-color 0.15s ease;
    }
    .dl-card:hover {
      transform: translateY(-2px);
      border-color: var(--color-vermilion);
      box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.6) inset,
        0 18px 34px -22px rgba(31, 27, 22, 0.5);
    }
    .dl-card-recommended {
      border-color: var(--color-vermilion);
      border-width: 2px;
      padding: calc(1.1rem - 1px) calc(1.1rem - 1px) calc(1.2rem - 1px);
    }
    .dl-stamp {
      position: absolute;
      top: -0.6rem;
      right: -0.6rem;
      width: 3.4rem;
      height: 3.4rem;
      opacity: 0;
      pointer-events: none;
      animation: dl-stamp-down 0.4s ease-out 0.05s forwards;
    }
    .dl-stamp-soon {
      opacity: 0.85;
      animation: none;
    }
    @keyframes dl-stamp-down {
      0% {
        opacity: 0;
        transform: scale(1.6) rotate(4deg);
      }
      70% {
        opacity: 1;
        transform: scale(0.92) rotate(4deg);
      }
      100% {
        opacity: 0.9;
        transform: scale(1) rotate(4deg);
      }
    }
    .dl-glyph {
      font-size: 1.6rem;
      line-height: 1;
    }
    .dl-name {
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 1.15rem;
      color: var(--color-ink);
    }
    .dl-format {
      font-family: var(--font-typewriter);
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--color-ink-muted);
    }
    .dl-note {
      font-family: var(--font-serif);
      font-size: 0.85rem;
      line-height: 1.5;
      color: var(--color-ink-light);
      margin: 0;
      flex: 1 1 auto;
    }
    .dl-btn {
      align-self: flex-start;
      margin-top: 0.2rem;
      padding: 0.45rem 0.95rem;
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--color-paper-soft);
      background: var(--color-vermilion);
      border: 1px solid var(--color-vermilion-2);
      border-radius: 2px;
      text-decoration: none;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .dl-btn:hover {
      background: var(--color-vermilion-2);
    }
    .dl-btn:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .dl-btn-small {
      font-size: 0.78rem;
      padding: 0.4rem 0.8rem;
      white-space: nowrap;
    }
    .dl-detect-line {
      min-height: 1.4rem;
      font-family: var(--font-typewriter);
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      color: var(--color-ink-muted);
      margin: 0 0 0.6rem;
      opacity: 0;
      transition: opacity 0.4s ease;
    }
    .dl-detect-line.dl-detect-visible {
      opacity: 1;
    }
    .dl-detect-line strong {
      color: var(--color-vermilion);
    }
    .dl-benefits {
      list-style: none;
      margin: 0.5rem 0 1rem;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }
    .dl-benefits li {
      font-family: var(--font-serif);
      font-size: 0.9rem;
      line-height: 1.55;
      color: var(--color-ink-light);
      padding-left: 1.4rem;
      position: relative;
    }
    .dl-benefits li::before {
      content: "✦";
      position: absolute;
      left: 0;
      top: 0.05rem;
      color: var(--color-vermilion);
      font-size: 0.75rem;
    }
    .dl-web {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.9rem;
      padding: 1.1rem 1.2rem;
      background: var(--color-paper);
      border: 1px dashed var(--color-paper-3);
      border-radius: 3px;
    }
    .dl-web-body {
      flex: 1 1 16rem;
    }
    .dl-web-body p {
      margin: 0.3rem 0 0;
      font-family: var(--font-serif);
      font-size: 0.88rem;
      line-height: 1.55;
      color: var(--color-ink-light);
    }
    .dl-checks {
      list-style: none;
      margin: 0.4rem 0 0;
      padding: 0;
      display: grid;
      gap: 0.3rem;
    }
    .dl-checks li {
      font-family: var(--font-serif);
      font-size: 0.88rem;
      line-height: 1.5;
      color: var(--color-ink-light);
      padding-left: 1.3rem;
      position: relative;
    }
    .dl-checks li::before {
      content: "✓";
      position: absolute;
      left: 0;
      color: var(--color-sage);
      font-family: var(--font-typewriter);
      font-size: 0.8rem;
    }
    .dl-card-soon {
      background: var(--color-paper);
    }
    .dl-waitlist-form {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-top: 0.2rem;
    }
    .dl-waitlist-input {
      flex: 1 1 9rem;
      min-width: 0;
      padding: 0.42rem 0.6rem;
      font-family: var(--font-serif);
      font-size: 0.85rem;
      color: var(--color-ink);
      background: var(--color-paper-soft);
      border: 1px solid var(--color-paper-3);
      border-radius: 2px;
    }
    .dl-waitlist-input:focus {
      outline: none;
      border-color: var(--color-vermilion);
    }
    .dl-joined {
      font-family: var(--font-serif);
      font-size: 0.85rem;
      font-style: italic;
      color: var(--color-sage);
      margin: 0.2rem 0 0;
    }
    .dl-waitlist-error {
      font-family: var(--font-typewriter);
      font-size: 0.72rem;
      color: var(--color-vermilion);
      margin: 0.1rem 0 0;
    }
  `);

  return (
    <LegalPage
      title="Downloads"
      lead="Take Twyne to your own desk — or keep it in the browser."
      toc={[
        { id: "desktop", label: "Desktop app" },
        { id: "mobile", label: "Mobile apps" },
        { id: "web", label: "Web & install" },
        { id: "your-data", label: "Your data travels with you" },
        { id: "release-notes", label: "Release notes & source" },
      ]}
    >
      <div class="doc-callout">
        <p>
          The desktop app is a thin native shell around the live workspace at
          twyne.love — sync, hosted AI, publishing, and sign-in all behave the
          same as the web. Pick a platform below, or simply keep writing in
          your browser. Either way, your local-first folios stay yours.
        </p>
      </div>

      <h2 id="desktop" class="doc-h2">
        Desktop app
      </h2>
      <p class="doc-p">
        Native builds for macOS, Windows, and Linux. Each download is
        published to the latest GitHub release and opens Twyne in its own
        window. A few reasons it's worth the extra click over a browser tab:
      </p>

      <ul class="dl-benefits">
        <li>
          Distraction-free — a native window with no tabs, address bar, or
          browser chrome around your writing.
        </li>
        <li>
          Smoother ATProto sign-in — the app registers a{" "}
          <code>twyne://</code> URL scheme so OAuth callbacks land back in the
          app directly, instead of bouncing through a browser redirect.
        </li>
        <li>
          Its own dock or taskbar icon and app-switcher entry, separate from
          whatever else is open in your browser.
        </li>
        <li>
          The same account, sync, and hosted AI as the web — nothing to
          reconfigure when you move between desktop and browser.
        </li>
      </ul>

      <p
        class={`dl-detect-line ${detecting.value ? "" : "dl-detect-visible"}`}
        aria-live="polite"
      >
        {detected.value ? (
          <>
            Looks like you're on <strong>
              {PLATFORMS.find((p) => p.id === detected.value)?.name}
            </strong>
            — that card's stamped below.
          </>
        ) : (
          !detecting.value && "Pick your platform below."
        )}
      </p>

      <div class="dl-grid">
        {PLATFORMS.map((p) => (
          <div
            key={p.id}
            class={`dl-card ${detected.value === p.id ? "dl-card-recommended" : ""}`}
          >
            {detected.value === p.id && (
              <img
                src="/approval-stamp.svg"
                alt=""
                class="dl-stamp stamp-tilt"
                aria-hidden="true"
              />
            )}
            <span class="dl-glyph" aria-hidden="true">
              {p.glyph}
            </span>
            <span class="dl-name">{p.name}</span>
            <span class="dl-format">{p.format}</span>
            <p class="dl-note">{p.note}</p>
            <a class="dl-btn" href={p.href} target="_blank" rel="noreferrer">
              Download for {p.name}
            </a>
          </div>
        ))}
      </div>

      <p class="doc-p">
        Builds are unsigned for now, so your operating system may ask you to
        confirm before launching an app from an unidentified developer. The
        desktop shell never bundles your writing — it loads the same hosted
        workspace you use on the web.
      </p>

      <h2 id="mobile" class="doc-h2">
        Mobile apps
      </h2>
      <p class="doc-p">
        iOS and Android apps are in the works. Leave your email and we'll let
        you know the day they land — no spam, just one message when it's
        ready.
      </p>

      <div class="dl-grid">
        {mobileWaitlistCard({
          platform: MOBILE_PLATFORMS[0],
          email: iosEmail,
          status: iosStatus,
          error: iosError,
          onSubmit: submitIos,
        })}
        {mobileWaitlistCard({
          platform: MOBILE_PLATFORMS[1],
          email: androidEmail,
          status: androidStatus,
          error: androidError,
          onSubmit: submitAndroid,
        })}
      </div>

      <h2 id="web" class="doc-h2">
        Web &amp; install
      </h2>
      <p class="doc-p">
        No download required. Twyne runs in any modern browser and can be
        installed as a Progressive Web App for a standalone window, dock
        icon, and offline-friendly local-first storage.
      </p>

      <div class="dl-web">
        <div class="dl-web-body">
          <span class="dl-name">Open in the browser</span>
          <p>
            Visit Twyne and start writing immediately — no account needed. To
            install, use your browser's “Install app” or “Add to Home Screen”
            option from the address bar or menu.
          </p>
        </div>
        <a class="dl-btn" href="/">
          Launch Twyne
        </a>
      </div>

      <h2 id="your-data" class="doc-h2">
        Your data travels with you
      </h2>
      <ul class="dl-checks">
        <li>
          Local-first by default — your brief, folios, and drafts live in your
          browser's IndexedDB until you choose to sync.
        </li>
        <li>
          Sign in on any build to sync the same projects across desktop and
          web.
        </li>
        <li>
          Bring your own AI key, or use hosted AI — both work identically
          across platforms.
        </li>
        <li>
          Export any folio as Markdown, HTML, text, or a .twyne.json backup,
          on any device.
        </li>
      </ul>

      <h2 id="release-notes" class="doc-h2">
        Release notes &amp; source
      </h2>
      <p class="doc-p">
        Every build is published with generated notes on GitHub. See what
        changed, grab an earlier version, or read the source on the{" "}
        <a href={RELEASES_LATEST} target="_blank" rel="noreferrer">
          releases page
        </a>
        . Questions about a build can go to{" "}
        <a href="mailto:support@twyne.love">support@twyne.love</a>.
      </p>
    </LegalPage>
  );
});

export const head: DocumentHead = {
  title: "Downloads · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Download Twyne for macOS, Windows, and Linux, join the iOS/Android waitlist, or install the web app as a PWA. Local-first writing that syncs across every device.",
    },
  ],
};
