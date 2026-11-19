#!/usr/bin/env python3
"""Recompute held-out predictions using pinned archives and the frozen context code."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import urllib.request
from eval_model import file_sha256

ROOT=Path(__file__).resolve().parents[1]
SETS=('tmt','hob','blb','msh','sos','powered-cube')

def run(args):subprocess.run([sys.executable,*map(str,args)],cwd=ROOT,check=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--set',choices=SETS,required=True);parser.add_argument('--directory',type=Path,default=ROOT/'generated/frozen-scoring');args=parser.parse_args()
    work=args.directory/args.set;work.mkdir(parents=True,exist_ok=True)
    sources=[s for s in json.loads((ROOT/'results/scoring-2026-09-16/downloads.json').read_text()) if s['set_id']==args.set]
    if len(sources)!=2:raise ValueError('Both pinned source archives are required')
    for source in sources:
        path=work/(source['kind']+'.csv.gz')
        if not path.exists():
            temp=path.with_suffix('.download');urllib.request.urlretrieve(source['url'],temp);temp.replace(path)
        if path.stat().st_size!=source['bytes'] or file_sha256(path)!=source['sha256']:raise ValueError('Pinned source changed; do not silently substitute a newer archive')
    for cohort in ('elite','control'):
        command=['scripts/eval_model.py','extract','--archive',work/'draft_data.csv.gz','--set-id',args.set,'--cache',work/(cohort+'.json'),'--cohort',cohort]
        if cohort=='control':command+=['--max-drafts','6000']
        run(command)
    run(['scripts/deck_fit.py','--games',work/'game_data.csv.gz','--cache',work/'elite.json','--split','train','--out',work/'fit.json'])
    run(['scripts/scoring_experiment.py','measure','--elite',work/'elite.json','--control',work/'control.json','--fit',work/'fit.json','--archive',work/'draft_data.csv.gz','--split','validation','--cap','5000','--out',work/'measurements.json.gz'])

if __name__=='__main__':main()
