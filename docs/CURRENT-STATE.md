# Current state

Updated 2026-09-19. Implementation, backend deployment, database publication, and provider activation are separate. Older reviews are historical evidence.

## Published product

Pack One remains the eight-decision game in [CHARTER](CHARTER.md): three universal Eastern-date Dailies (mixed, Powered Cube and Latest Set), no Daily rerolls, trophy-match 100, alternatives capped at 95, guest play/share, and durable leaderboards for players linked to an account before their first Daily start. Free accounts have unlimited regular practice. Previously created games keep their IDs and versions.

| Layer | Verified release |
| --- | --- |
| Browser | GitHub Pages serves main. PR156 released the light tournament design: self-hosted Barlow Condensed and Source Sans 3, numbered Daily scorecards, larger controls, and matching editorial typography. PR160 adds the third Daily, visible ranked/guest state and Elite set picker. Application release: `8abee764ba05c318c77670c115657304adb4deee`. |
| Production functions | `draftrunapi` deployment 24, `pack1growth` 15, and `pack1api` 18 all answer with release `8abee764ba05c318c77670c115657304adb4deee`. Development run 35460748733 and production run 35460832627 passed all three complete Daily flows. |
| Schema | Reviewed additive migrations through 0027 are applied to development and production. Historical migration 0016 was not replayed. |
| Corpus / selection | `elite-trophy-colour-stage-v7` / `eight-pick-v4`; 29 Live environments: 28 regular sets and Powered Cube. |
| Model / scoring | `strong-player-colour-stage-v3`, trained on Premier evidence. No Traditional pooling, model retraining, or scoring-curve change. |
| New-run eligibility | `trophy-implied-score-20-v1`; the indexed threshold is equivalent to the rounded implied-score floor. Historical games retain their recorded policy. |
| Traditional sources | Phase 2 components are explicitly published only for eligible Live parents. SIR remains Candidate. The existing `traditional-cube-p2p7-v3-v1` component remains Live. |
| Patreon | Public linking is disabled; controlled linking is enabled only for the owner-authorized account. Campaign `16808916`, Elite Member `29631843`; Supporter `29631835` grants no premium capabilities. All runtime secrets are installed on production growth. Real OAuth authorization remains outstanding. |

Pages success does not imply backend deployment or corpus publication. All three backend health markers were read independently after production deployment.

## Release evidence

- PR155 reconciles source evidence, migration order, metadata fallbacks, and indexed serving selection; unit, browser, database and pinned-artifact gates pass.
- PR156 supplies the tournament visual system and removes dormant More Modes and retired practice-launch modules. Historical shared challenges remain readable.
- PR157 makes image maintenance explicit and serializes corpus writers.
- PR158 supplies exact-tier membership policy, atomic provider/grant updates, bounded access expiry, identity uniqueness, webhook deduplication, and complete paginated hourly reconciliation. Isolated SQL lifecycle and account/admin browser tests pass. PR159 records verified tier IDs while keeping access off.
- Traditional staging: development 35457309349, production 35457565478. Development publication: 35457838857; production publication: 35458189546. Both passed. The failed first development attempt 35456612553 is retained as evidence, not counted as acceptance.

The first staging attempt caught an older automatic image-refresh job changing development Cube display metadata concurrently. That job stopped at an obsolete guest-practice smoke check before production database refresh. The preservation gate remained strict; automatic image-refresh triggers were removed, corpus writers were serialized, and staging was rerun successfully. Production retained Cube payloads were not changed by this incident.

The index/selection change had zero eligibility mismatches across 2,034,020 stored ratings and selected the same eight puzzle IDs for the recorded seed on an isolated production clone. Local serial HTTP timings are not production page latency. [Performance evidence](../results/release-2026-09-19/serving-performance.json).

Production source verification passed 40 new Daily selections (320 decisions) and 25 single-set custom paths. It confirmed independent trajectories, serving floor, pick windows, retained historical reads, 13,673 unchanged Premier Cube payloads and 19 unchanged existing Daily schedules. Production has 21 Live regular Phase 2 components and SIR Candidate, with all nine exclusions retained.

