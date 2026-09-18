# Daily selection v4 validation

100,000 deterministic Daily plans (800,000 decisions), using the 18 September 2026 Live metadata snapshot. Every plan has at least two decisions from the newest set and four from the previous-three pool. All 100,000 plans fit the actual v7 corpus pick-window/difficulty group availability on the isolated production clone.

The optional weight for release rank `r` (newest = 0) is `2^(-r/4)`: a half-life of four eligible releases. The previous-three pool uses the same decay across its three positions. Set sampling is with replacement; source drafts are sampled without replacement. Corpus size does not affect set weights.

Newest four share: **87.5993%**. On 45737 days, at least one of the previous three sets does not appear. Their guarantee applies to the pool, not each member.

| Set | Observed share | Expected share |
|---|---:|---:|
| hob | 29.0029% | 29.0089% |
| msh | 22.9951% | 22.9943% |
| sos | 19.3863% | 19.3358% |
| tmt | 16.2150% | 16.2594% |
| ecl | 1.9969% | 2.0045% |
| tla | 1.6744% | 1.6855% |
| eoe | 1.4185% | 1.4174% |
| fin | 1.2248% | 1.1919% |
| tdm | 1.0050% | 1.0022% |
| dft | 0.8316% | 0.8428% |
| fdn | 0.7056% | 0.7087% |
| dsk | 0.5854% | 0.5959% |
| blb | 0.4948% | 0.5011% |
| mh3 | 0.4211% | 0.4214% |
| otj | 0.3493% | 0.3543% |
| mkm | 0.2976% | 0.2980% |
| lci | 0.2465% | 0.2506% |
| woe | 0.2243% | 0.2107% |
| ltr | 0.1745% | 0.1772% |
| mom | 0.1497% | 0.1490% |
| one | 0.1250% | 0.1253% |
| bro | 0.1099% | 0.1053% |
| dmu | 0.0871% | 0.0886% |
| snc | 0.0830% | 0.0745% |
| neo | 0.0607% | 0.0626% |
| vow | 0.0500% | 0.0527% |
| mid | 0.0481% | 0.0443% |
| ktk | 0.0370% | 0.0372% |

Reproduce: `node scripts/simulate-dailies.mjs results/rebuild-2026-09-18/live-metadata.json 2026-09-18 100000 results/rebuild-2026-09-18/puzzle-groups.json`.

This simulation tests composition and feasible round assignment. The SQL integration suites separately check actual puzzle draws, source uniqueness, invalid windows, archived version retention and exact agreement with the exhaustive reference selector. Simulation is not a substitute for those release gates.
