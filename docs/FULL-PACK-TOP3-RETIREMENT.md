# Full Pack and Top 3 retirement

Status: source change for review. Nothing is deployed by this work. The owner has retired both modes, superseding earlier instructions to preserve them for product optionality.

## Behavior

The legacy API returns `410 Gone` for `POST /v1/scores`, `GET /v1/leaderboard`, `GET /v1/distribution`, `POST /v1/challenges` and `GET /v1/challenges/:12-character-id`. The Cloudflare gateway terminates the corresponding `/legacy` requests without contacting the origin. Draft Run's `/draft/v1/leaderboard`, 24-character challenge links and creator challenges remain supported.

The Growth service's obsolete `POST /v1/results` writer also returns 410. Forged Draft Run submissions still return 403; real results are saved by the game server. No legacy results or scores are rewritten or deleted.

Old web share links show a retirement notice with links to the Daily and practice. The native historical-link screen also offers the Daily. Full Pack/Top 3 graders, their replay-path runtime, old SPA, social/leaderboard client and unused legacy presentation/flow layers are removed. Legacy seeded-link creation and replay-prefetch helpers are removed; the shared random generator and rarity ordering used by Draft Run remain. `scoring.mjs` retains the ranking helper used by Draft Run. Date, hash, selector and period helpers remain in `worker/core.mjs`. Replay archives and offline training/build tools are retained.

## Identity and traffic verification

Current web code uses Growth's `/v1/player/session` or `/v1/session`; native guest creation uses `/growth/v1/session`. The removed leaderboard client was the old legacy API caller. Source inspection does not establish that deployed old clients generate no traffic.

Route-level live traffic was not available in this review, and no production data was queried. Therefore `POST /legacy/v1/session`, `PATCH /legacy/v1/player`, the `pack1api` identity function and its health route remain. Their ingress/authentication protections and username ownership rules are unchanged. Do not retire the entire function without a separate aggregate traffic review covering older web/mobile clients and token migration. Health now reports no active scoring implementation rather than advertising the removed path scorer.

## Deployment checklist for the owner

1. Use the existing release process and gates. Deploy the legacy `pack1api` function and Growth function first so direct-origin legacy writes return 410. Include the shared `retired-modes.mjs` module in both bundles. Existing identity and health endpoints must still pass acceptance.
2. Deploy the Cloudflare gateway revision. Verify legacy retired paths return 410 with no upstream call, while Growth sessions and current Draft Run leaderboard/share routes retain their existing behavior. Keep ingress protections and the API gateway catch-all route.
3. Publish the web assets, removing deleted files from the deployed site as well as Git. Verify an old 12-character challenge link displays the retirement notice and a modern share still opens normally. Release the native notice change through the normal mobile release flow.
4. Cloudflare configuration: this repository has a gateway catch-all, not individual retired-mode route declarations. No repository route removal is required. Live Cloudflare custom routes were not inspected; if separate overrides exist for these old endpoints, remove them only after the gateway tombstones are deployed. Do not remove `api.packone.pro/*`, Growth/Draft routes, the legacy identity route, quota bindings or origin protections.
5. Database: **no migration, deletion, backfill or data cleanup is required**. Keep `scores`, `game_results` and stored share records. No production operations are part of these PR changes.

## Historical activity remains counted

Growth reads play dates from `scores` without a mode filter in both account Daily dates and profile activity. Older Full Pack/Top 3 dates therefore continue contributing to historical activity and streak calculations. This is deliberately unchanged. Excluding those days would be a separate product decision and could change existing streaks.

## Validation

Retirement tests verify origin and edge 410 responses without database/upstream I/O, preservation of identity and modern share routes, no legacy result writes, and the static share notice. Existing current-scoring tests retain the trophy 100 / alternative 95-cap contracts. Backend smoke coverage now expects retirement and checks retention of synthetic historical rows; existing identity ownership tests remain.

CI routing maps track the shared retirement module as a full backend change. Retired-mode tests and their data-lane registrations are removed with the implementation they tested. Current Draft Run data/model suites, consensus sanity checks, backend gates, browser gates and release protections remain enabled.
