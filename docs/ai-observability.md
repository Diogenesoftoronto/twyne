# Twyne AI observability contract

This is the application-side contract for PostHog AI Observability, Arize
tracing, contextual feedback, and the human review queue. It intentionally
keeps manuscript content out of telemetry by default.

## Generation contract

Every generation should emit a `$ai_generation` event with:

- `$ai_trace_id`: stable for the complete generation, including retries;
- `$ai_session_id`: the browser PostHog session when available;
- `$ai_provider`, `$ai_model`, `$ai_input_tokens`, and `$ai_output_tokens`;
- `twyne_folio_id` and `twyne_editorial_action_id` when the request is tied to a
  folio action;
- `twyne_eval_*` properties from deterministic checks.

Authenticated server generations use `identity.tokenIdentifier` as
`distinct_id`. The caller cannot provide or override that identity. Browser
generations attach the current distinct, anonymous, and session identifiers as
correlation properties.

The same trace handle is returned on agent responses and persisted on persona
notes. Feedback therefore attaches to the exact generation rather than to a
persona or folio in the abstract.

## Privacy boundary

The default content mode is `redacted`. In this mode PostHog and Arize receive
roles, sizes, usage, latency, and `[redacted]` placeholders, not manuscript
text or transcripts. Full content is capped at 6,000 characters and requires
an explicit, reviewed setting:

```bash
POSTHOG_AI_CONTENT_MODE=full
ARIZE_CAPTURE_CONTENT=true
```

Those settings are for a controlled sample only. Do not enable them for broad
production evaluation access without confirming retention, reviewer access,
and the manuscript privacy policy.

Audio telemetry records byte count and media type, never audio bytes. Direct
audio, Fish Audio, and multipart transcription paths all emit a
`voice-transcription` generation event.

## Deterministic checks

These are guardrails, not quality claims or LLM judges:

- `json_score_rationale`: object shape plus integer score from 1 through 10;
- `json_rewrite`: non-empty `replacement`;
- `json_dossier_observations`: `observations` array;
- `json_criteria`: `criteria` array;
- required or any protocol markers;
- required source integrity: no `javascript:` URLs and at least one URL or
  bracket citation.

The result is `pass`, `fail`, or `not_applicable` and is versioned with
`twyne_eval_version`. Subjective grounding/helpfulness evaluation remains a
separate judge and must not be inferred from these properties.

Create one PostHog code-based evaluation for each property below. Enable
`allows_na` so generations without that contract return N/A rather than being
counted as failures:

```hog
// structured_output_contract
if (properties.twyne_eval_structured_output_valid == null) {
  return null
}
return properties.twyne_eval_structured_output_valid == true
```

```hog
// score_range
if (properties.twyne_eval_score_range_valid == null) {
  return null
}
return properties.twyne_eval_score_range_valid == true
```

```hog
// protocol_adherence
if (properties.twyne_eval_protocol_valid == null) {
  return null
}
return properties.twyne_eval_protocol_valid == true
```

```hog
// citation_source_integrity
if (properties.twyne_eval_citation_integrity_valid == null) {
  return null
}
return properties.twyne_eval_citation_integrity_valid == true
```

## Feedback and review queue

Persona notes show compact helpful / needs-work controls when a trace handle is
available. A negative vote can be classified as grounding, usefulness, tone,
incorrect, too long, or other. The browser sends a PostHog `survey sent` event
with `$ai_trace_id`; signed-in users also create an `aiFeedback` row with
`reviewStatus: "pending"`. The queue is internal-only until an authenticated
reviewer surface is implemented.

The milestone survey integration is deliberately gated by
`PUBLIC_POSTHOG_PROGRESS_SURVEY_NAME`. It is checked only after
`dossier_completed` or `draft_exported`, so a missing or unrelated PostHog
survey cannot interrupt early writing.

## Live PostHog setup checklist

The code does not create or silently select dashboard objects. In the live
project, configure these explicitly:

1. Enable AI Observability and create one feedback survey per logical trace
   group, using `$ai_trace_id` in the implementation instructions.
2. Create code-based evaluations for `structured_output_contract`,
   `score_range`, `protocol_adherence`, and `citation_source_integrity`, using
   the `twyne_eval_*` properties.
3. Create sampled LLM-as-judge evaluations for grounding and helpfulness only
   after an approved content-access policy and a reviewed production sample.
4. Set the exact progress survey name in
   `PUBLIC_POSTHOG_PROGRESS_SURVEY_NAME` after the survey exists.
5. Monitor the funnel:

   `AI requested → generation succeeded → eval passed → user marked helpful → revision/export completed → user returned`

Arize credentials and evaluator/task status still require live verification;
the repository checks only the export and redaction contract.
