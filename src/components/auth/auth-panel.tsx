import { component$, useSignal, $ } from "@builder.io/qwik";
import { useAuth } from "../../utils/auth-context";
import { signInWithBluesky, signOutBluesky } from "../../utils/atproto";
import {
  signIn,
  signUp,
  signOut,
  passkeyApi,
  emailOtp,
  authClient,
} from "../../utils/auth-client";

type AuthView = "login" | "register" | "email-otp";

const VIEW_COPY: Record<AuthView, { title: string; subtitle: string }> = {
  login: {
    title: "Sign the register",
    subtitle: "Sign in to keep the dossier with you across desks.",
  },
  register: {
    title: "Join the masthead",
    subtitle: "Open an account so the room can hold your work.",
  },
  "email-otp": {
    title: "Wire confirmation",
    subtitle: "We cabled a code to your address. Enter it below.",
  },
};

export const AuthPanel = component$(() => {
  const auth = useAuth();
  const view = useSignal<AuthView>("login");
  const email = useSignal("");
  const password = useSignal("");
  const name = useSignal("");
  const otpCode = useSignal("");
  const otpEmail = useSignal("");
  const blueskyHandle = useSignal("");
  const error = useSignal<string | null>(null);
  const loading = useSignal(false);

  const handleEmailSignIn = $(async () => {
    error.value = null;
    loading.value = true;
    try {
      const result = await signIn.email({
        email: email.value,
        password: password.value,
      });
      if (result.error) {
        error.value = result.error.message ?? "Sign in failed";
      }
    } catch (e: any) {
      error.value = e?.message ?? "Sign in failed";
    } finally {
      loading.value = false;
    }
  });

  const handleRegister = $(async () => {
    error.value = null;
    loading.value = true;
    try {
      const result = await signUp.email({
        email: email.value,
        password: password.value,
        name: name.value,
      });
      if (result.error) {
        error.value = result.error.message ?? "Registration failed";
      }
    } catch (e: any) {
      error.value = e?.message ?? "Registration failed";
    } finally {
      loading.value = false;
    }
  });

  const handlePasskeySignIn = $(async () => {
    error.value = null;
    loading.value = true;
    try {
      await (authClient.signIn as any).passkey();
    } catch (e: any) {
      error.value = e?.message ?? "Passkey sign in failed";
    } finally {
      loading.value = false;
    }
  });

  const handlePasskeyRegister = $(async () => {
    error.value = null;
    loading.value = true;
    try {
      await (passkeyApi as any).addPasskey();
    } catch (e: any) {
      error.value = e?.message ?? "Passkey registration failed";
    } finally {
      loading.value = false;
    }
  });

  const handleEmailOtpRequest = $(async () => {
    error.value = null;
    loading.value = true;
    try {
      const result = await emailOtp.sendVerificationOtp({
        email: otpEmail.value,
        type: "sign-in",
      });
      if (result.error) {
        error.value = result.error.message ?? "Failed to send the code";
      }
    } catch (e: any) {
      error.value = e?.message ?? "Failed to send the code";
    } finally {
      loading.value = false;
    }
  });

  const handleEmailOtpVerify = $(async () => {
    error.value = null;
    loading.value = true;
    try {
      const result = await emailOtp.verifyEmail({
        email: otpEmail.value,
        otp: otpCode.value,
      });
      if (result.error) {
        error.value = result.error.message ?? "Verification failed";
      }
    } catch (e: any) {
      error.value = e?.message ?? "Verification failed";
    } finally {
      loading.value = false;
    }
  });

  const handleBlueskySignIn = $(async () => {
    error.value = null;
    loading.value = true;
    try {
      // Redirects to the Bluesky consent screen and never returns here;
      // the session is completed on the redirect back into AuthProvider.
      await signInWithBluesky(blueskyHandle.value || undefined);
    } catch (e: any) {
      error.value = e?.message ?? "Bluesky sign in failed";
      loading.value = false;
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

  if (auth.value.loading) {
    return (
      <div class="px-5 py-6 text-center" role="status">
        <p
          class="text-2xl"
          style="font-family: var(--font-display); color: var(--color-ink-muted);"
        >
          ❧
        </p>
        <p
          class="mt-2 text-[11px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
          style="font-family: var(--font-typewriter);"
        >
          Checking the register…
        </p>
      </div>
    );
  }

  if (auth.value.user) {
    return (
      <div class="px-4 py-3">
        <p class="dept-label">On the masthead</p>
        <div class="mt-2 flex items-center gap-3">
          {auth.value.user.image && (
            <img
              src={auth.value.user.image}
              alt=""
              width={36}
              height={36}
              class="flex-shrink-0 rounded-full border border-[var(--color-paper-3)]"
              style="width: 36px; height: 36px; object-fit: cover;"
            />
          )}
          <div class="flex-1 min-w-0">
            <p
              class="text-sm text-[var(--color-ink)] truncate"
              style="font-family: var(--font-display); font-weight: 600;"
            >
              {auth.value.user.name || auth.value.user.email}
            </p>
            <p
              class="text-[11px] text-[var(--color-ink-muted)] truncate"
              style="font-family: var(--font-typewriter); letter-spacing: 0.08em;"
            >
              {auth.value.user.email}
            </p>
          </div>
          <button onClick$={handleSignOut} class="btn-paper flex-shrink-0">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const copy = VIEW_COPY[view.value];

  return (
    <div class="p-5 space-y-4">
      <div>
        <p class="dept-label">The Editor's Office</p>
        <h2
          class="mt-0.5 text-lg text-[var(--color-ink)]"
          style="font-family: var(--font-display); font-weight: 600;"
        >
          {copy.title}
        </h2>
        <p
          class="mt-1 text-[13px] leading-5 text-[var(--color-ink-light)]"
          style="font-family: var(--font-serif); font-style: italic;"
        >
          {copy.subtitle}
        </p>
      </div>

      {error.value && (
        <p class="error-slip" role="alert">
          {error.value}
        </p>
      )}

      {view.value === "email-otp" ? (
        <form
          preventdefault:submit
          onSubmit$={handleEmailOtpVerify}
          class="space-y-3"
        >
          <div>
            <label class="field-label" for="auth-otp-email">
              Email address
            </label>
            <input
              id="auth-otp-email"
              type="email"
              autoComplete="email"
              value={otpEmail.value}
              onInput$={(e) => {
                otpEmail.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="byline@example.com"
              class="field-input"
            />
          </div>
          <div>
            <label class="field-label" for="auth-otp-code">
              Verification code
            </label>
            <input
              id="auth-otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otpCode.value}
              onInput$={(e) => {
                otpCode.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="six figures, as cabled"
              class="field-input"
            />
          </div>
          <button
            type="button"
            onClick$={handleEmailOtpRequest}
            disabled={loading.value || !otpEmail.value}
            class="btn-paper w-full"
          >
            {loading.value ? "Cabling…" : "Cable the code"}
          </button>
          <button
            type="submit"
            disabled={loading.value || !otpCode.value}
            class="btn-press w-full"
          >
            Verify &amp; sign in
          </button>
        </form>
      ) : (
        <form
          preventdefault:submit
          onSubmit$={
            view.value === "login" ? handleEmailSignIn : handleRegister
          }
          class="space-y-3"
        >
          {view.value === "register" && (
            <div>
              <label class="field-label" for="auth-name">
                Name
              </label>
              <input
                id="auth-name"
                type="text"
                autoComplete="name"
                value={name.value}
                onInput$={(e) => {
                  name.value = (e.target as HTMLInputElement).value;
                }}
                placeholder="As it should read on the byline"
                class="field-input"
              />
            </div>
          )}
          <div>
            <label class="field-label" for="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email.value}
              onInput$={(e) => {
                email.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="byline@example.com"
              class="field-input"
            />
          </div>
          <div>
            <label class="field-label" for="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={
                view.value === "login" ? "current-password" : "new-password"
              }
              value={password.value}
              onInput$={(e) => {
                password.value = (e.target as HTMLInputElement).value;
              }}
              placeholder="••••••••"
              class="field-input"
            />
          </div>

          <button
            type="submit"
            disabled={loading.value || !email.value || !password.value}
            class="btn-press w-full"
          >
            {loading.value
              ? "Setting the type…"
              : view.value === "login"
                ? "Sign in with email"
                : "Create account"}
          </button>

          <div class="flex gap-2">
            <button
              type="button"
              onClick$={
                view.value === "login"
                  ? handlePasskeySignIn
                  : handlePasskeyRegister
              }
              disabled={loading.value}
              class="btn-paper flex-1"
            >
              {view.value === "login" ? "Use a passkey" : "Add a passkey"}
            </button>
            <button
              type="button"
              onClick$={() => {
                error.value = null;
                view.value = "email-otp";
              }}
              class="btn-paper flex-1"
            >
              Email a code
            </button>
          </div>
        </form>
      )}

      <div class="pt-1 border-t border-dashed border-[var(--color-paper-3)]">
        <p
          class="mt-3 text-[11px] tracking-[0.16em] uppercase text-center text-[var(--color-ink-muted)]"
          style="font-family: var(--font-typewriter);"
        >
          or bring your own byline
        </p>
        <div class="mt-2 flex gap-2">
          <input
            type="text"
            autoComplete="username"
            value={blueskyHandle.value}
            onInput$={(e) => {
              blueskyHandle.value = (e.target as HTMLInputElement).value;
            }}
            placeholder="handle.bsky.social (optional)"
            class="field-input flex-1 text-[12px]"
          />
          <button
            type="button"
            onClick$={handleBlueskySignIn}
            disabled={loading.value}
            class="btn-paper flex-shrink-0"
            title="Sign in with your Bluesky / ATProto account"
          >
            Bluesky
          </button>
        </div>
      </div>

      <div class="pt-1 text-center border-t border-dashed border-[var(--color-paper-3)]">
        <button
          onClick$={() => {
            error.value = null;
            view.value = view.value === "login" ? "register" : "login";
          }}
          class="mt-3 text-[11px] tracking-[0.16em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)] focus-ring"
          style="font-family: var(--font-typewriter);"
        >
          {view.value === "login"
            ? "Need an account? Join the masthead"
            : "Already on the masthead? Sign in"}
        </button>
      </div>
    </div>
  );
});
