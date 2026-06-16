import { component$, useStylesScoped$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { LegalPage } from "../../components/legal/legal-page";

/** Where the native desktop bundles are published (one asset per platform). */
const RELEASES_LATEST =
  "https://github.com/Diogenesoftoronto/twyne/releases/latest";

interface Platform {
  id: string;
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

export default component$(() => {
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
      transition: background 0.15s ease;
    }
    .dl-btn:hover {
      background: var(--color-vermilion-2);
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
  `);

  return (
    <LegalPage
      title="Downloads"
      lead="Take Twyne to your own desk — or keep it in the browser."
      toc={[
        { id: "desktop", label: "Desktop app" },
        { id: "web", label: "Web & install" },
        { id: "your-data", label: "Your data travels with you" },
        { id: "release-notes", label: "Release notes & source" },
      ]}
    >
      <div class="doc-callout">
        <p>
          The desktop app is a thin native shell around the live workspace at
          twyne.love — sync, hosted AI, publishing, and sign-in all behave the
          same as the web. Pick a platform below, or simply keep writing in your
          browser. Either way, your local-first folios stay yours.
        </p>
      </div>

      <h2 id="desktop" class="doc-h2">
        Desktop app
      </h2>
      <p class="doc-p">
        Native builds for macOS, Windows, and Linux. Each download is published
        to the latest GitHub release and opens Twyne in its own window with deep
        links for ATProto sign-in.
      </p>

      <div class="dl-grid">
        {PLATFORMS.map((p) => (
          <div key={p.id} class="dl-card">
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

      <h2 id="web" class="doc-h2">
        Web &amp; install
      </h2>
      <p class="doc-p">
        No download required. Twyne runs in any modern browser and can be
        installed as a Progressive Web App for a standalone window, dock icon,
        and offline-friendly local-first storage.
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
          Sign in on any build to sync the same projects across desktop and web.
        </li>
        <li>
          Bring your own AI key, or use hosted AI — both work identically across
          platforms.
        </li>
        <li>
          Export any folio as Markdown, HTML, text, or a .twyne.json backup, on
          any device.
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
        "Download Twyne for macOS, Windows, and Linux, or install the web app as a PWA. Local-first writing that syncs across every device.",
    },
  ],
};
