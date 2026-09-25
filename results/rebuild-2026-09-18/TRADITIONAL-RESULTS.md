# Traditional versus Premier: results, 2026-09-18

Retain Premier-only production evidence. Complete predeclared pooling criteria were not established. This does **not** prove different first-eight drafting policies. Playable Traditional puzzles remain a separate unpublished decision.

[Protocol](TRADITIONAL-PROTOCOL.md), [full metrics/calibration/residuals](traditional-report.json), [workflow](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/35349969472), revision `f7e54c0efb21d0fccf12442b1de172e4b9ff7c6e`.

## Held-out results

LL is calibrated log loss; lower is better. Top-1/ECE are percentages. Splits and intervals cluster source drafts. Pooled rows use BLB/DFT/FIN. HOB is descriptive: 48 Traditional test drafts missed the predeclared 50, which was not relaxed.

| Set | Test event | Training | Picks | LL | Top-1 | Mean rank | ECE |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| BLB | PremierDraft | premier | 6544 | 1.2519 | 54.49% | 1.976 | 1.83% |
| BLB | PremierDraft | traditional | 6544 | 1.4507 | 47.80% | 2.280 | 2.55% |
| BLB | PremierDraft | combined | 6544 | 1.2362 | 55.26% | 1.959 | 1.53% |
| BLB | PremierDraft | event_feature | 6544 | 1.2362 | 55.26% | 1.959 | 1.53% |
| BLB | TradDraft | premier | 1720 | 1.2402 | 54.77% | 1.984 | 2.21% |
| BLB | TradDraft | traditional | 1720 | 1.4254 | 49.59% | 2.234 | 3.17% |
| BLB | TradDraft | combined | 1720 | 1.2128 | 56.74% | 1.927 | 2.80% |
| BLB | TradDraft | event_feature | 1720 | 1.2128 | 56.74% | 1.927 | 2.80% |
| DFT | PremierDraft | premier | 7056 | 1.2416 | 55.24% | 1.964 | 2.44% |
| DFT | PremierDraft | traditional | 7056 | 1.4584 | 47.66% | 2.286 | 1.90% |
| DFT | PremierDraft | combined | 7056 | 1.2310 | 55.20% | 1.960 | 2.67% |
| DFT | PremierDraft | event_feature | 7056 | 1.2310 | 55.20% | 1.960 | 2.67% |
| DFT | TradDraft | premier | 1680 | 1.2002 | 56.73% | 1.907 | 4.22% |
| DFT | TradDraft | traditional | 1680 | 1.4358 | 48.39% | 2.263 | 3.94% |
| DFT | TradDraft | combined | 1680 | 1.1826 | 57.20% | 1.888 | 4.37% |
| DFT | TradDraft | event_feature | 1680 | 1.1826 | 57.20% | 1.888 | 4.37% |
| FIN | PremierDraft | premier | 8688 | 1.2175 | 57.03% | 1.943 | 1.31% |
| FIN | PremierDraft | traditional | 8688 | 1.4055 | 51.67% | 2.200 | 2.26% |
| FIN | PremierDraft | combined | 8688 | 1.2108 | 57.41% | 1.930 | 1.58% |
| FIN | PremierDraft | event_feature | 8688 | 1.2108 | 57.41% | 1.930 | 1.58% |
| FIN | TradDraft | premier | 2752 | 1.2602 | 56.32% | 1.980 | 1.38% |
| FIN | TradDraft | traditional | 2752 | 1.4392 | 50.40% | 2.237 | 2.99% |
| FIN | TradDraft | combined | 2752 | 1.2510 | 56.43% | 1.975 | 1.96% |
| FIN | TradDraft | event_feature | 2752 | 1.2510 | 56.43% | 1.975 | 1.96% |
| HOB | PremierDraft | premier | 1296 | 1.3516 | 54.55% | 2.126 | 4.64% |
| HOB | PremierDraft | traditional | 1296 | 1.4970 | 46.76% | 2.297 | 2.80% |
| HOB | PremierDraft | combined | 1296 | 1.2888 | 55.09% | 2.042 | 3.47% |
| HOB | PremierDraft | event_feature | 1296 | 1.2888 | 55.09% | 2.042 | 3.47% |
| HOB | TradDraft | premier | 384 | 1.4333 | 47.66% | 2.250 | 2.24% |
| HOB | TradDraft | traditional | 384 | 1.5170 | 44.53% | 2.297 | 4.28% |
| HOB | TradDraft | combined | 384 | 1.3394 | 51.56% | 2.117 | 3.54% |
| HOB | TradDraft | event_feature | 384 | 1.3394 | 51.56% | 2.117 | 3.54% |
| POOLED | PremierDraft | premier | 22288 | 1.2352 | 55.72% | 1.959 | 0.95% |
| POOLED | PremierDraft | traditional | 22288 | 1.4355 | 49.26% | 2.251 | 1.02% |
| POOLED | PremierDraft | combined | 22288 | 1.2246 | 56.08% | 1.948 | 0.87% |
| POOLED | PremierDraft | event_feature | 22288 | 1.2246 | 56.08% | 1.948 | 0.87% |
| POOLED | TradDraft | premier | 6152 | 1.2382 | 56.00% | 1.961 | 1.29% |
| POOLED | TradDraft | traditional | 6152 | 1.4344 | 49.63% | 2.243 | 1.57% |
| POOLED | TradDraft | combined | 6152 | 1.2216 | 56.73% | 1.938 | 1.54% |
| POOLED | TradDraft | event_feature | 6152 | 1.2216 | 56.73% | 1.938 | 1.54% |

## Interpretation

Combined training improved log loss for both events in all three sufficient sets. Pooled Premier LL fell from 1.23521 to 1.22464 (paired 95% difference interval −0.01314 to −0.00786); top-1 rose 55.721% to 56.080%. Traditional LL fell from its same-format model’s 1.43440 to 1.22162. Event-feature validation selected zero event weight in all four sets, producing no incremental held-out gain for this feature family.

Premier-trained prediction on Traditional was strong (pooled LL 1.23823). Traditional-trained prediction on Premier was weaker (1.43551 versus 1.23521, a 16.2% increase), failing the 5% cross-format tolerance. Traditional training samples were much smaller: BLB 507 vs 1,898; DFT 476 vs 2,116; FIN 724 vs 2,610. This sample-size confound prevents attributing that gap to different pick policies. Balanced training-size learning curves are the next discriminating test, not a post-result adjustment to overturn the predeclared decision.

No category showed the predeclared stable ≥3-point residual across three sufficient sets. BLB fixing was +2.03 points (interval +0.26 to +3.61), FIN removal −2.21 (−3.76 to −0.49); neither persisted across sets. Bomb/build-around matched coverage was missing in BLB/DFT, so absence of a stable pattern does not establish equivalence there. Individual-card intervals are exploratory and not multiplicity-adjusted.

## Outcome audit boundary

All four Premier source archives contain 7-0, 7-1 and 7-2 trophies, and the cohort extractor accepts all three. Importer tests cover valid losses and reject 7-3. This does not itself establish an exhaustive source-outcome join for every production puzzle; older ledgers may lack explicit losses. No Traditional record was inserted into production and no qualification/scoring rule changed.
