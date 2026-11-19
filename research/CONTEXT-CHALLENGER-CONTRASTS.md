# Context challenger contrasts: preregistration

Status: frozen before scoring any new arm or pairwise contrast. Append findings only below `## Results`; never rewrite the design after inspecting outcomes. This is a secondary pick-prediction experiment, not a decision-quality or release gate.

## Arms

The `v5`, `splash`, `explicit` and `explicit-fixing` definitions in [CONTEXT-CHALLENGERS.md](CONTEXT-CHALLENGERS.md) are unchanged. All use the uncapped harness train split, `v3-colour-and-pair` backbone, temperature 1.0 and independently refitted commitment, stage and marginal tables. Counts, pair expectations and evaluation decisions are shared.

Add `explicit-matched`: start with `explicit`, then make a card unknown wherever `v5` has no color judgment (absent or `None`). The known-empty flexible value counts as a v5 judgment. For supported spells use printed cast colors; supported lands are flexible, exactly as in `explicit`. Unsupported metadata retains the known v5 value. This holds the set of cards eligible for a color judgment equal to v5, including prior-pool cards, and separates explicit representation from expanded coverage. The fit can still differ because its commitment observations are refitted. No hybrid arm is included.

## Data

FRA, HOB, MSH, SOS, ECL and TMT validation results have already been seen. All their new results are development-only and cannot count toward any verdict. First reproduce the four existing arms' committed outputs on these six sets, without changing them.

Fresh confirmation is the next five most recent `category: expansion` entries by descending `source_date` in the inherited `corpus/draft-run/catalog.json`, after HOB/MSH/SOS/ECL/TMT:

| Set | Catalog source date |
| --- | --- |
| TLA | 2026-01-10 |
| EOE | 2025-09-03 |
| FIN | 2025-07-19 |
| TDM | 2025-05-20 |
| DFT | 2025-03-23 |

Use official 17Lands PremierDraft draft/game archives and checksum-pinned card metadata. Record SHA-256 for both archives, metadata and cache identity. Raw archives/caches remain ignored. Default extraction cohort is at least 100 games and the top 15% win-rate bucket. Train on the harness training split; score only validation, Pack 1 picks 1–11. The test split is reserved: do not score, inspect examples from it, tune against it or report its performance. Archive extraction may mechanically serialize it, as in the existing harness.

No set substitutions after seeing results. A source/checksum failure leaves the comparison incomplete until the pinned data is available. Describe these sets as fresh for these contrasts, not as never previously used anywhere in the repository.

## Contrasts and metrics

Every unordered pair among the four non-v5 arms is preregistered, in this fixed order: `splash`, `explicit`, `explicit-fixing`, `explicit-matched`. There are six comparisons. Each stored comparison is the later arm minus the earlier arm; negative log loss favors the later arm. Report v5-reference comparisons separately.

Primary metric: served-slice log loss. Guardrail: top-1 accuracy. Use the harness `paired_bootstrap` on identical decisions, clustering by draft, 2,000 draws and seed 20260915. Report 95% intervals. Also report Brier score, leader changes, mean absolute model-only point changes and color-judgment coverage; these do not determine the verdict.

## Frozen decision rule

A beats B in this secondary check if A minus B has a log-loss interval strictly below zero on at least four of the five fresh confirmation sets, and its top-1 interval is strictly below zero on none. Apply the same symmetric rule for B beating A; otherwise report inconclusive. A zero boundary is not significant. Missing results mean incomplete, not inconclusive or a win. The harness's five-decimal interval endpoints are the decision inputs, as in the previous experiment.

Six pairs across five sets create multiple comparisons. The intervals are pointwise and not adjusted for family-wise error; the cross-set consistency rule does not turn them into simultaneous 95% guarantees. Report every comparison, not just favorable ones. No omnibus winner is selected unless one arm beats all other non-v5 arms under the frozen rule. Do not choose by pooled point estimates or add a hybrid after seeing outcomes. Even a winner establishes pick-prediction evidence only, not contextual fairness, causal win value or release readiness.

## Validation and reporting

