#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ENVS = ("FIN", "TDM", "DFT")
CAPS = (10.0, 20.0, 50.0)
BOOT = 10_000
SEED = 529
EXPECTED = {
    "FIN": {"training": 20366, "experienced": 104028, "cutoff": 0.60},
    "TDM": {"training": 11887, "experienced": 68170, "cutoff": 0.60},
    "DFT": {"training": 18966, "experienced": 90876, "cutoff": 0.60},
}
EXPECTED_SHA = {
    "FIN": {
        "draft": "9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b",
        "game": "f6452e622976f66dd5420c55741da5b246c7e8d25d63c080e728635e1741a6a6",
    },
    "TDM": {
        "draft": "831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5",
        "game": "e2e679168818d67d812972343ba541d626d0f57140bc22955e09dd07bc2086e4",
    },
    "DFT": {
        "draft": "7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd",
        "game": "734325afbe5c023245e7769fab66c88dcf241407666becb06b956d7fee13a28b",
    },
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_audit(compat_root: Path):
    sys.path.insert(0, str(compat_root / "scripts"))
    import audit_a_transfer_529 as audit  # type: ignore
    return audit


def _load_ope(historical_root: Path):
    sys.path.insert(0, str(historical_root / "research"))
    from contextual_value_draft_weighted_ope import evaluate_draft_weighted, paired_delta  # type: ignore
    return evaluate_draft_weighted, paired_delta


def _outcomes(path: Path, ids: set[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        header = tuple(next(reader))
        pos = {x: i for i, x in enumerate(header)}
        for need in ("draft_id", "event_match_wins"):
            if need not in pos:
                raise SystemExit(f"{path}: missing {need}")
        for row in reader:
            if len(row) != len(header):
                continue
            did = row[pos["draft_id"]].strip()
            if did not in ids:
                continue
            raw = row[pos["event_match_wins"]].strip()
            if not raw:
                continue
            value = float(raw)
            if did in out and out[did] != value:
                raise SystemExit(f"{did}: inconsistent outcome")
            out[did] = value
    if set(out) != ids:
        raise SystemExit(f"{path}: missing outcomes={len(ids - set(out))}")
    return out


def prepare(args) -> None:
    env = args.env.upper()
    if env not in ENVS:
        raise SystemExit(f"unsupported env {env}")
    draft = Path(args.draft)
    game = Path(args.game)
    freeze = Path(args.freeze)
    compat = Path(args.compat_root)
    expected = EXPECTED[env]

    if sha256(draft) != EXPECTED_SHA[env]["draft"]:
        raise SystemExit(f"{env}: draft SHA mismatch")
    if sha256(game) != EXPECTED_SHA[env]["game"]:
        raise SystemExit(f"{env}: game SHA mismatch")

    audit = _load_audit(compat)
    z0 = np.load(freeze, allow_pickle=False)
    data = {k: z0[k] for k in z0.files}
    eval_ids = set(map(str, data["draft_ids"]))
    if len(eval_ids) != 15000:
        raise SystemExit(f"{env}: expected 15000 evaluation drafts, got {len(eval_ids)}")

    skills, _, header = audit.scan_skills(draft)
    training, cutoff, experienced = audit.select_strong_drafts(skills, 100, .15, None)
    training = set(training)
    if len(training) != expected["training"]:
        raise SystemExit(f"{env}: v5 training count {len(training)} != {expected['training']}")
    if int(experienced) != expected["experienced"]:
        raise SystemExit(f"{env}: experienced count {experienced} != {expected['experienced']}")
    if abs(float(cutoff) - expected["cutoff"]) > 1e-12:
        raise SystemExit(f"{env}: cutoff {cutoff} != {expected['cutoff']}")

    wanted = training | eval_ids
    examples = audit.load_examples(draft, wanted, header, training)
    lookup = audit.example_lookup(examples)
    pairs = [(did, ex) for did in training for ex in examples.get(did, ())]
    folds = audit.build_fold_training(pairs, training, 5)
    fits = audit.build_colour_tables_by_fold(game, pairs, folds, env.lower())
    models = {
        f.fold: audit.OutOfFoldModel(f.counts, audit.CountStore.empty(), fits[f.fold])
        for f in folds
    }

    offsets = np.asarray(data["offsets"], dtype=np.int64)
    names = np.asarray(data["candidate_names"])
    dids = np.asarray(data["draft_ids"]).astype(str)
    packs = np.asarray(data["pack_number"], dtype=np.int64)
    picks = np.asarray(data["pick_number"], dtype=np.int64)
    selected = np.asarray(data["selected_ord"], dtype=np.int64)
    v5 = np.empty(len(dids), dtype=np.int16)
    digest = hashlib.sha256()

    for i, did in enumerate(dids):
        key = (did, int(packs[i]) + 1, int(picks[i]) + 1)
        ex = lookup.get(key)
        if ex is None:
            raise SystemExit(f"{env}: missing decision {key}")
        lo, hi = int(offsets[i]), int(offsets[i + 1])
        local = [str(x) for x in names[lo:hi]]
        if set(local) != set(ex.candidates):
            raise SystemExit(f"{env}: candidates differ {key}")
        if not 0 <= int(selected[i]) < len(local) or local[int(selected[i])] != ex.historical_pick:
            raise SystemExit(f"{env}: selected action differs {key}")
        p = audit.probs(models[audit.stable_fold(did, 5)], ex)
        top = audit.ranking(p)[0]
        v5[i] = local.index(top)
        digest.update(f"{did}\0{packs[i]}\0{picks[i]}\0{top}\n".encode())

    ymap = _outcomes(draft, eval_ids)
    outcome = np.asarray([ymap[str(x)] for x in dids], dtype=np.float64)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, v5_ord=v5, outcome=outcome)
    meta = {
        "env": env,
        "draft_sha256": sha256(draft),
        "game_sha256": sha256(game),
        "training_drafts": len(training),
        "experienced_drafts": int(experienced),
        "win_rate_cutoff": float(cutoff),
        "decisions": len(v5),
        "evaluation_drafts": len(eval_ids),
        "action_digest_sha256": digest.hexdigest(),
        "model": "strong-player-colour-stage-v5 reconstructed with unchanged five-fold source isolation and no training cap",
    }
    Path(args.meta).write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n")
    print(json.dumps(meta, indent=2))


def _estimate(data, behavior, left, right, y, eval_dw, paired_delta):
    idx = np.arange(len(data["draft_ids"]), dtype=np.int64)
    rows = {}
    terms = {}
    for cap in CAPS:
        le, lt = eval_dw(
            offsets=data["offsets"], selected_ord=data["selected_ord"], target_ord=left,
            outcome=y, behavior=behavior, q_values=data["q_values"], draft_ids=data["draft_ids"],
            decision_indices=idx, cap=cap,
        )
        re, rt = eval_dw(
            offsets=data["offsets"], selected_ord=data["selected_ord"], target_ord=right,
            outcome=y, behavior=behavior, q_values=data["q_values"], draft_ids=data["draft_ids"],
            decision_indices=idx, cap=cap,
        )
        delta = paired_delta(lt, rt)
        rows[str(int(cap))] = {
            "left": le.__dict__,
            "right": re.__dict__,
            "minus_right": {
                "dr": float(le.dr - re.dr),
                "direct": float(le.direct - re.direct),
                "residual_correction": float((le.dr - re.dr) - (le.direct - re.direct)),
                "snips": float(le.snips - re.snips),
                "ipw": float(le.ipw - re.ipw),
            },
        }
        terms[str(int(cap))] = delta
    return rows, terms


def _bootstrap_many(series: dict[str, dict[str, np.ndarray]]):
    names = list(series)
    envs = sorted(ENVS)
    n = 15000
    stacks = {e: np.stack([np.asarray(series[name][e], float) for name in names]) for e in envs}
    vals = np.empty((len(names), BOOT))
    rng = np.random.default_rng(SEED)
    chunk = 20
    for start in range(0, BOOT, chunk):
        take = min(chunk, BOOT - start)
        inds = rng.integers(0, n, size=(take, len(envs), n))
        means = np.zeros((len(names), take))
        for j, e in enumerate(envs):
            means += np.mean(stacks[e][:, inds[:, j, :]], axis=2)
        vals[:, start:start + take] = means / len(envs)
    return {
        name: [float(np.quantile(vals[i], .025)), float(np.quantile(vals[i], .975))]
        for i, name in enumerate(names)
    }


def aggregate(args) -> None:
    eval_dw, paired_delta = _load_ope(Path(args.historical_root))
    historical_r = json.loads(Path(args.historical_r_report).read_text())
    historical_v4 = json.loads(Path(args.historical_v4_report).read_text())

    freeze_dir = Path(args.freeze_dir)
    prepared_dir = Path(args.prepared_dir)
    per_env = {}
    primary_series: dict[str, dict[str, np.ndarray]] = {k: {} for k in ("r_minus_v5", "v5_minus_research", "r_minus_research")}
    alternative_series: dict[str, dict[str, np.ndarray]] = {k: {} for k in primary_series}

    for env in ENVS:
        z0 = np.load(freeze_dir / env / "frozen-evaluation-context.npz", allow_pickle=False)
        data = {k: z0[k] for k in z0.files}
        prep = np.load(prepared_dir / env / "prepared.npz", allow_pickle=False)
        v5 = np.asarray(prep["v5_ord"], dtype=np.int64)
        y = np.asarray(prep["outcome"], dtype=np.float64)
        r = np.asarray(data["r_lcb_ord"], dtype=np.int64)
        research = np.asarray(data["incumbent_ord"], dtype=np.int64)
        pb = np.asarray(data["primary_behavior"], dtype=float)
        ab = np.asarray(data["alternative_behavior"], dtype=float)
        pairs = {
            "r_minus_v5": (r, v5),
            "v5_minus_research": (v5, research),
            "r_minus_research": (r, research),
        }
        env_row = {
            "decisions": len(v5),
            "r_v5_action_agreement": float(np.mean(r == v5)),
            "v5_research_action_agreement": float(np.mean(v5 == research)),
            "r_research_action_agreement": float(np.mean(r == research)),
        }
        for name, (left, right) in pairs.items():
            prow, pterms = _estimate(data, pb, left, right, y, eval_dw, paired_delta)
            arow, aterms = _estimate(data, ab, left, right, y, eval_dw, paired_delta)
            env_row[name] = {"primary": prow, "alternative": arow}
            primary_series[name][env] = pterms["20"]
            alternative_series[name][env] = aterms["20"]
        lhs = env_row["r_minus_research"]["primary"]["20"]["minus_right"]["dr"]
        rhs = (
            env_row["r_minus_v5"]["primary"]["20"]["minus_right"]["dr"]
            + env_row["v5_minus_research"]["primary"]["20"]["minus_right"]["dr"]
        )
        if abs(lhs - rhs) > 1e-12:
            raise SystemExit(f"{env}: DR additivity failed: {lhs} vs {rhs}")
        per_env[env] = env_row

    series = {}
    for name in primary_series:
        series[name + ":primary"] = primary_series[name]
        series[name + ":alternative"] = alternative_series[name]
    ci = _bootstrap_many(series)

    aggregate_rows = {}
    for name in primary_series:
        p = float(np.mean([np.mean(primary_series[name][e]) for e in ENVS]))
        a = float(np.mean([np.mean(alternative_series[name][e]) for e in ENVS]))
        aggregate_rows[name] = {
            "primary_cap20_dr": p,
            "primary_ci95": ci[name + ":primary"],
            "alternative_cap20_dr": a,
            "alternative_ci95": ci[name + ":alternative"],
            "per_environment_primary_cap20_dr": {
                e: per_env[e][name]["primary"]["20"]["minus_right"]["dr"] for e in ENVS
            },
        }

    ref = aggregate_rows["r_minus_research"]
    reproduction = {
        "point_abs_error": abs(ref["primary_cap20_dr"] - float(historical_r["primary"]["cap20_dr"])),
        "ci_lo_abs_error": abs(ref["primary_ci95"][0] - float(historical_r["primary"]["ci95"][0])),
        "ci_hi_abs_error": abs(ref["primary_ci95"][1] - float(historical_r["primary"]["ci95"][1])),
        "alternative_point_abs_error": abs(ref["alternative_cap20_dr"] - float(historical_r["alternative_same_actions"]["cap20_dr"])),
    }
    reproduction["pass"] = all(v <= 1e-12 for k, v in reproduction.items() if k != "pass")
    if not reproduction["pass"]:
        raise SystemExit(f"historical R-research reproduction failed: {reproduction}")

    old_r_v4 = historical_v4["aggregate"]["r_minus_deployed"]
    report = {
        "schema": 1,
        "scope": "same frozen 45,000 FIN/TDM/DFT drafts (15k each), all available P1P1-P1P8; equal draft and environment weight",
        "v5_definition": "strong-player-colour-stage-v5; complete qualified cohort; unchanged five-fold source isolation; no 5,000-draft cap",
        "challenger": "frozen R-LCB c=2.49; no refit or retuning",
        "estimator": "paired draft-weighted cap20 DR; 10,000-draw environment-stratified paired draft bootstrap; seed 529",
        "historical_r_minus_research_reproduction": reproduction,
        "historical_r_minus_v4": {
            "primary_cap20_dr": old_r_v4["primary"]["cap20_dr"],
            "primary_ci95": old_r_v4["primary"]["ci95"],
            "alternative_cap20_dr": old_r_v4["alternative_same_actions"]["cap20_dr"],
            "alternative_ci95": old_r_v4["alternative_same_actions"]["ci95"],
        },
        "new": aggregate_rows,
        "per_environment": per_env,
        "interpretation_guard": "Observational off-policy evaluation; estimates policy-value differences under the frozen nuisance/evaluator design and does not establish causal superiority.",
        "production_change_authorized": False,
    }
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")

    rv5 = aggregate_rows["r_minus_v5"]
    v5r = aggregate_rows["v5_minus_research"]
    old = report["historical_r_minus_v4"]
    lines = [
        "# Frozen R-LCB vs production v5 — 45k update",
        "",
        "Same frozen 45,000 FIN/TDM/DFT drafts and same R-LCB actions/evaluator as the September independent confirmation; only the incumbent consensus reconstruction changes from capped v4 to uncapped v5.",
        "",
        "| Contrast | cap-20 DR wins | 95% CI |",
        "| --- | ---: | --- |",
        f"| R-LCB − v4 (historical exact audit) | {float(old['primary_cap20_dr']):+.6f} | [{float(old['primary_ci95'][0]):+.6f}, {float(old['primary_ci95'][1]):+.6f}] |",
        f"| R-LCB − v5 (new) | {rv5['primary_cap20_dr']:+.6f} | [{rv5['primary_ci95'][0]:+.6f}, {rv5['primary_ci95'][1]:+.6f}] |",
        f"| v5 − research-A | {v5r['primary_cap20_dr']:+.6f} | [{v5r['primary_ci95'][0]:+.6f}, {v5r['primary_ci95'][1]:+.6f}] |",
        "",
        f"Historical R−research-A reproduction: **{'PASS' if reproduction['pass'] else 'FAIL'}**.",
        "",
        "This is observational OPE, not a randomized causal test, and authorizes no production change.",
    ]
    (outdir / "report.md").write_text("\n".join(lines) + "\n")
    print(json.dumps({
        "r_minus_v4": old,
        "r_minus_v5": rv5,
        "v5_minus_research": v5r,
        "historical_reproduction": reproduction,
    }, indent=2))


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("prepare")
    a.add_argument("--env", required=True)
    a.add_argument("--draft", required=True)
    a.add_argument("--game", required=True)
    a.add_argument("--freeze", required=True)
    a.add_argument("--compat-root", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--meta", required=True)
    b = sub.add_parser("aggregate")
    b.add_argument("--freeze-dir", required=True)
    b.add_argument("--prepared-dir", required=True)
    b.add_argument("--historical-root", required=True)
    b.add_argument("--historical-r-report", required=True)
    b.add_argument("--historical-v4-report", required=True)
    b.add_argument("--out", required=True)
    args = p.parse_args()
    if args.cmd == "prepare":
        prepare(args)
    else:
        aggregate(args)


if __name__ == "__main__":
    main()
