# Pack One: handoff closeout review

September 19, 2026 | Requirement-by-requirement audit | Prepared for Ryan Mindell

## 1. Closeout decision

The main product and release work is complete and live: the light tournament redesign, Traditional puzzle expansion, serving optimization, public Patreon connection, three Dailies, Elite custom-set practice, leaderboard identity fix, and the authorized Cube score recovery. Google ads remain disabled. Both paid Patreon tiers now have protection against future display-ad delivery while signed in and connected.

**I cannot certify every original handoff requirement without qualification.** The detailed model review found an indirect held-fold influence in production's stage-reference calculation, now tracked in [issue #164](https://github.com/killjoy00/mtg-ev-analyzer/issues/164). Also, a real Patreon billing/tier change and signed webhook delivery have not been observed, and browser tests do not establish physical-device or assistive-technology acceptance. These are explicitly open; they are not described as completed by passing mocked tests.

This review used the full 790-line, 42,757-byte **PACK-ONE-ASTRA-HANDOFF-2026-09-19-FINAL.md**, rather than an earlier revised copy. Its starting state was main 5dff038605888dc8f5075bbcc71d960ec666dff7, schema through 0023 and two Dailies. Your later instructions authorize the third Latest Set Daily, two Patreon tiers, Elite set selection, ranking correction and score recovery. Those later instructions supersede the handoff's older two-Daily presentation.

The model and score contract remains unchanged. Historical games have not been regraded. The recovery of the explicitly identified Cube result was a narrow, audited leaderboard repair, not a new attempt or a score recomputation.

## 2. Original definition of done

| Handoff requirement | Audit result and evidence |
| --- | --- |
| 1. Current surfaces show the eight-pick product hierarchy | Complete, with your authorized third Daily. Three numbered Daily rows; no retired mode invitation in current navigation. |
| 2. Remove or isolate dormant legacy product code | Complete as isolation. Current bootstrap loads the new game; old published challenge links use the historical reader. Dormant home/practice modules were removed. Historical compatibility remains intentionally. |
| 3. Rebuild or explicitly abandon PR150 performance work | Complete in PR155. Indexed serving lookup and equivalent support-floor selection released; zero eligibility differences across 2,034,020 ratings and exact seeded selection parity. |
| 4. Close PR149 and incorporate all eligible Traditional inventory | Complete. Twenty-one passing regular components are Live; SIR is Candidate under its Candidate parent. Failed sources remain excluded. |
| 5. Current-state documentation matches production | Reconciled in this closeout. Browser, function revisions, schema, corpus and provider state are listed separately. |
| 6. Roadmap contains genuine remaining work | Reconciled. Completed performance, Traditional and Patreon tasks removed; specific provider, device, monetization and model follow-ups retained. |
| 7. Tests and release gates pass | Final ad/member release passed unit, browser and isolated database gates; the same reviewed revision passed development then production acceptance. Historical failed attempts remain visible and are not counted as acceptance. |
| 8. Production smoke covers Dailies and account practice without rewriting history | Complete with scope stated. Production HTTP/browser checks completed all three unranked Dailies. Authenticated practice has fixture/SQL coverage and a real owner-completed Elite custom run. Existing schedules and payloads were preserved. |
| 9. No ambiguous stale release PRs | Complete. PR149/150/153/154 closed and superseded; PR133 remains closed. The audit found no open PRs before the new ad-protection PR163. |
| 10. Record component status per environment | Complete; see Section 4. SIR is explicitly non-serving, not silently promoted. |
| 11. Monotonic additive migrations from 0023 | Complete: 0024 serving lookup; 0025 Traditional Phase 2 evidence; 0026 provider accounts; 0027 third Daily environment. No replay of destructive historical migration 0016. |
| 12. Fully engineer and validate Patreon, beyond merging PR153 | Operationally released, with an open real-provider acceptance boundary. Exact-tier policy, OAuth, reconciliation, admin state, expiry, disconnect and tests exist. Real connect/reconnect, paid practice and API sync passed. Actual billing changes and signed delivery remain unobserved. |

