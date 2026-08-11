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
  exportDocx,
  exportHtml,
  exportPdf,
  downloadBlob,
  safeFilename,
  importAs,
  type ExportFormat,
  type ImportResult,
} from "../../utils/exchange";
import {
  loadFoliosFromIdb,
  saveFolioContentToIdb,
  saveFoliosToIdb,
  saveActiveFolioIdToIdb,
} from "../../utils/idb";
import {
  buildFolioExportPayload,
  readActiveFolioHtml,
} from "../../utils/folio-export";
import { useAuth } from "../../utils/auth-context";
import { getAgent } from "../../utils/atproto";
import {
  ensurePublication,
  loadPublishedDocument,
  publishDocument,
  type PublishResult,
  unpublishDocument,
} from "../../utils/standard-site";
import type { Folio, ProjectBrief } from "../../types";
import type { AppError } from "../../types/application-errors";
import { ApplicationNotice } from "../ui/application-notice";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { captureProductEvent } from "../../utils/product-analytics";
import { publishViaMicropub } from "../../utils/micropub";

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

/**
 * Compose the public reader URL for a published piece. Uses the first-class
 * /<handle>/<slug> shape. Returns null when the writer hasn't claimed a
 * handle yet — the caller surfaces a "claim a handle" prompt in that case.
 */
