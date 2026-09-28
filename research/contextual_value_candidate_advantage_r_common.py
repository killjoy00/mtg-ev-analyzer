#!/usr/bin/env python3
"""Shared pre-result machinery for amended candidate-advantage R-prime / R-LCB."""
from __future__ import annotations

import gzip
import json
import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np

GLOBAL_L2 = 100.0
SET_L2 = 1000.0
PSEUDO_CAP = 20.0
SUPPORT_FLOOR = 0.05
CORE = ("ECL", "MSH", "SOS", "TLA")
NULL_DRAWS = 5000
NULL_SEED = 529
NULL_MAX_DEVIATION = 0.02
C_GRID = np.round(np.arange(0.0, 6.0001, 0.01), 2)

PACKREL_BASES = (
    "alsa", "ata", "deck_inclusion_probability", "gih_wr",
    "gnd_wr", "iwd", "log1p_gih_games", "log1p_gnd_games",
)
ZERO_Z_NAMES = (
    "card:metadata_missing",
    *tuple(f"packrel:{base}:range" for base in PACKREL_BASES),
    *tuple(f"packrel:{base}:present_fraction" for base in PACKREL_BASES),
)
IDENTICAL_PRESENT = (
    "packrel:gih_wr:present",
    "packrel:gnd_wr:present",
    "packrel:iwd:present",
    "packrel:log1p_gih_games:present",
    "packrel:log1p_gnd_games:present",
)
PRESENT_REPRESENTATIVE = "packrel:gih_wr:present"


@dataclass
class RFit:
    coefficient: np.ndarray
    covariance: np.ndarray
    global_beta: np.ndarray
    global_covariance: np.ndarray
    z_mean: np.ndarray
    z_scale: np.ndarray
    keep_indices: np.ndarray
    keep_names: list[str]
    control_schema: dict
    slices: dict
    diagnostics: dict


def read_jsonl_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def load_fold(path: Path, report_path: Path, *, include_outcome: bool) -> dict:
    raw = np.load(path, allow_pickle=False)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    fold = int(raw["fold"][0])
    if int(report["fold"]) != fold:
        raise SystemExit(f"fold report mismatch for {fold}")
    if report.get("assessment_opened") is not False or report.get("assessment_outcomes_used") is not False:
        raise SystemExit(f"fold {fold} assessment boundary violation")
    keys = [
        "state_rich", "cand_rich", "offsets", "candidate_names", "decision_ids",
        "draft_ids", "expansion", "pack_number", "pick_number", "skill_rate",
        "user_games_lower_bound", "selected_ord", "incumbent_ord",
        "decision_weight",
    ]
    if include_outcome:
        keys.append("outcome")
    for optional in ("phi_simple", "phi_rich", "behavior", "q_simple"):
        if optional in raw.files:
            keys.append(optional)
    data = {key: raw[key] for key in keys}
    data["fold"] = fold
    data["report"] = report
    return data


def read_nuisance(path: Path, expected_fold: int) -> dict[str, dict]:
    rows = {}
    for raw in read_jsonl_gz(path):
        fold = int(raw["fold"])
        if fold != expected_fold:
            raise SystemExit(f"nuisance file mixes fold {fold}, expected {expected_fold}")
        did = str(raw["decision_id"])
        if did in rows:
            raise SystemExit(f"duplicate nuisance decision {did}")
        rows[did] = {
            "behavior": {str(k): float(v) for k, v in raw["behavior"].items()},
            "q_values": {str(k): float(v) for k, v in raw["q_values"].items()},
            "training_draft_count": int(raw["training_draft_count"]),
        }
    return rows


