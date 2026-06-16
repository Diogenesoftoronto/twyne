import { component$ } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { AuthPanel } from "../../components/auth/auth-panel";
import ImgGriffinMark from "~/media/assets/griffin-mark.svg?jsx";

export default component$(() => {
  return (
    <main
      class="min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8">
        <header class="flex items-center justify-between gap-4 border-b border-[var(--color-paper-3)] pb-5">
          <Link
            href="/"
            class="flex items-center gap-3 focus-ring"
            aria-label="Twyne home"
          >
            <ImgGriffinMark class="h-8 w-8" aria-hidden="true" />
            <span
              class="text-2xl text-[var(--color-ink)]"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                letterSpacing: "0.06em",
              }}
            >
              TWYNE
            </span>
          </Link>
          <nav
            class="flex items-center gap-4 text-[0.72rem] uppercase tracking-[0.16em] text-[var(--color-ink-light)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
            aria-label="Account page"
          >
            <Link href="/pricing/" class="hover:text-[var(--color-ink)]">
              Pricing
            </Link>
            <Link href="/docs/" class="hover:text-[var(--color-ink)]">
              Manual
            </Link>
          </nav>
        </header>

        <section class="grid flex-1 items-center gap-8 py-12 md:grid-cols-[minmax(0,1fr)_22rem] md:py-16">
          <div class="max-w-xl">
            <p class="dept-label">The Editor's Office</p>
            <h1
              class="mt-3 text-4xl leading-tight text-[var(--color-ink)] sm:text-5xl"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                letterSpacing: "-0.02em",
              }}
            >
              Sign in and keep the dossier with you.
            </h1>
            <p class="mt-5 max-w-prose text-[1.02rem] leading-7 text-[var(--color-ink-light)]">
              An account backs up your folios, lets you work across devices, and
              connects publishing features when you need them. You can still
              write locally without signing in.
            </p>
            <div
              class="mt-8 grid gap-3 border-l-2 border-[var(--color-vermilion)] pl-5 text-sm leading-6 text-[var(--color-ink-light)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              <p>
                Two short steps: enter your email, then sign in with a passkey
                or a one-time code. We send a fresh code the first time and
                every time a passkey hasn't been set up — once you register one,
                the passkey becomes the default.
              </p>
              <p>
                Your BYOK provider keys stay in this browser, not on Twyne's
                servers.
              </p>
              <p>
                Need plan details first?{" "}
                <Link
                  href="/pricing/"
                  class="text-[var(--color-vermilion)] underline underline-offset-4 hover:text-[var(--color-vermilion-2)]"
                >
                  View pricing
                </Link>
                .
              </p>
            </div>
          </div>

          <aside class="folio bg-[var(--color-paper-soft)]">
            <AuthPanel />
          </aside>
        </section>
      </div>
    </main>
  );
});

export const head: DocumentHead = {
  title: "Sign In · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Sign in to Twyne with a passkey, one-time email code, or Bluesky and sync your writing across devices.",
    },
  ],
};
