# Twyne tools

`@twyne/tools` provides two local, scriptable ways to work with a Twyne account:

- `twyne`, a CLI for authentication, folios, critiques, and citations.
- `twyne-mcp`, a stdio MCP server with exactly 10 focused tools.

Both clients use Twyne's authenticated `POST /api/integrations/v1` boundary. The access token belongs to the local user and is never sent anywhere except the configured Twyne URL.

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

The tool surface is deliberately small:

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

Successful tools return the same data as both human-readable JSON text and MCP `structuredContent`. For a quick review loop, call `twyne_get_feedback`; it returns persona notes and replies, the rubric, and suggestions together. For grounded writing, call `twyne_list_citations` before research and `twyne_upsert_citations` after using a source so its provenance remains attached to the folio.

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
