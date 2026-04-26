# Twyne

Twyne is a writer-first editing room. It opens with an anti-tabula-rasa interview so a draft starts from context instead of a blank page, then keeps that brief available to the editor, persona feedback, rubric review, comments, and citation detection.

## Features

- Rich text drafting with Tiptap, Qwik City, Vite, and Tailwind CSS.
- Anti-tabula-rasa project interview for title, format, audience, goal, tone, constraints, and success signal.
- Local draft and brief persistence with `localStorage`.
- Persona feedback grounded in the current project brief and draft text.
- Rubric scoring based on draft length, structure, citations, audience, goal, tone, and success signal.
- Citation detection for URLs, DOIs, ISBNs, author-year citations, and footnote markers.
- Comment panel for review notes and threaded replies.

## Requirements

- Bun 1.3.6 or newer.
- Node-compatible runtime for the Qwik/Vite toolchain.

## Development

```bash
bun install
bun run dev
```

The app runs locally with Vite, usually at `http://localhost:5173/`.

## Build

```bash
bun run build
```

The build emits browser assets to `dist/` and server output to `server/`.

## Run A Built Server

```bash
bun run build
bun server.js
```

The server listens on `PORT`, defaulting to `3000`.

## Releases

Tagged releases are built by GitHub Actions. Each release uploads a `twyne-<version>.tar.gz` bundle containing the source, lockfile, production build output, and server entry point so people can download and run that version.