- Existing four-arm results must reproduce the committed six-set JSON, excluding file-encoding-dependent cache byte hashes if caches must be regenerated; source archive hashes, training ID identity and all numeric results must match. Document any unavoidable cache-byte difference rather than silently ignoring it.
- Keep the guard proving the deck scan reproduces the harness table.
- Synthetic tests cover the matched-coverage mask, unsupported metadata, all six pairs, contrast direction and decision-rule boundaries.
- Commit aggregate-only JSON containing every source checksum and preregistration commit. Generate result tables from JSON and verify them programmatically. Keep player/draft-level rows out of public outputs.
- Do not change production models, point formulas, data, gates or release protections.

## Results

Scored after preregistration `bf5f8f6`. All original four-arm outputs reproduced exactly on all six development sets. Archive/metadata checksums and training identities match. Regenerated cache byte hashes can differ because gzip timestamps and cache filenames are part of the encoding; the committed report records each new cache identity.

Full aggregates and source checksums: [context-challenger-contrasts-2026-10-29.json](data/context-challenger-contrasts-2026-10-29.json). The original preregistration and results are unchanged. Run `python scripts/report_context_contrasts.py --check` to verify every table and verdict without raw archives.

### Fresh confirmation summaries

| Set | Decisions | v5 log loss | splash | explicit | explicit-fixing | explicit-matched |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TLA | 25,320 | 1.25365 | 1.22624 | 1.24351 | 1.24014 | 1.24341 |
| EOE | 21,868 | 1.13759 | 1.11495 | 1.11665 | 1.11665 | 1.11771 |
| FIN | 33,957 | 1.22511 | 1.20837 | 1.21626 | 1.21575 | 1.21672 |
| TDM | 19,338 | 1.25838 | 1.26555 | 1.27223 | 1.26092 | 1.27258 |
| DFT | 30,795 | 1.21999 | 1.19689 | 1.20293 | 1.19900 | 1.20330 |

Color-judgment coverage (known cards / fitted cards):

| Set | v5 | splash | explicit | explicit-fixing | explicit-matched |
| --- | ---: | ---: | ---: | ---: | ---: |
| TLA | 277/347 | 277/347 | 286/347 | 286/347 | 277/347 |
| EOE | 270/316 | 270/316 | 280/316 | 280/316 | 270/316 |
| FIN | 329/362 | 329/362 | 339/362 | 339/362 | 329/362 |
| TDM | 270/286 | 270/286 | 276/286 | 276/286 | 270/286 |
| DFT | 275/286 | 275/286 | 281/286 | 281/286 | 275/286 |

### v5 reference comparisons

These reference comparisons do not determine the six challenger verdicts. Negative log loss favors the arm; positive top-1 favors the arm.

| Set | Arm minus v5 | Log-loss delta [95% CI] | Top-1 delta [95% CI], pp |
| --- | --- | ---: | ---: |
| TLA | splash | -0.02741 [-0.02996, -0.02474] | +0.170 [-0.194, +0.525] |
| TLA | explicit | -0.01015 [-0.01209, -0.00820] | +0.150 [-0.107, +0.415] |
| TLA | explicit-fixing | -0.01351 [-0.01574, -0.01120] | -0.122 [-0.430, +0.186] |
| TLA | explicit-matched | -0.01025 [-0.01211, -0.00833] | +0.138 [-0.111, +0.399] |
| EOE | splash | -0.02264 [-0.02493, -0.02051] | +0.960 [+0.649, +1.280] |
| EOE | explicit | -0.02094 [-0.02301, -0.01885] | +0.919 [+0.613, +1.207] |
| EOE | explicit-fixing | -0.02094 [-0.02322, -0.01878] | +0.777 [+0.476, +1.093] |
| EOE | explicit-matched | -0.01988 [-0.02192, -0.01786] | +0.910 [+0.613, +1.203] |
| FIN | splash | -0.01675 [-0.01850, -0.01495] | +0.571 [+0.303, +0.851] |
| FIN | explicit | -0.00885 [-0.01023, -0.00752] | +0.380 [+0.180, +0.583] |
| FIN | explicit-fixing | -0.00936 [-0.01107, -0.00762] | +0.265 [+0.015, +0.524] |
| FIN | explicit-matched | -0.00839 [-0.00969, -0.00714] | +0.395 [+0.203, +0.598] |
| TDM | splash | +0.00717 [+0.00463, +0.00974] | -0.165 [-0.533, +0.207] |
| TDM | explicit | +0.01385 [+0.01125, +0.01648] | -1.164 [-1.541, -0.812] |
| TDM | explicit-fixing | +0.00254 [+0.00000, +0.00512] | -0.403 [-0.781, -0.026] |
| TDM | explicit-matched | +0.01420 [+0.01168, +0.01677] | -1.132 [-1.515, -0.786] |
| DFT | splash | -0.02310 [-0.02511, -0.02103] | +1.068 [+0.793, +1.357] |
| DFT | explicit | -0.01706 [-0.01902, -0.01522] | +0.796 [+0.562, +1.054] |
| DFT | explicit-fixing | -0.02099 [-0.02308, -0.01881] | +0.925 [+0.636, +1.220] |
| DFT | explicit-matched | -0.01669 [-0.01854, -0.01488] | +0.792 [+0.553, +1.039] |