function shareUrlFor(
  ownerHandle: string | null | undefined,
  slug: string,
): string | null {
  if (!ownerHandle) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/${ownerHandle}/${slug}`;
}

export const FolioMenu = component$<FolioMenuProps>((props) => {
  const auth = useAuth();
  const clientSig = useConvexClient();
  const menuOpen = useSignal(false);
  const dialog = useSignal<"import" | "share" | null>(null);
  const fileError = useSignal<AppError | null>(null);
  const importBusy = useSignal(false);
  const shareBusy = useSignal(false);
  const shareError = useSignal<AppError | null>(null);
  const shareNotice = useSignal<string | null>(null);
  const shareSlug = useSignal<string | null>(null);
  const shareUrl = useSignal<string | null>(null);
  const copyState = useSignal<"idle" | "copied">("idle");

  // ATProto / Bluesky PDS publishing.
  const pdsBusy = useSignal(false);
  const pdsError = useSignal<AppError | null>(null);
  const pdsResult = useSignal<PublishResult | null>(null);
  const pdsCopyState = useSignal<"idle" | "copied">("idle");
  const micropubEndpoint = useSignal("");
  const micropubToken = useSignal("");
  const micropubBusy = useSignal(false);
  const micropubResult = useSignal<string | null>(null);
  const micropubError = useSignal<AppError | null>(null);

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
        ownerHandle: string | null;
        folioId: string;
      }>;
      const existing = mine.find((m) => m.folioId === props.activeFolioId);
      if (existing) {
        shareSlug.value = existing.slug;
        shareUrl.value = shareUrlFor(existing.ownerHandle, existing.slug);
      } else {
        shareSlug.value = null;
        shareUrl.value = null;
      }
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:list-publications", err, {
        operation: "list-publications",
      });
    }
  });

  // Restore the locally-known PDS record when the writer changes folios or
  // reopens the share panel. The PDS remains the source of truth; IDB only
  // remembers the record key needed for update/delete controls.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    track(() => auth.value.provider);
    track(() => props.activeFolioId);
    if (auth.value.provider !== "atproto" || !props.activeFolioId) {
      pdsResult.value = null;
      return;
    }
    pdsResult.value = await loadPublishedDocument(props.activeFolioId);
  });

  /**
   * The page setup travels with the payload — without `layout` the exporter
   * silently fell back to DEFAULT_LAYOUT, so a writer who had set their own
   * margins got someone else's page.
   */
  const buildExportPayload = $(() =>
    buildFolioExportPayload({
      folioId: props.activeFolioId,
      folioName: props.activeFolioName,
      brief: props.brief,
      layout: props.layout,
      header: props.header,
      footer: props.footer,
    }),
  );

  const doExportPdf = $(async () => {
    fileError.value = null;
    try {
      const payload = await buildExportPayload();
      menuOpen.value = false;
      await exportPdf(payload);
      void captureProductEvent("draft_exported", { format: "pdf" });
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:export-pdf", err, {
        operation: "export",
      });
      fileError.value = normalizeApplicationError(err, {
        source: "application",
        metadata: { operation: "export" },
      });
    }
  });

  const doExport = $(async (format: ExportFormat) => {
    fileError.value = null;
    try {
      const payload = await buildExportPayload();
      const blob =
        format === "docx"
          ? await exportDocx(payload)
          : exportAs(format, payload);
      const ext =
        format === "markdown"
          ? "md"
          : format === "html"
            ? "html"
            : format === "txt"
              ? "txt"
              : format === "docx"
                ? "docx"
                : "twyne.json";
      downloadBlob(blob, safeFilename(props.activeFolioName, ext));
      menuOpen.value = false;
      void captureProductEvent("draft_exported", {
        format: format === "twyne-backup" ? "twyne_backup" : format,
      });
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:export", err, {
        operation: "export",
      });
      fileError.value = normalizeApplicationError(err, {
        source: "application",
        metadata: { operation: "export" },
      });
    }
  });

  const handleImportFile = $(async (file: File) => {
    importBusy.value = true;
    fileError.value = null;
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
        void captureProductEvent("folio_created", {
          source: "import",
          folio_type: folio.type,
        });
      }
      dialog.value = null;
      if (props.onImported$) {
        await props.onImported$(result);
      }
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:import", err, {
        operation: "import",
      });
      const normalized = normalizeApplicationError(err, {
        source: "application",
        metadata: { operation: "import" },
      });
      fileError.value =
        normalized.code === "MALFORMED_RESPONSE" ||
        normalized.code === "VALIDATION_FAILED"
          ? createAppError("VALIDATION_FAILED", {
              source: "validation",
              validationKey: "invalid_format",
              metadata: { operation: "import" },
            })
          : normalized;
    } finally {
      importBusy.value = false;
    }
  });

  const doPublish = $(async () => {
    shareBusy.value = true;
    shareError.value = null;
    shareNotice.value = null;
    try {
      if (!auth.value.user) {
        shareError.value = createAppError("AUTHENTICATION_REQUIRED", {
          source: "auth",
          metadata: { operation: "publish" },
        });
        return;
      }
      if (!props.activeFolioId) {
        shareError.value = createAppError("VALIDATION_FAILED", {
          source: "validation",
          validationKey: "required",
          metadata: { operation: "publish", field: "activeFolioId" },
        });
        return;
      }
      const client = clientSig.value;
      if (!client) {
        shareError.value = createAppError("NETWORK_UNAVAILABLE", {
          source: "convex",
          metadata: { operation: "publish" },
        });
        return;
      }
      const draftText = await readActiveFolioHtml(props.activeFolioId);

      // If the caller is an admin, route the publish through
      // the blog stream (`kind: "blog"`) so it shows up on
      // /blog instead of just at the private share URL. The
      // server checks the admin roster; non-admins asking for
      // "blog" get a plain "post" with `requestedBlog: true`
      // in the response so the client can surface a "you're
      // not an admin" message.
      const isAdmin = await client.query(api.admins.isCurrentUserAdmin, {});
      const result = (await client.mutation(api.published.publish, {
        folioId: props.activeFolioId,
        title: props.activeFolioName || "Untitled",
        authorName: props.authorName ?? undefined,
        briefSummary: props.brief?.answers.goal ?? undefined,
        content: draftText,
        kind: isAdmin ? "blog" : "post",
      })) as {
        slug: string;
        ownerHandle: string | null;
        kind: "post" | "blog";
        requestedBlog: boolean;
      };
      shareSlug.value = result.slug;
      // Admin publishes land on the blog feed; everyone else gets a
      // share URL using their claimed handle. A writer without a
      // claimed handle is prompted to claim one in Settings — the
      // piece is still published and readable at the handle-less URL
      // once they claim one (the server denormalizes ownerHandle on
      // the next publish or via claimHandle's backfill).
      shareUrl.value = isAdmin
        ? `${window.location.origin}/blog/${result.slug}`
        : shareUrlFor(result.ownerHandle, result.slug);
      if (!isAdmin && !result.ownerHandle) {
        shareNotice.value =
          "Published — claim a writer handle in Settings to get your share URL.";
      }
      if (result.requestedBlog && !isAdmin) {
        shareNotice.value =
          "You're not in the blog roster — published as a private share instead.";
      }
      void captureProductEvent("draft_published", {
        destination: result.kind === "blog" ? "twyne_blog" : "twyne_share",
      });
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:publish", err, {
        operation: "publish",
      });
      shareError.value = normalizeApplicationError(err, {
        source: "convex",
        metadata: { operation: "publish" },
      });
    } finally {
      shareBusy.value = false;
    }
  });

  const doUnpublish = $(async () => {
    if (!shareSlug.value) return;
    shareBusy.value = true;
    shareError.value = null;
    shareNotice.value = null;
    try {
      const client = clientSig.value;
      if (!client) {
        shareError.value = createAppError("NETWORK_UNAVAILABLE", {
          source: "convex",
          metadata: { operation: "unpublish" },
        });
        return;
      }
      await client.mutation(api.published.unpublish, {
        slug: shareSlug.value,
      });
      shareSlug.value = null;
      shareUrl.value = null;
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:unpublish", err, {
        operation: "unpublish",
      });
      shareError.value = normalizeApplicationError(err, {
        source: "convex",
        metadata: { operation: "unpublish" },
      });
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
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:copy-public-link", err, {
        operation: "copy-public-link",
      });
      shareError.value = normalizeApplicationError(err, {
        source: "application",
        metadata: { operation: "copy-public-link" },
      });
    }
  });

  const doPublishPds = $(async () => {
    pdsBusy.value = true;
    pdsError.value = null;
    try {
      if (!props.activeFolioId) {
        pdsError.value = createAppError("VALIDATION_FAILED", {
          source: "validation",
          validationKey: "required",
          metadata: { operation: "publish-pds", field: "activeFolioId" },
        });
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
        auth.value.atproto?.displayName ||
        auth.value.atproto?.handle ||
        props.authorName ||
        "My Twyne publication";
      const publication = await ensurePublication(agent, {
        name: pubName,
      });
      pdsResult.value = await publishDocument(agent, {
        folio,
        html,
        brief: props.brief,
        publication,
      });
      void captureProductEvent("draft_published", {
        destination: "standard_site",
      });
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:publish-pds", err, {
        operation: "publish-pds",
      });
      pdsError.value = normalizeApplicationError(err, {
        source: "provider",
        metadata: { operation: "publish-pds", provider: "atproto" },
      });
    } finally {
      pdsBusy.value = false;
    }
  });

  const doUnpublishPds = $(async () => {
    if (!props.activeFolioId) return;
    pdsBusy.value = true;
    pdsError.value = null;
    try {
      const agent = await getAgent();
      await unpublishDocument(agent, props.activeFolioId);
      pdsResult.value = null;
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:unpublish-pds", err, {
        operation: "unpublish-pds",
      });
      pdsError.value = normalizeApplicationError(err, {
        source: "provider",
        metadata: { operation: "unpublish-pds", provider: "atproto" },
      });
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
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:copy-pds-uri", err, {
        operation: "copy-pds-uri",
      });
      pdsError.value = normalizeApplicationError(err, {
        source: "application",
        metadata: { operation: "copy-pds-uri" },
      });
    }
  });

  const doPublishMicropub = $(async () => {
    micropubBusy.value = true;
    micropubError.value = null;
    micropubResult.value = null;
    try {
      const payload = await buildExportPayload();
      const standalone = exportHtml(payload);
      const article =
        standalone.match(/<article>([\s\S]*?)<\/article>/i)?.[1] ??
        payload.html;
      const result = await publishViaMicropub({
        endpoint: micropubEndpoint.value,
        token: micropubToken.value,
        title: payload.title,
        html: article,
      });
      micropubToken.value = "";
      micropubResult.value = result.url ?? "Published successfully.";
      void captureProductEvent("draft_published", {
        destination: "micropub",
      });
    } catch (err) {
      reportApplicationDiagnostic("twyne:folio:publish-micropub", err, {
        operation: "publish-micropub",
      });
      micropubError.value = normalizeApplicationError(err, {
        source: "provider",
        metadata: { operation: "publish-micropub" },
      });
    } finally {
      micropubBusy.value = false;
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
          <MenuItem label="PDF…" onClick$={doExportPdf} />
          <MenuItem
            label="Markdown (.md)"
            onClick$={() => doExport("markdown")}
          />
          <MenuItem label="Standalone HTML" onClick$={() => doExport("html")} />
          <MenuItem
            label="Microsoft Word (.docx)"
            onClick$={() => doExport("docx")}
          />
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
              fileError.value = null;
            }}
          />
          <hr class="my-1 border-[var(--color-paper-3)]" />
          <MenuItem
            label={shareSlug.value ? "Manage share…" : "Share…"}
            onClick$={() => {
              menuOpen.value = false;
              dialog.value = "share";
              shareError.value = null;
              shareNotice.value = null;
            }}
          />
          {fileError.value && (
            <div class="px-2 pt-2">
              <ApplicationNotice
                error={fileError.value}
                compact
                onDismiss$={$(() => {
                  fileError.value = null;
                })}
              />
            </div>
          )}
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
              Accepts <code>.docx</code>, <code>.md</code>,{" "}
              <code>.markdown</code>, <code>.html</code>, <code>.htm</code>,{" "}
              <code>.txt</code>, and Twyne backups (<code>.twyne.json</code>).
              The file becomes the active folio.
            </p>

            <label
              class="mt-4 block border border-dashed border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-4 text-center cursor-pointer"
              style="border-radius: 2px;"
            >
              <input
                type="file"
                accept=".docx,.md,.markdown,.html,.htm,.txt,.json,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/html,text/plain,application/json"
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

            {fileError.value && (
              <div class="mt-3">
                <ApplicationNotice
                  error={fileError.value}
                  compact
                  onDismiss$={$(() => {
                    fileError.value = null;
                  })}
                />
              </div>
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
            class="folio max-h-[90vh] w-[30rem] max-w-[92vw] overflow-y-auto p-5"
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

            {shareNotice.value && (
              <p
                class="mt-3 border border-[var(--color-mustard)] bg-[var(--color-paper-soft)] p-3 text-[12px] text-[var(--color-ink-light)]"
                role="status"
                style="font-family: var(--font-serif); border-radius: 2px;"
              >
                {shareNotice.value}
              </p>
            )}

            {shareError.value && (
              <div class="mt-3">
                <ApplicationNotice
                  error={shareError.value}
                  compact
                  recoveryLabel={
                    shareError.value.code === "AUTHENTICATION_REQUIRED"
                      ? "Sign in"
                      : undefined
                  }
                  recoveryHref={
                    shareError.value.code === "AUTHENTICATION_REQUIRED"
                      ? "/signin/"
                      : undefined
                  }
                  onDismiss$={$(() => {
                    shareError.value = null;
                  })}
                />
              </div>
            )}

            <div class="mt-5 border-t border-dashed border-[var(--color-paper-3)] pt-4">
              <p class="dept-label">Your own domain</p>
              <h4
                class="mt-1 text-[15px] text-[var(--color-ink)]"
                style="font-family: var(--font-display); font-weight: 600;"
              >
                Download a site-ready page
              </h4>
              <p class="mt-2 text-[12px] leading-5 text-[var(--color-ink-light)]">
                Twyne packages the piece as one complete HTML file with its
                reading layout, print styles, notes, and bibliography. Rename
                it <code>index.html</code>, upload it to your web host, and use
                that host's domain or DNS settings. No Twyne account or runtime
                is required for the published page.
              </p>
              <button
                type="button"
                class="btn-paper mt-3 w-full text-xs"
                onClick$={() => doExport("html")}
              >
                Download page for my domain
              </button>
            </div>

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
                    Files this piece as a <code>site.standard.document</code> in
                    your own ATProto repository, discoverable across the
                    ATmosphere.
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
                        <button class="btn-press text-xs" onClick$={copyPdsUri}>
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
                      <button
                        class="btn-paper text-xs w-full"
                        onClick$={doUnpublishPds}
                        disabled={pdsBusy.value}
                      >
                        {pdsBusy.value ? "Removing…" : "Unpublish from PDS"}
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
                    <ApplicationNotice
                      error={pdsError.value}
                      compact
                      recoveryLabel={
                        pdsError.value.code === "CONFIGURATION_ERROR"
                          ? "Open settings"
                          : undefined
                      }
                      recoveryHref={
                        pdsError.value.code === "CONFIGURATION_ERROR"
                          ? "/settings/"
                          : undefined
                      }
                      onDismiss$={$(() => {
                        pdsError.value = null;
                      })}
                    />
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

            <form
              class="mt-5 border-t border-dashed border-[var(--color-paper-3)] pt-4"
              preventdefault:submit
              onSubmit$={doPublishMicropub}
            >
              <p class="dept-label">Your publishing system</p>
              <h4
                class="mt-1 text-[15px] text-[var(--color-ink)]"
                style="font-family: var(--font-display); font-weight: 600;"
              >
                Publish with Micropub
              </h4>
              <p class="mt-2 text-[12px] leading-5 text-[var(--color-ink-light)]">
                Works with WordPress, Ghost, IndieWeb sites, and newsletter
                tools that provide a Micropub endpoint. Your token is used for
                this request only and is not saved by Twyne.
              </p>
              <label class="field-label mt-3" for="micropub-endpoint">
                Endpoint
              </label>
              <input
                id="micropub-endpoint"
                class="field-input w-full text-xs"
                type="url"
                value={micropubEndpoint.value}
                placeholder="https://example.com/micropub"
                onInput$={(_, element) => {
                  micropubEndpoint.value = element.value;
                }}
              />
              <label class="field-label mt-3" for="micropub-token">
                Access token
              </label>
              <input
                id="micropub-token"
                class="field-input w-full text-xs"
                type="password"
                autocomplete="off"
                value={micropubToken.value}
                onInput$={(_, element) => {
                  micropubToken.value = element.value;
                }}
              />
              <button
                type="submit"
                class="btn-press mt-3 w-full"
                disabled={
                  micropubBusy.value ||
                  !micropubEndpoint.value.trim() ||
                  !micropubToken.value.trim()
                }
              >
                {micropubBusy.value ? "Publishing…" : "Publish via Micropub"}
              </button>
              {micropubResult.value && (
                <p
                  class="mt-3 break-all text-xs text-[var(--color-sage)]"
                  role="status"
                >
                  {micropubResult.value.startsWith("http") ? (
                    <a
                      href={micropubResult.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="underline"
                    >
                      Open published post ↗
                    </a>
                  ) : (
                    micropubResult.value
                  )}
                </p>
              )}
              {micropubError.value && (
                <div class="mt-3">
                  <ApplicationNotice
                    error={micropubError.value}
                    compact
                    onRetry$={doPublishMicropub}
                    onDismiss$={$(() => {
                      micropubError.value = null;
                    })}
                  />
                </div>
              )}
            </form>

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
