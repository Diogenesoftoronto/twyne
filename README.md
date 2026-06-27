# Twyne

Twyne is a writer-first editing room. It opens with an anti-tabula-rasa interview so a draft starts from context instead of a blank page, then keeps that brief available to the editor, persona feedback, rubric review, comments, and citation detection.

## Features

- Rich-text drafting with Tiptap, Qwik City, Vite, and Tailwind CSS.
- Anti-tabula-rasa project interview for title, format, audience, goal, tone, constraints, and success signal.
- A room of editorial **personas** that read from your brief and draft and leave grounded feedback.
- **Rubric** scoring based on draft length, structure, citations, audience, goal, tone, and success signal.
- **Citation detection** for URLs, DOIs, ISBNs, author-year citations, and footnote markers.
- **Comments** panel for review notes and threaded replies.
- **Apparatus** research panel (pluggable providers) for searching and pulling sources while writing.
- **Convex** backend for sync, with **Better Auth** (passkeys) sign-in and **ATProto / standard.site** publishing.
- BYOK AI: bring your own Anthropic / OpenAI / Google key in Settings (stored in your browser).
- Installable PWA with brand favicons and OpenGraph share cards.

## Requirements

- Bun 1.3.x or newer (install + build).
- Node ≥ 20 (runs the SSR server; `server.js` uses `node:http`).

## Environment

Copy `.env.example` to `.env.local` and fill in at least `VITE_CONVEX_URL`,
`VITE_CONVEX_SITE_URL`, and `BETTER_AUTH_SECRET`. `VITE_*` / `PUBLIC_*` values
are inlined at build time. See `.env.example` for the full annotated list.

## Development

```bash
bun install
bun run dev   # Convex dev + Vite SSR
```

The app runs locally with Vite, usually at `http://localhost:5173/`.

## Build

```bash
bun run build
```

The build emits browser assets to `dist/` and server output to `server/`.

## Run a built server

```bash
bun run build.client && bun run build.server
node server.js
```

The server listens on `PORT`, defaulting to `3000`.

## Deployment

Twyne deploys to **Railway** (Bun build, Node runtime) via `railway.json` and
`railpack.json`. Custom domain: **twyne.love**. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for service setup, environment
variables, and the custom-domain steps.

## Desktop app

A native desktop build wraps the hosted app via
[Electrobun](https://www.electrobun.dev):

```bash
bun run desktop         # dev build + launch
bun run desktop.build   # production bundle into ./build
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#desktop-app-electrobun) for config,
the `TWYNE_DESKTOP_URL` dev override, and platform caveats.

## Releases

Releases use Bumpy bump files to generate changelog entries and version tags.
The repo installs a `pre-push` hook on `bun install` that runs
`bumpy check --hook pre-push`.

```bash
bun run release:add      # add a bump file for a change
bun run release:version  # consume bump files, update CHANGELOG.md, bump version
bun run release:publish  # create git tags and GitHub releases
```

Tagged releases are built by GitHub Actions. Each release uploads a `twyne-<version>.tar.gz` bundle containing the source, lockfile, production build output, and server entry point so people can download and run that version.
