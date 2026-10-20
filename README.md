# Twyne

Twyne is a writer-first editing room. It opens with an anti-tabula-rasa interview so a draft starts from context instead of a blank page, then keeps that brief in front of every editor, judge, and margin note for the rest of the piece.

[Writer’s manual](https://www.twyne.love/docs/) · [Documentation index](docs/README.md) · [Run locally](#development) · [Deployment](docs/DEPLOYMENT.md)

## The writing desk

| Work                       | What Twyne provides                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Define the piece           | A dossier for title, format, audience, purpose, tone, constraints and success.                       |
| Keep context across pieces | House defaults, collections and a charter of reusable standards.                                     |
| Draft and revise           | Rich text, native Typst source, paginated proof and recoverable source drafts.                       |
| Read with other eyes       | Five editorial personas, rubric scoring and threaded margin conversations.                           |
| Support the prose          | Source discovery, bibliography, citations and spoken notes.                                          |
| Keep or publish the work   | Local storage, signed-in sync, portable exports and writer-owned ATProto / Standard.site publishing. |

Built with Qwik City, Tiptap, Vite, Tailwind CSS and Convex. Account sign-in,
hosted credits and plans use **Not Organic**. Writing locally does not require
an account. See [the House and fluid desk guide](docs/flow-and-context.md) for
context inheritance, margin behavior and sync boundaries.

## The editorial room

The manuscript’s margins hold comments, editor notes, sources and connections.
Click a passage marker to unfold its conversation beside the draft. The **Cast**,
**Rubric**, **Marginalia** and **Apparatus** panels remain available for browsing;
their tabs show unread work. Automatic focus quiets the surrounding room during
sustained writing, with a manual override in the review controls.

### The room reads as you write

Twyne acts without being asked. The buttons remain, but as shortcuts rather
than the way work starts.

- **The editors read on their own.** Once **200 words** are new or rewritten
  since their last reading _and_ you have paused for **a minute**, all five
  editors read the changed paragraphs, plus a digest of how the draft has been
  moving. Rewrites count as much as new material. A folio they have never read
  is read on its own once it reaches 500 words. What they last read is kept
  per folio, so reopening a folio that already has notes stays quiet. Spend
  guards: five minutes between passes and eight passes a session. Turn it off
  with **Read as I write** in the room settings.
- **Quotations lead to passages.** Every passage an editor quotes in a note or
  reply links to the sentence it came from. Matching is literal: typography,
  case and spacing are normalised, `…` elisions are followed within one
  paragraph, and the note's own words choose between repeated phrases. A
  quotation that is ambiguous, or no longer in the draft, stays unlinked and
  says why. Links are re-checked whenever the draft changes.
- **Settled notes stay settled.** Mark a note **intentional** or **later** and
  that editor will not raise the same passage again until its text changes.
  The decisions go to the editors as context too.
- **Research needs no setup.** With your own model, it finds the claims that
  need a source. Signed in without one, Twyne picks out figures, quotations,
  appeals to authority and dated events from the text and Jev confirms which
  really need a source. Fiction is read as fiction. A failed pass or claim
  tries again after 30 seconds, 2 minutes and 10 minutes. The panel always
  says why research is idle: waiting for a pause, draft too short, no claims,
  all covered, or finished.

The same digest goes along when you _do_ press **Get notes**, so the deliberate
pass knows the trajectory rather than re-reading a cold snapshot.

### The rubric grades against _this_ piece

The default signed-in check first attempts one typed judgement over the enabled
criteria, including custom criteria. The editors then read each new version on
their own, at most once every ten minutes, in the background so the grade stays
on screen. Their notes survive later quick checks and say when they are about
an earlier version. **Ask them now** reads the current version straight away;
Twyne also takes the room path when the quick check is unavailable.

In the room reading, the static feature scorer measures shape — sentence-length variance,
type-token ratio, paragraph balance. It never reads the brief, so fluent prose
about the wrong subject used to score 10/10 on three categories.

That path’s **Target Fit** judge scores relevance independently of craft, and caps
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

| What                                       | Needs                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| Hear an editor, memo, or review read aloud | BYOK speech provider, or ElevenLabs v4 through your Not Organic wallet |
| Read the selection (or whole draft) aloud  | same                                                                   |
| Record a spoken margin note                | microphone + BYOK or hosted **transcription**                          |
| Answer the interview out loud              | same                                                                   |

Each of the five editors has their own voice, per provider — Fish Audio names
voices by id and OpenAI by name, so the mapping is per-provider rather than one
shared field. Spoken notes keep **both** the recording and the transcript: the
transcript threads, resolves and @-mentions like any other note, and you edit it
before it saves. Audio stays local and does not sync.

## BYOK providers

Keys are saved in your browser’s IndexedDB. Remote BYOK calls pass through
Twyne’s server relay, which forwards the key and request to your selected
provider. Local endpoints stay direct. Settings → AI lets you set a default and
override individual features.

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

With `devenv up`, the app runs at `http://127.0.0.1:5180/` and Storybook at
`http://127.0.0.1:6010/`, separate from the standalone commands' defaults
of 5173 and 6006. Configure `TWYNE_DEV_PORT` and `TWYNE_STORYBOOK_PORT`
in `devenv.local.nix` under `env` to change the workspace ports; the readiness
checks use those same values. Run `devenv down` to stop the workspace. Use
`devenv tasks list` to discover the namespaced check, test, build, codegen, and
Storybook build tasks.

Playwright uses `TWYNE_DEV_PORT` for both its server and browser URLs, so
`bun run test:e2e` follows the same port inside the Devenv shell.

For authenticated local development, the **development Convex deployment**
must trust the browser origin too. Set its `TRUSTED_ORIGINS` to the exact
origin you use, such as `http://127.0.0.1:5180`; equivalent loopback hosts
on that scheme and port are then accepted. Putting this value only in the
frontend's `.env.local` does not change the backend's CORS policy.
Not Organic also needs an explicitly approved local client in its
`PUBLIC_CLIENT_PRODUCT_CATALOG`, mapped to `twyne`. Each scheme, host and
port is a separate client approval. Production supports both
`https://twyne.love` and `https://www.twyne.love`.

When diagnosing sign-in, inspect the failing request URL. The callback
redeems its code at the configured Convex site's
`/api/auth/sign-in/notorganic`, then confirms `/api/auth/get-session`
before returning to the manuscript. A blocked PostHog request is an
analytics failure; `moz-extension://` errors come from a browser extension.
Neither by itself identifies a failed account exchange.

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

A native, offline writing room built with [GPUI Kit](https://gpui-kit.com/)
is available alongside the hosted desktop shell:

```bash
bun run desktop.gpui         # build and launch the Rust app
bun run desktop.gpui.build   # build the release executable
```

It provides local manuscripts, Markdown writing and reading, notebooks,
autosave, import/export, find, focus mode, and a reversible archive. It uses a
separate local library. See [the GPUI desktop guide](desktop/gpui/README.md)
for platform requirements, storage, shortcuts, and feature coverage.

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
The `preversion` and `postversion` scripts plus Devenv's native pre-push
hook run the same dependency-free release check so the package version,
annotated tag, and tagged manifest cannot drift apart.

```bash
bun run release:version patch  # or minor, major, prerelease, or an exact version
bun run release:publish        # push the version commit and tag
bun run release:check          # verify package.json and the corresponding tag
```

The pushed tag triggers GitHub Actions, which generates the GitHub release notes
and uploads a `twyne-<version>.tar.gz` bundle containing the source, lockfile,
production build output, and server entry point.
