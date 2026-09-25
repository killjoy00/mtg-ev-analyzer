# NAT baseline — 2026-09-25

[Workflow 36172031922](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36172031922)
ran the reviewed cache-enabled Functions behind the actual private Cloudflare
gateway, with one real runner egress address. Head:
`d07aeebe687a0cdf2e22851ec3d555d178849ae6`. The workflow removed the preview route
and deleted its production-sized disposable Neon clone after measurement.

The declared first stage had 25 scheduled players, a 15-second arrival ramp and
3–8-second think times. The eleventh new guest hit the independent 10/10-minute
session bucket (429, Retry-After 589 seconds). The harness stopped at 19 started
actors and 97 requests; no full run completed. It correctly did not escalate.
This is a failed capacity gate, not a claim that a 25-player launch is supported.

Before the stop, start p95 was 715 ms, view p95 314 ms, pick p95 337 ms and
reroll p95 1,799 ms. These small samples were within the predeclared budgets;
no downstream capacity conclusion follows from an ingress-limited run.

The clone contained 1,000 fixture accounts with entitlements and 90,000 added
score-history rows. Standings plans and timings are retained separately. The
request report contains route families/status/timings only, with no credentials
or player/run/network identifiers. This is NAT evidence, not distributed load.
