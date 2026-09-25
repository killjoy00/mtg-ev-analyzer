# Reroll latency diagnosis — 2026-09-25

[Workflow 36176646803](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36176646803) / code `9f01ba4ba28121b5b8af5928e7e6f4968e6dfea5` / disposable clone `br-aged-haze-ayjl6t6b`.

The corrected NAT workload completed 25/25 players and 539/539 requests successfully, but reroll p95 3.35 s missed the unchanged 2 s budget. This serial SQL experiment uses the same query before/after a set/pick-first covering index; all 12 reroll results match exactly. Full plans are retained in the workflow artifact. This is diagnosis, not gateway-capacity evidence.

| Case | Before median / max ms | Indexed median / max ms |
| --- | ---: | ---: |
| Mixed | 1460 / 3398 | 197 / 397 |
| Cube | 468 / 768 | 99 / 131 |
| Single custom | 82 / 222 | 74 / 79 |
| Multi custom | 519 / 2009 | 110 / 150 |

Three fixed seeds per case. Index storage: 478,814,208 bytes (about 457 MiB). The index is built after the baseline, so cache warming can contribute to the difference; the final isolated gateway/browser gate must still pass. No scoring, selection, or reroll SQL changes are needed. Production migration 0040 builds concurrently and release verification rejects an invalid/incomplete index.
