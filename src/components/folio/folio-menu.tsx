import {
  component$,
  useStore,
  $,
  useSignal,
  useVisibleTask$,
} from "@builder.io/qwik";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import {
  exportAs,
  downloadBlob,
  safeFilename,
  importAs,
  type ExportFormat,
  type ImportResult,
} from "../../utils/exchange";
import {
  loadFoliosFromIdb,
  loadFolioContentFromIdb,
  saveFolioContentToIdb,
  saveFoliosToIdb,
  saveActiveFolioIdToIdb,
} from "../../utils/idb";
import { useAuth } from "../../utils/auth-context";
import { getAgent } from "../../utils/atproto";
import {
  ensurePublication,
  publishDocument,
  type PublishResult,
} from "../../utils/standard-site";
import type { Folio, ProjectBrief } from "../../types";

/**
 * The folio's "File" menu. Sits in the editor toolbar and gives the
 * writer three groups of operations:
 *
 *   Export      — markdown / html / txt / twyne-backup
 *   Import      — file picker, recognises format from extension
 *   Share       — publish the folio to a public URL, copy the link,
 *                 unpublish, or open the public view
 *
 * Import rewrites the active folio (or, for `.twyne.json` backups,
 * restores brief + folios + content in one shot). Export never
 * mutates state. Share writes through Convex with the active user's
 * tokenIdentifier; it is a no-op for unauthenticated users.
 */

interface FolioMenuProps {
  brief: ProjectBrief | null;
  /** The current folio's id; used as the publish key. */
  activeFolioId: string | null;
  /** Title of the current folio (drives export filename + publish title). */
  activeFolioName: string;
  /** Author name for the share card; falls back to "Anonymous". */
  authorName?: string;
  /** Optional layout to drive export margins + width. */
  layout?: import("../../types").LayoutSettings;
  /** Optional running header / footer. */
  header?: string;
  footer?: string;
  /**
   * Called when an import replaces the current draft. The host route
   * is responsible for loading the new content into the editor and
   * updating its own state.
   */
  onImported$?: import("@builder.io/qwik").PropFunction<
    (r: ImportResult) => void
  >;
}

/* ── Live content handshake ──────────────────────────────────── */

async function readActiveFolioHtml(
  activeFolioId: string | null,
): Promise<string> {
  // Try the live editor first — it has the freshest content, before any
  // debounced save to IDB.
  let html = "";
  const receive = (e: Event) => {
    html = (e as CustomEvent).detail as string;
  };
  window.addEventListener("twyne:draft-html", receive);
  window.dispatchEvent(new CustomEvent("twyne:request-draft-html"));
  window.removeEventListener("twyne:draft-html", receive);
  if (html) return html;
  // Fall back to the folio's IDB slot. This is where the parent route
  // persists on every onUpdate.
  if (activeFolioId) {
    return await loadFolioContentFromIdb(activeFolioId);
  }
  return "";
}

