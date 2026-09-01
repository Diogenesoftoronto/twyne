import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link, type DocumentHead } from "@qwik.dev/router";
import { useAuth } from "../../utils/auth-context";
import {
  loadAiSettingsFromIdb,
  loadApparatusSettingsFromIdb,
} from "../../utils/idb";

interface LedgerStore {
  loaded: boolean;
  providers: string[];
  hostedResearch: boolean;
  externalKnowledgeBases: number;
}

export default component$(() => {
  const auth = useAuth();
  const store = useStore<LedgerStore>({
    loaded: false,
    providers: [],
    hostedResearch: false,
    externalKnowledgeBases: 0,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const [ai, apparatus] = await Promise.all([
      loadAiSettingsFromIdb(),
      loadApparatusSettingsFromIdb(),
    ]);
    store.providers = ai?.providers.map((provider) => provider.name) ?? [];
    store.hostedResearch = apparatus.researchProvider === "hosted";
    store.externalKnowledgeBases = apparatus.mcpServers.filter(
      (server) => server.enabled,
    ).length;
    store.loaded = true;
  });

  const signedIn = Boolean(auth.value.user);
  const rows = [
    {
      area: "Manuscripts and revision history",
      status: "On this device",
      detail:
        "Drafts, checkpoints, editorial tasks, and local settings are stored in this browser's IndexedDB and Lix database.",
    },
    {
      area: "Account sync",
      status: signedIn ? "Active" : "Off",
      detail: signedIn
        ? "Your folios and editorial artifacts sync to your authenticated Twyne account."
        : "Nothing is sent for account sync until you sign in.",
    },
    {
      area: "AI providers",
      status:
        store.providers.length > 0
          ? `${store.providers.length} configured`
          : "No browser provider",
      detail:
        store.providers.length > 0
          ? `Requests go to ${store.providers.join(", ")} only when you invoke an AI feature. API keys stay in this browser.`
          : "Hosted AI is used only when you explicitly invoke a hosted feature while signed in.",
    },
    {
      area: "Research",
      status: store.hostedResearch
        ? "Hosted search selected"
        : "Local or direct",
      detail:
        store.externalKnowledgeBases > 0
          ? `${store.externalKnowledgeBases} enabled MCP knowledge base${store.externalKnowledgeBases === 1 ? "" : "s"} may receive claim searches you initiate.`
          : "No external MCP knowledge bases are enabled.",
    },
    {
      area: "Publishing and collaboration",
      status: "Action only",
      detail:
        "A manuscript leaves the device only when you publish, invite a collaborator, or send it to an external Micropub or ATProto destination.",
    },
    {
      area: "Product analytics",
      status: "Content redacted",
      detail:
        "Twyne records feature and reliability events without manuscript, prompt, response, API-key, or access-token content.",
    },
  ];

  return (
    <main class="min-h-screen bg-[var(--color-paper)] px-4 py-8 text-[var(--color-ink)] sm:px-8">
      <div class="mx-auto max-w-4xl">
        <header class="mb-8 border-b border-[var(--color-paper-3)] pb-5">
          <p class="dept-label">Privacy ledger</p>
          <h1 class="mt-2 font-display text-3xl">Where your writing goes</h1>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-light)]">
            A current, product-level account of storage and data movement. This
            ledger describes behavior; the full legal policy remains available
            in Privacy.
          </p>
        </header>

        <section class="folio divide-y divide-[var(--color-paper-3)]">
          {rows.map((row) => (
            <div
              key={row.area}
              class="grid gap-2 p-5 sm:grid-cols-[12rem_10rem_1fr]"
            >
              <h2 class="font-display text-sm font-semibold">{row.area}</h2>
              <p class="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-sage)]">
                {store.loaded ? row.status : "Checking…"}
              </p>
              <p class="text-sm leading-6 text-[var(--color-ink-light)]">
                {row.detail}
              </p>
            </div>
          ))}
        </section>

        <footer class="mt-6 flex flex-wrap items-center gap-3">
          <Link class="btn-press" href="/settings/">
            Review privacy settings
          </Link>
          <Link class="btn-paper" href="/privacy/">
            Read the privacy policy
          </Link>
          <Link class="btn-paper" href="/editor/">
            Return to editor
          </Link>
        </footer>
      </div>
    </main>
  );
});

export const head: DocumentHead = {
  title: "Privacy ledger · Twyne",
  meta: [
    {
      name: "description",
      content: "See where Twyne stores and sends your writing.",
    },
  ],
};
