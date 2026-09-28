# Local & shipped models — brief plan

Status: proposal. Measurements come from Keating's on-device ledger
(`~/Projects/keating/scripts/on-device-site`).

## Models

| Model                                     | Size                                     | Where it runs                                                                           | Job                                                       |
| ----------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `minishlab/potion-retrieval-32M` (ONNX)   | ~131 MB, 512-d, ~4 ms/batch in Keating   | **Desktop (bundled)**                                                                   | Retrieval over folios, notes, apparatus, references       |
| `minishlab/potion-multilingual-128m-onnx` | ~547 MB (model 512 MB + 35 MB tokenizer) | **Convex / server, on request**; optional desktop download                              | Multilingual retrieval, matching the multilingual replies |
| KEV-0.8B (the local Jev)                  | 0.8B params                              | **Desktop (bundled or first-run download)** via the existing `desktop/litert-server.ts` | Offline editorial review / notes                          |

Static (potion) embeddings are a lookup plus a mean, with no transformer at inference time. That is why the 32M
model is cheap enough to ship. The multilingual model is too heavy for the browser, which is why the web
calls the server for it.

## Routing

- **Desktop:** potion-32M and KEV run locally. The multilingual model is used when installed, otherwise the
  server.
- **Browser:** embeddings come from the server (multilingual). Twyne does not download 500 MB into a tab.
- **Server:** multilingual embedding as an action. Convex actions have runtime/memory limits, so it likely needs a
  small sidecar (the Railway service) that Convex calls. Verify before committing to an in-Convex ONNX runtime.
  Store vectors with a Convex `vectorIndex`.
- Keep one `EmbeddingProvider` interface (`embed(texts) → Float32Array[]`, `dimensions`, `modelId`).
  - Never mix vectors from different models in one index.
  - Key the index by `modelId`.

## Offline is degraded — say so

- Add a single "Offline mode" notice in settings and in the editor status area. It lists what changes:
  - KEV notes are shorter and less reliable than hosted Jev.
  - Search is literal-strong but weaker on paraphrase. Keating: potion-32M paraphrase MRR ≈ 0.55 vs literal 1.0.
  - Research/web features are unavailable.
- Tag every output that came from a local model, so a writer can tell offline quality apart from hosted quality.

## Paid trained models (separate from Pro)

`docs/pricing-rollout.md` already keeps custom training out of `twyne_pro_v2`, so this is a separate product:

- **Fine-tuned potion** distilled on the writer's own corpus: better paraphrase search on their material.
- **Fine-tuned KEV** on house style / editorial rubric: offline notes that sound like their editor.
- Billed per training run plus delivery. Delivery means a downloadable desktop model, or hosted.

## Waitlist + survey

- A waitlist form on the pricing page ("Trained models — join the waitlist") that stores email, plan, and one
  optional line about what they write.
  - Use a Convex table `waitlist` with the fields: `email`, `userId?`, `source`, `createdAt`, `surveySentAt?`.
- Later: send a short survey (corpus size, languages, desktop vs hosted, price anchor) to the list in one batch.
  Record `surveySentAt` so nobody is asked twice.
- Gate the form behind a feature flag, like the other pricing gates.

## Order

1. `EmbeddingProvider` + potion-32M in desktop + offline notice.
2. Server multilingual endpoint + vector index.
3. Ship KEV through `litert-server`.
4. Waitlist table + form. The survey is sent when there is something to price.
