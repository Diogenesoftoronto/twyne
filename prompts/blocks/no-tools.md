---
notes: |
  Appended to an editor's system prompt when the call offers no tools: the
  rubric judges and suggested rewrites. The editorial protocol tells editors to
  call `quote_passage` before any claim; without this, a model that follows it
  emits a tool call the request cannot accept, and the provider rejects the
  whole response.
version: "1"
---

No tools are offered for this task. Do not call `quote_passage` or any other tool. Quote the draft directly in your answer where you need to, and respond in the format the task asks for.
