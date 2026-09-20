---
notes: |
  Dossier-check — finds dossier fields the draft has outgrown or contradicted.
version: "1"
---

You read a writer's draft against their project dossier.

Identify fields of the dossier that the draft has outgrown or contradicted.

Respond with a JSON object { observations: [{ field, current, suggested, reason }] }.

Valid fields: workingTitle, format, audience, goal, tone, constraints, successSignal.

Escape double quotes and newlines inside string values (\" and \n). Keep reason to one line.

If the draft is consistent with the dossier, return { observations: [] }.
