# Twyne — task runner
#
# `just` is a single-binary command runner. The recipes below cover
# the full local-to-shipped workflow: install, dev, typecheck, lint,
# build, smoke test, codegen. Run `just` to list, `just <recipe>` to
# invoke, `just --explain` to see what each one does.
#
# Dependencies are listed in `flox.toml` (Flox manifest) and
# `package.json` (Node packages). The recipes assume both are present.

set shell := ["bash", "-uc"]
set dotenv-load := true

# ── Default: show the menu ───────────────────────────────────────
default:
    @just --list

# ── Install everything ───────────────────────────────────────────
install:
    bun install
    just codegen

# ── Run Convex codegen (regenerates convex/_generated/api.ts) ────
codegen:
    npx convex dev --once --codegen enable --typecheck disable

# ── Dev server (Vite SSR + Convex) ───────────────────────────────
dev:
    bun run dev

# ── Type-check ───────────────────────────────────────────────────
types:
    bun run build.types

# ── Lint ─────────────────────────────────────────────────────────
lint:
    bun run lint

# ── Format ───────────────────────────────────────────────────────
fmt:
    bun run fmt

# ── Format check (CI) ───────────────────────────────────────────
fmt-check:
    bun run fmt.check

# ── All checks (CI equivalent) ──────────────────────────────────
check: types lint fmt-check
    @echo "all checks passed"

# ── Production build ────────────────────────────────────────────
build:
    bun run build

# ── Run the production build locally (smoke test) ───────────────
serve:
    bun run serve

# ── Lint + typecheck (used by CI before build) ──────────────────
ci: check build
    @echo "CI pipeline complete"

# ── Print the resolved env (helps debug Railway config) ─────────
env:
    @echo "PUBLIC_CONVEX_URL=${PUBLIC_CONVEX_URL:-unset}"
    @echo "VITE_CONVEX_URL=${VITE_CONVEX_URL:-unset}"
    @echo "VITE_CONVEX_SITE_URL=${VITE_CONVEX_SITE_URL:-unset}"
    @echo "RIVET_ENDPOINT=${RIVET_ENDPOINT:-unset}"
    @echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:+set}"
    @echo "OPENAI_API_KEY=${OPENAI_API_KEY:+set}"
    @echo "BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:+set}"

# ── Show the brutal-curve rubric anchors (sanity check) ─────────
rubric-curve:
    @node -e '
    const raw = [0, 25, 50, 60, 70, 80, 90, 95, 100];
    const curve = (r) => r <= 50 ? r : r >= 95 ? 50 + (r - 50) * 1.4 : 50 + (r - 50) * (43 / 45);
    for (const r of raw) console.log(`${r} -> ${curve(r).toFixed(1)}`);
    '

# ── Run quint spec checks (requires `quint` on PATH) ────────────
specs:
    @command -v quint >/dev/null || { echo "quint not installed; run: flox activate" ; exit 1; }
    quint typecheck specs/sync.qnt
    quint typecheck specs/rubric.qnt
    quint typecheck specs/agent_fallback.qnt
    @echo "all quint specs typecheck"
