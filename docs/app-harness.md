# App harness: AI operations over the integration API, CLI and MCP

Twyne's model-backed features (the room of editors, rewrites, the rubric, the
dossier check and the dossier interview) are reachable from outside the
browser through the same authenticated boundary the folio tools already use:
`POST /api/integrations/v1` with a personal access token. The `twyne` CLI and
the `twyne-mcp` server in `packages/twyne-tools` expose them, and the app evals
in `evals/app/` drive them through MCP, so an eval exercises the production
path rather than a replay of its prompts.

```
eval runner ──MCP──▶ twyne-mcp tools ──TwyneClient──▶ /api/integrations/v1
                                                       │  (PAT → owner)
                                                       ▼
                                 internal actions in convex/ (same code the
                                 browser's api.agents.* actions run)
                                                       │
                                                       ▼
                                 hosted provider: Not Organic, or the legacy
                                 OpenAI-compatible route (RIVET_ENDPOINT)
```

## Operations

Every request is `{ "operation": "<name>", ...fields }` and every success is
`{ "ok": true, "data": ... }`, exactly like the folio operations. Failures are
`{ "ok": false, "error": "..." }` with the same public-error filtering.

Shared field types:

- `draftText: string` — the manuscript as plain text.
- `folioId: string` — alternative to `draftText`. The server loads the
  owner's folio, converts its HTML to plain text, and uses the folio's brief
  when `brief` is not supplied. Supplying neither is a 400.
- `brief: ProjectBrief | null` — the dossier (`convex/agents.ts`
  `projectBriefValidator`). Optional everywhere except `dossier.check`.
- `responseLocale: "en" | "fr" | "es" | "zh" | "hi" | "ja"` — optional.
- `writerProfile` — optional, `writerProfileValidator` shape.
- `personaId` — one of the built-in editors in `src/utils/personas.ts`:
  `devil`, `angel`, `scholar`, `editor`, `reader`.

`EditorNote`:

```ts
{
  personaId: string;
  personaName: string;
  text: string;
  type: "critique" | "suggestion" | "encouragement" | "perspective";
  provider: string;          // "local" means the hosted model was not used
  anchor?: string;           // verbatim passage pinned by quote_passage
  anchors?: string[];
  extractions?: unknown[];
  traceId?: string;
}
```

| operation         | fields                                                                                                                                                                                                  | `data`                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `editors.list`    | —                                                                                                                                                                                                       | `Array<{ id, name, role, description, focus }>`       |
| `room.convene`    | `draftText`\|`folioId`, `brief?`, `personaIds?` (default: all five), `writerProfile?`, `responseLocale?`, `newMaterial?`, `trajectory?`                                                                 | `{ notes: EditorNote[], withheld: string[] }`         |
| `editor.ask`      | `personaId`, `draftText`\|`folioId`, `brief?`, `instruction?` (`feedback`\|`elaborate`\|`riff`\|`rewrite-suggestion`), `userMessage?`, `priorMessages?`, `anchor?`, `writerProfile?`, `responseLocale?` | `{ note: EditorNote }`                                |
| `rewrite.suggest` | `personaId`, `draftText`\|`folioId`, `original`, `level` (`sentence`\|`paragraph`), `brief?`, `writerProfile?`, `responseLocale?`                                                                       | `{ replacement, rationale, provider }`                |
| `rubric.grade`    | `draftText`\|`folioId`, `brief?`, `criteria?: Array<{ label, description }>`, `responseLocale?`                                                                                                         | `RubricGrade` (below)                                 |
| `dossier.check`   | `brief`, `draftText`\|`folioId`, `responseLocale?`                                                                                                                                                      | `{ observations, provider }`                          |
| `interview.turn`  | `messages: Array<{ author: "writer"\|"interviewer", text }>`, `mode` (`first-run`\|`refine`), `currentBrief?`, `startingMaterial?`, `responseLocale?`                                                   | `InterviewTurnResult` (as `runInterviewTurn` returns) |

`RubricGrade` mirrors what the rubric panel computes on its hosted path:

```ts
{
  grade: string;            // letter grade from combineJudgesAndStatic
  combined: number;
  judgeMean: number;
  minJudge: number;
  staticTotal: number;
  staticFeedback: string[];
  judges: Array<{ personaId: string; score: number; rationale: string; provider: string }>;
  sufficiency: { score: number; rationale: string; provider: string };
  evidence: { score: number; rationale: string; provider: string };
  integrity: { score: number; rationale: string; provider: string };
  targetFit: { score: number; rationale: string; provider: string };
  custom: Array<{ label: string; score: number; rationale: string; provider: string }>;
  review: { text: string; provider: string } | null;
  unjudged: string[];       // editors absent from `judges`: both asks of the model came back empty
}
```