export const FolioMenu = component$<FolioMenuProps>((props) => {
  const auth = useAuth();
  const clientSig = useConvexClient();
  const menuOpen = useSignal(false);
  const dialog = useSignal<"import" | "share" | null>(null);
  const importError = useSignal<string | null>(null);
  const importBusy = useSignal(false);
  const shareBusy = useSignal(false);
  const shareError = useSignal<string | null>(null);
  const shareSlug = useSignal<string | null>(null);
  const shareUrl = useSignal<string | null>(null);
  const copyState = useSignal<"idle" | "copied">("idle");

  // ATProto / Bluesky PDS publishing.
  const pdsBusy = useSignal(false);
  const pdsError = useSignal<string | null>(null);
  const pdsResult = useSignal<PublishResult | null>(null);
  const pdsCopyState = useSignal<"idle" | "copied">("idle");

  const store = useStore({ menuOpen: false });
  void store; // reserved for future menu state

  // Close the menu on outside click.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const open = track(() => menuOpen.value);
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-folio-menu]")) {
        menuOpen.value = false;
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") menuOpen.value = false;
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onEsc);
    cleanup(() => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onEsc);
    });
  });

  // Load any existing share slug for this folio.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    track(() => auth.value.user?.id);
    track(() => props.activeFolioId);
    if (!auth.value.user || !props.activeFolioId) {
      shareSlug.value = null;
      shareUrl.value = null;
      return;
    }
    const client = clientSig.value;
    if (!client) return;
    try {
      const mine = (await client.query(api.published.listMine, {})) as Array<{
        slug: string;
        folioId: string;
      }>;
      const existing = mine.find((m) => m.folioId === props.activeFolioId);
      if (existing) {
        shareSlug.value = existing.slug;
        shareUrl.value = `${window.location.origin}/p/${existing.slug}`;
      } else {
        shareSlug.value = null;
        shareUrl.value = null;
      }
    } catch {
      // ignore
    }
  });

  const doExport = $(async (format: ExportFormat) => {
    menuOpen.value = false;
    // The editor's content lives in the active folio's IDB slot, not the
    // legacy `twyne-draft-html` key. Read from the live source first via
    // an event handshake, then fall back to the folio's IDB content.
    const draftText = await readActiveFolioHtml(props.activeFolioId);
    const folios = await loadFoliosFromIdb();
    const payload = {
      title: props.activeFolioName || "Untitled",
      html: draftText,
      brief: props.brief,
      folios,
    };
    const blob = exportAs(format, payload);
    const ext =
      format === "markdown"
        ? "md"
        : format === "html"
          ? "html"
          : format === "txt"
            ? "txt"
            : "twyne.json";
    downloadBlob(blob, safeFilename(props.activeFolioName, ext));
  });

  const handleImportFile = $(async (file: File) => {
    importBusy.value = true;
    importError.value = null;
    try {
      const result = await importAs(file);
      // Persist to the active folio.
      const activeId = props.activeFolioId;
      if (activeId) {
        await saveFolioContentToIdb(activeId, result.html);
      } else {
        // No active folio — create one.
        const folio: Folio = {
          id: crypto.randomUUID(),
          name: result.title,
          type: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const folios = await loadFoliosFromIdb();
        await saveFoliosToIdb([...folios, folio]);
        await saveFolioContentToIdb(folio.id, result.html);
        await saveActiveFolioIdToIdb(folio.id);
      }
      dialog.value = null;
      if (props.onImported$) {
        await props.onImported$(result);
      }
    } catch (err) {
      importError.value = (err as Error).message ?? "Import failed";
    } finally {
      importBusy.value = false;
    }
  });

  const doPublish = $(async () => {
    shareBusy.value = true;
    shareError.value = null;
    try {
      if (!auth.value.user) {
        shareError.value =
          "Sign in (the editor's office, top right) to publish.";
        return;
      }
      if (!props.activeFolioId) {
        shareError.value = "No active folio to publish.";
        return;
      }
      const client = clientSig.value;
      if (!client) {
        shareError.value = "Sync is offline — try again in a moment.";
        return;
      }
      const draftText = await readActiveFolioHtml(props.activeFolioId);
      const result = (await client.mutation(api.published.publish, {
        folioId: props.activeFolioId,
        title: props.activeFolioName || "Untitled",
        authorName: props.authorName ?? undefined,
        briefSummary: props.brief?.answers.goal ?? undefined,
        content: draftText,
      })) as { slug: string };
      shareSlug.value = result.slug;
      shareUrl.value = `${window.location.origin}/p/${result.slug}`;
    } catch (err) {
      shareError.value = (err as Error).message ?? "Publish failed";
    } finally {
      shareBusy.value = false;
    }
  });

  const doUnpublish = $(async () => {
    if (!shareSlug.value) return;
    shareBusy.value = true;
    shareError.value = null;
    try {
      const client = clientSig.value;
      if (!client) return;
      await client.mutation(api.published.unpublish, {
        slug: shareSlug.value,
      });
      shareSlug.value = null;
      shareUrl.value = null;
    } catch (err) {
      shareError.value = (err as Error).message ?? "Unpublish failed";
    } finally {
      shareBusy.value = false;
    }
  });

  const copyLink = $(async () => {
    if (!shareUrl.value) return;
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      copyState.value = "copied";
      setTimeout(() => (copyState.value = "idle"), 1500);
    } catch {
      // ignore
    }
  });

  const doPublishPds = $(async () => {
    pdsBusy.value = true;
    pdsError.value = null;
    try {
      if (!props.activeFolioId) {
        pdsError.value = "No active folio to publish.";
        return;
      }
      const agent = await getAgent();
      const html = await readActiveFolioHtml(props.activeFolioId);
      const folios = await loadFoliosFromIdb();
      const folio =
        folios.find((f) => f.id === props.activeFolioId) ??
        ({
          id: props.activeFolioId,
          name: props.activeFolioName || "Untitled",
          type: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as Folio);
      const pubName =
        props.brief?.answers.workingTitle ||
        props.authorName ||
        "My Twyne publication";
      const publication = await ensurePublication(agent, {
        name: pubName,
        url: window.location.origin,
      });
      pdsResult.value = await publishDocument(agent, {
        folio,
        html,
        brief: props.brief,
        publication,
      });
    } catch (err) {
      pdsError.value = (err as Error).message ?? "Publish to PDS failed";
    } finally {
      pdsBusy.value = false;
    }
  });

  const copyPdsUri = $(async () => {
    const uri = pdsResult.value?.uri;
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      pdsCopyState.value = "copied";
      setTimeout(() => (pdsCopyState.value = "idle"), 1500);
    } catch {
      // ignore
    }
  });

  return (
    <div class="relative" data-folio-menu>
      <button
        class="btn-paper text-xs"
        onClick$={() => {
          menuOpen.value = !menuOpen.value;
        }}
        aria-haspopup="menu"
        aria-expanded={menuOpen.value}
        title="Export, import, share"
      >
        File ▾
      </button>
      {menuOpen.value && (
        <div
          class="absolute right-0 top-full mt-1 w-56 folio z-50"
          role="menu"
          style={{ padding: "0.4rem 0" }}
        >
          <p class="dept-label px-3 py-1.5">Export</p>
          <MenuItem
            label="Markdown (.md)"
            onClick$={() => doExport("markdown")}
          />
          <MenuItem label="Standalone HTML" onClick$={() => doExport("html")} />
          <MenuItem label="Plain text" onClick$={() => doExport("txt")} />
          <MenuItem
            label="Twyne backup (.json)"
            onClick$={() => doExport("twyne-backup")}
          />
          <hr class="my-1 border-[var(--color-paper-3)]" />
          <MenuItem
            label="Import…"
            onClick$={() => {
              menuOpen.value = false;
              dialog.value = "import";
              importError.value = null;
            }}
          />
          <hr class="my-1 border-[var(--color-paper-3)]" />
          <MenuItem
            label={shareSlug.value ? "Manage share…" : "Share…"}
            onClick$={() => {
              menuOpen.value = false;
              dialog.value = "share";
              shareError.value = null;
            }}
          />
        </div>
      )}

      {dialog.value === "import" && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15, 12, 8, 0.55)" }}
          onClick$={(e) => {
            if (e.target === e.currentTarget) dialog.value = null;
          }}
        >
          <div
            class="folio p-5 w-[28rem] max-w-[92vw]"
            role="dialog"
            aria-modal="true"
            aria-label="Import a document"
          >
            <p class="dept-label">Import</p>
            <h3
              class="mt-1 text-lg text-[var(--color-ink)]"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              Bring a piece into the room
            </h3>
            <p
              class="mt-2 text-[13px] leading-5 text-[var(--color-ink-light)]"
              style="font-family: var(--font-serif);"
            >
              Accepts <code>.md</code>, <code>.markdown</code>,{" "}
              <code>.html</code>, <code>.htm</code>, <code>.txt</code>, and
              Twyne backups (<code>.twyne.json</code>). The file becomes the
              active folio.
            </p>

            <label
              class="mt-4 block border border-dashed border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-4 text-center cursor-pointer"
              style="border-radius: 2px;"
            >
              <input
                type="file"
                accept=".md,.markdown,.html,.htm,.txt,.json,text/markdown,text/html,text/plain,application/json"
                class="sr-only"
                onChange$={async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) await handleImportFile(file);
                }}
              />
              <span
                class="text-xs tracking-[0.16em] uppercase text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                {importBusy.value ? "reading…" : "click to choose a file"}
              </span>
            </label>

            {importError.value && (
              <p class="error-slip mt-3" role="alert">
                {importError.value}
              </p>
            )}

            <div class="mt-4 flex justify-end gap-2">
              <button
                class="btn-paper text-xs"
                onClick$={() => {
                  dialog.value = null;
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog.value === "share" && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(15, 12, 8, 0.55)" }}
          onClick$={(e) => {
            if (e.target === e.currentTarget) dialog.value = null;
          }}
        >
          <div
            class="folio p-5 w-[30rem] max-w-[92vw]"
            role="dialog"
            aria-modal="true"
            aria-label="Share this piece"
          >
            <p class="dept-label">Share</p>
            <h3
              class="mt-1 text-lg text-[var(--color-ink)]"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              Publish a reading view
            </h3>
            <p
              class="mt-2 text-[13px] leading-5 text-[var(--color-ink-light)]"
              style="font-family: var(--font-serif);"
            >
              Anyone with the link can read this piece. There is no edit access
              — it's a public galley, not a co-authoring session. Unpublishing
              takes the page down immediately.
            </p>

            {auth.value.provider === "atproto" ? (
              <p
                class="mt-4 text-[12px] text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                The internal reading view needs an email or passkey account.
                Under a Bluesky session, publish to your own PDS below instead.
              </p>
            ) : !auth.value.user ? (
              <p
                class="mt-4 text-[12px] text-[var(--color-vermilion)]"
                style="font-family: var(--font-typewriter);"
              >
                Sign in (the editor's office, top right) to publish.
              </p>
            ) : shareUrl.value ? (
              <div class="mt-4 space-y-3">
                <p class="dept-label">Live at</p>
                <div class="flex gap-2">
                  <input
                    readOnly
                    value={shareUrl.value}
                    class="field-input flex-1 text-[12px]"
                    style="font-family: var(--font-mono);"
                    onFocus$={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button class="btn-press text-xs" onClick$={copyLink}>
                    {copyState.value === "copied" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div class="flex gap-2">
                  <a
                    href={shareUrl.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn-paper text-xs flex-1"
                  >
                    Open the public view ↗
                  </a>
                  <button
                    class="btn-paper text-xs"
                    onClick$={doUnpublish}
                    disabled={shareBusy.value}
                  >
                    {shareBusy.value ? "…" : "Unpublish"}
                  </button>
                </div>
              </div>
            ) : (
              <div class="mt-4 space-y-3">
                <p class="dept-label">Title to publish</p>
                <p
                  class="text-[14px] text-[var(--color-ink)]"
                  style="font-family: var(--font-display); font-weight: 600;"
                >
                  {props.activeFolioName || "Untitled"}
                </p>
                <button
                  class="btn-press w-full"
                  onClick$={doPublish}
                  disabled={shareBusy.value}
                >
                  {shareBusy.value ? "Publishing…" : "Publish now"}
                </button>
              </div>
            )}

            {shareError.value && (
              <p class="error-slip mt-3" role="alert">
                {shareError.value}
              </p>
            )}

            <div class="mt-5 pt-4 border-t border-dashed border-[var(--color-paper-3)]">
              <p class="dept-label">Your own repo</p>
              <h4
                class="mt-1 text-[15px] text-[var(--color-ink)]"
                style="font-family: var(--font-display); font-weight: 600;"
              >
                Publish to your PDS (Bluesky)
              </h4>
              {auth.value.provider === "atproto" ? (
                <div class="mt-2 space-y-3">
                  <p
                    class="text-[13px] leading-5 text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif);"
                  >
                    Files this piece as a{" "}
                    <code>site.standard.document</code> in your own ATProto
                    repository, discoverable across the ATmosphere.
                  </p>
                  {pdsResult.value ? (
                    <div class="space-y-2">
                      <p class="dept-label">Record</p>
                      <div class="flex gap-2">
                        <input
                          readOnly
                          value={pdsResult.value.uri}
                          class="field-input flex-1 text-[11px]"
                          style="font-family: var(--font-mono);"
                          onFocus$={(e) =>
                            (e.target as HTMLInputElement).select()
                          }
                        />
                        <button
                          class="btn-press text-xs"
                          onClick$={copyPdsUri}
                        >
                          {pdsCopyState.value === "copied" ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <div class="flex gap-2">
                        <a
                          href={pdsResult.value.viewerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="btn-paper text-xs flex-1"
                        >
                          Open the reading view ↗
                        </a>
                        <a
                          href={pdsResult.value.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="btn-paper text-xs flex-1"
                        >
                          Inspect the record ↗
                        </a>
                      </div>
                      <button
                        class="btn-paper text-xs w-full"
                        onClick$={doPublishPds}
                        disabled={pdsBusy.value}
                      >
                        {pdsBusy.value ? "Updating…" : "Re-publish (update)"}
                      </button>
                    </div>
                  ) : (
                    <button
                      class="btn-press w-full"
                      onClick$={doPublishPds}
                      disabled={pdsBusy.value}
                    >
                      {pdsBusy.value
                        ? "Filing to your repo…"
                        : "Publish to your PDS"}
                    </button>
                  )}
                  {pdsError.value && (
                    <p class="error-slip" role="alert">
                      {pdsError.value}
                    </p>
                  )}
                </div>
              ) : (
                <p
                  class="mt-2 text-[12px] text-[var(--color-ink-muted)]"
                  style="font-family: var(--font-typewriter);"
                >
                  Connect Bluesky (the editor's office, top right) to publish to
                  your own repository.
                </p>
              )}
            </div>

            <div class="mt-4 flex justify-end">
              <button
                class="btn-paper text-xs"
                onClick$={() => {
                  dialog.value = null;
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

interface MenuItemProps {
  label: string;
  onClick$: import("@builder.io/qwik").PropFunction<() => void>;
}

const MenuItem = component$<MenuItemProps>((props) => {
  return (
    <button
      class="w-full text-left px-3 py-1.5 text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)] focus-ring"
      style="font-family: var(--font-serif); border-radius: 0;"
      onClick$={props.onClick$}
      role="menuitem"
    >
      {props.label}
    </button>
  );
});
