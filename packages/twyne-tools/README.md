# Twyne tools

`@twyne/tools` provides two local, scriptable ways to work with a Twyne account:

- `twyne`, a CLI for authentication, folios, critiques, citations, and model-backed editorial work.
- `twyne-mcp`, a stdio MCP server with exactly 15 focused tools.

Both clients use Twyne's authenticated `POST /api/integrations/v1` boundary. The access token belongs to the local user and is never sent anywhere except the configured Twyne URL.

The package also exposes local Codex and Anthropic SDK adapters. They are
separate from Twyne account authentication: each adapter reuses the credential
owned by its provider's official CLI.

## Install and authenticate

Requires Node.js 20 or newer.

```sh
npm install --global @twyne/tools
twyne auth login --url https://YOUR-TWYNE-DEPLOYMENT
```

Paste the personal access token at the hidden prompt, pass it with `--token`, set `TWYNE_ACCESS_TOKEN`, or pipe it on stdin. Login validates the token before saving it. The saved config lives at `$XDG_CONFIG_HOME/twyne/config.json` (normally `~/.config/twyne/config.json`) and is created with mode `0600`; its directory is mode `0700`. `TWYNE_CONFIG_PATH` can select another config file.

For ephemeral environments, skip the config file:

```sh
export TWYNE_API_URL=https://YOUR-TWYNE-DEPLOYMENT
export TWYNE_ACCESS_TOKEN=twyne_pat_...
twyne auth status
```

The environment variables must be supplied together and take precedence over the config file.

## Provider SDK sign-in

Install the SDK you intend to use, then sign in through its official local CLI:

```sh
npm install @twyne/tools @openai/codex-sdk @anthropic-ai/sdk
twyne provider login codex
twyne provider login anthropic

twyne provider status codex
twyne provider status anthropic
```

Codex opens the ChatGPT sign-in flow and stores its own credential. Anthropic
delegates to `ant auth login`, which creates an Anthropic profile consumed by
the SDK. `twyne provider logout codex|anthropic` delegates sign-out to the same
official CLI. Twyne does not copy provider tokens into its own config.

```ts
import { runAnthropicTask, runCodexTask } from "@twyne/tools";

const codex = await runCodexTask("Review this repository", {
  workingDirectory: process.cwd(),
});
const claude = await runAnthropicTask("Outline this chapter", {
  profile: "default",
});
```

## CLI

```sh
# Folios
twyne folio list --json
twyne folio get FOLIO_ID
twyne folio create --name "New essay" --type draft --file opening.md
twyne folio update FOLIO_ID --file revision.html --expected-updated-at 1785780000000
twyne folio search "particular phrase" --limit 10

# Bulk exchange
twyne folio import notes.md chapter.html research.txt backup.twyne.json
twyne folio export --format archive --output all-writing.twyne.json
twyne folio export FOLIO_ID --format markdown --output essay.md

# Critiques and sources
twyne feedback get FOLIO_ID
twyne citations list --folio-id FOLIO_ID --search "author or DOI"
twyne citations upsert --folio-id FOLIO_ID --file citations.json
```

`citations.json` may contain one citation object or an array. A title is required. Supplying an existing `id` updates that citation; omitting it creates one.

### The editorial room

```sh
twyne editors list [--json]
twyne room convene (--folio ID | --file FILE | --stdin) [--editors devil,angel] [--brief FILE] [--locale xx] [--json]
twyne editor ask PERSONA (--folio ID | --file FILE | --stdin) [--instruction feedback|elaborate|riff|rewrite-suggestion] [--message TEXT] [--anchor TEXT] [--brief FILE] [--json]
twyne rewrite PERSONA (--folio ID | --file FILE | --stdin) --original TEXT [--level sentence|paragraph] [--brief FILE] [--json]
twyne grade (--folio ID | --file FILE | --stdin) [--brief FILE] [--criteria FILE] [--json]
twyne dossier check --brief FILE (--folio ID | --file FILE | --stdin) [--json]
twyne interview turn --messages FILE [--mode first-run|refine] [--brief FILE] [--starting FILE] [--json]
```

Choose exactly one draft source. HTML/HTM files are stripped to plain text with
basic entities decoded; Markdown, text, and other files are passed through
unchanged. Stdin is plain text and retains whitespace. With `--folio`, the server
loads the saved draft and its brief unless you supply a brief explicitly.

The five editors are `devil` (Mlle. Sceptique, argument), `angel` (Sœur
Encourageante, strengths), `scholar` (Professeur Athenæum, evidence), `editor`
(M. Le Stylo, line and structure), and `reader` (Le Lecteur, audience fit).
Convene the room for a full read; ask one editor for a follow-up using `--message`.
Rewrites require an `--original` passage appearing verbatim in the draft and
default to `--level sentence`. The room's `--locale` accepts `en`, `fr`, `es`,
`zh`, `hi`, or `ja`.

`--brief`, `--criteria`, and `--messages` read JSON files. Criteria are an array
of `{ "label": "Clarity", "description": "Can the reader follow the argument?" }`.
Messages are an array of `{ "author": "writer" | "interviewer", "text": "..." }`.
Interviews default to `--mode first-run`; `--brief` supplies `currentBrief`, and
`--starting` reads manuscript text (with the same HTML conversion as draft files).

Model-backed operations spend model credits and return results without writing
to the folio. `--json` prints exactly the operation's `data`, including the
`{ notes }` and `{ note }` envelopes. Without it, commands print compact readable
summaries. Success exits with code 0; errors go to stderr and exit with code 1.

