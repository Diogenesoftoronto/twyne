import { $, component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { useGT } from "gt-qwik";
import { translate } from "gt-qwik/runtime";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import {
  CUSTOM_DOMAIN_LIMIT,
  normalizeCustomHostname,
} from "../../utils/custom-domain-hostnames";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { SiteSelect } from "../ui/site-select";

type DomainStatus =
  | "pending_dns"
  | "issuing_certificate"
  | "active"
  | "failed"
  | "removed";

interface DnsRecord {
  type: "CNAME" | "ALIAS" | "TXT" | "A";
  name: string;
  fqdn: string;
  value: string;
  purpose: "traffic" | "verification" | "certificate";
  ready: boolean;
}

interface CustomDomain {
  id: Id<"customDomains">;
  hostname: string;
  kind: "apex" | "subdomain";
  handle: string;
  status: DomainStatus;
  dnsRecords: DnsRecord[];
  registered: boolean;
  lastCheckedAt: number | null;
  lastError: string | null;
  activatedAt: number | null;
  createdAt: number;
}

interface WaitlistEntry {
  hostname: string | null;
  status: "waiting" | "connected";
  joinedAt: number;
}

interface CustomDomainStore {
  loaded: boolean;
  domains: CustomDomain[];
  handles: string[];
  /** Connecting domains directly is team-only while they're waitlisted. */
  isAdmin: boolean;
  waitlist: WaitlistEntry | null;
  waitlistDraft: string;
  draft: string;
  draftHandle: string;
  busy: string | null;
  error: string | null;
  confirmRemove: string | null;
  copied: string | null;
}

/** Codes with their own translated message; anything else shows the server's text. */
const ERROR_CODES = new Set([
  "HOSTNAME_EMPTY",
  "HOSTNAME_INVALID",
  "HOSTNAME_TOO_LONG",
  "HOSTNAME_IP",
  "HOSTNAME_LOCAL",
  "HOSTNAME_TWYNE",
  "HOSTNAME_PROVIDER",
  "HOSTNAME_WILDCARD",
  "CUSTOM_DOMAIN_TAKEN",
  "CUSTOM_DOMAIN_LIMIT",
  "CUSTOM_DOMAIN_NEEDS_HANDLE",
  "CUSTOM_DOMAIN_REMOVING",
  "CUSTOM_DOMAIN_WAITLIST",
  "RATE_LIMITED",
]);

function errorCode(error: unknown): { code?: string; message?: string } {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data: unknown }).data;
    if (data && typeof data === "object") {
      const record = data as { code?: unknown; message?: unknown };
      return {
        code: typeof record.code === "string" ? record.code : undefined,
        message:
          typeof record.message === "string" ? record.message : undefined,
      };
    }
  }
  if (error instanceof Error && /rate limit/i.test(error.message)) {
    return { code: "RATE_LIMITED" };
  }
  return {};
}

/**
 * The writer's own domain for their public page. Domains aren't self-serve
 * yet (the hosting provider allows only a few), so writers see their Twyne
 * address and can join a waitlist; the team connects domains from it, and
 * admins can add one directly. A connected domain shows its DNS records,
 * status, a re-check and remove here as usual.
 */
