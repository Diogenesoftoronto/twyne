---
notes: |
  Appended to the editor's user prompt for a suggested rewrite, on the hosted
  path (convex/agents.ts suggestRewrite) and the bring-your-own-key path
  (src/utils/ai-client.ts runClientRewrite), so both ask for the same thing.
  {sizeRule} is the sentence/paragraph length rule; {original} is the passage.
  The fact rule exists because evals caught rewrites that "simplified" a term
  of art away or dropped the place a claim was about.
version: "2"
---

REWRITE TASK: Rewrite the PASSAGE below in your voice, preserving its meaning but doing the work better. {sizeRule}

Keep every name, number, date, place and term of art the passage contains unless the rewrite's purpose is to correct one; the writer's facts are not yours to drop. If a technical term is the problem, keep the term and explain it in plain words rather than replacing it.

Respond as JSON only, no prose: {"replacement": "<rewritten passage as plain text>", "rationale": "<one sentence, in your voice>"}

PASSAGE:
"{original}"