The same operations are available through `TwyneClient`: `listEditors()`,
`conveneRoom(input)`, `askEditor(input)`, `suggestRewrite(input)`,
`gradeDraft(input)`, `checkDossier(input)`, and `interviewTurn(input)`. Each
accepts an optional final `AbortSignal`. Inputs and results are exported types;
optional fields are omitted when undefined, while explicit `null` is preserved.

### Auto-research

Find passages that need sources, then search for one target:

```sh
twyne research targets (--folio ID | --file FILE | --stdin) [--strategy hosted|model] [--max N] [--brief FILE] [--existing "Title A" --existing "Title B"] [--json]
twyne research sources --kind claim --anchor "Passage from the draft" --query "precise search terms" [--reason TEXT] [--max N] [--json]
twyne research sources --target target.json [--max N] [--json]
```

Targets use the same draft loading as the editorial commands, including HTML
conversion. `hosted` (the default) confirms rule-proposed candidates; `model`
extracts targets with the hosted model. Repeat `--existing` for source titles
already covered. `--max` accepts 1–12 targets or 1–10 sources. Target kinds are
`quote`, `work`, `person`, `statistic`, `claim`, and `event`; `--target` reads a
single JSON ResearchTarget instead of the kind, anchor, query, and reason flags.

Human output lists targets with their anchors, or sources in ranked order with
publisher/date when available. `--json` prints exactly the operation's `data`.
The client methods are `findResearchTargets(input, signal?)` and
`searchResearchSources(input, signal?)`. These operations return results without
saving them to a folio and are available only through the CLI and client; MCP
remains at 15 tools.

## MCP

Point any stdio MCP client at the installed binary and provide credentials through the config or environment:

```json
{
  "mcpServers": {
    "twyne": {
      "command": "twyne-mcp",
      "env": {
        "TWYNE_API_URL": "https://YOUR-TWYNE-DEPLOYMENT",
        "TWYNE_ACCESS_TOKEN": "twyne_pat_..."
      }
    }
  }
}
```

The tool surface has exactly 15 tools, grouped by purpose.

Data tools:

1. `twyne_list_folios`
2. `twyne_get_folio`
3. `twyne_create_folio`
4. `twyne_update_folio`
5. `twyne_search_folios`
6. `twyne_import_folios`
7. `twyne_export_folios`
8. `twyne_get_feedback`
9. `twyne_list_citations`
10. `twyne_upsert_citations`

Room tools:

11. `twyne_convene_room` — full read from all five editors or selected `personaIds`.
12. `twyne_ask_editor` — feedback, a follow-up, or a conversational reply from one editor.
13. `twyne_suggest_rewrite` — concrete replacement of a verbatim passage, with rationale.
14. `twyne_grade_draft` — rubric grade, per-judge scores, and optional custom criteria.
15. `twyne_interview_turn` — next dossier question or synthesized brief from interview messages.

The first four room tools require exactly one of `folioId` or `draftText`.
`twyne_suggest_rewrite` also requires `personaId`, `original`, and `level`;
`twyne_interview_turn` requires `messages` and `mode`. Room tools are read-only,
non-idempotent model calls that spend credits. `editors.list` and `dossier.check`
are available through the CLI and client only, keeping the MCP surface at 15.

Successful tools return the same data as both human-readable JSON text and MCP `structuredContent`. For a quick review loop, call `twyne_get_feedback`; it returns persona notes and replies, the rubric, and suggestions together. For grounded writing, call `twyne_list_citations` before research and `twyne_upsert_citations` after using a source so its provenance remains attached to the folio.

## Driving Twyne in tests

The CLI and MCP server work against any deployment through `TWYNE_API_URL` and
`TWYNE_ACCESS_TOKEN`, including the in-process local app started by the repo's
evals. From the repository root:

```sh
bun evals/app/local-app.ts --model mock --port 8788
# Export TWYNE_API_URL and TWYNE_ACCESS_TOKEN printed by the local app.
twyne room convene --file essay.md --json
printf 'A draft to grade.\n' | twyne grade --stdin --json
node packages/twyne-tools/dist/mcp.js
```

Build the package before spawning `dist/mcp.js`. Evals can use any stdio MCP
client and read `structuredContent`; CLI tests can parse stdout as JSON and
check the exit code. Embedded CLI tests can call `runCli(args, io)` with
`stdout`, `stderr`, `env`, and an optional `readStdin: async () => draftText`
hook. See [the app harness contract](../../docs/app-harness.md) for operation
fields, response shapes, and model modes.

## Twyne archive v2

Bulk exchange uses a JSON envelope rather than a zip file, which lets MCP clients pass it without filesystem access:

```json
{
  "format": "twyne-archive",
  "version": 2,
  "exportedAt": "2026-08-03T12:00:00.000Z",
  "folios": [
    {
      "folio": { "id": "...", "name": "Essay", "type": "draft" },
      "html": "<p>Manuscript</p>",
      "brief": {},
      "feedback": {},
      "rubric": {},
      "suggestions": [],
      "citations": []
    }
  ]
}
```

HTML, brief, and citations can be imported through the integration API. Feedback, rubric results, and suggestions are exported for reference but are read-only, so importing an archive reports them as skipped rather than pretending they were restored.

## Development

```sh
bun test
bun run check
bun run build
```