def align_nuisance(
    data: Mapping[str, np.ndarray],
    nuisance_rows: Mapping[str, Mapping[str, object]],
    *,
    verify_phi: bool,
) -> tuple[np.ndarray, np.ndarray, dict]:
    decision_ids = [str(x) for x in data["decision_ids"]]
    if set(decision_ids) != set(nuisance_rows):
        missing = sorted(set(decision_ids)-set(nuisance_rows))[:3]
        extra = sorted(set(nuisance_rows)-set(decision_ids))[:3]
        raise SystemExit(f"nuisance decision coverage mismatch missing={missing} extra={extra}")
    offsets = np.asarray(data["offsets"], dtype=np.int64)
    names = data["candidate_names"].astype(str)
    behavior = np.empty(len(names), dtype=np.float64)
    q = np.empty(len(names), dtype=np.float64)
    max_sum_error = 0.0
    candidate_mismatches = 0
    for i,did in enumerate(decision_ids):
        start,stop=int(offsets[i]),int(offsets[i+1])
        offered=list(names[start:stop])
        source=nuisance_rows[did]
        bp=source["behavior"]; qp=source["q_values"]
        if set(offered)!=set(bp) or set(offered)!=set(qp):
            candidate_mismatches += 1
            raise SystemExit(f"candidate set mismatch for {did}")
        for local,name in enumerate(offered):
            behavior[start+local]=float(bp[name])
            q[start+local]=float(qp[name])
        err=abs(float(np.sum(behavior[start:stop]))-1.0)
        max_sum_error=max(max_sum_error,err)
        if err>1e-9:
            raise SystemExit(f"behavior sum error {err} for {did}")
        if np.any(behavior[start:stop] <= 0):
            raise SystemExit(f"nonpositive behavior for {did}")

    stored_behavior_error=None
    stored_q_error=None
    if "behavior" in data:
        stored_behavior_error=float(np.max(np.abs(np.asarray(data["behavior"],float)-behavior)))
        if stored_behavior_error>1e-12:
            raise SystemExit(f"stored behavior differs from joined nuisance by {stored_behavior_error}")
    if "q_simple" in data:
        stored_q_error=float(np.max(np.abs(np.asarray(data["q_simple"],float)-q)))
        if stored_q_error>1e-12:
            raise SystemExit(f"stored q_simple differs from joined nuisance by {stored_q_error}")

    unselected_max_error=None
    selected_max_error=None
    if verify_phi:
        if "phi_simple" not in data or "outcome" not in data:
            raise SystemExit("phi parity requested but phi_simple/outcome missing")
        phi=np.asarray(data["phi_simple"],dtype=np.float64)
        selected_global=offsets[:-1]+np.asarray(data["selected_ord"],dtype=np.int64)
        unselected=np.ones(len(phi),dtype=bool)
        unselected[selected_global]=False
        # Required exact parity on unselected rows.
        if not np.array_equal(phi[unselected], q[unselected]):
            unselected_max_error=float(np.max(np.abs(phi[unselected]-q[unselected])))
            raise SystemExit(f"unselected phi/q exact parity failure {unselected_max_error}")
        unselected_max_error=0.0
        propensity=behavior[selected_global]
        inverse=np.minimum(1.0/propensity,PSEUDO_CAP)
        recomputed=q[selected_global]+inverse*(np.asarray(data["outcome"],float)-q[selected_global])
        selected_max_error=float(np.max(np.abs(phi[selected_global]-recomputed)))
        if selected_max_error>1e-10:
            raise SystemExit(f"selected phi recomputation failure {selected_max_error}")

    return behavior,q,{
        "decisions":len(decision_ids),
        "candidate_rows":len(names),
        "candidate_mismatches":candidate_mismatches,
        "max_behavior_sum_error":max_sum_error,
        "unselected_phi_q_max_error":unselected_max_error,
        "selected_phi_recompute_max_error":selected_max_error,
        "stored_behavior_max_error":stored_behavior_error,
        "stored_q_max_error":stored_q_error,
    }


def compute_z(
    data: Mapping[str,np.ndarray],
    behavior: np.ndarray,
) -> np.ndarray:
    offsets=np.asarray(data["offsets"],dtype=np.int64)
    cand=np.asarray(data["cand_rich"],dtype=np.float64)
    selected=offsets[:-1]+np.asarray(data["selected_ord"],dtype=np.int64)
    weighted=cand*np.asarray(behavior,dtype=np.float64)[:,None]
    expectation=np.add.reduceat(weighted,offsets[:-1],axis=0)
    return cand[selected]-expectation


def compute_residual(
    data: Mapping[str,np.ndarray],
    behavior: np.ndarray,
    q: np.ndarray,
) -> np.ndarray:
    if "outcome" not in data:
        raise SystemExit("outcome not loaded")
    offsets=np.asarray(data["offsets"],dtype=np.int64)
    qmean=np.add.reduceat(np.asarray(q,float)*np.asarray(behavior,float),offsets[:-1])
    return np.asarray(data["outcome"],float)-qmean


