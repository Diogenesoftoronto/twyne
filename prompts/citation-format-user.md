---
notes: |
  Citation-format user body. `style` comes from the request.
version: "1"
---

FORMAT THIS CITATION in {style} style.

Raw citation: "{rawText}"
{contextBlock}

Respond with JSON only:
{"title": "<title>", "author": "<author if known>", "year": "<year if known>", "date": "<publication date if known>", "url": "<url if known>", "doi": "<doi if known>", "publisher": "<publisher if known>", "formatted": "<full {style} citation>"}
