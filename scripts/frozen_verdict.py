#!/usr/bin/env python3
"""Apply the frozen pass rule to the reserve result. No judgement at read time."""
import json, sys
RESERVE = ["ecl", "fin", "ktk", "mom", "powered-cube", "woe"]
CAND, BASE = "v3-colour-and-pair", "v2"
rep = json.load(open(sys.argv[1]))

agg = {}
for r in rep["runs"]:
    v = r["variant"]["name"]; s = r["served_slice"]
    a = agg.setdefault(v, {"n": 0, "ll": 0.0, "t1": 0.0})
    a["n"] += s["n"]; a["ll"] += s["log_loss"] * s["n"]; a["t1"] += s["top1_accuracy"] * s["n"]
pooled = {v: {"ll": a["ll"] / a["n"], "t1": a["t1"] / a["n"], "n": a["n"]} for v, a in agg.items()}
d_ll = pooled[CAND]["ll"] - pooled[BASE]["ll"]
d_t1 = pooled[CAND]["t1"] - pooled[BASE]["t1"]

regress = []
per_set = []
for c in rep["comparisons"]:
    if not c["slice"].startswith("served") or CAND not in c["candidate"]:
        continue
    p = c["paired"]
    per_set.append((c["set_id"], p["log_loss_delta"], p["log_loss_ci95"],
                    p["top1_delta"], p["top1_ci95"]))
    if p["log_loss_ci95"][0] > 0:
        regress.append(f"{c['set_id']}: log loss worse, separated")
    if p["top1_ci95"][1] < 0:
        regress.append(f"{c['set_id']}: top-1 worse, separated")

passed = d_ll < 0 and d_t1 > 0 and not regress
print("=" * 74)
print("FROZEN TEST PASS - predeclared variant-reserve sets")
print("=" * 74)
print(f"sets: {', '.join(RESERVE)}")
print(f"served-slice decisions: {pooled[BASE]['n']:,}\n")
print(f"{'':<22}{'log loss':>10}{'top-1':>10}")
print(f"{'v2 (incumbent)':<22}{pooled[BASE]['ll']:>10.4f}{pooled[BASE]['t1']:>10.4f}")
print(f"{'v3-colour-and-pair':<22}{pooled[CAND]['ll']:>10.4f}{pooled[CAND]['t1']:>10.4f}")
print(f"{'delta':<22}{d_ll:>+10.4f}{d_t1:>+10.4f}\n")
print(f"{'set':<16}{'d log loss':>12}{'95% CI':>22}{'d top-1':>10}{'95% CI':>22}")
for sid, dll, cll, dt1, ct1 in sorted(per_set):
    print(f"{sid:<16}{dll:>+12.4f}{f'[{cll[0]:+.4f},{cll[1]:+.4f}]':>22}"
          f"{dt1:>+10.4f}{f'[{ct1[0]:+.4f},{ct1[1]:+.4f}]':>22}")
print()
print("pass rule: both pooled metrics improve, AND no set shows a separated regression")
print(f"  pooled log loss improved : {d_ll < 0}")
print(f"  pooled top-1 improved    : {d_t1 > 0}")
print(f"  separated regressions    : {regress or 'none'}")
print(f"\nVERDICT: {'PASS' if passed else 'FAIL'}")