### Frozen-rule verdicts

| Comparison | Result |
| --- | --- |
| explicit vs splash | splash beats explicit |
| explicit-fixing vs splash | splash beats explicit-fixing |
| explicit-matched vs splash | splash beats explicit-matched |
| explicit-fixing vs explicit | inconclusive |
| explicit-matched vs explicit | inconclusive |
| explicit-matched vs explicit-fixing | inconclusive |

### explicit minus splash

**Verdict: baseline beats candidate.** Candidate log-loss wins: 0/5; baseline wins: 5/5. Significantly worse top-1 sets: candidate 2, baseline 0.

Negative log loss favors the candidate; positive top-1 favors the candidate. Top-1 is in percentage points. Development rows do not enter the verdict.

| Set | Role | Log-loss delta [95% CI] | Top-1 delta [95% CI], pp |
| --- | --- | ---: | ---: |
| TLA | confirmation | +0.01727 [+0.01483, +0.01967] | -0.020 [-0.332, +0.332] |
| EOE | confirmation | +0.00171 [+0.00062, +0.00276] | -0.041 [-0.210, +0.128] |
| FIN | confirmation | +0.00789 [+0.00652, +0.00934] | -0.191 [-0.421, +0.047] |
| TDM | confirmation | +0.00668 [+0.00402, +0.00942] | -0.998 [-1.381, -0.605] |
| DFT | confirmation | +0.00604 [+0.00473, +0.00733] | -0.273 [-0.489, -0.055] |
| FRA | development | +0.00847 [+0.00586, +0.01120] | +0.133 [-0.319, +0.572] |
| HOB | development | +0.00274 [-0.00060, +0.00631] | +0.259 [-0.158, +0.705] |
| MSH | development | +0.00905 [+0.00714, +0.01108] | -0.123 [-0.436, +0.178] |
| SOS | development | +0.01684 [+0.01446, +0.01909] | -1.006 [-1.335, -0.682] |
| ECL | development | +0.00599 [+0.00317, +0.00880] | -0.169 [-0.578, +0.263] |
| TMT | development | -0.00338 [-0.01146, +0.00456] | -0.175 [-1.116, +0.766] |

### explicit-fixing minus splash

**Verdict: baseline beats candidate.** Candidate log-loss wins: 1/5; baseline wins: 4/5. Significantly worse top-1 sets: candidate 4, baseline 0.

Negative log loss favors the candidate; positive top-1 favors the candidate. Top-1 is in percentage points. Development rows do not enter the verdict.

| Set | Role | Log-loss delta [95% CI] | Top-1 delta [95% CI], pp |
| --- | --- | ---: | ---: |
| TLA | confirmation | +0.01390 [+0.01159, +0.01616] | -0.292 [-0.553, -0.016] |
| EOE | confirmation | +0.00171 [+0.00077, +0.00267] | -0.183 [-0.316, -0.046] |
| FIN | confirmation | +0.00739 [+0.00614, +0.00871] | -0.306 [-0.474, -0.141] |
| TDM | confirmation | -0.00463 [-0.00703, -0.00223] | -0.238 [-0.590, +0.098] |
| DFT | confirmation | +0.00211 [+0.00105, +0.00325] | -0.143 [-0.283, -0.010] |
| FRA | development | +0.00493 [+0.00240, +0.00762] | -0.106 [-0.439, +0.226] |
| HOB | development | -0.00256 [-0.00547, +0.00055] | -0.072 [-0.360, +0.201] |
| MSH | development | +0.01044 [+0.00846, +0.01242] | -0.559 [-0.792, -0.319] |
| SOS | development | +0.00674 [+0.00461, +0.00865] | -0.385 [-0.702, -0.081] |
| ECL | development | +0.00563 [+0.00276, +0.00850] | -0.333 [-0.748, +0.088] |
| TMT | development | -0.01325 [-0.02085, -0.00545] | +0.394 [-0.481, +1.335] |

