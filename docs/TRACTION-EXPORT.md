# Twyne aggregate evidence for Traction

The internal `traction:exportDay` action sends one complete UTC day's observed usage to Not Organic. A cron invokes it at 04:20 UTC for yesterday. It is disabled unless all four server-side Convex environment values are configured:

| Variable                            | Value                                                   |
| ----------------------------------- | ------------------------------------------------------- |
| `TRACTION_EXPORT_ENABLED`           | `true`                                                  |
| `NOTORGANIC_TRACTION_ORIGIN`        | HTTPS origin of the Not Organic gateway                 |
| `NOTORGANIC_TRACTION_SERVICE_ID`    | `twyne-product`                                         |
| `NOTORGANIC_TRACTION_EXPORT_SECRET` | Dedicated random signing secret, at least 32 characters |

Register a separate `convex` producer named `twyne-product`, project `twyne`, in Not Organic's server registry and configure its `exportSecretEnv` to the same private secret value. Keep the operational log producer `twyne-convex` separate. No credentials or identifiers go into browser configuration. Missing configuration performs no reads or outbound requests.

The producer reads at most 2,001 ledger rows and 2,001 writing-day rows through time/day indexes, using the first 2,000 of each. It exports only aggregate values and fixed metadata. It preserves server, provider and client-reported AI authority; actual and estimated cost are different series. Writing counts describe browser-triggered autosaves, and the distinct account count describes accounts reporting that activity. The existing writing mutation assigns its day from the server's UTC clock; the browser cannot supply that date. These are not DAU or numbers of words written. Distinct daily counts must not be summed into period-wide unique people or actions.

All exports currently have `complete:false`: hosted capture and browser synchronization have no complete-day ingestion watermark. Empty days and absent categories produce null values. Positive measurements are observed lower bounds. The internal preview/action also reports `truncated` when the read cap is exceeded; the version-one ingestion payload conveys that conservatively through `complete:false` rather than inventing an unsupported field. Increasing the cap or adding an ingestion watermark requires a separate coverage review.

`traction:dailyEvidence` is an internal read-only preview with `{date, revision, now}`. `traction:prepareExport` freezes content-free JSON bytes transactionally for `{date, revision}`. Repeating a revision reuses those exact bytes, including after a timeout or after late events arrive. A deliberate correction uses a higher revision. The gateway also rejects conflicting revisions and ignores stale ones. Export dates must be complete UTC days within 90 days. Snapshot cleanup removes up to 100 expired records during preparation; inactive producers need separate maintenance if physical removal is required immediately.

The action sends `POST /v1/traction/ingest/twyne-product/daily`, with the lowercase hexadecimal HMAC-SHA256 of the exact raw body in `x-webhook-signature`. Redirects are refused and requests time out after 15 seconds. Only HTTP 202 is acknowledged. Failed deliveries throw a redacted error; an operator can rerun `traction:exportDay` with the same date and revision. No automatic fresh revision is created for retries.

The new indexes must be deployed before enabling the producer. For a large production table, stage/backfill these indexes before enabling them and this scheduled reader. This change does not deploy Convex, configure credentials, or make live gateway requests.
