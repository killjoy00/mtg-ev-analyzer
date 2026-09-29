#!/usr/bin/env python3
"""10k environment-stratified row-bootstrap CI widths for replicate 0 of all P1P1 scenarios."""
from __future__ import annotations
import argparse,json
from pathlib import Path
import numpy as np
from a_regret_p1p1_null_calibration import SCENARIOS

ENV=("FIN","TDM","DFT","MSH","SOS")
DRAWS=10000
SEED=7562026092931

def args():
    p=argparse.ArgumentParser()
    p.add_argument("--input-root",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()

def main():
    a=args()
    files=list(a.input_root.rglob("rep0-all-scenarios.npz"))
    if len(files)!=5:
        raise SystemExit(f"expected 5 npz files, got {len(files)}")
    # Artifact directory names contain the environment.
    env_files={}
    for p in files:
        found=[e for e in ENV if e in str(p.parent)]
        if len(found)!=1: raise SystemExit(f"cannot resolve env from {p}")
        env_files[found[0]]=p
    names=[x[0] for x in SCENARIOS]
    arrays={s:{e:np.asarray(np.load(env_files[e])[s],dtype=np.float64) for e in ENV} for s in names}
    total_n={s:sum(len(arrays[s][e]) for e in ENV) for s in names}
    rng=np.random.default_rng(SEED)
    boots={s:np.zeros(DRAWS,dtype=np.float64) for s in names}
    batch=20
    for start in range(0,DRAWS,batch):
        b=min(batch,DRAWS-start)
        sums={s:np.zeros(b,dtype=np.float64) for s in names}
        for e in ENV:
            n=len(arrays[names[0]][e])
            idx=rng.integers(0,n,size=(b,n),dtype=np.int32)
            for s in names:
                if len(arrays[s][e])!=n: raise SystemExit(f"{e} {s}: n mismatch")
                sums[s]+=arrays[s][e][idx].sum(axis=1)
        for s in names:
            boots[s][start:start+b]=sums[s]/total_n[s]
    out={}
    for s in names:
        vals=np.concatenate([arrays[s][e] for e in ENV])
        lo,hi=np.quantile(boots[s],[.025,.975])
        out[s]={
            "replicate":0,"eligible_decisions":int(len(vals)),
            "point":float(np.mean(vals)),"draws":DRAWS,
            "ci95":[float(lo),float(hi)],"half_width":float((hi-lo)/2)
        }
    payload={"issue":756,"phase":"p1p1_rep0_all_scenario_row_bootstrap_supplement","synthetic_only":True,
             "decision_rule_unchanged":True,"scenarios":out}
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(payload,indent=2,sort_keys=True)+"\n")
    print(json.dumps(payload,indent=2,sort_keys=True))
if __name__=="__main__":
    main()
