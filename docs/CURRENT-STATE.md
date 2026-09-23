# Current state

Updated 2026-09-23. Implementation, backend deployment, database publication, and provider activation are separate. Older reviews are historical evidence.

## Published product

Pack One remains the eight-decision game in [CHARTER](CHARTER.md): three universal Eastern-date Dailies (mixed, Powered Cube and Latest Set), no Daily rerolls, trophy-match 100, alternatives capped at 95, guest play/share, and durable leaderboards for players linked to an account before their first Daily start. Free accounts have unlimited regular practice. Previously created games keep their IDs and versions.

| Layer | Verified release |
| --- | --- |
| Browser | GitHub Pages serves `main`. Runtime behavior through `89ee3ef93f97f57c766e5889076166f6a720a3b9` passed Pages deployment 35818127581; this documentation closeout does not change browser runtime. The September 23 Patreon release adds the Welcome Note route `/?patreon=activate`, focused mobile activation/recovery states, and browser UX-stage funnel markers. PR390 also enables required email-verification Phase 2. |
| Production functions | The reviewed secure release for #181 deployed exact revision `aac69a28c4cb70d609fcc78c7ef2de390914c54d` through development and production (run 35817596160). `pack1growth` contains the server-authoritative `elite_activated` transition metric; production smoke 35817596155 and the final live gateway/OAuth smoke passed. |
| Schema | Reviewed additive migrations through 0033 are applied to development and production, including owned Pack One username uniqueness and the v4 Traditional component guards. Historical destructive migration 0016 was not replayed. |
| Corpus / selection | `elite-trophy-colour-stage-v8` / `eight-pick-v4`. The v8 parent remains immutable while separately versioned supplemental source components extend current inventory. |
| Model / scoring | Current v8 evidence uses leakage-corrected `strong-player-colour-stage-v4`, trained on Premier evidence. Traditional source rows do not train or calibrate the model. Historical v3 remains readable; the scoring curve is unchanged. |
| New-run eligibility | `trophy-implied-score-20-v1`; the indexed threshold is equivalent to the rounded implied-score floor. Historical games retain their recorded policy. |
| Traditional sources | v4 supplemental components are published only for eligible Live parents. `traditional-premier-v4-phase2-v1` is Live for 21 regular sets; SIR remains Candidate under its Candidate parent. `traditional-cube-p2p7-v4-v1` is Live for Powered Cube P1P2-P1P7. HBG/HOB/KTK/PIO remain blocked. |
| Patreon | Public linking and the post-purchase Welcome Note activation route are live; issue #181 is closed. Campaign `16808916`, Elite `29631843` grants both premium practice capabilities; Supporter `29631835` does not. Browser `patreon_activation_succeeded` is UX telemetry only; authoritative activation measurement uses the server-only `elite_activated` event written when premium grants transition from inactive/revoked to active. The owner verified the Welcome Note link on mobile; an already-entitled account correctly showed **Elite is active** without another OAuth round trip. Actual real billing/tier transitions remain unobserved. Production recorded one signed/matching webhook receipt at 2026-09-19T19:08:21Z; see the webhook note below. |

Pages success does not imply backend deployment or corpus publication. All three backend health markers were read independently after production deployment.

## Release evidence

- PR155 reconciles source evidence, migration order, metadata fallbacks, and indexed serving selection; unit, browser, database and pinned-artifact gates pass.
- PR156 supplies the tournament visual system and removes dormant More Modes and retired practice-launch modules. Historical shared challenges remain readable.
- PR157 makes image maintenance explicit and serializes corpus writers.
- PR158 supplies exact-tier membership policy, atomic provider/grant updates, bounded access expiry, identity uniqueness, webhook deduplication, and complete paginated hourly reconciliation. Isolated SQL lifecycle and account/admin browser tests pass. PR159 records verified tier IDs while keeping access off.
- Historical v3 Traditional staging/publication evidence remains in the September 19 closeout. The leakage-corrected v4 release completed September 21: development stage 35675750660 / 35676281911, production stage 35677378980 / 35678122885, development publish 35678556011 / 35678774912, production publish 35679143746 / 35679407781. Overall promotion chain 35678538754 passed. See [Traditional v4 production release closeout](reports/TRADITIONAL-V4-RELEASE-2026-09-21.md).

The first staging attempt caught an older automatic image-refresh job changing development Cube display metadata concurrently. That job stopped at an obsolete guest-practice smoke check before production database refresh. The preservation gate remained strict; automatic image-refresh triggers were removed, corpus writers were serialized, and staging was rerun successfully. Production retained Cube payloads were not changed by this incident.

