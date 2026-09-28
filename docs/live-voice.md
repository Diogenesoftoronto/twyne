# Live voice in Twyne

Character comments resolve their narrator before synthesis. The player shows cast names for OpenAI, Fish Audio, and browser voices; browser narration maps the cast to supported Supertonic embeddings. An explicit voice change affects the active passage, not the next character’s comment.

The voice desk opens from **Talk** in the compositor, a character note, or the narration player. It uses Not Organic’s existing `/v1/live/sessions` route with `gpt-live-1`. `/api/live` only bridges the browser’s WebSocket to the authenticated gateway; Twyne does not receive an OpenAI key. The gateway currently selects Marin for live audio, while the chosen editor supplies their role and speaking direction.

Live supports simultaneous microphone input and speech output, separate captions, mute, graceful end, and client delegation. Requests can find draft passages, search via the existing research provider, open editorial panels, and propose replacements or additions. Edits require a later spoken approval or the Apply button, check the document revision, preserve surrounding rich text, and participate in the editor’s undo history. Switching folios ends the conversation. Search refuses the research provider’s local placeholder results.

## Credit and access

Pro members and accounts with unspent Twyne welcome credit can start Live. The provider grants eligible accounts a one-time $2.50 Twyne allowance, using the same paid-history exclusions and transactional idempotency as the existing Keating allowance. The allowance is scoped to Twyne and cannot be replenished by signing in again.

Each voice session reserves up to $0.50. The gateway enforces duration from its configured rate and settles trusted final usage. Each delegated language request has a separate $0.05 maximum and uses the wallet-backed `fast` route. The UI discloses these separate limits; they are spending ceilings, not advertised model rates. Closing the microphone releases local capture immediately while the connection waits for `session.closed`. An unconfirmed final receipt is shown as such.

## Configuration and rollout

Both the Twyne server and Convex must use the same `NOTORGANIC_ISSUER` (default `https://api.notorganic.info`). Production must set `SITE_URL` to the public Twyne origin for the WebSocket origin check. Existing Not Organic assertion credentials remain server-side. The gateway must have GPT Live enabled, its rate configured, and the Twyne product authorized for `realtime:connect`, `wallet:read`, and `infer:fast`. Research uses Twyne’s existing research configuration.

The companion provider changes are in `convex/welcomeGrants.ts`, `apps/gateway/src/convex-store.ts`, and `apps/gateway/src/live.ts`. The Live policy accepts delegated replies only for IDs observed from the upstream session; it still rejects Responses delegation, arbitrary model changes, storage, and client-supplied usage. Deploy those provider changes and Twyne’s `convex/liveVoice.ts` before exposing the frontend.

Provider processing/content-logging consent is recorded by Not Organic. Twyne keeps captions only in session memory and does not save microphone recordings. Pending work is abandoned when the session closes; paid requests already dispatched may still settle.

Protocol references: [GPT Live sessions](https://developers.openai.com/api/docs/guides/live-conversations), [client delegation](https://developers.openai.com/api/docs/guides/live-delegation).

Deterministic checks cover character selection, credit eligibility, relay handshake restrictions, revision-safe edits, one-time grants, delegated reply IDs, and provider settlement after disconnect. A real microphone conversation, actual wallet debit, and production deployment must still be verified separately.