### explicit-matched minus splash

**Verdict: baseline beats candidate.** Candidate log-loss wins: 0/5; baseline wins: 5/5. Significantly worse top-1 sets: candidate 2, baseline 0.

Negative log loss favors the candidate; positive top-1 favors the candidate. Top-1 is in percentage points. Development rows do not enter the verdict.

| Set | Role | Log-loss delta [95% CI] | Top-1 delta [95% CI], pp |
| --- | --- | ---: | ---: |
| TLA | confirmation | +0.01717 [+0.01484, +0.01945] | -0.032 [-0.336, +0.304] |
| EOE | confirmation | +0.00277 [+0.00176, +0.00370] | -0.050 [-0.192, +0.101] |
| FIN | confirmation | +0.00836 [+0.00699, +0.00972] | -0.177 [-0.403, +0.059] |
| TDM | confirmation | +0.00703 [+0.00436, +0.00970] | -0.967 [-1.345, -0.574] |
| DFT | confirmation | +0.00641 [+0.00513, +0.00764] | -0.276 [-0.487, -0.059] |
| FRA | development | +0.01274 [+0.01033, +0.01511] | +0.027 [-0.412, +0.478] |
| HOB | development | +0.00630 [+0.00345, +0.00914] | +0.245 [-0.187, +0.676] |
| MSH | development | +0.01002 [+0.00819, +0.01188] | -0.160 [-0.467, +0.135] |
| SOS | development | +0.01710 [+0.01475, +0.01933] | -0.974 [-1.298, -0.649] |
| ECL | development | +0.00698 [+0.00414, +0.00973] | -0.123 [-0.537, +0.321] |
| TMT | development | +0.00208 [-0.00544, +0.00970] | -0.219 [-1.138, +0.722] |

### explicit-fixing minus explicit

**Verdict: inconclusive.** Candidate log-loss wins: 3/5; baseline wins: 0/5. Significantly worse top-1 sets: candidate 1, baseline 1.

Negative log loss favors the candidate; positive top-1 favors the candidate. Top-1 is in percentage points. Development rows do not enter the verdict.

| Set | Role | Log-loss delta [95% CI] | Top-1 delta [95% CI], pp |
| --- | --- | ---: | ---: |
| TLA | confirmation | -0.00336 [-0.00472, -0.00194] | -0.273 [-0.533, -0.028] |
| EOE | confirmation | +0.00000 [-0.00102, +0.00102] | -0.142 [-0.297, +0.018] |
| FIN | confirmation | -0.00050 [-0.00179, +0.00084] | -0.115 [-0.330, +0.088] |
| TDM | confirmation | -0.01131 [-0.01291, -0.00977] | +0.760 [+0.486, +1.039] |
| DFT | confirmation | -0.00393 [-0.00529, -0.00248] | +0.130 [-0.088, +0.347] |
| FRA | development | -0.00354 [-0.00584, -0.00098] | -0.239 [-0.651, +0.186] |
| HOB | development | -0.00530 [-0.00719, -0.00330] | -0.331 [-0.690, +0.029] |
| MSH | development | +0.00139 [-0.00058, +0.00341] | -0.436 [-0.725, -0.141] |
| SOS | development | -0.01011 [-0.01160, -0.00867] | +0.621 [+0.393, +0.860] |
| ECL | development | -0.00036 [-0.00104, +0.00039] | -0.164 [-0.298, -0.029] |
| TMT | development | -0.00987 [-0.01334, -0.00621] | +0.569 [+0.066, +1.072] |

### explicit-matched minus explicit

