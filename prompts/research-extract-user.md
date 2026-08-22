---
notes: |
  Research-extract user body. `existingBlock` switches between the
  "writer's bibliography is empty" and "Already covered…" forms.
version: "2"
---

FACT-CHECK UP TO {maxTargets} ITEMS in this draft. First sweep for quotations, then named people in context, then statistics/dates, then every other externally checkable factual claim or event. Do not stop after finding one category.

{existingBlock}

Draft:
"""
{draftExcerpt}
"""
{extra}

Return a JSON object only.
