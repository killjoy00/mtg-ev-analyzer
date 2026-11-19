# Traditional inventory Phase 1

Research-only availability and cohort audit completed 2026-09-18.

This phase asks only whether each Pack One environment has enough public Traditional 3-0 trophy trajectories, under the existing strong-player qualification rules, to justify the full Phase 2 scoring/quality comparison. It does **not** authorize publication, change model training, change production, or imply that Traditional passes the later scoring gates.

Evidence:
- GitHub Actions workflow run: 35384568843
- 17Lands public dataset inventory reviewed 2026-09-18
- Production Premier cohort/model metadata read from the current `elite-trophy-colour-stage-v7` manifests
- Regular-set playable window: P1P1-P1P8
- Powered Cube playable window: P1P2-P1P9 with the historical P1P1 card inherited in pool context
- Minimum Phase 2 cohort: 100 complete qualified source trajectories in each event

## Result

| Environment | Production status | Premier included trophies | Qualified Traditional 3-0 | Complete Traditional trajectories | Phase 1 result |
| --- | --- | ---: | ---: | ---: | --- |
| HOB | Live | 617 | 222 | 222 | TESTABLE |
| MSH | Live | 2,090 | 338 | 338 | TESTABLE |
| SOS | Live | 3,206 | 576 | 576 | TESTABLE |
| TMT | Live | 701 | 247 | 0 | WINDOW_UNAVAILABLE |
| ECL | Live | 2,396 | 477 | 0 | WINDOW_UNAVAILABLE |
| TLA | Live | 3,408 | 472 | 0 | WINDOW_UNAVAILABLE |
| EOE | Live | 2,743 | 661 | 661 | TESTABLE |
| FIN | Live | 4,342 | 1,275 | 1,275 | TESTABLE |
| TDM | Live | 2,411 | 589 | 589 | TESTABLE |
| DFT | Live | 3,583 | 782 | 780 | TESTABLE |
| FDN | Live | 2,824 | 688 | 686 | TESTABLE |
| DSK | Live | 3,840 | 939 | 937 | TESTABLE |
| BLB | Live | 3,173 | 861 | 852 | TESTABLE |
| MH3 | Live | 3,627 | 863 | 861 | TESTABLE |
| OTJ | Live | 4,203 | 1,375 | 1,373 | TESTABLE |
| MKM | Live | 4,024 | 1,511 | 1,506 | TESTABLE |
| KTK | Live | 489 | 263 | 262 | TESTABLE |
| LCI | Live | 3,939 | 1,456 | 1,451 | TESTABLE |
| WOE | Live | 4,496 | 1,290 | 1,284 | TESTABLE |
| LTR | Live | 5,131 | 1,177 | 1,176 | TESTABLE |
| MOM | Live | 5,562 | 952 | 952 | TESTABLE |
| ONE | Live | 2,308 | 587 | 581 | TESTABLE |
| BRO | Live | 1,701 | 491 | 489 | TESTABLE |
| DMU | Live | 4,793 | 1,789 | 1,776 | TESTABLE |
| SNC | Live | 4,927 | 618 | 606 | TESTABLE |
| NEO | Live | 3,747 | 1,168 | 1,155 | TESTABLE |
| VOW | Live | 2,132 | — | — | DATA_UNAVAILABLE |
| MID | Live | 2,864 | — | — | DATA_UNAVAILABLE |
| HBG | Candidate | 804 | 355 | 353 | TESTABLE |
| SIR | Candidate | 1,031 | 604 | 600 | TESTABLE |
| PIO | Candidate | 1,406 | 306 | 306 | TESTABLE |
| **Powered Cube** | **Live** | **1,243** | **220** | **220** | **TESTABLE** |
| STX | Retired | — | — | — | SCHEMA_UNAVAILABLE |

## Summary

- **27 environments are testable** under the current minimum cohort rule.
- Those environments contain **21,867 complete qualified Traditional trajectories**, or 174,936 eight-decision candidate opportunities before any Phase 2 scoring/quality exclusions.
- Restricting to currently Live environments gives **20,608 complete trajectories** (164,864 eight-decision opportunities). Candidate HBG/SIR/PIO account for the difference.
- **Powered Cube is testable**: 220 qualified 3-0 trajectories are complete across P1P2-P1P9. Its public TradDraft archive is the same late-2025 Powered Cube event family as the current production Premier source and preserves the inherited P1P1 context needed for the current game shape.
- TMT, ECL and TLA are **not sample-size failures**. They have 247, 477 and 472 qualified Traditional 3-0 trophies respectively, but the public draft data does not provide complete P1P1-P1P8 trajectories. Under the current regular-set product contract they are therefore WINDOW_UNAVAILABLE. A future decision to allow P1P2-P1P9 for those regular formats would be a separate product-policy change and is not implied by this audit.
- VOW and MID have no public TradDraft draft archive in the current 17Lands dataset inventory.
- STX has a public TradDraft archive, but it lacks the user game-count and win-rate bucket fields required by the current Pack One qualification standard. It is retired in production and remains research-only unless a separately justified legacy qualification method is adopted.
- The previously studied BLB/DFT/FIN/HOB counts reproduce the earlier research: BLB 852, DFT 780, FIN 1,275 and HOB 222 complete Traditional trajectories.

## Phase 2 eligibility boundary

Phase 1 only establishes that the data exists and is sufficiently large. Each TESTABLE environment still needs the frozen-Premier-model parity check and the predeclared support, calibration, disagreement, partial-credit, difficulty, late-pick, serving-subset and source-quality gates before any Traditional puzzle component can be considered for publication.

Candidate and Retired environments may be studied for evidence but their research result does not change their serving lifecycle state.