The independent model-isolation finding also prevents an unconditional signoff on the handoff's fixed guardrail that a source draft must not influence its own grader. It is an existing build-path issue found by this audit, not a regression introduced by the ad or Patreon release.

## 3. Live releases and verification

| Layer | Final verified state |
| --- | --- |
| Site | https://packone.pro/; GitHub Pages deployment from main |
| Reviewed application release | 4cd16f4e1d2cd0aa95885222b0d48d9cc6b216c5 |
| Production functions | draftrunapi 26, pack1growth 17, pack1api 20 |
| Development acceptance | GitHub Actions 35463356101 |
| Production acceptance | GitHub Actions 35463480967 |
| Schema | Through additive migration 0027 |
| Corpus / model | elite-trophy-colour-stage-v7 / strong-player-colour-stage-v3 |
| Selection / serving policy | eight-pick-v4 / trophy-implied-score-20-v1 |
| Source exclusions | Nine retained exclusions |

Earlier feature release PR160 was verified by unit run 35460401581, browser run 35460401422 and isolated database run 35460401447. Live browser run 35460997062 completed all three Dailies at viewport widths 320, 390, 768 and 1440, with loaded images, guest notices, result states and no browser errors. Production deployment is verified by health markers and gameplay, not inferred from a successful Pages build.

The serving optimization measured 107,253 ms before and 54,551 ms after in the recorded serial selection workload on an isolated production clone. This is approximately a 49.1% reduction for that workload, not a claim that live pages load 49% faster. Independent live browser observations recorded 1,114 ms to homepage play links and 950/223/200 ms to the mixed/Cube/Latest first pack in one run. These are observations, not latency guarantees or physical-phone measurements.

The three-Daily release preserved all 19 existing schedule fingerprints. Traditional publication preserved 13,673 Premier Cube puzzle payloads and historical reads. New sources and eligibility policies affect newly generated play; an old schedule is not rewritten merely because today's corpus policy differs.

Your September 19 Cube first attempt had eight stored answers, a score of 89, the correct immutable schedule, and an account link established before play. The repair restored only its ranking eligibility and missing leaderboard entry, with a daily_ranking_recovered audit event. Existing career aggregates were not replayed. The public board showed Killjoy00's recovered 89 when verified.

## 4. Traditional publication and corpus operations

Production was re-read during this audit: 29 Live environments, three Candidate and one Retired. The Live count is 28 regular environments plus Powered Cube. HBG, PIO and SIR remain Candidate; STX remains Retired. There are nine source exclusions.

| Supplemental inventory | Current status |
| --- | --- |
| BLB, BRO, DFT, DMU, DSK, EOE, FDN, FIN, LCI, LTR, MH3, MKM, MOM, MSH, NEO, ONE, OTJ, SNC, SOS, TDM, WOE | All 21 regular Phase 2 components Live |
| SIR | Passing regular component staged as Candidate because its parent is Candidate |
| Powered Cube | Existing restricted Traditional P1P2-P1P7 component Live |
| HOB, KTK, HBG, PIO Traditional sources | Failed Phase 2; not admitted |
| Traditional Cube P1P8/P1P9 | Excluded; those run positions retain Premier inventory |

The release used staging and publication as separate explicit actions: development stage 35457309349, production stage 35457565478, development publication 35457838857 and production publication 35458189546. All final operations passed. The earlier failed staging attempt exposed concurrent metadata maintenance; automatic refresh triggers were removed and corpus writers serialized before the successful rerun. That failed attempt did not replace production Cube puzzle payloads.

Post-publication verification checked 40 new Daily draws, 320 decisions, 25 single-set custom paths, pick windows, serving floor and source independence. Source admission did not retrain the model or promote Candidate parents. Research pass, staged data, serving-Live status and deployed application code remain separate facts.

Corpus discovery and scheduled operations exist and have run successfully. The next genuinely new 17Lands archive remains the best prospective test of schema irregularities and ingestion behavior. It should enter Candidate under existing gates; it should not publish automatically.

## 5. Patreon and membership: what was actually exercised

