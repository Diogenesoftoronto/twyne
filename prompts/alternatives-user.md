---
notes: |
  User prompt for Alternatives. {scale} is word/phrase/sentence/passage;
  {lengthRule} is the word budget from src/utils/alternatives.ts lengthBudget;
  {lenses} lists the allowed lens ids with a one-line brief each; {exclude}
  lists wordings already on screen for a "more" round (or is empty);
  {direction} is the writer's typed direction for a steered round (or empty).
version: "2"
---

The writer locked this {scale} ({words} words) and wants alternatives for it.

BEFORE THE SPAN: {before}
SPAN: "{text}"
AFTER THE SPAN: {after}

{direction}

Write {count} replacements for the SPAN, spread across these lenses (use the lens id exactly):
{lenses}

Each replacement: {lengthRule}. It must read correctly between BEFORE and AFTER. Every line must differ from the span and from every other line.

{exclude}
