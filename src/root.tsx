import { component$, isDev } from "@builder.io/qwik";
import { QwikCityProvider, RouterOutlet } from "@builder.io/qwik-city";
import { RouterHead } from "./components/router-head/router-head";
import { ConvexProvider } from "./utils/convex-context";
import { AuthProvider } from "./utils/auth-context";

import "./global.css";

export default component$(() => {
  const convexUrl = (import.meta.env.PUBLIC_CONVEX_URL ??
    import.meta.env.VITE_CONVEX_URL) as string | undefined;

  return (
    <QwikCityProvider>
      <head>
        <meta charset="utf-8" />
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
        <ConvexProvider url={convexUrl}>
          <AuthProvider>
            <RouterOutlet />
          </AuthProvider>
        </ConvexProvider>
      </body>
    </QwikCityProvider>
  );
});
