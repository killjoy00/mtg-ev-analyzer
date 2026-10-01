# Production database recovery

This runbook separates data recovery from application rollback and corpus rebuild. It was introduced after the September 29/30, 2026 cross-cutting launch audit (issue #778).

## Current recovery posture

Neon project: `Pack 1` (`patient-shadow-91417882`).

Serving production database branch: `br-orange-feather-ayps8kep` (currently named `pack1-dr-restore-drill-2026-09-30 (1)`). Neon currently marks the restored `br-dark-sound-ayxhwq1u` branch as `main`, primary and default. Those control-plane labels do not define Pack One's serving branch.

At the September 30 audit, Neon initially reported a **6-hour** history-retention window. After the restore drill and cost review, Pack One intentionally increased the production Neon history-retention setting to **86,400 seconds / 24 hours**.

Current recovery assets and post-drill control-plane state:

- Neon point-in-time history: **24 hours**;
- one older manual snapshot: `pre-0033-unique-usernames` from September 22;
- drill snapshot: `pack1-dr-drill-2026-09-30`;
- restored/finalized branch: `br-dark-sound-ayxhwq1u`, now named `main`, primary and default, with the original `ep-hidden-bonus-ayfmcpys` endpoint attached;
- serving branch: `br-orange-feather-ayps8kep`, renamed `pack1-dr-restore-drill-2026-09-30 (1)`, with replacement endpoint `ep-young-hall-ayl0754j`.

This is deliberately lightweight disaster recovery. Pack One's user/account/history data is useful but not treated as high-value financial or safety-critical data. The goal is a practical one-day rewind window for bad migrations or accidental writes, not a high-availability or archival backup program.

## September 30 restore drill

A fresh manual snapshot of the serving production branch was restored to a new branch and then finalized. The data copy itself matched the source, but finalization **did change Neon control-plane identity**: `br-dark-sound-ayxhwq1u` became `main` / primary / default, the original `ep-hidden-bonus-ayfmcpys` endpoint moved to it, and `br-orange-feather-ayps8kep` was renamed and received `ep-young-hall-ayl0754j`.

Pack One's Functions, schedulers and gateway remained explicitly bound to `br-orange-feather-ayps8kep`, so application writes continued there. Neon Auth also remained enabled on that serving branch and began reporting the new `ep-young-hall-ayl0754j` Auth base. Code that still hardcoded the old Auth endpoint therefore sent Auth writes to the restored default branch while application writes continued on the serving branch, causing the September 30 sign-in incident.

Critical counts matched between production and the restored branch:

| Invariant | Production | Restored |
| --- | ---: | ---: |
| Neon Auth users | 6 | 6 |
| Players | 649 | 649 |
| Account links | 5 | 5 |
| Draft Run sessions | 500 | 500 |
| Completed Draft Runs | 262 | 262 |
| Ranked scores | 91 | 91 |
| Entitlement grants | 10 | 10 |
| Provider accounts | 3 | 3 |
| Apple subscription entitlements | 0 | 0 |
| Apple subscription notifications | 0 | 0 |
| Analytics events | 12,736 | 12,736 |
| Account-deletion operations | 2 | 2 |
| Verified puzzles | 3,371,134 | 3,371,134 |
| Corpus source snapshots | 143 | 143 |
| Serving-inventory rows | 2,052,976 | 2,052,976 |
| Settings rows | 27 | 27 |

Integrity checks also matched:

- duplicate owned username keys: 0;
- orphan account links: 0;
- orphan Draft Run sessions: 0;
- orphan entitlement grants: 0.

This proves that a current manual Neon snapshot can be restored to an isolated branch with the critical Pack One relational state intact. It does **not** prove an older point-in-time recovery, application cutover, DNS/custom-domain cutover, Function environment rebinding, scheduler restoration, or provider reconciliation.

## Recovery types

### Application rollback

Use the reviewed release workflow to restore the last known-good Functions/gateway revision when code caused the incident. Do not roll database state backward merely to undo application code.

Additive migrations normally remain in place during an application rollback.

### Point-in-time recovery

Use Neon history only when the required recovery point is still inside the configured history-retention window. Before any destructive restore, establish the exact incident timestamp and choose a recovery point that precedes the bad write.

A real production rewind/replacement requires explicit owner approval.

### Snapshot restore

Prefer restoring a snapshot onto a **new branch first**. Validate it before any production cutover.

Never overwrite the production branch merely to test recovery.

### Corpus rebuild

The checked-in corpus and source/provenance workflows can reconstruct serving evidence, but they are not substitutes for restoring account identity, career/history, scores, entitlements, provider state, analytics, or deletion operations.

## Isolated restore procedure

**Restore drills must not finalize or swap branches.** Finalizing a restore is a production cutover and requires explicit owner approval. On September 30, finalizing moved the original endpoint and the default/`main` label to the restored branch, which caused the Auth incident.

1. Record the incident/recovery reason and current serving production branch ID.
2. Create or select the exact Neon snapshot/recovery point.
3. Restore it to a new non-production branch.
4. Do not point public Functions, the gateway, schedulers, Auth, or store clients at the restored branch yet.
5. Run the integrity checks below.
6. Verify schema/function compatibility with the application revision that would serve the restored data.
7. **After any restore or restore finalization, re-list every endpoint and record which branch each endpoint is attached to. Re-read Neon Auth on the serving branch and record its exact `base_url`. Do not close the drill or incident until both match the intended serving branch.**
8. If a real cutover is required, separately review connection-string/function/scheduler/Auth implications and obtain explicit owner approval before replacing production.
9. After cutover, run production account, Daily, Practice, entitlement and monitoring smokes before reopening normal operation.
10. Keep the old branch/snapshot until the recovery has been independently accepted. Cleanup is a separate destructive action.

## Required post-restore checks

Run only read-only checks until a restored branch has been explicitly approved for mutation.

### Identity and account integrity

- Auth-user count and account-link count match the intended recovery point.
- No account link references a missing Auth user or player.
- Owned username keys remain unique.
- Account-deletion operations are reconciled before allowing deleted/pending identities to sign in.

### Gameplay and ranking integrity

- Draft Run session/completed-run counts are plausible for the recovery point.
- No Draft Run session references a missing player.
- Daily/ranked-score uniqueness constraints are intact.
- Recent completed runs can be read without replaying completion writes.

### Entitlement/provider integrity

- No entitlement grant references a missing Auth user.
- Patreon/provider records remain attached to the expected accounts.
- Apple entitlement/notification state is reconciled with Apple before granting access solely from potentially stale recovered state.

### Serving integrity

- Serving revision and serving inventory exist and agree with the restored corpus state.
- Current Live/Candidate corpus state and readiness records are internally coherent.
- Do not publish or activate a Candidate merely because the restored database contains it.

### Operational integrity

- Settings rows exist, but never print secret values into recovery evidence.
- Reconcile scheduled triggers, Function deployments, custom domains and external credentials separately; branch data restoration does not prove those control-plane objects are correct.
- After every restore/finalize operation, verify endpoint-to-branch attachments and the serving branch's Neon Auth `base_url`; a successful data restore does not prove Auth or compute routing stayed attached to the intended branch.
- Re-enable launch monitoring only after its durable watermark/state has been checked against the recovery point.

## Pack One recovery policy

Issue #778 adopts the following intentionally low-ceremony policy:

- **Point-in-time recovery window:** 24 hours in Neon.
- **Routine snapshots:** none. Do not create daily or weekly snapshot jobs solely for backup.
- **Pre-risk snapshots:** create a manual snapshot before a genuinely destructive or unusually risky production database operation when a clean rollback point would be useful.
- **Restore drills:** the September 30, 2026 isolated restore proves the current mechanism. Repeat after a material change to the Neon/recovery architecture, or roughly annually if no such change occurs; there is no monthly/quarterly drill requirement.
- **Notifications:** no success notifications and no recurring backup reminders. Surface only an actual recovery failure or a recovery event that needs owner action.
- **RTO:** no strict uptime SLA is adopted. Recovery should use the documented runbook with correctness favored over an artificial time target.
- **Older-than-24-hour loss:** accepted. If corruption is discovered outside the recovery window and no deliberate pre-risk snapshot covers it, Pack One may repair or recreate the affected low-value user/history state instead of maintaining longer archival recovery.

At the September 2026 observed write rate, moving from 6 hours to 24 hours of Neon history was estimated to add only about **$0.20-$0.25/month** in retained-change-history cost. This is an operating estimate, not a billing guarantee.

## Safety rules

- Never test by rewinding or replacing production.
- Never expose database URLs, provider tokens, user emails, names, auth tokens, or secret `settings` values in GitHub evidence.
- Treat branch deletion, snapshot deletion, and production restore/cutover as destructive operations requiring explicit approval.
- Application rollback and data rollback are different operations; choose the smallest one that addresses the incident.
