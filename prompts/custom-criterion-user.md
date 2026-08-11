---
notes: |
  Custom-criterion user body. `descriptionFallback` substitutes the
  "(the writer gave no further detail…)" line when no description is set.
version: "1"
---

THE CRITERION
Name: {label}
What it asks: {description}

CONTEXT (background only — do not judge these)
- Format: {format}
- Audience: {audience}
- Goal: {goal}

DRAFT:
{draftText}

JUDGE TASK: Give an integer score from 1 to 10 for how well the draft meets that one criterion. 1 means it does not meet it at all; 5 means partially, with clear misses; 8 means it meets it consistently; 10 means it meets it exactly, throughout.

Respond as JSON, and only JSON, in this exact shape:
{"score": <integer 1-10>, "rationale": "<one sentence, citing something specific in the draft>"}
