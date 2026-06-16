# Deploying Twyne

Twyne ships as a Qwik City SSR app. The browser bundle is built by Vite into
`dist/`, the SSR server entry into `server/`, and `server.js` (Node `http`)
serves both and listens on `$PORT`.

## Railway (primary)

The repo is configured for [Railway](https://railway.com) via `railway.json`
(`builder: RAILPACK`) and [`railpack.json`](https://railpack.com) — Railpack is
Railway's successor to Nixpacks:

- **Build** (Bun): `bun install --frozen-lockfile` → `bun run build.client && bun run build.server`
- **Start** (Node): `node server.js`
- **Healthcheck**: `GET /`

`railpack.json` pins `node: 20` + `bun: 1` so the runtime image has `node`
available for the start command (`server.js` uses `node:http`), while Bun does
the install and Vite build.

### One-time setup

1. **Create / link the service** (already linked to `Diogenesoftoronto/twyne`):

   ```bash
   railway add --service twyne --repo Diogenesoftoronto/twyne
   ```

   Railway auto-deploys on every push to the connected branch.

2. **Set environment variables** (see `.env.example` for the full list). The
   `VITE_*` values are baked in at build time, so they must be set on the
   service before the first build:

   ```bash
   railway variables \
     --set "VITE_CONVEX_URL=https://your-deployment.convex.cloud" \
     --set "VITE_CONVEX_SITE_URL=https://your-deployment.convex.site" \
     --set "BETTER_AUTH_SECRET=..." \
     --set "BETTER_AUTH_URL=https://twyne.love" \
     --set "SITE_URL=https://twyne.love"
   ```

   `PORT` is injected by Railway automatically — do not set it.

3. **Custom domain**: in the Railway service → Settings → Networking, add
   `twyne.love` and point the DNS `CNAME` at the generated Railway target.
   Until the domain resolves, auth callbacks that expect `https://twyne.love`
   will not complete — use the `*.up.railway.app` URL or temporarily set
   `BETTER_AUTH_URL`/`SITE_URL` to it while testing.

### Convex in production

`VITE_CONVEX_URL` should point at a **production** Convex deployment, not a dev
one. Create/promote it with `npx convex deploy`, then update the Railway
variables. Convex functions deploy independently of the Railway frontend.

## Feature flags

Two capabilities ship dark and are switched on through PostHog feature flags
(runtime, per user/environment):

| Flag             | Effect                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `twyne-pricing`  | Enables the `/pricing` page (Creem) + its nav links. Off ⇒ direct visits redirect home after flags load. |
| `twyne-local-ai` | Surfaces the desktop-only native LiteRT model (Gemma 4 E4B) in the UI.                                   |

Set `PUBLIC_POSTHOG_KEY` and optionally `PUBLIC_POSTHOG_HOST`
(`https://us.i.posthog.com` by default) in the frontend deployment. The legacy
`PUBLIC_FEATURE_PRICING` and `PUBLIC_FEATURE_LOCAL_AI` env vars are fallback
defaults for local/offline builds where PostHog is absent; PostHog should own
production rollout.

PostHog also captures AI Observability events for evals. Browser-side BYOK and
desktop-local model calls emit `$ai_generation` through `posthog-js`; Convex
server-side hosted AI calls emit the same event via the capture API when
`POSTHOG_PROJECT_API_KEY` (and optional `POSTHOG_HOST`) is set in Convex. Create
PostHog evals against `$ai_generation`, then filter/break down by
`twyne_feature`, `$ai_provider`, `$ai_model`, `twyne_persona_id`, and
`twyne_expected_format`.

**Creem** (when pricing is on): set `PUBLIC_CREEM_PRODUCT_PRO` (public product
id) plus the Convex secrets `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, and
`CREEM_SUCCESS_URL`. Point a Creem webhook at
`<VITE_CONVEX_SITE_URL>/creem/webhook`.

**Local model** (desktop only): the web flag just shows the UI; the model runs
as a native LiteRT-LM server bundled into the Electrobun desktop build. Build
that variant with `TWYNE_DESKTOP_LOCAL_AI=true` and `LOCAL_MODEL_PATH` pointing
at the Gemma 4 E4B LiteRT file. The plain web app never loads the model.

## Local production smoke test

```bash
bun run build.client && bun run build.server
PORT=3137 node server.js
# then: curl -I http://localhost:3137/og-image.png
```

## Assets / social embeds

- Favicons and app icons live in `public/` (`favicon.svg`, `favicon.ico`,
  `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`,
  `icon-512-maskable.png`) and are referenced from
  `src/components/router-head/router-head.tsx`.
- The OpenGraph/Twitter card image is `public/og-image.png` (1200×630). Default
  social tags are emitted site-wide by `RouterHead`; per-route `head` exports
  can override any `og:`/`twitter:` key.

## Desktop app (Electrobun)

Twyne ships a native desktop shell built with
[Electrobun](https://www.electrobun.dev). It is a thin wrapper: a single Bun
entrypoint (`desktop/main.ts`) opens a `BrowserWindow` pointed at the hosted
site (`https://twyne.love` by default), so SSR, Convex sync, Better Auth, and
ATProto publishing all run server-side exactly as on the web. The shell bundles
no application code of its own and updates whenever the site does.

```bash
bun run desktop         # dev build + launch the window
bun run desktop.build   # production app bundle into ./build
```

Point the window at a local dev server while developing:

```bash
TWYNE_DESKTOP_URL=http://localhost:5173 bun run desktop
```

Config lives in `electrobun.config.ts` (app id `love.twyne.desktop`, custom
`twyne://` scheme reserved for OAuth deep links). The desktop sources are built
by Bun via the electrobun CLI and are kept out of the app's Vite/tsc build
(`desktop/tsconfig.json`, and excluded in the root `tsconfig.json`).

**Caveats**: Electrobun is young and macOS-first (Linux uses a GTK webview;
Windows support is newer). For desktop sign-in, the ATProto OAuth client must
list the desktop loopback/`twyne://` redirect URIs. macOS distribution needs
codesigning + notarization (configure under `build.mac` in
`electrobun.config.ts`).
