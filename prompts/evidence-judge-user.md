---
notes: |
  Evidence judge user body. `goal`, `audience`, `staticNote`, `draftText`
  are all set by `buildEvidenceJudgePrompt` at call time.
version: "1"
---

GOAL: {goal}
AUDIENCE: {audience}

STATIC SIGNALS (these are heuristics, not the verdict — they may miss padded or missing claims):
{staticNote}

DRAFT:
{draftText}

JUDGE TASK: Give an integer score from 1 to 10 for whether the draft's evidence actually supports the load-bearing claims for this audience and goal. Consider:
- Does each named citation/study/example say what the draft claims it says, or is it vaguely invoked?
- Are claims that need evidence actually attached to evidence, vs asserted with confidence?
- Are there gaps where evidence is needed but missing entirely?
- Is there citation-stuffing (many marks, no actual support)?

1 means mostly unsourced assertion or fake/padded citations; 5 means partial support with notable gaps; 7 means claims are grounded where it matters; 9-10 means evidence genuinely carries the argument. Most first drafts land 3-6.

Respond as JSON, and only JSON, in this exact shape:
{"score": <integer 1-10>, "rationale": "<one sentence>"}