The index/selection change had zero eligibility mismatches across 2,034,020 stored ratings and selected the same eight puzzle IDs for the recorded seed on an isolated production clone. Local serial HTTP timings are not production page latency. [Performance evidence](../results/release-2026-09-19/serving-performance.json).

The v4 release verification passed 40 new Daily selections (320 decisions) and 25 single-set custom paths. It confirmed independent trajectories, the serving floor, reviewed pick windows, retained historical reads and preserved existing payloads/Dailies. Production has 21 Live regular v4 components plus Live Powered Cube v4; SIR v4 remains Candidate under its Candidate parent. HBG/HOB/KTK/PIO remain blocked.

Live browser run 35458218471 passed both complete unranked Dailies, loaded card images, responsive widths 320/390/768/1440, pool/card proportions, completion states and zero browser errors. In that single run, homepage play links appeared at 808 ms, mixed first pack at 688 ms, and Cube first pack at 213 ms. These are observations, not latency guarantees. [Full production evidence](../results/release-2026-09-19/production-verification.json).

## Traditional admission boundary

Approved regular v4 scope: MSH, SOS, EOE, FIN, TDM, DFT, FDN, DSK, BLB, MH3, OTJ, MKM, LCI, WOE, LTR, MOM, ONE, BRO, DMU, SNC, NEO, and SIR. The same admission boundary survived v4 revalidation with no regular v3-to-v4 admission flips. Only the 21 whose parent is Live serve; SIR is Candidate only. HBG, HOB, KTK and PIO remain blocked. Powered Cube v4 is separately approved only for P1P2-P1P7; P1P8/P1P9 remain Premier-only. Existing Premier sources are separate and unchanged.

Expansion affects newly generated games. It does not regenerate today's Daily or alter stored scores, shares, historical puzzles, or model evidence.

## Remaining validation and deferred work

