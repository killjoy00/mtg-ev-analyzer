# Neon scheduled maintenance

Prepared 2026-09-23. Production activation completed 2026-09-23 through PR #434 and scheduler release run 35926957155. Neon Function Triggers now own recurring Pack One backend maintenance. Merging scheduler-aware code by itself still does not create or enable a trigger.

## Production triggers

All triggers belong to Neon project `patient-shadow-91417882`, production branch `br-orange-feather-ayps8kep`. Child branches inherit trigger definitions disabled, so previews do not duplicate production schedules.

| Trigger | Function | Path | UTC cron | Purpose |
| --- | --- | --- | --- | --- |
| `pack1-daily-primary` | `draftrunapi` | `/internal/daily-generation` | `7 7,8 * * *` | Generate all three Dailies at 00:07 Pacific |
| `pack1-daily-retry` | `draftrunapi` | `/internal/daily-generation` | `37 7,8 * * *` | Idempotent retry at 00:37 Pacific |
| `pack1-account-deletion-maintenance` | `pack1growth` | `/internal/account-deletion-maintenance` | `9,19,29,39,49,59 * * * *` | Resume bounded deletion work and sweep expired verification state |

The existing account-deletion trigger is also the independent stale signal for production launch monitoring. After its deletion/sweep work completes, the Neon-scheduled invocation reads sanitized launch coverage state from public issue #596. Coverage more than 30 minutes behind the trigger's edge-attested `scheduled_at`, or inaccessible/invalid state, emits `launch_watcher_stale` and returns 503 for that trigger run. Manual GitHub deletion-maintenance recovery skips this check. No additional trigger, GitHub credential, gameplay request, IP/player identity or quota secret is involved.

Neon cron is UTC. The Daily triggers therefore fire at both candidate UTC hours for PST/PDT. The handler converts the trigger's `data.scheduled_at` to `America/Los_Angeles` and performs work only when the resulting local time is exactly 00:07 or 00:37 for the matching named trigger. The other DST-side invocation exits successfully without touching Daily state. Daily schedule creation remains idempotent and player-triggered creation remains the fallback.

Trigger-only requests require Neon's `X-Neon-Trigger-Invocation-Id` edge-attested header, the matching body invocation ID, a schedule trigger envelope, and the exact expected trigger name. Ordinary callers cannot synthesize the `X-Neon-*` header through Neon's public edge.

## GitHub recovery boundary

`.github/workflows/daily-generation.yml` remains manual-only and keeps its exact GitHub OIDC identity as a break-glass verifier. Scheduled GitHub OIDC identities are no longer accepted for Daily generation.

`.github/workflows/account-deletion-maintenance.yml` is manual-only recovery. It calls the mutating maintenance endpoint only when explicitly dispatched and can recover work if the Neon trigger is disabled or unhealthy. GitHub no longer polls the read-only maintenance-status endpoint on a schedule, so recurring production database wakeups belong only to Neon-owned maintenance.

The public Cloudflare gateway exposes neither internal maintenance route.

## Activation and rollback

Use the reviewed rollout operation `neon-schedulers`, which dispatches `.github/workflows/neon-scheduler-release.yml`.

Enabling requires the exact deployed SHA. The release workflow proves that SHA is a reviewed ancestor of current `main`, contains the scheduler-aware handlers/reconciler, and is the exact release marker served by production `draftrunapi` and `pack1growth`; this deliberately permits the reviewed activation-request commit itself to advance `main`. It then reconciles only the three named production triggers. Unrelated Neon triggers are left untouched. A same-name inherited trigger is refused rather than silently localized.

Disable is the immediate rollback: it preserves each definition but stops future scheduled runs. GitHub manual recovery remains available. A trigger already queued for the imminent minute can still fire, so all mutating handlers remain idempotent or bounded.

Production activation completed only after the Pacific Daily migration, exact-SHA production function deployment, and production Daily-generation verification had all completed successfully. The enabled production functions serve exact scheduler-aware revision `4029202c96bebe893419efa91dd0eeea3407d285`.

For future re-enables after a backend change, preserve the same boundary: first prove the reviewed scheduler-aware revision is live in both production functions, then run the reviewed `neon-schedulers` enable operation. The September 23 rollout and after-inactivity evidence are recorded in [the rollout closeout](reports/PACIFIC-DAILY-NEON-SCHEDULER-CLOSEOUT-2026-09-23.md).
