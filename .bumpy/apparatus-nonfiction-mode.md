---
twyne: patch
---

Recognize the formats writers actually type when choosing research discipline.
A Dossier reading "reported feature", "opinion column", "investigative piece",
or "book review" fell through to the general mandate instead of the nonfiction
one, so the drafts most in need of checking got the weakest instruction. Adds
an extraction eval that runs the shipped prompt against drafts with known
must-flag and must-not-flag passages, scored without a judge model.
