# Twyne

Twyne is a writer-first editing room. It opens with an anti-tabula-rasa interview so a draft starts from context instead of a blank page, then keeps that brief in front of every editor, judge, and margin note for the rest of the piece.

## Features

- Rich-text drafting with Tiptap, Qwik City, Vite, and Tailwind CSS.
- Anti-tabula-rasa project interview for title, format, audience, goal, tone, constraints, and success signal — with **typed follow-ups** (multiple choice, fill-in-the-blanks, scales) generated from what you've already said.
- A room of five editorial **personas** that read from your brief and draft and leave grounded feedback — and that **read along as you write**, not only when you ask.
- **Rubric** scoring gated on relevance: a Target Fit judge decides whether the draft is about the right thing, and caps the shape metrics when it isn't.
- **Voice**: hear each editor in their own voice, record spoken margin notes, and answer the interview out loud.
- **Citation detection** for URLs, DOIs, ISBNs, author-year citations, and footnote markers.
- **Comments** panel for review notes and threaded replies.
- **Apparatus** research panel (pluggable providers) for searching and pulling sources while writing.
- **Convex** backend for sync, with **Better Auth** (passkeys) sign-in and
  writer-owned **ATProto / Standard.site** publishing, including canonical
  Twyne readers and publication/document verification links.
- BYOK AI: bring your own key in Settings, stored in your browser and never sent to a server.
- Installable PWA with brand favicons and per-article OpenGraph share cards.

## The editorial room

Four panels sit beside the manuscript: **Cast** (the five editors), **Rubric**
(the galley proof), **Marginalia** (your notes), and **Apparatus** (sources).
Each tab carries an unread count, so work that arrives while you're looking
elsewhere isn't silent.

### The room reads as you write

Convening the room is deliberate and expensive — five model calls over the
whole manuscript. Alongside it, a background pass runs on a narrower brief:
once you've written **~300 net new words** _and_ stopped typing for **two
minutes**, all five editors read **only the new paragraphs**, plus a digest of
how the draft has been moving.

Those arrive as quieter "in passing" notes in the Cast panel. Two spend guards
sit on top — a five-minute floor between passes and a per-session cap — because
this runs without you asking. Turn it off with **Read as I write** in the room
settings.

The same digest goes along when you _do_ press Convene, so the deliberate pass
knows the trajectory rather than re-reading a cold snapshot.

### The rubric grades against _this_ piece

The static feature scorer measures shape — sentence-length variance,
type-token ratio, paragraph balance. It never reads the brief, so fluent prose
about the wrong subject used to score 10/10 on three categories.

A **Target Fit** judge now scores relevance independently of craft, and caps
every shape-derived criterion by it. Lowering target fit can only ever lower
the grade, never raise it.

The criteria themselves are yours to shape. Twyne ships a fixed spine so a
score in March means the same thing in June; you can disable or reweight any of
it, add criteria of your own ("stays in second person", "every section ends on
an image") for the room to judge, or ask it to **suggest criteria** fitted to
your format — proposals you accept, never applied silently. Customise anything
and a second "by your weights" score appears beside the editorial grade. Every
pass is recorded, so the panel shows the run of grades rather than a snapshot.

## Voice

| What                                       | Needs                                             |
| ------------------------------------------ | ------------------------------------------------- |
| Hear an editor, memo, or review read aloud | BYOK speech provider, or Twyne-hosted voice (Pro) |
| Read the selection (or whole draft) aloud  | same                                              |
| Record a spoken margin note                | microphone + BYOK or hosted **transcription**     |
| Answer the interview out loud              | same                                              |

Each of the five editors has their own voice, per provider — Fish Audio names
voices by id and OpenAI by name, so the mapping is per-provider rather than one
shared field. Spoken notes keep **both** the recording and the transcript: the
transcript threads, resolves and @-mentions like any other note, and you edit it
before it saves. Audio stays local and does not sync.

## BYOK providers

Keys live in your browser (IndexedDB) and are never sent to a Twyne server.
Settings → AI lets you set a default and override any individual feature.

- **Language**: OpenAI, Anthropic, Google, DeepSeek, OpenRouter, Ollama, Z.ai /
  GLM, MiniMax, and any OpenAI- or Anthropic-compatible endpoint. The desktop
  build also auto-registers a local Gemma 4 E4B served on loopback.
- **Speech**: OpenAI (or an OpenAI-compatible endpoint) for both narration and
  transcription; **Fish Audio** for voice only.

Fish Audio speaks but cannot think, so it is never offered to the persona,
rubric or interview features — configuring it alone won't make those features
try a client path they can't complete. Its `s2.1-pro-free` model works without
API credit; transcription (`/v1/asr`) does not, and needs a
[funded API balance](https://fish.audio/app/developers).

## Requirements

- Bun 1.3.x or newer (install + build).
- Node ≥ 20 (runs the SSR server; `server.js` uses `node:http`).

Optional: [devenv](https://devenv.sh) for a reproducible shell with pinned Bun.
With devenv + [direnv](https://direnv.net) installed, the shell activates
automatically when you `cd` into the repo (the `.envrc` handles it).

## Environment

Copy `.env.example` to `.env.local` and fill in at least `VITE_CONVEX_URL`,
`VITE_CONVEX_SITE_URL`, and `BETTER_AUTH_SECRET`. `VITE_*` / `PUBLIC_*` values
are inlined at build time. See `.env.example` for the full annotated list.

## Development

```bash
bun install
bun run dev   # Convex dev + Vite SSR
```

Or, with devenv:

```bash
devenv tasks run twyne:install
devenv up   # Convex dev + Vite SSR + Storybook
```

The app runs at `http://127.0.0.1:5173/` and Storybook at
`http://127.0.0.1:6006/`. Run `devenv down` to stop the workspace. Use
`devenv tasks list` to discover the namespaced check, test, build, codegen, and
Storybook build tasks.

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

Versioning uses Bun's package manager. `bun pm version` requires a clean working
tree, updates `package.json`, and creates the version commit and `v<version>` tag.
The `preversion`, `postversion`, and pre-push hooks run the same dependency-free
release check so the package version, annotated tag, and tagged manifest cannot
drift apart.

```bash
bun run release:version patch  # or minor, major, prerelease, or an exact version
bun run release:publish        # push the version commit and tag
bun run release:check          # verify package.json and the corresponding tag
```

The pushed tag triggers GitHub Actions, which generates the GitHub release notes
and uploads a `twyne-<version>.tar.gz` bundle containing the source, lockfile,
production build output, and server entry point.