def feature_cleanup(
    feature_names: Sequence[str],
    z_train: np.ndarray,
    z_validation: np.ndarray,
    *,
    tolerance: float = 1e-12,
) -> tuple[np.ndarray,list[str],dict]:
    names=list(feature_names)
    by_name={name:i for i,name in enumerate(names)}
    missing=[name for name in (*ZERO_Z_NAMES,*IDENTICAL_PRESENT) if name not in by_name]
    if missing:
        raise SystemExit(f"expected R feature names missing: {missing}")
    zero_errors={}
    for name in ZERO_Z_NAMES:
        idx=by_name[name]
        err=max(float(np.max(np.abs(z_train[:,idx]))),float(np.max(np.abs(z_validation[:,idx]))))
        zero_errors[name]=err
        if err>tolerance:
            raise SystemExit(f"expected zero residual feature {name} has max abs {err}")
    rep=by_name[PRESENT_REPRESENTATIVE]
    identical_errors={}
    for name in IDENTICAL_PRESENT:
        idx=by_name[name]
        err=max(
            float(np.max(np.abs(z_train[:,idx]-z_train[:,rep]))),
            float(np.max(np.abs(z_validation[:,idx]-z_validation[:,rep]))),
        )
        identical_errors[name]=err
        if err>tolerance:
            raise SystemExit(f"expected identical present feature {name} differs by {err}")

    drop=set(ZERO_Z_NAMES)
    drop.update(name for name in IDENTICAL_PRESENT if name!=PRESENT_REPRESENTATIVE)
    keep=np.asarray([i for i,name in enumerate(names) if name not in drop],dtype=np.int64)
    kept=[names[i] for i in keep]
    return keep,kept,{
        "zero_feature_max_abs":zero_errors,
        "identical_present_max_abs_diff":identical_errors,
        "dropped":sorted(drop),
        "kept_count":len(kept),
        "dropped_count":len(drop),
    }


def weighted_mean_scale(x: np.ndarray, weight: np.ndarray, floor: float=1e-8):
    x=np.asarray(x,dtype=np.float64)
    w=np.asarray(weight,dtype=np.float64)
    total=float(np.sum(w))
    mean=np.sum(x*w[:,None],axis=0)/total
    var=np.sum(np.square(x-mean)*w[:,None],axis=0)/total
    scale=np.sqrt(np.maximum(var,0.0))
    near=scale<floor
    scale=np.where(near,1.0,scale)
    return mean,scale,near


def build_control_schema(data: Mapping[str,np.ndarray], state_names: Sequence[str]) -> dict:
    names=list(state_names)
    by={name:i for i,name in enumerate(names)}
    for required in ("base:user_game_win_rate","base:log1p_user_games"):
        if required not in by:
            raise SystemExit(f"missing control state feature {required}")
    rank_names=[name for name in names if name.startswith("base:rank=")]
    if not rank_names:
        raise SystemExit("no rank state controls")
    rank_reference="base:rank=unknown" if "base:rank=unknown" in rank_names else sorted(rank_names)[0]
    rank_kept=[name for name in sorted(rank_names) if name!=rank_reference]
    exp=np.asarray(data["expansion"]).astype(str)
    pack=np.asarray(data["pack_number"],dtype=np.int64)
    pick=np.asarray(data["pick_number"],dtype=np.int64)
    levels=sorted(set(f"{e}|{int(p)}|{int(k)}" for e,p,k in zip(exp,pack,pick)))
    reference=levels[0]

    state=np.asarray(data["state_rich"],dtype=np.float64)
    w=np.asarray(data["decision_weight"],dtype=np.float64)
    schema={
        "skill_index":by["base:user_game_win_rate"],
        "experience_index":by["base:log1p_user_games"],
        "rank_indices":[by[name] for name in rank_kept],
        "rank_names":rank_kept,
        "rank_reference":rank_reference,
        "set_position_levels":levels,
        "set_position_reference":reference,
    }
    for label,index in (("skill",schema["skill_index"]),("experience",schema["experience_index"])):
        value=state[:,index]
        mean=float(np.sum(w*value)/np.sum(w))
        sd=math.sqrt(float(np.sum(w*np.square(value-mean))/np.sum(w)))
        schema[f"{label}_mean"]=mean
        schema[f"{label}_scale"]=sd if sd>1e-12 else 1.0
    return schema


