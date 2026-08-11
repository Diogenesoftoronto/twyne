---
notes: |
  Target-fit judge user body. The four commission fields plus optional
  particulars (from answered probes) and the (already clamped) draft.
version: "1"
---

THE COMMISSION
- Format: {format}
- Audience: {audience}
- Goal: {goal}
- Success signal: {successSignal}

{particulars}

DRAFT:
{draftText}

JUDGE TASK: Give an integer score from 1 to 10 for how well this content serves that specific audience and goal, in that format. Ignore how well it is written.

1  = a competent piece about something else entirely, or aimed at a different reader.
4  = adjacent to the commission; a reader would recognise the territory but not get what was promised.
7  = squarely on the commission, with some drift or unserved corners.
10 = every section is doing the commissioned job for the commissioned reader.

Respond as JSON, and only JSON, in this exact shape:
{"score": <integer 1-10>, "rationale": "<one sentence naming what the draft is actually about versus what was commissioned>"}