Live browser run 35458218471 passed both complete unranked Dailies, loaded card images, responsive widths 320/390/768/1440, pool/card proportions, completion states and zero browser errors. In that single run, homepage play links appeared at 808 ms, mixed first pack at 688 ms, and Cube first pack at 213 ms. These are observations, not latency guarantees. [Full production evidence](../results/release-2026-09-19/production-verification.json).

## Traditional admission boundary

Approved regular Phase 2 scope: MSH, SOS, EOE, FIN, TDM, DFT, FDN, DSK, BLB, MH3, OTJ, MKM, LCI, WOE, LTR, MOM, ONE, BRO, DMU, SNC, NEO, and SIR. Only the 21 whose parent is Live can serve; SIR is staged only. HOB, KTK, HBG, PIO, and the rejected full-window Traditional Cube source are not admitted. Existing Premier sources for those environments are separate. Nine source exclusions remain.

Expansion affects newly generated games. It does not regenerate today's Daily or alter stored scores, shares, historical puzzles, or model evidence.

## Remaining activation work

The webhook secret is installed, and the Connect button is enabled only for the owner-authorized test account. The owner must approve the normal Patreon OAuth connection; then verify the real membership, capabilities and reconciliation before enabling public linking. Fixture tests cannot establish real provider behavior. [Owner setup steps](PATREON-OWNER-SETUP.md) and [integration runbook](PATREON.md) record the exact URLs, secret name, policy, failure behavior, and canary requirements. No subscription purchase was made.

The temporary performance/SQL test branch `release-tournament-20260919` (`br-cold-flower-ay5yimu1`) is isolated from serving and suspends while idle.

## Architecture and future changes

GitHub Pages hosts the client. Production functions use Neon branch `br-orange-feather-ayps8kep`; development uses `br-twilight-hill-ayffyd2b`, in project `patient-shadow-91417882`. Keep the existing architecture.

Verify schema, deploy a reviewed main SHA to development, pass its acceptance flow, then deploy that identical SHA to production and verify all three markers plus gameplay. Never restore development over production. Corpus publication remains an explicit authenticated and audited operation.

[Design system](DESIGN-SYSTEM.md), [initial rebuild audit](REBUILD-2026-09-18.md), [distribution](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md), [Traditional research](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md), [scoring](../results/rebuild-2026-09-18/SCORING-RESULTS.md).

## Live September 19 feature release

- Third Daily (`latest`) has its own fixed schedule, status, share link and leaderboard, using only the newest Live released regular set.
- Elite custom-set picker is discoverable from the homepage; backend capability enforcement remains required.
- Established account-linked player tokens qualify for Daily ranking without a redundant active Auth header. Guest-started attempts remain unranked after linking. The first pack displays ranked identity or a guest warning.
- Owner-authorized Cube recovery: the September 19 first attempt scored 89, matched the universal schedule, had eight stored answers and a pre-existing account link/session. Only its ranking flag and missing scores entry were restored; career/result aggregates were not replayed. Audit event `daily_ranking_recovered` records the repair.
- Patreon discovery 35459558651 confirmed all runtime/creator secrets. Production linking is enabled only for the owner-authorized canary account; public activation awaits real OAuth evidence.
- Schema prerequisite: additive environment expansion in migration 0027.

PR160 passed unit/browser gates and the isolated database suite (35460401581, 35460401422, 35460401447). Live browser run 35460997062 completed all three Dailies at 320/390/768/1440 widths with images, guest notices, pool proportions, result states and zero browser errors. Today’s Latest Set schedule has eight HOB decisions from eight distinct drafts. All 19 previous schedules have identical fingerprints. The public Cube board shows the recovered 89. Unsigned production webhooks correctly return 401; an actual signed provider delivery and real membership canary are not yet claimed. [Feature release evidence](../results/release-2026-09-19/three-dailies-verification.json).
