# Shared-run self-challenge closeout — 2026-09-23

## Incident

A practice shared-run link could be reopened by its own creator and treated as a new friend challenge. The same signed-in player could therefore complete the same stored run again and receive an impossible self-comparison such as `You: 63 · Killjoy00: 82`.

The defect was not only presentation. The replay was stored as a challenge session and could write a challenge result/outcome into career history.

## Root cause

`draft_run_shares` already identified the authoritative source session, but the Draft Run share lookup did not surface that session's player owner to the challenge-start path. `POST /v1/runs` therefore treated every valid share as if it belonged to another player.

The result-response and result-persistence paths inherited the same assumption, so a legacy same-player replay could render and persist a self-opponent comparison.

## Runtime fix

PR #446, **Prevent self-challenges from shared runs**, merged as `0649b3897a12e0d5ae98f3ecd693fccd768c0788`.

The reviewed behavior is now:

- share metadata carries the source session ID and owner player ID internally;
- if the current player owns the share, starting from that link returns the original authoritative session instead of inserting a new challenge session;
- response and persistence paths defensively suppress same-player challenge metadata for legacy or in-flight rows;
- a defensive fallback result is stored without challenge identity rather than creating self-opponent history;
- shared score lists include the creator's original score and exclude same-player replay duplicates;
- backend regressions assert that reopening your own share creates zero challenge sessions.

The product contract in [CHARTER](../CHARTER.md) now states this ownership rule explicitly. [Request integrity](../REQUEST-INTEGRITY.md) documents the runtime and cleanup boundary.

## Verification and deployment

The final PR #446 head passed:

- test run `35952231947`;
- isolated Neon backend schema/integration gate `35952231948`;
- E2E run `35952231945`.

The exact merged application revision `0649b3897a12e0d5ae98f3ecd693fccd768c0788` then passed the normal promotion sequence:

- development deploy and acceptance: `35952934212`;
- production deploy and acceptance: `35953672931`.

Production therefore received the prevention fix before historical cleanup began.

## Historical cleanup

Migration `0036_self_shared_run_cleanup.sql` removes only replay sessions where the challenge share's original session owner and the replay player are the same person. It also removes the replay's derived career result and run-linked analytics, revalidates affected game/challenge achievements, removes invalid unlock telemetry when necessary, and clears a showcase selection only if the showcased achievement no longer remains earned.

PR #455 added the fixed reviewed cleanup workflow and documentation. PR #456 dispatched it only after the prevention fix was live in both environments.

Cleanup run `35954445732` completed successfully:

| Environment | Legacy self-share sessions before | Remaining after |
| --- | ---: | ---: |
| Development | 32 | 0 |
| Production | 3 | 0 |

The workflow ran development first and production second and required zero remaining same-player shared-run challenge sessions after each transaction.

## Final state

A share creator reopening their own practice link now recovers the original completed run/result. It does not create another attempt, does not compare the player against themself, and does not add a self-result to challenge history.

The three production legacy self-challenge sessions were removed together with their derived artifacts. The original authoritative runs and normal challenges from other players remain intact.
