# Deploying Twyne

Twyne ships as a Qwik City SSR app. The browser bundle is built by Vite into
`dist/`, the SSR server entry into `server/`, and `server.js` (Node `http`)
serves both and listens on `$PORT`.

## Railway (primary)

The repo is configured for [Railway](https://railway.com) via `railway.json`
and `nixpacks.toml`:

- **Build** (Bun): `bun install --frozen-lockfile` → `bun run build.client && bun run build.server`
- **Start** (Node): `node server.js`
- **Healthcheck**: `GET /`

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

## Desktop app (planned)

A future Electrobun desktop shell will wrap the hosted app; see the project
plan. Not yet built.
