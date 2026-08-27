import { component$, isDev, useVisibleTask$ } from "@builder.io/qwik";
import { QwikCityProvider, RouterOutlet } from "@builder.io/qwik-city";
import { RouterHead } from "./components/router-head/router-head";
import { ConvexProvider } from "./utils/convex-context";
import { AuthProvider } from "./utils/auth-context";
import { PostHogProvider } from "./utils/posthog-context";
import { installLixAuthInterceptor } from "./utils/lix-auth";
import { GlobalConnectivityBanner } from "./components/ui/global-connectivity-banner";
import { GlobalApplicationToasts } from "./components/ui/global-application-toasts";
import { GlobalSpeechPlayer } from "./components/ui/global-speech-player";
import { UsageSyncController } from "./components/desk/usage-sync-controller";
import {
  THEME_BOOTSTRAP_SCRIPT,
  applyTheme,
  readThemePreference,
} from "./utils/theme";

import "./global.css";

export default component$(() => {
  const convexUrl = (import.meta.env.PUBLIC_CONVEX_URL ??
    import.meta.env.VITE_CONVEX_URL) as string | undefined;

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    installLixAuthInterceptor();

    // The bootstrap script resolves "System" once, at load. Keep following the
    // OS afterwards, so flipping the machine to dark at dusk re-inks the room
    // without a reload. Explicit presets are left alone.
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const preference = readThemePreference();
      if (preference.preset !== "system") return;
      applyTheme(preference, document.documentElement, query.matches);
    };
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  });

  return (
    <QwikCityProvider>
      <head>
        <meta charset="utf-8" />
        {/*
          Stamps the writer's palette onto <html> before the first paint.
          It has to be an inline script rather than a component: Qwik
          server-renders the document, so any QRL resumes long after the
          browser has already painted the default cream — which is exactly
          the flash this avoids. The source lives in `utils/theme.ts` so it
          cannot drift from `applyTheme`.
        */}
        <script
          data-theme-bootstrap
          dangerouslySetInnerHTML={THEME_BOOTSTRAP_SCRIPT}
        />
        {!isDev && (
          <link
            rel="manifest"
            href={`${import.meta.env.BASE_URL}manifest.json`}
          />
        )}
        {/* Editorial type stack — Fraunces (display), Lora (body), DM Sans (UI), Special Elite (typewriter) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Special+Elite&display=swap"
        />
        <RouterHead />
      </head>
      <body lang="en">
        <GlobalConnectivityBanner />
        <GlobalApplicationToasts />
        <ConvexProvider url={convexUrl}>
          <AuthProvider>
            <PostHogProvider>
              <UsageSyncController />
              <RouterOutlet />
              <GlobalSpeechPlayer />
            </PostHogProvider>
          </AuthProvider>
        </ConvexProvider>
      </body>
    </QwikCityProvider>
  );
});
