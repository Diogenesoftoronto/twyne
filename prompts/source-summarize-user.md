---
notes: |
  Source-summarize user body. `title`, `authorLine`, `urlLine`, `domainHint`.
version: "1"
---

SUMMARIZE THIS SOURCE for a writer's bibliography.

Title: {title}
{authorLine}
{urlLine}

Based on the title{domainSuffix}, provide:
1. A 1-2 sentence summary of what this source likely argues or covers
2. 2-3 key claims or findings (inferred from the title/context)
3. A relevance score (1-10) for academic writing

Respond with JSON only:
{"summary": "<1-2 sentences>", "keyClaims": ["<claim 1>", "<claim 2>"], "relevanceScore": <1-10>}