def control_matrix(data: Mapping[str,np.ndarray], schema: Mapping[str,object]) -> tuple[np.ndarray,list[str]]:
    state=np.asarray(data["state_rich"],dtype=np.float64)
    cols=[]; names=[]
    skill=(state[:,int(schema["skill_index"])]-float(schema["skill_mean"]))/float(schema["skill_scale"])
    expv=(state[:,int(schema["experience_index"])]-float(schema["experience_mean"]))/float(schema["experience_scale"])
    cols.extend([skill,expv]); names.extend(["control:skill_linear","control:experience_linear"])
    for name,index in zip(schema["rank_names"],schema["rank_indices"]):
        cols.append(state[:,int(index)])
        names.append(f"control:{name}")
    exp=np.asarray(data["expansion"]).astype(str)
    pack=np.asarray(data["pack_number"],dtype=np.int64)
    pick=np.asarray(data["pick_number"],dtype=np.int64)
    labels=np.asarray([f"{e}|{int(p)}|{int(k)}" for e,p,k in zip(exp,pack,pick)])
    ref=str(schema["set_position_reference"])
    for level in schema["set_position_levels"]:
        if level==ref:
            continue
        cols.append((labels==level).astype(np.float64))
        names.append(f"control:set_position={level}")
    return np.column_stack(cols),names


def fit_r_prime(
    *,
    z: np.ndarray,
    residual: np.ndarray,
    weight: np.ndarray,
    data: Mapping[str,np.ndarray],
    feature_names: Sequence[str],
    keep_indices: np.ndarray,
    control_schema: Mapping[str,object],
    global_l2: float=GLOBAL_L2,
    set_l2: float=SET_L2,
) -> RFit:
    keep=np.asarray(keep_indices,dtype=np.int64)
    zkeep=np.asarray(z[:,keep],dtype=np.float64)
    mean,scale,near=weighted_mean_scale(zkeep,weight)
    if np.any(near):
        bad=[feature_names[int(keep[i])] for i,v in enumerate(near) if v]
        raise SystemExit(f"post-cleanup near-constant R features: {bad}")
    zstd=(zkeep-mean)/scale
    controls,control_names=control_matrix(data,control_schema)
    n=len(zstd); p=zstd.shape[1]
    width=1+controls.shape[1]+p+len(CORE)*p
    design=np.zeros((n,width),dtype=np.float64)
    design[:,0]=1.0
    cstart=1; cstop=cstart+controls.shape[1]
    design[:,cstart:cstop]=controls
    gstart=cstop; gstop=gstart+p
    design[:,gstart:gstop]=zstd
    set_slices={}
    exp=np.asarray(data["expansion"]).astype(str)
    cursor=gstop
    for env in CORE:
        sl=slice(cursor,cursor+p)
        mask=exp==env
        design[mask,sl]=zstd[mask]
        set_slices[env]=(sl.start,sl.stop)
        cursor += p

    w=np.asarray(weight,dtype=np.float64)
    y=np.asarray(residual,dtype=np.float64)
    xtw=design.T*w
    gram=xtw@design
    rhs=xtw@y
    penalty=np.zeros(width,dtype=np.float64)
    penalty[gstart:gstop]=float(global_l2)
    penalty[gstop:]=float(set_l2)
    penalized=gram.copy()
    penalized[np.diag_indices_from(penalized)] += penalty
    # Unpenalized nuisance controls may be linearly dependent in sparse
    # set/rank/position cells. Use the Moore-Penrose solution; candidate
    # directions remain ridge-identified and the rank/conditioning is reported.
    bread=np.linalg.pinv(penalized,rcond=1e-12)
    coef=bread@rhs
    prediction=design@coef
    err=y-prediction
    draft_ids=np.asarray(data["draft_ids"]).astype(str)
    unique,inverse=np.unique(draft_ids,return_inverse=True)
    score=np.zeros((len(unique),width),dtype=np.float64)
    np.add.at(score,inverse,design*(w*err)[:,None])
    meat=score.T@score
    correction=len(unique)/(len(unique)-1) if len(unique)>1 else 1.0
    covariance=correction*(bread@meat@bread)
    cov_beta=covariance[gstart:gstop,gstart:gstop]
    beta=coef[gstart:gstop]

    gram_diag=np.diag(gram)[gstart:gstop]
    diagnostics={
        "n_decisions":n,
        "n_drafts":len(unique),
        "design_width":width,
        "control_count":controls.shape[1],
        "control_names":control_names,
        "global_feature_count":p,
        "weighted_residual_rmse":math.sqrt(float(np.sum(w*np.square(err))/np.sum(w))),
        "linear_system":{
            "width":width,
            "rank":int(np.linalg.matrix_rank(penalized)),
            "condition_number":float(np.linalg.cond(penalized)),
            "solver":"Moore-Penrose pseudoinverse rcond=1e-12",
        },
        "global_gram_diag":{
            "min":float(np.min(gram_diag)),
            "median":float(np.median(gram_diag)),
            "max":float(np.max(gram_diag)),
            "penalty":float(global_l2),
            "penalty_over_median_gram":float(global_l2/np.median(gram_diag)),
        },
        "global_beta_l2":float(np.linalg.norm(beta)),
        "set_deviation_l2":{
            env:float(np.linalg.norm(coef[a:b])) for env,(a,b) in set_slices.items()
        },
        "covariance":{
            "cr_type":"CR1 cluster-by-draft empirical sandwich; G/(G-1) correction",
            "clusters":len(unique),
            "global_trace":float(np.trace(cov_beta)),
            "global_max_diag":float(np.max(np.diag(cov_beta))),
            "global_min_diag":float(np.min(np.diag(cov_beta))),
            "global_min_eigenvalue":float(np.min(np.linalg.eigvalsh((cov_beta+cov_beta.T)/2))),
            "global_max_eigenvalue":float(np.max(np.linalg.eigvalsh((cov_beta+cov_beta.T)/2))),
        },
    }
    return RFit(
        coefficient=coef,
        covariance=covariance,
        global_beta=beta,
        global_covariance=cov_beta,
        z_mean=mean,
        z_scale=scale,
        keep_indices=keep,
        keep_names=[feature_names[int(i)] for i in keep],
        control_schema=dict(control_schema),
        slices={
            "controls":(cstart,cstop),
            "global":(gstart,gstop),
            "set":set_slices,
        },
        diagnostics=diagnostics,
    )


