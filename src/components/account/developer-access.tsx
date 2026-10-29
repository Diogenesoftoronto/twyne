import { $, component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AppError } from "../../types/application-errors";
import { ApplicationNotice } from "../ui/application-notice";
import { useAuth } from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { normalizeApplicationError } from "../../utils/application-errors";

interface DeveloperAccessStore {
  integrationTokensLoaded: boolean;
  integrationTokens: Array<{
    id: Id<"integrationTokens">;
    name: string;
    prefix: string;
    createdAt: number;
  }>;
  integrationTokenName: string;
  integrationTokenBusy: boolean;
  integrationTokenError: AppError | null;
  newIntegrationToken: string | null;
  integrationTokenCopied: boolean;
}

/** Personal access tokens for the `twyne` CLI and `twyne-mcp` server. */
export const DeveloperAccess = component$(() => {
  const convexClientSig = useConvexClient();
  const auth = useAuth();
  const integrationApiUrl = import.meta.env.VITE_CONVEX_SITE_URL
    ? `${String(import.meta.env.VITE_CONVEX_SITE_URL).replace(/\/$/, "")}/api/integrations/v1`
    : "";
  const store = useStore<DeveloperAccessStore>({
    integrationTokensLoaded: false,
    integrationTokens: [],
    integrationTokenName: "",
    integrationTokenBusy: false,
    integrationTokenError: null,
    newIntegrationToken: null,
    integrationTokenCopied: false,
  });

  const refreshIntegrationTokens = $(async () => {
    const client = convexClientSig.value;
    if (!client || auth.value.provider !== "convex") {
      store.integrationTokens = [];
      store.integrationTokensLoaded = true;
      return;
    }
    try {
      store.integrationTokens = await client.query(
        api.integrations.listTokens,
        {},
      );
      store.integrationTokenError = null;
    } catch (error) {
      store.integrationTokenError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "list-integration-tokens" },
      });
    } finally {
      store.integrationTokensLoaded = true;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    track(() => auth.value.provider);
    track(() => convexClientSig.value);
    await refreshIntegrationTokens();
  });

  const handleCreateIntegrationToken = $(async () => {
    const client = convexClientSig.value;
    if (!client) return;
    store.integrationTokenBusy = true;
    store.integrationTokenError = null;
    store.integrationTokenCopied = false;
    try {
      const created = await client.mutation(api.integrations.createToken, {
        name: store.integrationTokenName.trim() || "CLI and MCP",
      });
      store.newIntegrationToken = created.token;
      store.integrationTokenName = "";
      await refreshIntegrationTokens();
    } catch (error) {
      store.integrationTokenError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "create-integration-token" },
      });
    } finally {
      store.integrationTokenBusy = false;
    }
  });

  const handleRevokeIntegrationToken = $(
    async (id: Id<"integrationTokens">) => {
      const client = convexClientSig.value;
      if (!client) return;
      store.integrationTokenBusy = true;
      store.integrationTokenError = null;
      try {
        await client.mutation(api.integrations.revokeToken, { id });
        await refreshIntegrationTokens();
      } catch (error) {
        store.integrationTokenError = normalizeApplicationError(error, {
          source: "convex",
          metadata: { operation: "revoke-integration-token" },
        });
      } finally {
        store.integrationTokenBusy = false;
      }
    },
  );

  const handleCopyIntegrationToken = $(async () => {
    if (!store.newIntegrationToken) return;
    await navigator.clipboard.writeText(store.newIntegrationToken);
    store.integrationTokenCopied = true;
  });

  return (
    <section class="folio p-5 border border-[var(--color-paper-3)]">
      <h2
        class="text-base font-semibold mb-1"
        style={{ fontFamily: "var(--font-display)" }}
      >
        CLI &amp; MCP access
      </h2>
      <p class="text-xs text-[var(--color-ink-light)] mb-4 leading-relaxed">
        Give writing tools permission to import and export folios, read
        critiques and rubrics, and work with your citations. A token is shown
        once; Twyne stores only its fingerprint.
      </p>

      {store.integrationTokenError && (
        <div class="mb-3">
          <ApplicationNotice
            error={store.integrationTokenError}
            compact
            onRetry$={refreshIntegrationTokens}
            onDismiss$={() => {
              store.integrationTokenError = null;
            }}
          />
        </div>
      )}

      {store.newIntegrationToken && (
        <div class="mb-5 p-3 border border-[var(--color-accent-green)] bg-[var(--color-paper-soft)]">
          <p
            class="text-[0.65rem] tracking-[0.14em] uppercase text-[var(--color-accent-green)] mb-2"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Copy this token now — it won&apos;t be shown again
          </p>
          <textarea
            readOnly
            rows={3}
            value={store.newIntegrationToken}
            class="w-full p-2 text-xs break-all bg-[var(--color-paper)] text-[var(--color-ink)] border border-[var(--color-paper-3)] resize-none"
            style={{ fontFamily: "var(--font-mono)" }}
            aria-label="New Twyne access token"
          />
          <div class="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick$={handleCopyIntegrationToken}
              class="btn-press text-xs text-[var(--color-paper)]"
              style={{
                backgroundColor: "var(--color-ink)",
                fontFamily: "var(--font-typewriter)",
              }}
            >
              {store.integrationTokenCopied ? "Copied" : "Copy token"}
            </button>
            <button
              type="button"
              onClick$={() => {
                store.newIntegrationToken = null;
                store.integrationTokenCopied = false;
              }}
              class="text-[0.7rem] tracking-[0.12em] uppercase text-[var(--color-ink-muted)] hover:underline"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div class="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          type="text"
          value={store.integrationTokenName}
          onInput$={(event) => {
            store.integrationTokenName = (
              event.target as HTMLInputElement
            ).value;
          }}
          placeholder="Token name, e.g. Claude Desktop"
          maxLength={80}
          class="flex-1 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)]"
          style={{ fontFamily: "var(--font-typewriter)" }}
        />
        <button
          type="button"
          onClick$={handleCreateIntegrationToken}
          disabled={store.integrationTokenBusy}
          class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-50"
          style={{
            backgroundColor: "var(--color-ink)",
            fontFamily: "var(--font-typewriter)",
          }}
        >
          {store.integrationTokenBusy ? "Working…" : "Create token"}
        </button>
      </div>

      {integrationApiUrl && (
        <div class="mb-4 p-3 bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)]">
          <p class="text-xs text-[var(--color-ink-light)] mb-2">
            After installing the Twyne tools, run this once and paste the token
            when asked:
          </p>
          <code
            class="block text-[0.7rem] text-[var(--color-ink)] break-all"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            twyne auth login --url {integrationApiUrl}
          </code>
          <p class="mt-2 text-[0.68rem] text-[var(--color-ink-muted)]">
            MCP hosts can then launch <code>twyne-mcp</code>; it reads the same
            local login.
          </p>
        </div>
      )}

      <div class="space-y-2">
        {!store.integrationTokensLoaded && (
          <p class="text-xs text-[var(--color-ink-muted)]">Loading tokens…</p>
        )}
        {store.integrationTokensLoaded &&
          store.integrationTokens.length === 0 && (
            <p class="text-xs text-[var(--color-ink-muted)]">
              No CLI or MCP tokens yet.
            </p>
          )}
        {store.integrationTokens.map((token) => (
          <div
            key={token.id}
            class="flex items-center justify-between gap-3 p-2 border border-[var(--color-paper-3)]"
          >
            <div class="min-w-0">
              <p class="text-sm text-[var(--color-ink)] truncate">
                {token.name}
              </p>
              <p
                class="text-[0.65rem] text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {token.prefix}… · created{" "}
                {new Date(token.createdAt).toLocaleDateString()}
              </p>
            </div>
            <button
              type="button"
              onClick$={() => handleRevokeIntegrationToken(token.id)}
              disabled={store.integrationTokenBusy}
              class="text-[0.65rem] tracking-[0.12em] uppercase text-[var(--color-vermilion)] hover:underline disabled:opacity-50"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
    </section>
  );
});