Public linking was enabled only after the owner completed a real Elite connection, reconnect and practice run, and the creator API confirmed the membership. Campaign 16808916 maps Supporter tier 29631835 and Elite tier 29631843 explicitly. Payment amount, email matching and merely being the creator do not unlock premium practice.

| Benefit | Free account | Supporter | Elite |
| --- | --- | --- | --- |
| Three Dailies | Yes; also available to guests | Yes | Yes |
| Unlimited regular practice | Yes | Yes | Yes |
| Unlimited Cube practice | No | No | Yes |
| Pick-your-sets practice | No | No | Yes |
| Future display-ad suppression | No membership benefit | Yes, connected and signed in | Yes, connected and signed in |

Real OAuth first connected at 18:32:15 UTC and reconnect completed at 18:35:16 UTC on September 19. The provider reported active_patron with the exact Elite tier. Both premium capabilities were active. A completed custom run used three selected sets, eight distinct source drafts and no outside sets. The account's private identifiers and authentication tokens are not included in this report.

Authoritative reconciliation run 35461859312 fetched one complete page, found one linked member and applied one membership update with no superseded snapshot. The provider snapshot was recorded at 18:39:06 UTC, renewing both grants. This verified the same sync path used by the hourly schedule; it does not guarantee GitHub will execute every future scheduled run on time.

OAuth state is hashed, single-use and time-limited. The runtime receives only client and webhook secrets; creator credentials stay in the operational workflow. OAuth access tokens are not retained in provider rows. Webhook payloads request a fresh authoritative sync rather than directly granting benefits. The sync reads all pages before writes, checks revisions and updates snapshots/grants atomically. Grants expire three hours after the last successful snapshot. Admin Users shows provider, membership, capabilities, expiry and last sync.

Automated coverage includes Supporter denial of premium tools, exact campaign/tier boundaries, gifts/trials, declined/refunded states, still-entitled cancellations, upgrade/downgrade, duplicate identity, stale snapshots, incomplete pagination, signature rejection, expiry, disconnect and manual-grant preservation. Existing started practice can finish with its recorded session; entitlement checks control new paid practice starts. A real billing change was not performed, and an actual signed Patreon delivery was not observed. An unsigned production webhook correctly returned 401.

Recovery is explicit: inspect Admin Users and the reconciliation workflow, rerun the reviewed sync operation after provider recovery, and replace expired creator credentials through repository secrets if required. Workflow failures and admin timestamps provide current operational visibility. A separately verified alerting policy and real billing-transition observation remain follow-ups; they are not replaced by the successful OAuth test.

## 6. Design and commercial review

The published visual direction follows a light tournament scorecard. Barlow Condensed supplies headings and scores; Source Sans 3 supplies body text and controls. Both are self-hosted with licenses. Numbered Daily rows, fine rules, readable spacing and restrained blue, ochre and rust accents give the site a competitive identity. Card art carries the imagery. The system avoids decorative AI graphics, glowing gradients and unrelated typefaces.

The three Daily choices are prominent, completed rows become compact, and the Elite set picker remains discoverable. Controls are at least 44 pixels high and keyboard focus remains visible. Earlier pool cards retain approximately 85% of pack-card width. The visual review supports this direction; it does not claim that a complete screen-reader, physical-iPhone or native-share audit has been performed.

**Google ads:** hooks remain in ads.mjs, ad-config.js and editorial ad-slot markup. Delivery is disabled and client/slot configuration is empty. Existing publisher metadata and ads.txt are verification material, not proof of Google approval. Slots now begin hidden in HTML, and the old preview query cannot expose them. No placement was added to the homepage or active drafting.

If ads are enabled later, the loader checks account membership before loading Google's script. Connected Supporter and Elite members receive neither the script nor slots. Unknown, stale or failed membership checks keep ads hidden. Account changes remove existing slots. Signed-out visitors cannot be recognized as members; sign-in and Patreon connection are required on that browser. Real advertising and consent activation remain deferred until the owner requests them after approval.

