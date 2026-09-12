# Pack One roadmap

## Do next

1. **Measure real-player difficulty and scoring fairness.** Report first-attempt trophy matches, average partial credit, response time, rerolls and abandonment by difficulty, pick depth and environment. Exclude QA activity. Review model/historical-choice disagreements separately; keep the settled trophy-only and 100-point rules.
2. **Make source freshness and accounting routine.** Run inexpensive supported-archive version checks, trigger imports only for changed sources, retain a per-draft/per-pick disposition ledger and reconcile production IDs and counts after every load. Register a new environment through one policy/catalog process. Keep retired sources permanently blocked.
3. **Reduce cold-start and cache-refresh delays.** Move selection metadata toward a compact indexed serving representation; benchmark cold and warm starts and concurrency against the full corpus before changing architecture. Preserve exhaustive eligibility and set weighting.
4. **Finish real-device product verification.** Test iPhone authentication, native sharing, resume and Daily rollover; prioritize observed completion and retention friction. Existing narrow-browser checks do not establish native-device behavior.

## Consider next

- **Choose-your-sets Draft Run.** Let a player choose the environments for a ten-pick practice run, including HBG, SIR and PIO. Validate that the chosen pool can meet pick windows, difficulty mix and reroll requirements; persist the chosen-set list in friend links. Keep a separate custom/practice identity from the shared Daily leaderboard. Do not build this mode until separately prioritized.
- **Recover excluded image cases.** Recheck exact card identities and source images for remaining qualified trophies without weakening image or trajectory standards.
- **Player-calibrated difficulty.** Once there is sufficient first-attempt data, compare the current ambiguity proxy with measured results; introduce new versions rather than silently changing historical ratings.
- **Retention and distribution.** Improve result sharing and the return-to-Daily flow based on measured behavior, then test targeted community promotion. Put monetization behind demonstrated repeat play.
