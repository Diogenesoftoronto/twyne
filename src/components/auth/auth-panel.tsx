import {
  $,
  component$,
  Slot,
  useStore,
  useVisibleTask$,
  type PropFunction,
} from "@builder.io/qwik";
import { useAuth } from "../../utils/auth-context";
import { signInWithBluesky, signOutBluesky } from "../../utils/atproto";
import { signOut, emailOtp, authClient } from "../../utils/auth-client";
import {
  getPreferredMethod,
  setPreferredMethod,
  type SignInMethod,
} from "../../utils/auth-preference";

/**
 * The Editor's Office sign-in panel.
 *
 * Two-step dossier flow, like the onboarding interview:
 *
 *   I.   The Email  — the writer types their address.
 *   II.  The Key    — passkey or one-time code. The passkey is the default
 *                     when the account already has one; OTP is sent
 *                     automatically on first-time sign-up and on every
 *                     sign-in for accounts that haven't set up a passkey.
 *
 * Bluesky sign-in sits in step 1 as a tertiary option — it carries its own
 * handle, so it doesn't need the email step.
 */
export const AuthPanel = component$(() => {
  const auth = useAuth();

  const store = useStore({
    step: 1 as 1 | 2,
    email: "",
    /** Which key the user is on. `null` means "decide based on memory". */
    chosen: null as SignInMethod | null,
    /** Whether we've already sent an OTP for this email in this session. */
    otpSent: false,
    otpCode: "",
    sendingOtp: false,
    verifyingOtp: false,
    usingPasskey: false,
    /** Once we've completed sign-in, surface a one-time prompt to add a passkey. */
    offerPasskey: false,
    addingPasskey: false,
    error: null as string | null,
  });

  // Auto-send the OTP the first time we land on step 2 in OTP mode, so
  // a first-time visitor never has to click "send me a code" separately.
  // Runs only on the client (visible task) so SSR never hits the auth API.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const step = track(() => store.step);
    const email = track(() => store.email);
    const chosen = track(() => store.chosen);
    const sent = track(() => store.otpSent);
    const sending = track(() => store.sendingOtp);
    const user = track(() => auth.value.user);

    if (step !== 2 || chosen !== "otp" || sent || sending) return;
    if (!email || !email.includes("@")) return;
    if (user) return; // already signed in
    void sendOtp(email);
  });

  const sendOtp = $(async (email: string) => {
    store.sendingOtp = true;
    store.error = null;
    try {
      const result = await emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (result?.error) {
        store.error = result.error.message ?? "Failed to send the code";
        return;
      }
      store.otpSent = true;
    } catch (e: any) {
      store.error = e?.message ?? "Failed to send the code";
    } finally {
      store.sendingOtp = false;
    }
  });

  const handleStepOne = $(() => {
    const trimmed = store.email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      store.error = "Add an email address so we know where to send the code.";
      return;
    }
    store.error = null;
    // Look up the per-email preference, falling back to OTP for first-timers
    // (we'll auto-detect passkey availability when they click that button).
    const remembered = getPreferredMethod(trimmed);
    store.chosen = remembered ?? "otp";
    store.otpSent = false;
    store.otpCode = "";
    store.offerPasskey = false;
    store.step = 2;
  });

  const handlePasskeySignIn = $(async () => {
    store.usingPasskey = true;
    store.error = null;
    try {
      const result = await (authClient.signIn as any).passkey({
        autoFill: true,
      });
      if (result?.error) {
        const msg = result.error.message ?? "";
        // If no passkey is registered for the account, fall through to OTP.
        if (
          /no passkey|passkey not found|credential/i.test(msg) ||
          result.error.code === "AUTH_CANCELLED"
        ) {
          store.error = null;
          store.chosen = "otp";
          return;
        }
        store.error = msg || "Passkey sign in failed";
      } else {
        setPreferredMethod(store.email, "passkey");
      }
    } catch (e: any) {
      store.error = e?.message ?? "Passkey sign in failed";
    } finally {
      store.usingPasskey = false;
    }
  });

  const handleResendOtp = $(async () => {
    store.otpSent = false;
    store.otpCode = "";
    await sendOtp(store.email);
  });

  const handleVerifyOtp = $(async () => {
    if (!store.otpCode.trim()) {
      store.error = "Type the code we just cabled you.";
      return;
    }
    store.verifyingOtp = true;
    store.error = null;
    try {
      const result = await emailOtp.verifyEmail({
        email: store.email,
        otp: store.otpCode,
      });
      if (result?.error) {
        store.error = result.error.message ?? "Verification failed";
        return;
      }
      setPreferredMethod(store.email, "otp");
      // Persist the email so the post-sign-in passkey prompt has it.
      store.offerPasskey = true;
    } catch (e: any) {
      store.error = e?.message ?? "Verification failed";
    } finally {
      store.verifyingOtp = false;
    }
  });

  const handleAddPasskey = $(async () => {
    store.addingPasskey = true;
    store.error = null;
    try {
      const result = await (authClient.passkey as any).addPasskey({
        name: "This device",
      });
      if (result?.error) {
        // Cancelling the WebAuthn prompt is the most common "error" — quietly
        // dismiss the offer without nagging the writer.
        if (result.error.code === "AUTH_CANCELLED") {
          store.offerPasskey = false;
          return;
        }
        store.error = result.error.message ?? "Couldn't add a passkey";
        return;
      }
      setPreferredMethod(store.email, "passkey");
      store.offerPasskey = false;
    } catch (e: any) {
      store.error = e?.message ?? "Couldn't add a passkey";
    } finally {
      store.addingPasskey = false;
    }
  });

  const handleSkipPasskey = $(() => {
    store.offerPasskey = false;
  });

  const handleBack = $(() => {
    store.step = 1;
    store.error = null;
    store.otpCode = "";
    store.otpSent = false;
    store.offerPasskey = false;
  });

  const handleBlueskySignIn = $(async () => {
    store.error = null;
    try {
      // Redirects to the Bluesky consent screen and completes on return.
      await signInWithBluesky();
    } catch (e: any) {
      store.error = e?.message ?? "Bluesky sign in failed";
    }
  });

  const handleSignOut = $(async () => {
    if (auth.value.provider === "atproto") {
      await signOutBluesky();
      auth.value = { user: null, loading: false };
      return;
    }
    await signOut();
  });

  // Surface the post-OTP passkey offer only after the session actually
  // settles on a real user. The convex context provider updates `auth.value`
  // once the cookie lands.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const offer = track(() => store.offerPasskey);
    const user = track(() => auth.value.user);
    if (offer && user) {
      // The session is live — keep the offer visible until the user
      // accepts or skips.
    } else if (!user) {
      // Signed out — make sure we don't carry the offer forward.
      store.offerPasskey = false;
    }
  });

  if (auth.value.loading) {
    return <AuthShellFrame header="The Editor's Office">…loading…</AuthShellFrame>;
  }

  if (auth.value.user) {
    if (store.offerPasskey) {
      return (
        <AuthShellFrame
          header="Add a passkey?"
          step={2}
          progress="One more thing"
        >
          <SignedInHeader email={auth.value.user.email} onSignOut$={handleSignOut} />
          <p
            class="mt-3 text-[13px] leading-5 text-[var(--color-ink-light)]"
            style="font-family: var(--font-serif); font-style: italic;"
          >
            A passkey lets you sign back in with a tap — no email code to
            wait for. We'll register this device; you can add more from
            Settings later.
          </p>
          {store.error && (
            <p class="error-slip mt-4" role="alert">
              {store.error}
            </p>
          )}
          <button
            type="button"
            onClick$={handleAddPasskey}
            disabled={store.addingPasskey}
            class="btn-press mt-5 w-full"
          >
            {store.addingPasskey ? "Registering…" : "Register this device"}
          </button>
          <button
            type="button"
            onClick$={handleSkipPasskey}
            disabled={store.addingPasskey}
            class="mt-2 w-full text-center text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)] focus-ring"
            style="font-family: var(--font-typewriter);"
          >
            Not now
          </button>
        </AuthShellFrame>
      );
    }
    return (
      <AuthShellFrame header="The Editor's Office">
        <SignedInHeader email={auth.value.user.email} onSignOut$={handleSignOut} />
      </AuthShellFrame>
    );
  }

  // ── Step I — The Email ──────────────────────────────────────
  if (store.step === 1) {
    return (
      <AuthShellFrame
        header="The Editor's Office"
        step={1}
        progress="Step 1 of 2"
        department="Dept. of the Byline"
        question="What's your email?"
        hint="We'll send a one-time code or call up your passkey — whichever fits."
      >
        {store.error && (
          <p class="error-slip" role="alert">
            {store.error}
          </p>
        )}
        <form
          preventdefault:submit
          onSubmit$={handleStepOne}
          class="mt-4 space-y-3"
        >
          <div>
            <label class="field-label" for="auth-step-email">
              Email address
            </label>
            <input
              id="auth-step-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={store.email}
              onInput$={(e) => {
                store.email = (e.target as HTMLInputElement).value;
              }}
              placeholder="byline@example.com"
              class="field-input"
              style="font-family: var(--font-display); font-size: 1.1rem; font-weight: 500;"
            />
          </div>
          <button
            type="submit"
            disabled={!store.email.trim()}
            class="btn-press w-full"
          >
            Continue →
          </button>
        </form>

        <div class="ornament-divider mt-5">
          <span style="font-family: var(--font-display);">❦</span>
        </div>

        <p
          class="mt-4 text-center text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]"
          style="font-family: var(--font-typewriter);"
        >
          or bring your own byline
        </p>
        <button
          type="button"
          onClick$={handleBlueskySignIn}
          class="btn-paper mt-2 w-full"
          title="Sign in with your Bluesky / ATProto account"
        >
          Continue with Bluesky
        </button>
      </AuthShellFrame>
    );
  }

  // ── Step II — The Key ───────────────────────────────────────
  const prefersOtp = store.chosen !== "passkey";
  return (
    <AuthShellFrame
      header="The Editor's Office"
      step={2}
      progress="Step 2 of 2"
      department="Dept. of the Key"
      question={
        prefersOtp
          ? "We'll cable you a one-time code."
          : "Use your passkey to sign in."
      }
      hint={
        prefersOtp
          ? store.otpSent
            ? `Sent to ${store.email}. Enter the six figures below.`
            : "Setting the wheels in motion…"
          : "Tap the prompt on this device, or use a hardware key."
      }
    >
      <p
        class="mb-4 inline-flex items-center gap-2 rounded-sm border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2.5 py-1 text-[11px] tracking-[0.12em] text-[var(--color-ink-muted)]"
        style="font-family: var(--font-typewriter); text-transform: uppercase;"
      >
        <span>For</span>
        <span class="text-[var(--color-ink)]" style="font-weight: 600;">
          {store.email}
        </span>
        <button
          type="button"
          onClick$={handleBack}
          class="text-[var(--color-vermilion)] underline underline-offset-2 hover:text-[var(--color-vermilion-2)]"
          style="font-family: var(--font-typewriter);"
        >
          change
        </button>
      </p>

      {store.error && (
        <p class="error-slip" role="alert">
          {store.error}
        </p>
      )}

      {prefersOtp ? (
        <div class="space-y-4">
          <div>
            <label class="field-label" for="auth-otp-code">
              Verification code
            </label>
            <input
              id="auth-otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus={store.otpSent}
              value={store.otpCode}
              onInput$={(e) => {
                store.otpCode = (e.target as HTMLInputElement).value;
              }}
              onKeyDown$={(e) => {
                if (e.key === "Enter") void handleVerifyOtp();
              }}
              placeholder="six figures, as cabled"
              class="field-input"
              style="font-family: var(--font-display); font-size: 1.2rem; letter-spacing: 0.4em; text-align: center; font-weight: 500;"
            />
          </div>
          <button
            type="button"
            onClick$={handleVerifyOtp}
            disabled={store.verifyingOtp || store.sendingOtp || !store.otpCode}
            class="btn-press w-full"
          >
            {store.verifyingOtp ? "Verifying…" : "Verify & sign in"}
          </button>
          <button
            type="button"
            onClick$={handleResendOtp}
            disabled={store.sendingOtp}
            class="w-full text-center text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)] focus-ring disabled:opacity-40"
            style="font-family: var(--font-typewriter);"
          >
            {store.sendingOtp ? "Sending…" : "Re-send the code"}
          </button>

          <div class="ornament-divider mt-3">
            <span style="font-family: var(--font-display);">❦</span>
          </div>

          <button
            type="button"
            onClick$={handlePasskeySignIn}
            disabled={store.usingPasskey}
            class="btn-paper w-full"
          >
            {store.usingPasskey ? "Checking…" : "Use a passkey instead"}
          </button>
        </div>
      ) : (
        <div class="space-y-4">
          <button
            type="button"
            onClick$={handlePasskeySignIn}
            disabled={store.usingPasskey}
            class="btn-press w-full"
          >
            {store.usingPasskey ? "Checking…" : "Continue with passkey"}
          </button>
          <p
            class="text-center text-[12px] text-[var(--color-ink-muted)]"
            style="font-family: var(--font-serif); font-style: italic;"
          >
            No passkey on this device?{" "}
            <button
              type="button"
              onClick$={() => {
                store.chosen = "otp";
                store.otpSent = false;
              }}
              class="text-[var(--color-vermilion)] underline underline-offset-2 hover:text-[var(--color-vermilion-2)]"
              style="font-family: var(--font-serif); font-style: italic;"
            >
              Email me a code instead
            </button>
            .
          </p>
        </div>
      )}

      <div class="mt-5 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">
        <button
          type="button"
          onClick$={handleBack}
          class="hover:text-[var(--color-ink)] focus-ring"
          style="font-family: var(--font-typewriter);"
        >
          ← Back
        </button>
        <span style="font-family: var(--font-typewriter);">
          {prefersOtp ? "One-time code" : "Passkey"}
        </span>
      </div>
    </AuthShellFrame>
  );
});

