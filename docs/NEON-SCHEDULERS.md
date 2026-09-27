# Neon scheduled maintenance

Prepared 2026-09-23. Production activation completed 2026-09-23 through PR #434 and scheduler release run 35926957155. Neon Function Triggers now own recurring Pack One backend maintenance. Merging scheduler-aware code by itself still does not create or enable a trigger.

## Production triggers

All triggers belong to Neon project `patient-shadow-91417882`, production branch `br-orange-feather-ayps8kep`. Child branches inherit trigger definitions disabled, so previews do not duplicate production schedules.

| Trigger | Function | Path | UTC cron | Purpose |
| --- | --- | --- | --- | --- |
| `pack1-daily-primary` | `draftrunapi` | `/internal/daily-generation` | `7 7,8 * * *` | Generate all three Dailies at 00:07 Pacific |
| `pack1-daily-retry` | `draftrunapi` | `/internal/daily-generation` | `37 7,8 * * *` | Idempotent retry at 00:37 Pacific |
| `pack1-account-deletion-maintenance` | `pack1growth` | `/internal/account-deletion-maintenance` | `9,19,29,39,49,59 * * * *` | Resume bounded deletion work and sweep expired verification state |

The existing account-deletion trigger is also the independent stale signal for production launch monitoring. After its deletion/sweep work completes, the Neon-scheduled invocation reads sanitized launch coverage state from public issue #596. Coverage more than 30 minutes behind the trigger's edge-attested `scheduled_at`, or inaccessible/invalid state, emits `launch_watcher_stale` and returns 503 for that trigger run.

On a stale episode, production `pack1growth` can also dispatch the existing GitHub `launch-alert.yml` workflow as an authenticated root recovery. This is a recovery trigger only: GitHub Actions remains responsible for log inspection, #596 watermark advancement, serialization, replay/retention rules and the bounded #644 continuation chain. Neon persists `launch_watcher_recovery_dispatch_v1` in `settings`, uses compare-and-set claiming to prevent concurrent duplicate roots, caps an episode at three independent root attempts, retries dispatch failures after ten minutes, waits 20 minutes before retrying an accepted no-progress dispatch, and suppresses another root whenever coverage advances. The required `PACK1_LAUNCH_WATCHER_GITHUB_TOKEN` is a fine-grained token restricted to this repository with Actions write permission. It is injected only into production through the protected `pack-one-mobile-release` release boundary; development must not receive it.

The trigger separately persists `launch_watcher_operator_alert_v1` and uses the existing Pack One Resend credential plus Pack One's established product/support mailbox, `admin@packone.pro`, to send one stale notification per episode and one recovery notification. That address is Pack One's documented public support mailbox; the Auth deletion service-principal address is not treated as an alert mailbox. A pending send is retained for retry and uses a deterministic provider idempotency key; repeated stale invocations are deduplicated. If a recovery notification cannot be delivered, the otherwise-fresh trigger returns 503 so the retry remains observable. A GitHub dispatch failure does not suppress the independent Neon stale signal or operator email. Manual GitHub deletion-maintenance recovery skips this check. No additional Neon trigger, gameplay request, IP/player identity or quota secret is involved.

Neon cron is UTC. The Daily triggers therefore fire at both candidate UTC hours for PST/PDT. The handler converts the trigger's `data.scheduled_at` to `America/Los_Angeles` and performs work only when the resulting local time is exactly 00:07 or 00:37 for the matching named trigger. The other DST-side invocation exits successfully without touching Daily state. Daily schedule creation remains idempotent and player-triggered creation remains the fallback.

Trigger-only requests require Neon's `X-Neon-Trigger-Invocation-Id` edge-attested header, the matching body invocation ID, a schedule trigger envelope, and the exact expected trigger name. Ordinary callers cannot synthesize the `X-Neon-*` header through Neon's public edge.

## GitHub recovery boundary

The launch-monitoring boundary is intentionally different from Daily generation: `launch-alert.yml` still requests a five-minute GitHub schedule, but the independent Neon trigger is the backstop when GitHub does not materialize scheduled roots on time. Its production-only token may start only the already-reviewed launch-alert workflow; it is not a general repository administration credential. Rotate that token in the protected environment and redeploy through `secure-auth-release.yml` so development/prod smoke re-proves the boundary.

`.github/workflows/daily-generation.yml` remains manual-only and keeps its exact GitHub OIDC identity as a break-glass verifier. Scheduled GitHub OIDC identities are no longer accepted for Daily generation.

`.github/workflows/account-deletion-maintenance.yml` is manual-only recovery. It calls the mutating maintenance endpoint only when explicitly dispatched and can recover work if the Neon trigger is disabled or unhealthy. GitHub no longer polls the read-only maintenance-status endpoint on a schedule, so recurring production database wakeups belong only to Neon-owned maintenance.

The public Cloudflare gateway exposes neither internal maintenance route.

## Activation and rollback

Use the reviewed rollout operation `neon-schedulers`, which dispatches `.github/workflows/neon-scheduler-release.yml`.

Enabling requires the exact deployed SHA. The release workflow proves that SHA is a reviewed ancestor of current `main`, contains the scheduler-aware handlers/reconciler, and is the exact release marker served by production `draftrunapi` and `pack1growth`; this deliberately permits the reviewed activation-request commit itself to advance `main`. It then reconciles only the three named production triggers. Unrelated Neon triggers are left untouched. A same-name inherited trigger is refused rather than silently localized.

Disable is the immediate rollback: it preserves each definition but stops future scheduled runs. GitHub manual recovery remains available. A trigger already queued for the imminent minute can still fire, so all mutating handlers remain idempotent or bounded.

Production activation completed only after the Pacific Daily migration, exact-SHA production function deployment, and production Daily-generation verification had all completed successfully. The enabled production functions serve exact scheduler-aware revision `4029202c96bebe893419efa91dd0eeea3407d285`.

For future re-enables after a backend change, preserve the same boundary: first prove the reviewed scheduler-aware revision is live in both production functions, then run the reviewed `neon-schedulers` enable operation. The September 23 rollout and after-inactivity evidence are recorded in [the rollout closeout](reports/PACIFIC-DAILY-NEON-SCHEDULER-CLOSEOUT-2026-09-23.md).
