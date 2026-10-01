# Production Auth / Neon restore incident — closeout (2026-09-30)

**Status:** Closed. Production corrected, validated, and cleaned up. The only open item is optional email/password acceptance that needs a real inbox (see `docs/AUTH-HARDENING.md`).

## Summary

New email/password accounts created after a Neon restore drill could not sign in: Pack One returned HTTP 500 ("Request failed. Please try again.") because the new Auth identity existed on a different database branch from the one Pack One writes to. One tester was affected. No application data was written to the wrong branch.

## Timeline (UTC)

| When | Event |
| --- | --- |
| 09-30 04:31 | Restore drill finalized; the original production endpoint moved to the restored branch. |
| 09-30 17:31 | First failed sign-in (tester). |
| 09-30 ~17:45 | Diagnosed from tester feedback, not monitoring. |
| 09-30 18:56 | #794 merged (Auth rebound to the serving branch, binding guard added). |
| 09-30 19:10–19:18 | Fix released (#797). |
| 09-30 by 21:08 | Single-host cleanup released (#799/#800). |
| 09-30 23:26–23:35 | Verification and sign-up UX fixes released (#801/#806). |
| 10-01 00:21–00:28 | Native post-claim route released (#807/#808). |
| 10-01 04:26–04:34 | Old endpoint disabled; production made default and renamed; restored branch, drill snapshot and idle QA branches deleted. |

## Root cause

Pack One hardcoded the production Neon Auth endpoint hostname (`ep-hidden-bonus-ayfmcpys`) instead of deriving it from the serving branch. The September 30 restore drill was finalized despite the runbook calling for an isolated restore, and finalizing moved that endpoint and the default/`main` label to the restored branch (`br-dark-sound-ayxhwq1u`). Pack One's functions, schedulers and gateway were explicitly bound to `br-orange-feather-ayps8kep`, so application writes stayed there, while Auth followed the hardcoded hostname to the restored branch. New Auth identities therefore existed only on the restored branch, and creating a Pack One session for them on the serving branch failed with FK error 23503. The drill record wrongly stated that production had not been replaced. The Google OAuth callback change was a consequence of the fix, not a cause.

Separately, the web client treated any sign-up response containing a `user` as a completed sign-in, so the "Check your email" screen never appeared (fixed in #801).

## Correction and prevention

- Production Auth uses the base URL Neon reports for the serving branch, from one source of truth (#794, #812).
- A read-only binding guard runs before every Auth release, hourly, and after each launch-telemetry run (#794, #809, #815).
- Restore drills must not finalize; finalizing is a production cutover that needs owner approval (`docs/DATABASE-RECOVERY.md`).
- Mutating Auth-hardening runs need a per-commit opt-in on PRs (#817) and run on `main` only from a reviewed request change (#818).
- CI branches name their parent explicitly; none inherit Neon's default branch (`backend-gate.yml`).
- The serving branch is now named `production` and is Neon's default; the restored branch and its endpoint are gone.
- Detection was the real gap: ~13 hours of latency versus ~22 minutes to release the fix.

## Mutations performed during remediation

- QA localhost toggles: run 36797780678 (accidental, from a PR edit) and 36807107096 (approved); both restored.
- Production hardening run 36811306347 (approved); its disposable identity was removed (0 users, accounts or sessions remained, verified 10-01 04:08).
- 10-01: endpoint `ep-hidden-bonus-ayfmcpys` disabled; `br-orange-feather-ayps8kep` set as default and renamed `production`; `br-dark-sound-ayxhwq1u`, snapshot `pack1-dr-drill-2026-09-30`, `br-calm-pond-ayh8f671` and `br-lively-silence-ayiptwkk` deleted; `pg_stat_statements` enabled on production. The deletes were accepted by the Neon API; absence was not re-read afterwards.

## Related fixes shipped alongside

- Sign-up shows "Check your email"; unverified sign-in offers a resend link (#801).
- Sign-up is email + password only (`autocomplete="username"`), with the leaderboard name chosen after the account is claimed, on web and native (#801, #807).
- Mobile RC privacy audit unblocked (#813).

## Open

- Optional email/password acceptance with a real inbox (`docs/AUTH-HARDENING.md`).
- Optional removal of the old Google OAuth redirect URI (now points at a deleted host).
- Follow-up issues #802 (launch watcher cadence), #803 (guest analytics 401s), #804 (origin instrumentation), #805 (remaining Neon hygiene: unmanaged `dr*` Functions).
- `docs/DATABASE-RECOVERY.md` and `docs/AUTH-RECOVERY-DELIVERY.md` still describe the pre-cleanup branch labels and should be updated.
