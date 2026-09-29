#!/usr/bin/env bash
# Railway build step: deploy Convex backend (when key is configured), then
# build the Qwik City frontend + SSR server.
#
# Gating: when CONVEX_DEPLOY_KEY is unset (frontend-only deploys, preview
# environments, local re-runs) we still build the frontend but skip the
# backend push.

set -euo pipefail

if [ -n "${CONVEX_DEPLOY_KEY:-}" ]; then
  echo "==> Deploying Convex backend"
  # 1.46 fixes index-removal review with deploy-only keys. Keep CI deployment
  # tooling explicit even when the app's lockfile pins an older client.
  npx --yes convex@1.46.0 deploy --cmd 'bun run build.client && bun run build.server'
else
  echo "==> CONVEX_DEPLOY_KEY not set — building frontend only, skipping convex deploy"
  bun run build.client
  bun run build.server
fi