export const CustomDomainSettings = component$(() => {
  const gt = useGT();
  const t = (id: string, vars?: Record<string, string | number>) =>
    translate(gt, `customDomains.${id}`, vars);
  const auth = useAuth();
  const convex = useConvexClient();
  const store = useStore<CustomDomainStore>({
    loaded: false,
    domains: [],
    handles: [],
    isAdmin: false,
    waitlist: null,
    waitlistDraft: "",
    draft: "",
    draftHandle: "",
    busy: null,
    error: null,
    confirmRemove: null,
    copied: null,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const identity = track(() =>
      hasAuthenticatedConvexIdentity(auth.value) ? auth.value.user?.id : null,
    );
    const client = track(() => convex.value);
    store.loaded = false;
    store.domains = [];
    store.handles = [];
    store.isAdmin = false;
    store.waitlist = null;
    if (!identity || !client) {
      store.loaded = true;
      return;
    }
    let cancelled = false;
    cleanup(() => {
      cancelled = true;
    });
    void client
      .query(api.profiles.getMyHandle, {})
      .then((row) => {
        if (cancelled) return;
        const owned = (row as { ownedAliases?: string[] } | null)?.ownedAliases;
        store.handles = owned ?? [];
        store.draftHandle = store.handles[0] ?? "";
      })
      .catch(() => undefined);
    void client
      .query(api.admins.isCurrentUserAdmin, {})
      .then((admin) => {
        if (!cancelled) store.isAdmin = admin === true;
      })
      .catch(() => undefined);
    cleanup(
      client.onUpdate(
        api.customDomains.myWaitlist,
        {},
        (entry) => {
          store.waitlist = entry as WaitlistEntry | null;
          if (entry?.hostname && !store.waitlistDraft) {
            store.waitlistDraft = entry.hostname;
          }
        },
        () => undefined,
      ),
    );
    cleanup(
      client.onUpdate(
        api.customDomains.listMine,
        {},
        (rows) => {
          store.domains = rows as CustomDomain[];
          store.loaded = true;
        },
        () => {
          store.loaded = true;
        },
      ),
    );
  });

  const showError = $((error: unknown, operation: string) => {
    reportApplicationDiagnostic(
      `twyne:account:custom-domain-${operation}`,
      error,
      {
        operation: `custom-domain-${operation}`,
      },
    );
    const { code, message } = errorCode(error);
    store.error =
      code && ERROR_CODES.has(code)
        ? translate(gt, `customDomains.errors.${code}`, {
            limit: CUSTOM_DOMAIN_LIMIT,
          })
        : (message ?? translate(gt, "customDomains.errors.generic"));
  });

  const add = $(async () => {
    const client = convex.value;
    if (!client || store.busy) return;
    store.error = null;
    const parsed = normalizeCustomHostname(store.draft);
    if (!parsed.ok) {
      store.error = translate(gt, `customDomains.errors.${parsed.code}`);
      return;
    }
    store.busy = "add";
    try {
      await client.mutation(api.customDomains.add, {
        hostname: parsed.hostname,
        handle: store.draftHandle || undefined,
      });
      store.draft = "";
    } catch (error) {
      await showError(error, "add");
    } finally {
      store.busy = null;
    }
  });

  const joinWaitlist = $(async () => {
    const client = convex.value;
    if (!client || store.busy) return;
    store.error = null;
    const draft = store.waitlistDraft.trim();
    let hostname: string | undefined;
    if (draft) {
      const parsed = normalizeCustomHostname(draft);
      if (!parsed.ok) {
        store.error = translate(gt, `customDomains.errors.${parsed.code}`);
        return;
      }
      hostname = parsed.hostname;
    }
    store.busy = "waitlist";
    try {
      await client.mutation(api.customDomains.joinWaitlist, { hostname });
    } catch (error) {
      await showError(error, "waitlist");
    } finally {
      store.busy = null;
    }
  });

  const leaveWaitlist = $(async () => {
    const client = convex.value;
    if (!client || store.busy) return;
    store.error = null;
    store.busy = "waitlist";
    try {
      await client.mutation(api.customDomains.leaveWaitlist, {});
      store.waitlistDraft = "";
    } catch (error) {
      await showError(error, "waitlist");
    } finally {
      store.busy = null;
    }
  });

  const recheck = $(async (domainId: Id<"customDomains">) => {
    const client = convex.value;
    if (!client || store.busy) return;
    store.error = null;
    store.busy = domainId;
    try {
      await client.mutation(api.customDomains.recheck, { domainId });
    } catch (error) {
      await showError(error, "recheck");
    } finally {
      store.busy = null;
    }
  });

  const remove = $(async (domainId: Id<"customDomains">) => {
    const client = convex.value;
    if (!client || store.busy) return;
    store.error = null;
    store.busy = domainId;
    try {
      await client.mutation(api.customDomains.remove, { domainId });
      store.confirmRemove = null;
    } catch (error) {
      await showError(error, "remove");
    } finally {
      store.busy = null;
    }
  });

  const copy = $(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      store.copied = key;
      setTimeout(() => {
        if (store.copied === key) store.copied = null;
      }, 2000);
    } catch {
      // Clipboard can be blocked; the value is selectable on the page.
    }
  });

  const signedIn = hasAuthenticatedConvexIdentity(auth.value);
  if (!signedIn) return null;
  const atLimit = store.domains.length >= CUSTOM_DOMAIN_LIMIT;
  const needsHandle = store.loaded && store.handles.length === 0;
  const handle = store.handles[0];
  const waiting = store.waitlist?.status === "waiting";
  const label =
    "text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)]";

  return (
    <section
      id="domains"
      class="folio p-5 scroll-mt-6"
      aria-labelledby="custom-domains-heading"
    >
      <h2
        id="custom-domains-heading"
        class="text-base font-semibold mb-1"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("title")}
      </h2>
      <p class="text-xs text-[var(--color-ink-light)] mb-4 max-w-2xl">
        {t("description")}
      </p>

      {handle && (
        <p class="mb-4 text-sm">
          {t("addressIntro")}{" "}
          <a
            href={`/${handle}/`}
            class="underline"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            twyne.love/{handle}
          </a>
          <span class="block text-xs text-[var(--color-ink-light)]">
            {t("addressPieces", { example: `twyne.love/${handle}/my-post` })}
          </span>
        </p>
      )}

      {store.error && (
        <p
          class="mb-3 text-[0.7rem] text-[var(--color-vermilion)]"
          style={{ fontFamily: "var(--font-typewriter)" }}
          role="alert"
        >
          {store.error}
        </p>
      )}

      {needsHandle ? (
        <p class="text-sm text-[var(--color-ink-light)]">{t("needsHandle")}</p>
      ) : !store.isAdmin ? (
        store.waitlist?.status === "connected" ? null : (
          <div
            class="border border-[var(--color-paper-3)] p-4"
            style={{ borderRadius: "2px" }}
          >
            <p class="text-sm font-semibold">
              {waiting ? t("waitlistJoined") : t("waitlistTitle")}
            </p>
            <p class="mt-1 mb-3 text-xs text-[var(--color-ink-light)] max-w-2xl">
              {waiting
                ? store.waitlist?.hostname
                  ? t("waitlistJoinedFor", {
                      hostname: store.waitlist.hostname,
                    })
                  : t("waitlistJoinedNoDomain")
                : t("waitlistBody")}
            </p>
            <form
              class="flex flex-wrap items-end gap-3"
              preventdefault:submit
              onSubmit$={joinWaitlist}
            >
              <label class="block min-w-0 flex-1 basis-56">
                <span
                  class={`block mb-1 ${label}`}
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {t("waitlistInputLabel")}
                </span>
                <input
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellcheck={false}
                  value={store.waitlistDraft}
                  placeholder={t("inputPlaceholder")}
                  class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1.5 text-sm"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                  onInput$={(event) => {
                    store.waitlistDraft = (
                      event.target as HTMLInputElement
                    ).value;
                  }}
                />
              </label>
              <div class="flex items-center gap-3">
                {waiting && (
                  <button
                    type="button"
                    class="underline text-xs text-[var(--color-ink-light)]"
                    disabled={!!store.busy}
                    onClick$={leaveWaitlist}
                  >
                    {t("waitlistLeave")}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={
                    !!store.busy ||
                    (waiting &&
                      store.waitlistDraft.trim() ===
                        (store.waitlist?.hostname ?? ""))
                  }
                  class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--color-ink)",
                    fontFamily: "var(--font-typewriter)",
                  }}
                >
                  {store.busy === "waitlist"
                    ? t("waitlistSaving")
                    : waiting
                      ? t("waitlistUpdate")
                      : t("waitlistJoin")}
                </button>
              </div>
            </form>
          </div>
        )
      ) : (
        <form
          class="flex flex-wrap items-end gap-3"
          preventdefault:submit
          onSubmit$={add}
        >
          <label class="block min-w-0 flex-1 basis-56">
            <span
              class={`block mb-1 ${label}`}
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              {t("inputLabel")}
            </span>
            <input
              type="text"
              inputMode="url"
              autoComplete="off"
              spellcheck={false}
              value={store.draft}
              placeholder={t("inputPlaceholder")}
              disabled={atLimit}
              class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1.5 text-sm"
              style={{ fontFamily: "var(--font-typewriter)" }}
              onInput$={(event) => {
                store.draft = (event.target as HTMLInputElement).value;
              }}
            />
          </label>
          {store.handles.length > 1 && (
            <div class="min-w-0 basis-40">
              <span
                class={`block mb-1 ${label}`}
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                {t("handleLabel")}
              </span>
              <SiteSelect
                value={store.draftHandle}
                ariaLabel={t("handleLabel")}
                options={store.handles.map((handle) => ({
                  value: handle,
                  label: `/${handle}`,
                }))}
                onChange$={(value) => {
                  store.draftHandle = value;
                }}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={atLimit || !!store.busy || !store.draft.trim()}
            class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-ink)",
              fontFamily: "var(--font-typewriter)",
            }}
          >
            {store.busy === "add" ? t("adding") : t("add")}
          </button>
        </form>
      )}
      {store.isAdmin && atLimit && (
        <p class="mt-2 text-xs text-[var(--color-ink-muted)]">
          {t("limitReached", { limit: CUSTOM_DOMAIN_LIMIT })}
        </p>
      )}

      {store.domains.length > 0 && (
        <ul class="mt-5 space-y-4">
          {store.domains.map((domain) => {
            const live = domain.status === "active";
            const records = domain.dnsRecords;
            const hasTxt = records.some((record) => record.type === "TXT");
            return (
              <li
                key={domain.id}
                class="border border-[var(--color-paper-3)] p-4"
                style={{ borderRadius: "2px" }}
              >
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <div class="min-w-0">
                    <p
                      class="text-sm font-semibold break-all"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      {domain.hostname}
                    </p>
                    <p class="text-xs text-[var(--color-ink-light)]">
                      {domain.kind === "apex"
                        ? t("kindApex")
                        : t("kindSubdomain")}
                      {" · /"}
                      {domain.handle}
                    </p>
                  </div>
                  <span
                    class={`text-[0.6rem] tracking-[0.18em] uppercase ${
                      live
                        ? "text-[var(--color-accent-green)]"
                        : domain.status === "failed"
                          ? "text-[var(--color-vermilion)]"
                          : "text-[var(--color-ink-light)]"
                    }`}
                    style={{ fontFamily: "var(--font-typewriter)" }}
                    aria-live="polite"
                  >
                    {t(`status.${domain.status}`)}
                  </span>
                </div>

                {live && (
                  <p class="mt-2 text-sm">
                    <a
                      href={`https://${domain.hostname}/`}
                      class="underline"
                      target="_blank"
                      rel="noopener"
                    >
                      {t("liveAt", { url: `https://${domain.hostname}/` })}
                    </a>
                  </p>
                )}

                {!live && !domain.registered && domain.status !== "failed" && (
                  <p class="mt-3 text-xs text-[var(--color-ink-light)]">
                    {t("preparing")}
                  </p>
                )}

                {!live && records.length > 0 && (
                  <div class="mt-3">
                    <p class="text-xs text-[var(--color-ink-light)] mb-2">
                      {t("recordsIntro")}
                    </p>
                    <div class="space-y-2">
                      {records.map((record) => {
                        const key = `${domain.id}:${record.type}:${record.name}`;
                        return (
                          <dl
                            key={key}
                            class="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 border-t border-dotted border-[var(--color-paper-3)] pt-2 text-xs"
                          >
                            <dt
                              class={label}
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              {t("recordType")}
                            </dt>
                            <dd
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              {record.type}
                              <span
                                class={`ml-2 ${
                                  record.ready
                                    ? "text-[var(--color-accent-green)]"
                                    : "text-[var(--color-ink-muted)]"
                                }`}
                              >
                                {record.ready
                                  ? t("recordReady")
                                  : t("recordWaiting")}
                              </span>
                            </dd>
                            <dt
                              class={label}
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              {t("recordName")}
                            </dt>
                            <dd
                              class="break-all"
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              {record.name}
                            </dd>
                            <dt
                              class={label}
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              {t("recordValue")}
                            </dt>
                            <dd class="flex min-w-0 items-start gap-2">
                              <code class="min-w-0 break-all select-all">
                                {record.value}
                              </code>
                              <button
                                type="button"
                                class="shrink-0 underline text-[var(--color-ink-light)]"
                                onClick$={() => copy(key, record.value)}
                              >
                                {store.copied === key ? t("copied") : t("copy")}
                              </button>
                            </dd>
                          </dl>
                        );
                      })}
                    </div>
                    {domain.kind === "apex" && (
                      <p class="mt-3 text-xs text-[var(--color-ink-light)]">
                        {t("apexNote", { hostname: domain.hostname })}
                      </p>
                    )}
                    {hasTxt && (
                      <p class="mt-2 text-xs text-[var(--color-ink-light)]">
                        {t("txtNote")}
                      </p>
                    )}
                  </div>
                )}

                {domain.lastError && !live && (
                  <p
                    class="mt-3 text-xs text-[var(--color-vermilion)]"
                    role="status"
                  >
                    {domain.lastError}
                  </p>
                )}

                <div class="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  {domain.lastCheckedAt && (
                    <span class="text-[var(--color-ink-muted)]">
                      {t("lastChecked", {
                        time: new Date(domain.lastCheckedAt).toLocaleString(),
                      })}
                    </span>
                  )}
                  {!live && (
                    <button
                      type="button"
                      class="btn-paper text-xs"
                      disabled={!!store.busy}
                      onClick$={() => recheck(domain.id)}
                    >
                      {store.busy === domain.id ? t("checking") : t("recheck")}
                    </button>
                  )}
                  {store.confirmRemove === domain.id ? (
                    <>
                      <span>
                        {t("removeConfirm", { hostname: domain.hostname })}
                      </span>
                      <button
                        type="button"
                        class="btn-paper text-xs text-[var(--color-vermilion)]"
                        disabled={!!store.busy}
                        onClick$={() => remove(domain.id)}
                      >
                        {t("remove")}
                      </button>
                      <button
                        type="button"
                        class="underline"
                        onClick$={() => (store.confirmRemove = null)}
                      >
                        {t("cancel")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      class="underline text-[var(--color-ink-light)]"
                      onClick$={() => (store.confirmRemove = domain.id)}
                    >
                      {t("remove")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