[Issue #164](https://github.com/killjoy00/mtg-ev-analyzer/issues/164) is closed. The held-fold stage-reference dependency was corrected with complement-only fold construction, a deterministic held-label invariance regression, measured v3-to-v4 impact, and a separately versioned v8/v4 release. Historical v3 puzzles and scores were not rewritten. Traditional admission was revalidated against the corrected grader and published through the normal development-to-production lifecycle; see [the September 21 v4 release closeout](reports/TRADITIONAL-V4-RELEASE-2026-09-21.md).

Patreon purchase-to-activation issue #181 is closed. Real connect/reconnect, premium practice, creator API reconciliation, the Welcome Note activation route, and the already-entitled mobile path passed. The authoritative funnel now counts server-written `elite_activated`, not browser success. The next genuine billing/tier transition still needs observation as an operational evidence item, not as a blocker to activation.

Signed webhook delivery is no longer wholly unobserved, and the route is no longer untested. `provider_webhook_receipts` holds one row, received 2026-09-19T19:08:21Z. A row is written only after the handler verifies an HMAC-MD5 signature against `PATREON_WEBHOOK_SECRET`, accepts the event as one of `members:create/update/delete`, and matches campaign `16808916`. Nothing in this repository ever sends a signed webhook — the secret is only written at deploy and read by the handler — so Patreon is the only expected author. That attribution is inference, not proof: an ad-hoc signed request by someone holding the secret would be indistinguishable. A portal test delivery or a real tier change, checked against the receipt count, is what would settle it. Separately, `tests/patreon-webhook-backend-smoke.mjs` now drives the deployed handler on an isolated branch: all three member events accepted and deduplicated on replay, unhandled events and foreign campaigns ignored without a receipt, and missing, malformed, wrong, foreign-secret and tampered-body signatures rejected 401 with no side effects. Each assertion was checked against a deliberately broken handler. Google ad activation is explicitly deferred pending approval and owner direction; TCGplayer affiliate routing is active through the approved Impact deep-link template. Physical-device/native-share/accessibility validation and the next new archive arrival remain prospective checks. [Owner operations](PATREON-OWNER-SETUP.md), [Patreon runbook](PATREON.md), [roadmap](ROADMAP.md) and [monetization decisions](../MONETIZATION.md) state these boundaries.

The temporary performance/SQL test branch `release-tournament-20260919` (`br-cold-flower-ay5yimu1`) is isolated from serving and suspends while idle.

## Architecture and future changes

### Runtime boundary

The current public runtime is rooted in `bootstrap.mjs`. The homepage is served through `daily-home.mjs`, current gameplay through `draft-run-product.mjs`, and previously published historical challenge links through `historical-share.mjs`.

`app.js` is intentionally preserved dormant architecture for the Top 3 / Full Pack implementation. It is not a current runtime entrypoint. Keep it for product optionality, and do not treat edits there as changes to the live Daily Draft Run unless the bootstrap/runtime boundary is intentionally changed. Tests may continue to cover preserved behavior even when that behavior is not currently served.

GitHub Pages hosts the client. Production functions use Neon branch `br-orange-feather-ayps8kep`; development uses `br-twilight-hill-ayffyd2b`, in project `patient-shadow-91417882`. Keep the existing architecture.

Verify schema, deploy a reviewed main SHA to development, pass its acceptance flow, then deploy that identical SHA to production and verify all three markers plus gameplay. Never restore development over production. Corpus publication remains an explicit authenticated and audited operation.

[Design system](DESIGN-SYSTEM.md), [initial rebuild audit](REBUILD-2026-09-18.md), [distribution](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md), [Traditional research](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md), [scoring](../results/rebuild-2026-09-18/SCORING-RESULTS.md).

## Pack One usernames

`players.display_name` carries two different things, and only one of them is a username.

An account-linked player's name becomes a public identity only when `players.username_owned` is true: owned names may appear on leaderboards, public profiles and attributed challenges. An anonymous browser's name is a local nickname that the client replays from localStorage on every `/v1/player/session` call, and the QA harnesses deliberately reuse a handful of those nicknames across many guest rows. Migration 0033 makes only owned usernames unique.

- Uniqueness is a Postgres partial unique index, `players_username_uq` over `pack1_username_key(display_name)` where `username_owned`. The index is the authority; the application catches its violation rather than relying on an availability check, which could only narrow the race.
- Comparison ignores case and whitespace. `Ryan`, `ryan`, `RYAN` and `  Ryan ` are one username. `worker/username.mjs` mirrors the SQL key function, so the application and the database agree on what counts as the same name.
- Every casing of the generic `Pack Player` placeholder is excluded, so anonymous and never-customized players keep sharing it.
- Uniqueness ignores `profile_public`: a private account still owns its username.
- A duplicate attempt answers `409` with `That username is already taken.` A Postgres constraint error never reaches the caller.
- Ownership is taken at two moments. A profile rename (`PATCH /v1/profile`) takes it deliberately, and reverting to the placeholder releases it. Linking an account takes it for the nickname the browser was already using, but only when free: a taken nickname still links successfully and stays unowned.
- Account linkage by itself is not a public identity. Ranked Daily attachment, score promotion, Draft Run and legacy leaderboards, and attributed challenge shares require an owned username. A linked player whose nickname is already owned by somebody else stays linked but remains unranked/unattributed until choosing a free username; anonymous challenge attribution is shown generically as `A friend`.
- That unowned linked state is explicit in the product rather than silent: account linking and Daily status return a ranking-identity reason, Daily home warns before play, My Pack One keeps a persistent username-attention card, and an already-started run explains why it is unranked. If a completed guest Daily is waiting for account validation, the validation remains pending through the rename and retries after a unique username is saved. The admin Users view counts and flags linked players with `username_owned=false`; the link path records server-only `username_ownership_conflict` analytics. Individual conflicts do not send email.
- `merge_pack1_player` adopts a source name onto a placeholder target only when nobody owns it. A taken name is left with its owner, and the merge completes rather than raising the constraint.
- A replayed localStorage nickname can never overwrite an owned username; both workers keep the stored name in that case.

Deployment order is fixed: 0033 must be applied before the application release that reads it, because worker SQL on the session, link and profile paths references `username_owned` and `pack1_username_key`. `scripts/verify-neon-schema.mjs` asserts all four signals and fails the deploy gate until the migration lands.

Operational recovery, admin monitoring and the regression contract are documented in [Username identity and ranking](USERNAME-IDENTITY.md).

## Live September 19 feature release

- Third Daily (`latest`) has its own fixed schedule, status, share link and leaderboard, using only the newest Live released regular set.
- Elite custom-set picker is discoverable from the homepage; backend capability enforcement remains required.
- Established account-linked player tokens qualify for Daily ranking without a redundant active Auth header. A completed guest fixed Daily can be promoted by an explicit sign-in/link on the same Eastern game date when the run belongs to the resolved player, the account identity remains eligible for attachment, the run is complete and still unranked, and no score already exists for that player/date/environment. Successful validation inserts the one Daily score and sets `leaderboard_eligible`; fixed schedules, zero rerolls, account/day/environment uniqueness, merge conflict handling, and score uniqueness preserve first-attempt behavior. The first pack displays ranked identity or a guest warning.
- Owner-authorized Cube recovery: the September 19 first attempt scored 89, matched the universal schedule, had eight stored answers and a pre-existing account link/session. Only its ranking flag and missing scores entry were restored; career/result aggregates were not replayed. Audit event `daily_ranking_recovered` records the repair.
- Patreon discovery 35459558651 confirmed all runtime/creator secrets. The owner-authorized canary subsequently passed and public linking is now enabled; see the activation evidence below.
- Schema prerequisite: additive environment expansion in migration 0027.

PR160 passed unit/browser gates and the isolated database suite (35460401581, 35460401422, 35460401447). Live browser run 35460997062 completed all three Dailies at 320/390/768/1440 widths with images, guest notices, pool proportions, result states and zero browser errors. Today’s Latest Set schedule has eight HOB decisions from eight distinct drafts. All 19 previous schedules have identical fingerprints. The public Cube board shows the recovered 89. Unsigned production webhooks correctly return 401; no signed provider delivery had been observed as of that run. One was recorded later the same day, at 19:08:21Z; see the webhook note above. The later real member connection/reconnection, custom practice and API sync passed, as recorded separately below. [Feature release evidence](../results/release-2026-09-19/three-dailies-verification.json).

## Final Patreon and ad-protection release

Public Patreon activation PR162 passed development 35462022892 and production 35462227708. Reconciliation 35461859312 confirmed the exact real Elite tier and renewed two capabilities. The owner completed a three-set custom run using eight distinct drafts exclusively within the selected sets.

PR163 passed full unit 35462928388, browser 35462928378 and isolated database 35462928376 gates. Its intercepted browser tests cover disabled delivery, Supporter/Elite suppression, stale/unknown/failed membership handling, nonmembers, guests and account changes. Existing ad slots start hidden in HTML. The published `ad-config.js` remains disabled, and the live editorial preview URL shows no ad slot. Google ads remain disabled. TCGplayer affiliate routing is active; this document does not assert any commission amount.

## Daily-home monetization fallback and dormant AdSense

Exactly one static `data-ad-slot="home"` remains after `#app` inside
`.app-shell`. It is eligible only while the Daily home is rendered, can fill at
most once per full page load, is cleared permanently for that page load when an
in-place view leaves the Daily home, and is never eligible in gameplay or result
views. Editorial `article-top` remains a separate explicit Google mapping and is
still unconfigured.

The public AdSense client is `ca-pub-1217971050094766` and the dormant home unit
is `1543495960`; `ad-config.js` remains `enabled:false`. While that Google
release gate is disabled, the Daily-home slot uses the TCGplayer affiliate
fallback. It uses the locally served official TCGplayer logo asset, a visible
commission disclosure, the approved Impact deep-link template targeting the
Magic category, and click surface `daily_home_banner`. Displaying the fallback
does not load a TCGplayer/Impact script or pixel. Google activation replaces the
affiliate promotion rather than stacking with it.

Supporter ($3) and Elite ($7) ad-free behavior continues to use exact campaign,
tier and provider state IDs rather than payment amount. Active, still-entitled
former, free-trial and gifted qualifying memberships suppress both Google and the
affiliate fallback; declined and refunded/fraud/deleted states retain their
existing non-ad-free result. A signed-out Patreon member is a guest.
Pack One-originated account/Patreon changes write a nonce-only browser signal that
clears an open promotion across tabs and never refills it on that page load.
Direct patreon.com changes and backend webhook/scheduled-sync changes do not emit
that signal, so an already-open tab can retain its promotion until reload.

Google approval, applicable consent/privacy work and explicit owner authorization
remain required before AdSense delivery can be enabled.

[Activation and final deployment evidence](../results/release-2026-09-19/patreon-activation.json), [handoff closeout](reports/HANDOFF-CLOSEOUT-2026-09-19.md), [detailed model/scoring report](reports/MODEL-AND-SCORING-2026-09-19.md), and [Traditional v4 production release closeout](reports/TRADITIONAL-V4-RELEASE-2026-09-21.md). Historical release snapshots are retained with their original as-of state.
