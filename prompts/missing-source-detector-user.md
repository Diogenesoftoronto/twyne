---
notes: |
  Missing-source detector user body. `existingBlock` carries the
  "Already-cited sources…" sentence or "No sources have been cited yet."
version: "1"
---

DETECT MISSING CITATIONS in this draft.

{existingBlock}

Draft:
"""
{draftExcerpt}
"""

Identify up to 5 claims that need citations. For each:
1. The exact claim text (quote it)
2. Why it needs a source
3. A suggested search query to find a source

Respond with JSON only:
{"claims": [{"claim": "<quoted claim>", "reason": "<why it needs citation>", "suggestedQuery": "<search query>"}]}