def candidate_difference_rows(
    data: Mapping[str,np.ndarray],
    fit: RFit,
    decision_indices: np.ndarray,
    behavior: np.ndarray,
    *,
    support_floor: float=SUPPORT_FLOOR,
) -> dict:
    offsets=np.asarray(data["offsets"],dtype=np.int64)
    incumbent=np.asarray(data["incumbent_ord"],dtype=np.int64)
    cand=np.asarray(data["cand_rich"],dtype=np.float64)
    owners=[]; local_ord=[]; diffs=[]; ses=[]; props=[]; a_supported=[]; counts=[]
    valid_decisions=[]
    cov=(fit.global_covariance+fit.global_covariance.T)/2
    for owner,raw_i in enumerate(np.asarray(decision_indices,dtype=np.int64)):
        i=int(raw_i); start,stop=int(offsets[i]),int(offsets[i+1])
        a=int(incumbent[i]); ap=float(behavior[start+a])
        valid_decisions.append(i); counts.append(stop-start); a_supported.append(ap>=support_floor)
        if ap<support_floor:
            continue
        abase=cand[start+a,fit.keep_indices]
        for local in range(stop-start):
            if local==a:
                continue
            p=float(behavior[start+local])
            if p<support_floor:
                continue
            d=(cand[start+local,fit.keep_indices]-abase)/fit.z_scale
            variance=max(0.0,float(d@cov@d))
            se=math.sqrt(variance)
            if se<=1e-15:
                continue
            owners.append(owner); local_ord.append(local); diffs.append(d); ses.append(se); props.append(p)
    return {
        "decision_indices":np.asarray(valid_decisions,dtype=np.int64),
        "owners":np.asarray(owners,dtype=np.int64),
        "candidate_ord":np.asarray(local_ord,dtype=np.int16),
        "diff":np.asarray(diffs,dtype=np.float64),
        "se":np.asarray(ses,dtype=np.float64),
        "propensity":np.asarray(props,dtype=np.float64),
        "a_supported":np.asarray(a_supported,dtype=bool),
        "candidate_count":np.asarray(counts,dtype=np.int16),
    }


def _psd_factor(cov: np.ndarray) -> tuple[np.ndarray,dict]:
    sym=(np.asarray(cov,float)+np.asarray(cov,float).T)/2
    eigval,eigvec=np.linalg.eigh(sym)
    min_raw=float(np.min(eigval))
    clipped=np.maximum(eigval,0.0)
    factor=eigvec*np.sqrt(clipped)[None,:]
    return factor,{
        "min_eigenvalue_raw":min_raw,
        "negative_eigenvalue_count":int(np.sum(eigval< -1e-12)),
        "clipped_negative_mass":float(np.sum(np.abs(eigval[eigval<0]))),
    }


