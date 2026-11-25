# One Pack One Patreon Publisher

There is exactly one supported Windows application, one Pack One pairing and
one PostyBirb session for **every** Patreon article. The separate reviewed
Windows releases from #1793/#1797/#1800 are superseded. No database login,
Patreon API token, secondary installer, additional startup task, or separate
publisher process is required. The user should not install the older packages.

## Operator experience

1. Close any previous Pack One helper. The unified application locks both
   previous process-lock paths; no legacy instance can run alongside it.
2. In Admin > Patreon, download the reviewed **Pack One Patreon Publisher for
   Windows** ZIP, extract it, and open PackOnePatreonPublisher.exe.
3. Reuse the existing DPAPI-encrypted pairing from the same Windows account,
   or generate a single pairing code in Admin and paste it locally. Confirm
   the original player publication notice commitment in Admin. Check
   connection, then enable automatic posting once.
4. The application retires legacy auto-start and disables the old automatic
   setting without erasing its Wednesday journal. The existing PackOneWeekly
   Windows sign-in registration now points to the unified executable.
   Keep only this application and PostyBirb running.

The UI displays separate statuses for recap, Pick of the Week, season posts
and Lab. "Not connected yet" means the corresponding content integration is
not shipped; it must not be represented as an active schedule.

## Shared integration contract for #1795, #1796 and #1791

The single packaged entry is scripts/pack-one-patreon-publisher.mjs.
It authenticates the current owner pairing through the existing
/v1/weekly-publisher status operation before any automatic submission.
It calls the lanes sequentially, with the same call(action, params) and
bridge(action, post) functions from scripts/pack-one-weekly-private-runner.mjs.
Never start another process or run a competing cloud publisher. Failed
individual lanes do not suppress independent due work after authentication.
Revocation stops all new ticks; it cannot undo an external handoff.

- Monday: runPairedWeeklyTick({call, bridge}); existing receipt and
  server-side name admission, at noon Central.
- Wednesday/Thursday: pick-tick on the same pinned bridge; only a current v2
  immutable aggregate manifest is eligible, with the original Wednesday
  journal and provider confirmation. No legacy daily v1 submission.
- Season Results & Awards and Midseason Set Guide: the #1803 export
  runPairedSeasonTick({call, bridge}) is discovered automatically once merged.
  Preserve server-authenticated stable season receipts, exact approval,
  name admission and public reconciliation. The lane serves both types.
- Lab: expose runPairedLabTick({call, bridge}) from the shared private
  runner. It must select only the exact approved immutable article, respect
  the Friday policy and reconcile pending receipts without a second queue.
  Implement the actual server and media contracts in #1791/#1792.
  Do not expose names, private evidence, credentials or unapproved drafts.
  Until that export is present, the application reports Not connected yet.

A lane returns {status: ...} with a fixed code; no raw exception text or
article content in launcher stdout. Extend the dispatcher's fixed status set
and GUI mapping together when adding statuses. Article-specific server
checks and supported media/caption validation remain mandatory; this shared
dispatcher does not weaken them. New article shapes require reviewed source
updates to the single package, not another executable or credential.
The only child bridge is the existing stdin-only WeeklyPrivateBridge.exe
inside the bundle; it is not a separate application for the user to manage.

## Release

The existing weekly-private-windows.yml workflow is the single reviewed
publisher build. It packages the unified entry and its tracked import graph,
tests both weekly lanes and the actual Chromium rendering, checks Windows
DPAPI and runtime completeness, then publishes the main-only
patreon-publisher-windows-<revision> release containing
PackOnePatreonPublisher.zip and PublisherSHA256.txt. The old
patreon-desktop.yml workflow is regression-test-only; it publishes no helper.
The Admin page only links to this unified tag and asset pattern.

The existing paired backend deployed in #1802 is reused; this consolidation
does not need a new database migration or service credential. First
new-format public posts remain subject to local setup, scheduled eligibility,
provider confirmation, and public presentation verification. Do not call a
passing build a live publication. Keep #1790 open through live acceptance.
