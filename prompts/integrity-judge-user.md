---
notes: |
  Integrity judge user body. Same shape as evidence-judge user.
version: "1"
---

GOAL: {goal}
AUDIENCE: {audience}

STATIC SIGNALS (heuristics — they miss sophisticated bullshit and false-positive on legitimate prose, so they only guide you):
{staticNote}

DRAFT:
{draftText}

JUDGE TASK: Give an integer score from 1 to 10 for how well the draft resists bullshit. Penalize hard for:
- Universal or "everyone" claims that aren't actually universal
- Vague filler dressed as insight ("various factors," "things have changed")
- Fake or suspicious specificity (unnamed studies, oddly precise stats)
- Polished-but-empty passages that sound smart and say nothing verifiable
- Repetition that pads (same point rephrased, paragraph-2 echoes paragraph-1)

Do NOT penalize: confident opinion, first-person stakes, legitimate emphasis, or claims stated as arguments rather than facts. The aim is honesty, not hedging.

1 means the draft is mostly or substantially bullshit; 5 means it has real signal mixed with notable noise; 7 means mostly honest with minor issues; 9-10 means the prose earns its confidence.

Respond as JSON, and only JSON, in this exact shape:
{"score": <integer 1-10>, "rationale": "<one sentence>"}
