# Neon scheduled maintenance

Prepared 2026-09-23. Neon Function Triggers own recurring Pack One backend maintenance after the scheduler release is explicitly enabled. Merging scheduler-aware code does not create or enable a trigger.

## Production triggers

All triggers belong to Neon project `patient-shadow-91417882`, production branch `br-orange-feather-ayps8kep`. Child branches inherit trigger definitions disabled, so previews do not duplicate production schedules.

| Trigger | Function | Path | UTC cron | Purpose |
| --- | --- | --- | --- | --- |
| `pack1-daily-primary` | `draftrunapi` | `/internal/daily-generation` | `7 7,8 * * *` | Generate all three Dailies at 00:07 Pacific |
| `pack1-daily-retry` | `draftrunapi` | `/internal/daily-generation` | `37 7,8 * * *` | Idempotent retry at 00:37 Pacific |
| `pack1-account-deletion-maintenance` | `pack1growth` | `/internal/account-deletion-maintenance` | `9,19,29,39,49,59 * * * *` | Resume bounded deletion work and sweep expired verification state |

Neon cron is UTC. The Daily triggers therefore fire at both candidate UTC hours for PST/PDT. The handler converts the trigger's `data.scheduled_at` to `America/Los_Angeles` and performs work only when the resulting local time is exactly 00:07 or 00:37 for the matching named trigger. The other DST-side invocation exits successfully without touching Daily state. Daily schedule creation remains idempotent and player-triggered creation remains the fallback.

Trigger-only requests require Neon's `X-Neon-Trigger-Invocation-Id` edge-attested header, the matching body invocation ID, a schedule trigger envelope, and the exact expected trigger name. Ordinary callers cannot synthesize the `X-Neon-*` header through Neon's public edge.

## GitHub recovery boundary

`.github/workflows/daily-generation.yml` remains manual-only and keeps its exact GitHub OIDC identity as a break-glass verifier. Scheduled GitHub OIDC identities are no longer accepted for Daily generation.

`.github/workflows/account-deletion-maintenance.yml` remains both manual and scheduled, but its scheduled path is read-only. Every ten minutes, five minutes after the Neon maintenance cadence, it calls `/internal/account-deletion-maintenance-status` only to surface stuck or operator-review deletion work in Actions. A manual dispatch still calls the mutating maintenance endpoint and can recover work if the Neon trigger is disabled or unhealthy.

The public Cloudflare gateway exposes neither internal maintenance route.

## Activation and rollback

Use the reviewed rollout operation `neon-schedulers`, which dispatches `.github/workflows/neon-scheduler-release.yml`.

Enabling requires an exact current `main` SHA. The release workflow first proves that production `draftrunapi` and `pack1growth` both serve that exact release marker, then reconciles only the three named production triggers. Unrelated Neon triggers are left untouched. A same-name inherited trigger is refused rather than silently localized.

Disable is the immediate rollback: it preserves each definition but stops future scheduled runs. GitHub manual recovery remains available. A trigger already queued for the imminent minute can still fire, so all mutating handlers remain idempotent or bounded.

Do not enable these triggers until the Pacific Daily migration, exact-SHA production function deployment, and production Daily-generation verification have all completed successfully.
