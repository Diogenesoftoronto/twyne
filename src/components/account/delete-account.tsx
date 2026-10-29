import { $, component$, useStore } from "@qwik.dev/core";
import { api } from "../../../convex/_generated/api";
import type { AppError } from "../../types/application-errors";
import { ApplicationNotice } from "../ui/application-notice";
import { ThemedDialog } from "../ui/themed-dialog";
import { useConvexClient } from "../../utils/convex-context";
import { signOut } from "../../utils/auth-client";
import { clearConvexSyncContext } from "../../utils/convex-sync";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";

interface DeleteAccountStore {
  deletingAccount: boolean;
  accountToast: string | null;
  accountError: AppError | null;
  showDeleteDialog: boolean;
  deleteConfirmText: string;
  deleteDialogError: string | null;
}

/** Danger zone: schedules permanent, resumable deletion of the account. */
export const DeleteAccount = component$(() => {
  const convexClientSig = useConvexClient();
  const store = useStore<DeleteAccountStore>({
    deletingAccount: false,
    accountToast: null,
    accountError: null,
    showDeleteDialog: false,
    deleteConfirmText: "",
    deleteDialogError: null,
  });

  const openDeleteAccountDialog = $(() => {
    if (!convexClientSig.value) {
      store.accountError = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "delete-account" },
      });
      return;
    }
    store.showDeleteDialog = true;
    store.deleteConfirmText = "";
    store.deleteDialogError = null;
    store.accountError = null;
  });

  const handleDeleteAccount = $(async () => {
    const client = convexClientSig.value;
    if (!client) {
      store.accountError = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "delete-account" },
      });
      return;
    }
    if (store.deleteConfirmText.trim() !== "DELETE") {
      store.deleteDialogError = "Type DELETE exactly to continue.";
      return;
    }
    store.deletingAccount = true;
    store.deleteDialogError = null;
    store.accountError = null;
    try {
      const result = (await client.mutation(api.account.deleteAccount, {})) as {
        identityPurged: boolean;
        deletionScheduled: boolean;
      };
      if (!result.deletionScheduled) {
        throw new Error("Account deletion was not scheduled.");
      }
      // The authenticated request has queued bounded server-side deletion.
      // Clear this browser session while the resumable job finishes.
      try {
        await signOut();
      } catch {
        /* sign-out is best-effort; server-side deletion is already scheduled */
      }
      clearConvexSyncContext();
      store.accountToast = result.identityPurged
        ? "Account deletion started. Twyne is removing synced data in the background."
        : "Account deletion started. Synced data is being removed in the background; identity teardown may still be finishing.";
      store.showDeleteDialog = false;
      store.deletingAccount = false;
      window.location.href = "/";
    } catch (error) {
      reportApplicationDiagnostic("twyne:account:delete-account", error, {
        operation: "delete-account",
      });
      store.accountError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "delete-account" },
      });
      store.deleteDialogError = store.accountError.message;
      store.deletingAccount = false;
    }
  });

  return (
    <>
      <section class="folio p-5 border border-[var(--color-vermilion)]/40">
        <h2
          class="text-base font-semibold mb-1"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Delete account
        </h2>
        <p class="text-xs text-[var(--color-ink-light)] mb-4">
          Starts permanent account deletion. Twyne removes synced data in
          resumable background batches after you sign out — folios, briefs,
          persona notes, usage history, rubric, published pieces, and payment
          state. Local-only browser data stays until you clear it. This cannot
          be undone.
        </p>
        {store.accountToast && (
          <p
            class="mb-3 text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-accent-green)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {store.accountToast}
          </p>
        )}
        {store.accountError && (
          <div class="mb-3">
            <ApplicationNotice
              error={store.accountError}
              compact
              onRetry$={
                store.accountError.recovery.canRetry
                  ? openDeleteAccountDialog
                  : undefined
              }
              onDismiss$={() => {
                store.accountError = null;
              }}
            />
          </div>
        )}
        <button
          onClick$={openDeleteAccountDialog}
          disabled={store.deletingAccount}
          class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-60"
          style={{
            backgroundColor: "var(--color-vermilion)",
            fontFamily: "var(--font-typewriter)",
          }}
        >
          {store.deletingAccount
            ? "Scheduling deletion…"
            : "Start account deletion"}
        </button>
      </section>

      <ThemedDialog
        open={store.showDeleteDialog}
        title="Delete your account?"
        message="This schedules permanent deletion of your Twyne account and synced data. Removal continues in resumable background batches after sign-out. Export anything you want to keep first."
        confirmLabel={store.deletingAccount ? "Scheduling…" : "Start deletion"}
        tone="danger"
        busy={store.deletingAccount}
        confirmDisabled={store.deletingAccount}
        error={store.deleteDialogError}
        inputLabel="Type DELETE to confirm"
        inputValue={store.deleteConfirmText}
        inputPlaceholder="DELETE"
        inputHelp="This step is irreversible."
        onInput$={(value: string) => {
          store.deleteConfirmText = value;
          store.deleteDialogError = null;
        }}
        onCancel$={() => {
          if (store.deletingAccount) return;
          store.showDeleteDialog = false;
          store.deleteConfirmText = "";
          store.deleteDialogError = null;
        }}
        onConfirm$={handleDeleteAccount}
      />
    </>
  );
});
