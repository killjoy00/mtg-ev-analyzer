# Reviewed releases and private diagnostics

The secure-auth release uses `scripts/apply-release-migrations.mjs` and the
`secure-auth-release` plan in `migrations/manifest.json`. Historical SQL is
immutable. A release applies only entries missing from `pack1_applied_migrations`.
The ledger records SHA-256 identities, state and whether application was executed
or established by the reviewed baseline.

## Baseline and recovery

`migrations/baseline.json` freezes historical file identities and a schema-only
contract for the already-upgraded database. It does not claim every historical
migration was applied: only the secure release's historical plan is baselined.
Columns (including nullability/defaults), constraints, valid indexes, functions,
views and triggers are checked before inserting baseline records atomically.
Any unexpected trigger blocks baselining. No application rows or identities are
stored in the contract.

The contract was compared with both current release environments and a fixture
built from the complete immutable migration history. Legacy compatibility-table
shells and retired-environment allowlists are outside this plan's contract; those
old retirement migrations are not marked applied. PostgreSQL's version-specific
named not-null constraints are omitted because column nullability is checked
directly. Explicit alternative fingerprints admit only reviewed historical
serving definitions that 0067 repairs. The removal-aware comparison from 0066
is retained. Baseline drift fails closed; do not regenerate fingerprints from
an unknown database merely to make a release pass.

A session advisory lock serializes runners. Transactional migration DDL and its
ledger entry commit together. An atomic PostgreSQL execution block prevents
embedded transaction control from splitting that commit. New psql meta-commands
(including external script includes) are rejected. Concurrent-index migrations record `running`
before execution. Failure records `failed`; an interrupted or failed entry blocks
later release attempts. Review the database privately, repair or roll back the
specific incomplete operation, validate its schema and identity, then explicitly
repair its ledger entry. Never blindly delete failed records or mark them applied.
Future nontransactional files must be self-contained; included mutable scripts
require a reviewed identity mechanism. Existing included maintenance SQL is
already covered by the verified historical baseline and is not replayed.

The PostgreSQL gate runs the actual release plan twice, tests simultaneous
runners and failures, checks serving invalidation and preserves saved-history
digests. Production warmup, schema validation and readiness gates remain enabled.

## Private request diagnostics

The gateway generates a random trace, overwrites caller-supplied traces and sends
it to NetworkQuota and the backend. Records contain allowlisted route/reason codes,
bounded timings and failure flags. They contain no IP, quota key, credentials,
raw account/session identifiers or response bodies. Anonymous object tags use a
domain-separated daily HMAC; they do not change the quota object's identity.

Use the existing private Workers observability destination, with no public tail
consumer. Join quota records by trace and provider Durable Object metadata.
Provider object analytics supply object location; `ingress_colo` describes ingress
only. The gateway's residual quota time includes transport, queueing and output
gate acknowledgement, so it cannot alone identify network latency. Handler
transaction/get/put/alarm timings and concurrency distinguish other stages.
Start records can survive a reset that prevents a completion record.

The shared five-second quota deadline, denial handling and fresh-stub retry rules
remain enforced. Timeout, abort and overload never trigger a retry. A retryable
stub failure may conservatively overcount a committed debit. Backend session
creation is never retried after an ambiguous response. Backend reason headers
remain internal to the gateway; only allowlisted codes enter diagnostics.

Summaries for public monitoring remain sanitized. This instrumentation does not
change the monitoring watermark, alert thresholds or scheduled triggers.

## Compute history

`scripts/neon-compute-history.mjs` is a read-only collector for the v2 project and
branch consumption-history endpoints with `metrics=compute_unit_seconds`. Run
only in trusted infrastructure with the existing approved `NEON_API_KEY` and an
absolute private output path outside public artifacts:

```sh
node scripts/neon-compute-history.mjs FROM_UTC TO_UTC daily /private/history.json /private/ownership.json
```

Output is created exclusively with mode 0600; stdout contains no usage details.
The reviewed `private compute history` workflow runs only from main in the
existing protected environment, on manual dispatch or a merged request change.
It uses the existing approved credentials and `scripts/private-compute-report.mjs`
to write into the private operations bucket. It verifies that r2.dev access is
disabled and no custom domains exist, rechecks before the write, then verifies
the saved bytes by SHA-256 readback. There is no public artifact or usage output,
and no new schedule. Each run/attempt has its own object. Credentials are never
copied into reports. A missing capability or validation failure remains explicit;
raw usage pages needed to diagnose schema/coverage failures stay private.

Default collection covers completed UTC days this month and the latest 167
complete UTC hours, leaving room inside the hourly retention boundary. Live and
recoverable deleted branch metadata are retained privately as inventory evidence;
names alone do not establish CI ownership. Exact reviewed ownership receipts may
be supplied through the private `compute-history/ownership.json` object. No
project-minus-branch difference is assigned to CI. A successful collection and
readback do not prove complete attribution or settled billing.

The existing egress-evidence schedule also writes privately through
`scripts/private-egress-report.mjs`. A verified immutable run copy precedes the
private latest-observation pointer used for counter comparisons. The first
private observation starts a new comparison baseline; missing history is never
zero usage. Its schedule and alert routing are unchanged, and PRs run only the
offline regressions without live credentials. Detailed reports are no longer
printed or uploaded as public workflow artifacts. This does not erase older
published evidence or move the launch-monitoring coverage watermark.
Hourly windows must fit the provider's 168-hour retention; daily windows fit
60 days. Windows are UTC-aligned and never silently shortened. Pagination loops,
conflicting frames, overlaps and invalid metrics fail. Missing metrics are not
zero. Reconciliation requires matching billing identities, plans and windows;
unmatched data and impossible negative differences remain unreconciled.

Ownership input is an array of exact `project_id`, `branch_id`, `owner`,
`evidence_type` and private `evidence_ref` records. Supported evidence types are
`creation_receipt`, `deletion_receipt` and `workflow_receipt`; owners are `CI`,
`investigation` and `other`. Retained evidence must actually establish ownership.
Conflicting ownership stays unattributed. Project-minus-returned-branch usage is
always unattributed. All observations remain provisional until independently
reconciled with settled billing. Functions capacity-hours and invocation costs
are excluded and must be reported separately.

## Health work

Quick health remains a liveness check. Ordinary full-health calls may reuse a
process-local aggregate for up to one minute only after reading the current
serving revision. Concurrent scans are coalesced per process. A revision change
during calculation prevents caching or returning that calculation. No puzzle,
eligibility decision, saved run or Daily is served from this aggregate cache.
Release validation explicitly uses `deep=1`, which always performs the full scan.
Process-local reuse does not establish a reduction in billed compute; measure
actual scan frequency and provider consumption separately.