def calibrate_lcb_c(
    *,
    data: Mapping[str,np.ndarray],
    fit: RFit,
    decision_indices: np.ndarray,
    behavior: np.ndarray,
    draws: int=NULL_DRAWS,
    seed: int=NULL_SEED,
) -> tuple[float,dict]:
    rows=candidate_difference_rows(data,fit,decision_indices,behavior)
    n_dec=len(rows["decision_indices"])
    if not len(rows["diff"]):
        raise SystemExit("no supported alternatives for LCB calibration")
    factor,psd=_psd_factor(fit.global_covariance)
    rng=np.random.default_rng(seed)
    # Histogram edges allow exact survival counts at the fixed 0.01 c grid.
    edges=np.concatenate(([-np.inf],C_GRID,[np.inf]))
    hist=np.zeros(len(edges)-1,dtype=np.int64)
    batch=100
    for start in range(0,draws,batch):
        b=min(batch,draws-start)
        normal=rng.standard_normal((b,factor.shape[1]))
        beta=normal@factor.T
        t=(rows["diff"]@beta.T)/rows["se"][:,None]
        max_t=np.full((n_dec,b),-np.inf,dtype=np.float64)
        for col in range(b):
            np.maximum.at(max_t[:,col],rows["owners"],t[:,col])
        hist += np.histogram(max_t.ravel(),bins=edges)[0]

    total=n_dec*draws
    rates={}
    chosen=None
    # bins: (-inf,0), [0,.01), ... [5.99,6), [6,inf)
    for k,c in enumerate(C_GRID):
        # edge index of c is k+1; values > c live in bins k+1 onward.
        above=int(np.sum(hist[k+1:]))
        rate=above/total
        rates[f"{c:.2f}"]=rate
        if chosen is None and rate<=NULL_MAX_DEVIATION:
            chosen=float(c)
    if chosen is None:
        raise SystemExit("no c in fixed grid achieves <=2% null deviation")
    return chosen,{
        "draws":draws,
        "seed":seed,
        "decision_count":n_dec,
        "supported_alternative_rows":int(len(rows["diff"])),
        "target_max_deviation_rate":NULL_MAX_DEVIATION,
        "grid":[float(C_GRID[0]),float(C_GRID[-1]),0.01],
        "chosen_c":chosen,
        "chosen_null_deviation_rate":rates[f"{chosen:.2f}"],
        "neighbor_rates":{
            key:value for key,value in rates.items()
            if abs(float(key)-chosen)<=0.03
        },
        "covariance_psd":psd,
    }


def choose_r_lcb(
    *,
    data: Mapping[str,np.ndarray],
    fit: RFit,
    decision_indices: np.ndarray,
    behavior: np.ndarray,
    c: float,
) -> tuple[np.ndarray,dict]:
    offsets=np.asarray(data["offsets"],dtype=np.int64)
    incumbent=np.asarray(data["incumbent_ord"],dtype=np.int64)
    cand=np.asarray(data["cand_rich"],dtype=np.float64)
    cov=(fit.global_covariance+fit.global_covariance.T)/2
    chosen=np.asarray(incumbent,dtype=np.int64).copy()
    leader_props=[]; lcb_values=[]; unsupported_a=0; supported_alt_counts=[]
    for raw_i in np.asarray(decision_indices,dtype=np.int64):
        i=int(raw_i); start,stop=int(offsets[i]),int(offsets[i+1])
        a=int(incumbent[i]); ap=float(behavior[start+a])
        if ap<SUPPORT_FLOOR:
            unsupported_a += 1
            leader_props.append(ap); lcb_values.append(0.0); supported_alt_counts.append(0)
            continue
        abase=cand[start+a,fit.keep_indices]
        best_local=a; best_lcb=0.0; n_alt=0
        for local in range(stop-start):
            if local==a or float(behavior[start+local])<SUPPORT_FLOOR:
                continue
            n_alt += 1
            d=(cand[start+local,fit.keep_indices]-abase)/fit.z_scale
            delta=float(d@fit.global_beta)
            se=math.sqrt(max(0.0,float(d@cov@d)))
            lcb=delta-float(c)*se
            if lcb>best_lcb+1e-15 or (abs(lcb-best_lcb)<=1e-15 and lcb>0 and str(data["candidate_names"][start+local])<str(data["candidate_names"][start+best_local])):
                best_lcb=lcb; best_local=local
        chosen[i]=best_local if best_lcb>0 else a
        leader_props.append(float(behavior[start+int(chosen[i])]))
        lcb_values.append(float(best_lcb))
        supported_alt_counts.append(n_alt)
    idx=np.asarray(decision_indices,dtype=np.int64)
    intervention=float(np.mean(chosen[idx]!=incumbent[idx]))
    return chosen,{
        "eligible_decisions":len(idx),
        "intervention_rate":intervention,
        "A_below_0_05":unsupported_a,
        "A_below_0_05_fraction":unsupported_a/max(1,len(idx)),
        "chosen_propensity_mean":float(np.mean(leader_props)),
        "chosen_propensity_median":float(np.median(leader_props)),
        "chosen_propensity_p05":float(np.quantile(leader_props,.05)),
        "positive_lcb_mean":float(np.mean([x for x in lcb_values if x>0])) if any(x>0 for x in lcb_values) else 0.0,
        "supported_alternatives_mean":float(np.mean(supported_alt_counts)),
    }


