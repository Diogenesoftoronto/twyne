import { $, component$, useStore } from "@qwik.dev/core";
import { useAuth } from "../../utils/auth-context";
import { accountDisplayName } from "../../utils/account-display";
import { signOut } from "../../utils/auth-client";
import { startNotOrganicSignIn } from "../../utils/notorganic-connect";
import type { AppError } from "../../types/application-errors";
import { normalizeApplicationError } from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { ApplicationNotice } from "../ui/application-notice";
import { captureProductEvent } from "../../utils/product-analytics";
import {
  clearAuthAttempt,
  rememberAuthAttempt,
} from "../../utils/auth-analytics";

/**
 * The Editor's Office sign-in panel.
 *
 * Twyne accounts are Not Organic accounts: one button, one redirect. The same
 * DID backs your plan, hosted inference and PDS publishing.
 */
export const AuthPanel = component$(() => {
  const auth = useAuth();
  const store = useStore({
    redirecting: false,
    error: null as AppError | null,
  });

  const handleSignIn = $(async () => {
    store.redirecting = true;
    store.error = null;
    rememberAuthAttempt({ method: "notorganic", flow: "signin" });
    void captureProductEvent("sign_in_started", {
      method: "notorganic",
      flow: "signin",
    });
    try {
      await startNotOrganicSignIn();
    } catch (error) {
      clearAuthAttempt();
      reportApplicationDiagnostic("twyne:auth:notorganic-sign-in", error, {
        operation: "notorganic-sign-in",
      });
      const appError = normalizeApplicationError(error, {
        source: "auth",
        metadata: { operation: "notorganic-sign-in" },
      });
      void captureProductEvent("sign_in_failed", {
        method: "notorganic",
        flow: "signin",
        error_code: appError.code,
      });
      store.error = appError;
      store.redirecting = false;
    }
  });

  if (auth.value.loading) {
    return (
      <div class="p-5">
        <p class="dept-label">The Editor's Office</p>
        <p class="mt-3 text-[var(--color-ink-light)]">…loading…</p>
      </div>
    );
  }

  const user = auth.value.user;
  if (user) {
    return (
      <div class="p-5">
        <p class="dept-label">The Editor's Office</p>
        <div class="mt-3 flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <p
              class="text-sm text-[var(--color-ink)] truncate"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              On the masthead
            </p>
            <p
              class="text-[11px] text-[var(--color-ink-muted)] truncate"
              style="font-family: var(--font-typewriter); letter-spacing: 0.08em;"
            >
              {accountDisplayName(user)}
            </p>
          </div>
          <button
            onClick$={() => void signOut()}
            class="btn-paper flex-shrink-0"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="p-5">
      <p class="dept-label">The Editor's Office</p>
      <p
        class="mt-3 text-[1.05rem] leading-snug text-[var(--color-ink)]"
        style="font-family: var(--font-display); font-weight: 600;"
      >
        Sign in with your Not Organic account.
      </p>
      <p
        class="mt-1 text-[12px] leading-5 text-[var(--color-ink-light)]"
        style="font-family: var(--font-serif); font-style: italic;"
      >
        New here? You can create one on the next page. The same account holds
        your plan, your credit and your published writing.
      </p>
      {store.error && (
        <div class="mt-4">
          <ApplicationNotice error={store.error} compact />
        </div>
      )}
      <button
        type="button"
        onClick$={handleSignIn}
        disabled={store.redirecting}
        class="btn-press mt-5 w-full"
      >
        {store.redirecting ? "Redirecting…" : "Continue with Not Organic"}
      </button>
    </div>
  );
});
