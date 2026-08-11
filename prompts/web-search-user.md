---
notes: |
  Web-search user body.
version: "1"
---

Find up to {maxResults} credible sources for this writing project.

Query:
{query}

Context:
{context}

Return JSON in this exact shape:
{"results":[{"title":"...","url":"https://...","snippet":"1-2 sentence relevance summary","author":"optional","publisher":"optional","date":"optional","why":"why this source helps the draft"}]}