def legacy_r_support_actions(
    *,
    data: Mapping[str,np.ndarray],
    beta: np.ndarray,
    keep_indices: np.ndarray,
    scale: np.ndarray,
    decision_indices: np.ndarray,
    behavior: np.ndarray,
) -> np.ndarray:
    offsets=np.asarray(data["offsets"],dtype=np.int64)
    incumbent=np.asarray(data["incumbent_ord"],dtype=np.int64)
    cand=np.asarray(data["cand_rich"],dtype=np.float64)
    names=data["candidate_names"].astype(str)
    chosen=incumbent.copy()
    for raw_i in np.asarray(decision_indices,dtype=np.int64):
        i=int(raw_i); start,stop=int(offsets[i]),int(offsets[i+1])
        score=(cand[start:stop,keep_indices]/scale)@beta
        local=min(range(stop-start),key=lambda j:(-float(score[j]),str(names[start+j])))
        floor=max(0.01,0.10/(stop-start))
        chosen[i]=local if float(behavior[start+local])>=floor else int(incumbent[i])
    return chosen



def fit_skill_interaction_behavior(
    *,
    data: Mapping[str,np.ndarray],
    baseline_behavior: np.ndarray,
    l2: float=1000.0,
) -> dict:
    """Outcome-free conditional-logit correction using skill x candidate features."""
    from scipy.optimize import minimize

    offsets=np.asarray(data["offsets"],dtype=np.int64)
    counts=np.diff(offsets).astype(np.int64)
    candidate=np.asarray(data["cand_rich"],dtype=np.float64)
    skill=np.asarray(data["skill_rate"],dtype=np.float64)
    weight=np.asarray(data["decision_weight"],dtype=np.float64)
    selected=np.asarray(data["selected_ord"],dtype=np.int64)
    total=float(np.sum(weight))
    skill_mean=float(np.sum(weight*skill)/total)
    skill_sd=math.sqrt(float(np.sum(weight*np.square(skill-skill_mean))/total))
    if skill_sd<=1e-12:
        raise SystemExit("recorded skill has no variation")
    skill_z=(skill-skill_mean)/skill_sd
    row_skill=np.repeat(skill_z,counts)
    row_weight=np.repeat(weight,counts)

    row_base=np.asarray(baseline_behavior,dtype=np.float64)
    if len(row_base)!=len(candidate):
        raise SystemExit("skill-aware behavior baseline length mismatch")
    base_log=np.log(np.clip(row_base,1e-12,1.0))

    # Standardize candidate dimensions outcome-free using decision-normalized weights.
    row_norm_weight=np.repeat(weight/counts,counts)
    scale_total=float(np.sum(row_norm_weight))
    mean=np.sum(candidate*row_norm_weight[:,None],axis=0)/scale_total
    var=np.sum(np.square(candidate-mean)*row_norm_weight[:,None],axis=0)/scale_total
    scale=np.sqrt(np.maximum(var,0.0))
    active=scale>1e-8
    if not np.any(active):
        raise SystemExit("no active candidate features for skill-aware behavior")
    x=((candidate[:,active]-mean[active])/scale[active])*row_skill[:,None]
    selected_global=offsets[:-1]+selected

    def objective(beta):
        score=base_log+x@beta
        peak=np.maximum.reduceat(score,offsets[:-1])
        exp=np.exp(score-np.repeat(peak,counts))
        denom=np.add.reduceat(exp,offsets[:-1])
        logz=peak+np.log(denom)
        loss=float(np.sum(weight*(logz-score[selected_global]))/total + 0.5*l2*float(beta@beta)/total)
        prob=exp/np.repeat(denom,counts)
        gradient=(x.T@(row_weight*prob)-x[selected_global].T@weight)/total + l2*beta/total
        return loss,np.asarray(gradient,dtype=np.float64)

    result=minimize(
        objective,np.zeros(int(np.sum(active)),dtype=np.float64),
        method="L-BFGS-B",jac=True,
        options={"maxiter":300,"ftol":1e-9,"gtol":1e-6,"maxls":20},
    )
    if not result.success:
        raise SystemExit(f"skill-aware behavior fit failed: {result.message}")
    return {
        "beta":np.asarray(result.x,dtype=np.float64),
        "mean":mean,
        "scale":np.where(active,scale,1.0),
        "active":active,
        "skill_mean":skill_mean,
        "skill_scale":skill_sd,
        "l2":float(l2),
        "objective":float(result.fun),
        "iterations":int(result.nit),
        "gradient_max_abs":float(np.max(np.abs(result.jac))),
    }