**Verdict: inconclusive.** Candidate log-loss wins: 0/5; baseline wins: 2/5. Significantly worse top-1 sets: candidate 0, baseline 0.

Negative log loss favors the candidate; positive top-1 favors the candidate. Top-1 is in percentage points. Development rows do not enter the verdict.

| Set | Role | Log-loss delta [95% CI] | Top-1 delta [95% CI], pp |
| --- | --- | ---: | ---: |
| TLA | confirmation | -0.00010 [-0.00065, +0.00041] | -0.012 [-0.075, +0.051] |
| EOE | confirmation | +0.00106 [+0.00050, +0.00164] | -0.009 [-0.091, +0.078] |
| FIN | confirmation | +0.00047 [+0.00006, +0.00083] | +0.015 [-0.044, +0.071] |
| TDM | confirmation | +0.00035 [-0.00015, +0.00081] | +0.031 [-0.021, +0.083] |
| DFT | confirmation | +0.00037 [-0.00005, +0.00075] | -0.003 [-0.058, +0.049] |
| FRA | development | +0.00427 [+0.00278, +0.00569] | -0.106 [-0.332, +0.120] |
| HOB | development | +0.00356 [+0.00157, +0.00548] | -0.014 [-0.259, +0.201] |
| MSH | development | +0.00098 [+0.00026, +0.00159] | -0.037 [-0.098, +0.025] |
| SOS | development | +0.00025 [-0.00013, +0.00063] | +0.032 [-0.032, +0.101] |
| ECL | development | +0.00099 [+0.00030, +0.00169] | +0.047 [-0.029, +0.123] |
| TMT | development | +0.00546 [+0.00327, +0.00762] | -0.044 [-0.306, +0.219] |

### explicit-matched minus explicit-fixing

**Verdict: inconclusive.** Candidate log-loss wins: 0/5; baseline wins: 3/5. Significantly worse top-1 sets: candidate 1, baseline 1.

Negative log loss favors the candidate; positive top-1 favors the candidate. Top-1 is in percentage points. Development rows do not enter the verdict.

| Set | Role | Log-loss delta [95% CI] | Top-1 delta [95% CI], pp |
| --- | --- | ---: | ---: |
| TLA | confirmation | +0.00326 [+0.00172, +0.00482] | +0.261 [+0.012, +0.517] |
| EOE | confirmation | +0.00106 [-0.00006, +0.00223] | +0.133 [-0.032, +0.293] |
| FIN | confirmation | +0.00097 [-0.00033, +0.00224] | +0.130 [-0.077, +0.347] |
| TDM | confirmation | +0.01166 [+0.01004, +0.01327] | -0.729 [-1.019, -0.445] |
| DFT | confirmation | +0.00430 [+0.00275, +0.00571] | -0.133 [-0.354, +0.094] |
| FRA | development | +0.00781 [+0.00481, +0.01049] | +0.133 [-0.319, +0.598] |
| HOB | development | +0.00886 [+0.00595, +0.01170] | +0.316 [-0.101, +0.705] |
| MSH | development | -0.00042 [-0.00245, +0.00156] | +0.399 [+0.104, +0.694] |
| SOS | development | +0.01036 [+0.00887, +0.01193] | -0.588 [-0.828, -0.349] |
| ECL | development | +0.00135 [+0.00029, +0.00233] | +0.210 [+0.058, +0.356] |
| TMT | development | +0.01533 [+0.01134, +0.01960] | -0.613 [-1.182, -0.044] |

### Interpretation

An arm beats every other arm under the frozen rule: splash.

These are comparisons of strong-player pick prediction. They do not measure contextual scoring fairness or causal win value and cannot authorize a release. Commitment still counts any color overlap; demanding pips, alternate costs and landcycling remain outside these arms. The matched arm controls color-judgment eligibility, not every interaction between coverage and refitted statistics. Intervals are pointwise across multiple comparisons. The test split was not scored or used for selection.

The v5 reference is a material caveat: splash has significantly higher log loss on TDM. Winning among challengers does not imply improvement over v5 in every format.

The explicit versus explicit-matched comparison is inconclusive. This check does not establish expanded color-judgment coverage as the explanation for the earlier explicit-arm gains.