/* ── Sub-components ──────────────────────────────────────────── */

interface AuthShellFrameProps {
  header: string;
  step?: 1 | 2;
  progress?: string;
  department?: string;
  question?: string;
  hint?: string;
}

const AuthShellFrame = component$<AuthShellFrameProps>(
  ({ header, step, progress, department, question, hint }) => {
    const roman = step ? ["", "I", "II"][step] : "";
    return (
      <div class="p-5">
        <p class="dept-label">{header}</p>
        {progress && (
          <p
            class="mt-0.5 text-[10px] tracking-[0.18em] text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter); text-transform: uppercase;"
          >
            {progress}
          </p>
        )}
        {step && (
          <div
            class="mt-3 mb-4 h-[3px] w-full overflow-hidden bg-[var(--color-paper-2)]"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={2}
            aria-valuenow={step}
            aria-label="Sign-in progress"
          >
            <div
              class="h-full transition-[width] duration-300"
              style={{
                width: `${(step / 2) * 100}%`,
                background:
                  "linear-gradient(90deg, var(--color-vermilion) 0%, var(--color-mustard) 100%)",
              }}
            />
          </div>
        )}
        {question && (
          <div class="mt-1 flex items-baseline gap-3">
            <span
              class="leading-none ink-bleed"
              style="font-family: var(--font-display); font-weight: 700; font-size: 1.8rem; color: var(--color-vermilion); font-style: italic;"
            >
              {roman}.
            </span>
            <p
              class="text-[1.05rem] leading-snug text-[var(--color-ink)]"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              {question}
            </p>
          </div>
        )}
        {department && (
          <p
            class="mt-2 ml-9 text-[10px] tracking-[0.18em] text-[var(--color-ink-muted)]"
            style="font-family: var(--font-typewriter); text-transform: uppercase;"
          >
            {department}
          </p>
        )}
        {hint && (
          <p
            class="mt-1 ml-9 text-[12px] leading-5 text-[var(--color-ink-light)]"
            style="font-family: var(--font-serif); font-style: italic;"
          >
            {hint}
          </p>
        )}
        <Slot />
      </div>
    );
  },
);

interface SignedInHeaderProps {
  email: string;
  onSignOut$: PropFunction<() => void>;
}

const SignedInHeader = component$<SignedInHeaderProps>(
  ({ email, onSignOut$ }) => {
    return (
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
            {email}
          </p>
        </div>
        <button onClick$={onSignOut$} class="btn-paper flex-shrink-0">
          Sign out
        </button>
      </div>
    );
  },
);