`room.convene` releases each editor's note only if the editorial review
(System One) passes it, as in the browser. An editor whose note is still
vetoed after its repairs is left out and named in `withheld`; the call fails
only when no editor's note is released.

Model-backed operations apply the same per-owner rate limits as the browser
actions (room convene 6 a minute, feedback and rewrites 30 a minute); a refusal
is a 429. Results are returned, not written to the folio.

Errors follow the folio operations, with two additions. An application error
raised by the feature itself carries its code, `{ "ok": false, "error": "...",
"code": "provider_unavailable" }`, with a matching status (401, 403, 400, 404,
409, 429, 502, 503 or 504). A request whose fields fail validation is a 400
that names the field: `Request fields must be valid for interview.turn
(currentBrief.attachments)`.

`rubric.grade` refuses drafts under 500 words with a 400, because the panel
never grades them, and answers 503 `provider_unavailable` when every judge fell
back to the local heuristic, as the panel does.

## Auto-research

Two operations expose the research pass the Apparatus runs in the background
(`src/utils/background-research.ts`): deciding which passages need a source,
and finding sources for one of them. Both run the same pure helpers the browser
does (`research-candidates.ts`, `research-targets.ts`).

`ResearchTarget` is the type in `src/types/index.ts`:
`{ id, kind: "quote"|"work"|"person"|"statistic"|"claim"|"event", anchor, reason, query, importance }`.

| operation          | fields                                                                                                                            | `data`                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `research.targets` | `draftText`\|`folioId`, `brief?`, `strategy?` (`hosted`, default, \| `model`), `maxTargets?` (1-12), `existingSources?: string[]` | `{ strategy, provider, mode, targets: ResearchTarget[], candidates? }` |
| `research.sources` | `target: { kind, anchor, query, reason? }`, `maxResults?` (1-10)                                                                  | `{ provider, results: Source[], ranked: Source[] }`                    |

- `strategy: "hosted"` is what a writer on Twyne's hosted service gets today:
  `claimCandidates` finds sentences that look checkable, System One confirms the
  ones that need a source (`candidateRequest` / `confirmedTargets`), and
  `candidates` lists what the rules proposed.
- `strategy: "model"` runs the research-extract prompts a bring-your-own-model
  writer gets (`buildResearchExtractSystemPrompt` / `buildResearchExtractUserPrompt`,
  parsed by `parseResearchTargets`) on the hosted model.
- `mode` is `dossierResearchMode(brief)`: `fiction`, `nonfiction` or `general`.
- `research.sources` searches with the deployment's research provider, using
  the browser's context (`buildResearchSearchContext`), and returns the hits in
  provider order and ranked by `rankSourcesForTarget`. With no live provider it
  answers 503 `configuration_required` rather than placeholder results.

Search providers follow `RESEARCH_PROVIDER`. `notorganic` searches through Not
Organic's metered `/v1/web/search` as the caller's linked account, so no
separate search key is needed; the others use `RESEARCH_API_KEY`.

## Running the app locally for tests and evals

`evals/app/local-app.ts` loads every module in `convex/` into one process with
`convex-test`, seeds a writer and an access token, and serves the real HTTP
router. Hosted calls go wherever the environment points them:

- `--model mock` starts a scripted OpenAI-compatible stub and sets
  `RIVET_ENDPOINT` to it, so the legacy hosted route answers from fixtures.
- `--model openai-compatible` uses `TWYNE_APP_MODEL_BASE_URL`,
  `TWYNE_APP_MODEL_API_KEY` and `TWYNE_APP_MODEL` through the same route.
- `--model notorganic` keeps the app's Not Organic routing and links the
  seeded writer to `TWYNE_EVAL_DID`.

The editorial review gate's System One judgements follow `--system-one`:
`mock` answers from the same stub, `direct` uses `TYPESAFE_API_KEY` (honoured
because the in-process app is a local deployment), and Not Organic routes them
itself.

```sh
bun evals/app/local-app.ts --model mock --port 8788
# prints TWYNE_API_URL and TWYNE_ACCESS_TOKEN for the CLI and twyne-mcp
```