**TCGplayer:** hooks remain in tcgplayer.mjs, tcgplayer-config.js, revealed-card comparisons and selected set articles. The Impact tracking template is empty, so current links are ordinary card searches and no affiliate commissions are verified. Click analytics are present; clicks are not revenue.

Recommendation: retain the small existing card links and treat affiliate routing as an optional measured trial. Avoid extra banners, a store section or pricing-feed work now. If the owner chooses to proceed, confirm the partnership in Impact, supply its public deep-link template, add clear nearby disclosure and verify routing/reporting through the approved partner process. Do not make a self-purchase to test commissions. TCGplayer's [official program documentation](https://docs.tcgplayer.com/docs/tcgplayer-affiliate-program) describes Impact; its [partner guidelines](https://help.tcgplayer.com/hc/en-us/articles/31411199594391-TCGplayer-Partner-Guidelines) govern disclosure and link use.

## 7. What remains and who needs to act

| Remaining item | Why open | Next action |
| --- | --- | --- |
| Production stage-reference isolation, issue #164 | Synthetic proof shows indirect held-fold influence; real score impact unmeasured | Engineering: build strictly isolated references, add invariance regression, assess pinned data, and use a new model/corpus version. Do not rewrite old scores. |
| Real Patreon billing/tier transition and signed delivery | Connect/reconnect/API sync succeeded, but no actual billing transition was observed | Observe the next legitimate membership change and verify provider state, webhook/sync, and grant results. No purchase or cancellation is required now. |
| Real-device, sharing and accessibility checks | Browser automation is narrower evidence | Perform a real-device and assistive-technology pass when available; document actual devices and flows. |
| Next new archive ingestion | Existing scheduled runs cannot predict every future schema irregularity | Treat the next real arrival as operational acceptance; keep fail-closed Candidate gates. |
| Google ad activation | Owner explicitly deferred pending approval | No action now. Later confirm approval, consent setup and member suppression before any delivery. |
| TCGplayer affiliate activation | Approved account/template and conversion evidence not provided | Optional. Keep current ordinary links; provide a public Impact template only if choosing to run the experiment. |

You do not need to provide anything for the changes delivered in this release. Ads remain off, Patreon linking is public, and the reports preserve the distinction between shipped product work and outstanding validation. The appropriate closeout is **functional release complete, with the documented model and operational follow-ups still open**.

## 8. Evidence index

- Original authority: PACK-ONE-ASTRA-HANDOFF-2026-09-19-FINAL.md, 790 lines, prepared September 19; supplemented by the owner's later instructions in this conversation.
- [Current deployment record](https://github.com/killjoy00/mtg-ev-analyzer/blob/main/docs/CURRENT-STATE.md), [product contract](https://github.com/killjoy00/mtg-ev-analyzer/blob/main/docs/CHARTER.md), and [remaining roadmap](https://github.com/killjoy00/mtg-ev-analyzer/blob/main/docs/ROADMAP.md).
- [Traditional and preservation evidence](https://github.com/killjoy00/mtg-ev-analyzer/blob/main/results/release-2026-09-19/production-verification.json), [performance evidence](https://github.com/killjoy00/mtg-ev-analyzer/blob/main/results/release-2026-09-19/serving-performance.json), and [three-Daily release evidence](https://github.com/killjoy00/mtg-ev-analyzer/blob/main/results/release-2026-09-19/three-dailies-verification.json).
- [Patreon activation record](https://github.com/killjoy00/mtg-ev-analyzer/blob/main/results/release-2026-09-19/patreon-activation.json), [integration runbook](https://github.com/killjoy00/mtg-ev-analyzer/blob/main/docs/PATREON.md), and [monetization decisions](https://github.com/killjoy00/mtg-ev-analyzer/blob/main/MONETIZATION.md).
- [Ad protection PR163](https://github.com/killjoy00/mtg-ev-analyzer/pull/163) and [model-isolation issue #164](https://github.com/killjoy00/mtg-ev-analyzer/issues/164).
- Companion report: Model and Scoring, September 19, 2026, explains the formulas, experiments, results and limitations in depth.
