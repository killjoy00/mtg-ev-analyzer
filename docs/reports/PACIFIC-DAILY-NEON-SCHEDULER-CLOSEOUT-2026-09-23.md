# Pacific Daily and Neon scheduler rollout closeout — 2026-09-23

## Status

Complete and live in production.

Pack One's three fixed Dailies now use the Pacific product date (`America/Los_Angeles`). Migration 0035 is applied in production, the reviewed Daily pre-generation endpoint is live, recurring Daily pre-generation is owned by Neon Function Triggers, and player-triggered Daily creation remains the fallback. GitHub Daily generation is manual-only recovery/verification.

The owner accepted the after-inactivity evidence with five valid Neon-idle-confirmed samples out of six requested. The sixth sample was not counted because the workflow correctly failed closed when the production compute did not return to `idle` within the 12-minute gate after recurring Neon maintenance had been enabled. No additional sample is required for this rollout.

## Release chain

| Step | Evidence | Result |
| --- | --- | --- |
| Pacific Daily implementation | PR #411, merged as `75c3519eb262815acb8f8901603056cbe32dc7af` | Pacific product date, idempotent generation endpoint, migration 0035, manual verifier and measurement mode |
| Development migration | Actions run 35916528116 | success |
| Development Daily release | Actions run 35917106128 | success |
| Production migration | Actions run 35918986460 | success |
| Production migration idempotency repeat | Actions run 35919598153 | success |
| Production Daily release | Actions run 35920167475 | success |
| Production OIDC Daily verifier | PR #424 / run 35920962380 | success for all three environments |
| Neon scheduler implementation | PR #423, merged as `4029202c96bebe893419efa91dd0eeea3407d285` | Neon Function Trigger ownership, exact trigger identity, rollback/recovery path |
| Scheduler-aware development deploy | Run 35924506293 | success |
| Scheduler-aware production deploy | Run 35925098968 | success; exact revision `4029202c96bebe893419efa91dd0eeea3407d285` |
| Production scheduler activation | PR #434 / run 35926957155 | success; all three reviewed triggers enabled |

The release respected the Pacific calendar cutover ordering: migration before backend deployment, development before production, and production endpoint proof before recurring scheduler activation.

## Active production schedulers

Activation run 35926957155 verified that both production function health markers served exact scheduler-aware revision `4029202c96bebe893419efa91dd0eeea3407d285` before changing trigger state. Reconciliation prepared all reviewed definitions disabled first and then enabled the full set.

| Trigger | Function/path | Schedule | Production state |
| --- | --- | --- | --- |
| `pack1-daily-primary` | `draftrunapi/internal/daily-generation` | 00:07 Pacific | enabled |
| `pack1-daily-retry` | `draftrunapi/internal/daily-generation` | 00:37 Pacific | enabled |
| `pack1-account-deletion-maintenance` | `pack1growth/internal/account-deletion-maintenance` | every 10 minutes at :09/:19/:29/:39/:49/:59 UTC | enabled |

Daily trigger cron is expressed as paired UTC hours and gated inside the handler by `America/Los_Angeles`, so exactly the Pacific 00:07/00:37 invocation performs Daily work across PST/PDT changes. Daily generation is idempotent; a retry does not reroll an existing Daily.

Manual `.github/workflows/daily-generation.yml` remains available as a break-glass verifier. Player-triggered creation remains the runtime fallback. Disabling the Neon schedulers preserves trigger definitions while stopping future scheduled runs.

## After-inactivity production measurements

Workflow run 35925826479 requested two samples each for Mixed, Powered Cube and Latest. Before every counted browser sample, the workflow polled Neon's control plane and required the production read-write compute to report `current_state: idle`. Each completed sample has a matching `neon-idle-*.json` artifact.

Artifact: `production-browser-verification`, artifact ID 10780303326, SHA-256 `d2daaf272ca0b3616becc3ab1e9230534fc62f7e1653d3c76843381626331ec9`.

| Daily | Sample | Idle confirmed (UTC) | Click → first cards | Homepage → first cards |
| --- | ---: | --- | ---: | ---: |
| Mixed | 1 | 2026-09-23 22:05:48.203 | 3.626 s | 5.986 s |
| Mixed | 2 | 2026-09-23 22:17:55.640 | 3.276 s | 5.980 s |
| Powered Cube | 1 | 2026-09-23 22:24:27.709 | 2.867 s | 4.060 s |
| Powered Cube | 2 | 2026-09-23 22:32:28.988 | 2.220 s | 3.331 s |
| Latest | 1 | 2026-09-23 22:38:12.399 | 2.596 s | 4.317 s |
| Latest | 2 | — | not counted | not counted |

The five measured browser runs all passed. The requested sixth sample never crossed the idle precondition: after Latest sample 1, the control-plane state remained `active` for the full 12-minute wait and the workflow exited with `Production Draft Run compute did not become idle before the measurement deadline (last state: active)`.

Production scheduler activation completed at approximately 22:12 UTC while this measurement suite was still running. The enabled account-deletion maintenance cadence includes 22:39 and 22:49 UTC, which is consistent with the branch remaining active during the final Latest idle window. This is an operational explanation, not a latency failure: the workflow did not count a warm/active run as a cold-start sample.

These timings are observations from the production browser verifier, not an SLO or latency guarantee.

## Final operating boundary

- Pacific date is authoritative for the three fixed Dailies and current Daily/retention calendar views.
- Existing Daily schedules remain immutable; pre-generation cannot reroll them.
- Neon Function Triggers own recurring Daily pre-generation.
- GitHub Daily generation is manual-only recovery/verification.
- Player-triggered creation remains the fallback if pre-generation is unavailable.
- Trigger requests require Neon edge-attested invocation identity and exact reviewed trigger names.
- Scheduler rollback is the reviewed `neon-schedulers` disable operation; it leaves definitions in place and stops future scheduled runs.
- No additional cold-start sample is required for this rollout by owner decision.

See [Neon scheduled maintenance](../NEON-SCHEDULERS.md) for the operating runbook.