def predict_skill_interaction_behavior(
    model: Mapping[str,object],
    *,
    data: Mapping[str,np.ndarray],
    baseline_behavior: np.ndarray,
) -> np.ndarray:
    offsets=np.asarray(data["offsets"],dtype=np.int64)
    counts=np.diff(offsets).astype(np.int64)
    candidate=np.asarray(data["cand_rich"],dtype=np.float64)
    skill=(np.asarray(data["skill_rate"],dtype=np.float64)-float(model["skill_mean"]))/float(model["skill_scale"])
    active=np.asarray(model["active"],dtype=bool)
    x=((candidate[:,active]-np.asarray(model["mean"],dtype=np.float64)[active])/
       np.asarray(model["scale"],dtype=np.float64)[active])*np.repeat(skill,counts)[:,None]
    score=np.log(np.clip(np.asarray(baseline_behavior,dtype=np.float64),1e-12,1.0))+x@np.asarray(model["beta"],dtype=np.float64)
    peak=np.maximum.reduceat(score,offsets[:-1])
    exp=np.exp(score-np.repeat(peak,counts))
    denom=np.add.reduceat(exp,offsets[:-1])
    prob=exp/np.repeat(denom,counts)
    if np.any(~np.isfinite(prob)) or np.any(prob<=0):
        raise SystemExit("invalid skill-aware behavior probabilities")
    return prob

def noise_legacy_support_rate(
    *,
    data: Mapping[str,np.ndarray],
    fit: RFit,
    decision_indices: np.ndarray,
    behavior: np.ndarray,
    draws: int=NULL_DRAWS,
    seed: int=NULL_SEED,
) -> dict:
    factor,psd=_psd_factor(fit.global_covariance)
    rng=np.random.default_rng(seed)
    idx=np.asarray(decision_indices,dtype=np.int64)
    offsets=np.asarray(data["offsets"],dtype=np.int64)
    incumbent=np.asarray(data["incumbent_ord"],dtype=np.int64)
    cand=np.asarray(data["cand_rich"],dtype=np.float64)
    # Build one relative-to-A matrix for every candidate in every eligible decision.
    pieces=[]; prop_pieces=[]; owner_slices=[]; thresholds=[]
    cursor=0
    for raw_i in idx:
        i=int(raw_i); start,stop=int(offsets[i]),int(offsets[i+1])
        a=int(incumbent[i])
        base=cand[start+a,fit.keep_indices]
        d=(cand[start:stop,fit.keep_indices]-base)/fit.z_scale
        pieces.append(d)
        prop_pieces.append(np.asarray(behavior[start:stop],dtype=np.float64))
        owner_slices.append((cursor,cursor+(stop-start),a))
        thresholds.append(max(0.01,0.10/(stop-start)))
        cursor += stop-start
    diff=np.concatenate(pieces,axis=0)
    props=np.concatenate(prop_pieces)
    thresholds=np.asarray(thresholds,dtype=np.float64)

    deviations=0; clipped_band=0; total=0
    batch=100
    for begin in range(0,draws,batch):
        b=min(batch,draws-begin)
        beta=rng.standard_normal((b,factor.shape[1]))@factor.T
        score=diff@beta.T
        for owner,(a,bound,a_local) in enumerate(owner_slices):
            block=score[a:bound]
            local=np.argmax(block,axis=0)
            max_score=block[local,np.arange(b)]
            # Tie probability under continuous null draws is zero; A has relative score 0.
            chosen_prop=props[a+local]
            dev=(max_score>0)&(local!=a_local)&(chosen_prop>=thresholds[owner])
            deviations += int(np.sum(dev))
            chosen_effective=np.where(dev,chosen_prop,props[a+a_local])
            clipped_band += int(np.sum((chosen_effective>=0.01)&(chosen_effective<0.05)))
        total += len(idx)*b
    return {
        "draws":draws,
        "seed":seed,
        "deviation_rate":deviations/total,
        "chosen_propensity_0_01_to_0_05_fraction":clipped_band/total,
        "covariance_psd":psd,
    }

