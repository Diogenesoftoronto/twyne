---
notes: |
  Sufficiency judge user body — does the draft develop enough material?
version: "1"
---

GOAL: {goal}
AUDIENCE: {audience}

DRAFT:
{draftText}

JUDGE TASK: Give an integer score from 1 to 10 for whether the draft develops enough on-topic material to justify reaching its stated goal. 1 means mostly assertion, filler, or off-topic drift; 10 means the development fully earns the goal. Most first drafts land 3-6.

Respond as JSON, and only JSON, in this exact shape:
{"score": <integer 1-10>, "rationale": "<one sentence>"}
