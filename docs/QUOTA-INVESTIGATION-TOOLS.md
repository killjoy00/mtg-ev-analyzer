# Private quota investigation tools

The one-shot quota stage workflow is read-only. It queries the existing gateway
and writes its report to the approved private operations bucket. Workflow logs
contain only a completion or failure category. It has no schedule and does not
replace launch monitoring or the #596 coverage watermark.

The workflow uses the existing `CLOUDFLARE_EDGE_TOKEN` for observability and
`CLOUDFLARE_PRIVATE_REPORT_TOKEN` for storage. It requires reviewed main and a
valid run identity, and reuses the existing protected private-report environment.
Failures expose only an allowlisted stage or HTTP status, without provider bodies.
Managed public bucket access must be disabled, custom domains
must be empty, and every saved report must pass exact readback verification.
There is no public artifact or log fallback when private storage is unavailable.

The default current window remains settled and bounded. Expired default history
is explicitly skipped rather than preventing current collection. Trusted callers
can provide both `PACK1_QUOTA_FORENSICS_FROM` and `PACK1_QUOTA_FORENSICS_TO` as
canonical UTC timestamps, within the collector's conservative retention bound,
at least two minutes old and at most 35 minutes apart.

A short query page is not sufficient coverage evidence. The collector requires
query level 1, splits coarser partitions, discards their partial rows, checks
pagination cycles, deduplicates event identities and caps requests and rows.
Event identity includes the application event, random trace and attempt when
available: concurrent records may share a provider ID and timestamp. Gateway
parsing hashes this composite identity and never copies its trace into summaries.
Conflicting payloads with the same full identity still fail closed.
Unresolved or unavailable sampling information fails closed. Even verified query
partitions cannot prove that the provider retained every event. Missing handler
records or backend acknowledgement do not prove nonexecution. Gateway residual
time includes queueing, transport and acknowledgement; it is not pure network
latency. Separate aggregate provider counts from individual correlated requests.

Launch monitoring uses the same verified query collector before advancing its
existing coverage watermark. Unresolved query coverage follows the existing
telemetry-failure alert and recovery path. Alert thresholds, schedules, incident
routing and the identity and contents of the coverage issue are unchanged.

`scripts/review-quota-confirmation.mjs INPUT_JSON PRIVATE_OUTPUT_JSON` reviews a
retained same-actor crossover report offline. It rechecks the original gate and
explains each failed cohort criterion. A strict p95 tie is distinguished from a
measured regression. Control spread cannot waive either, and no probe calls,
production activation or threshold changes result from a review. Input and
output contain detailed synthetic results and should be retained privately.

The retained confirmation quantiles cannot identify which requests were refills,
memory-credit admissions or transport outliers. They cannot establish the cause
of individual tail regressions. Counter-write decisions are not total billed
operations or verified production cost savings. The original latency acceptance
and subsequent correctness/gameplay gates remain required.
