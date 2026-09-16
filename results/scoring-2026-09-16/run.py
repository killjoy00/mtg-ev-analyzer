#!/usr/bin/env python3
"""Reproduce the automated scoring development experiment from public data."""
import argparse
import concurrent.futures
import gzip
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'scripts'))
from eval_model import Cache, cache_identity, file_sha256
from scoring_experiment import EXPONENTS, TEMPERATURES, SEED, model_signature


def command(args, log):
    subprocess.run([sys.executable,*map(str,args)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir',type=Path,default=ROOT/'generated/scoring-20260916')
    parser.add_argument('--phase',choices=['all','prepare','measure','report'],default='all')
    parser.add_argument('--workers',type=int,default=3)
    parser.add_argument('--out',type=Path,default=HERE/'report.json')
    args=parser.parse_args()
    if args.workers<1:
        parser.error('--workers must be positive')
    protocol=json.loads((HERE/'protocol.json').read_text())
    if (EXPONENTS!=protocol['raw_score_exponents'] or TEMPERATURES!=protocol['display_calibration_exponents']
            or SEED!=protocol['seed']):
        raise ValueError('Experiment implementation no longer matches this protocol')
    downloads=json.loads((HERE/'downloads.json').read_text())
    work=args.work_dir.resolve()
    for name in ['archives','games','cache','fit','measurements','log']:
        (work/name).mkdir(parents=True,exist_ok=True)

    def prepare(sid):
        for source in [r for r in downloads if r['set_id']==sid]:
            path=work/('archives' if source['kind']=='draft_data' else 'games')/(sid+'.csv.gz')
            if not path.exists():
                temporary=path.with_suffix('.download')
                urllib.request.urlretrieve(source['url'],temporary)
                if temporary.stat().st_size!=source['bytes'] or file_sha256(temporary)!=source['sha256']:
                    raise ValueError(f'Public archive changed: {source["url"]}. Do not silently substitute it.')
                temporary.replace(path)
            if path.stat().st_size!=source['bytes'] or file_sha256(path)!=source['sha256']:
                raise ValueError(f'Archive checksum mismatch: {path}')
        with (work/'log'/f'{sid}.prepare.log').open('w') as log:
            for cohort in ['elite','control']:
                cache=work/'cache'/f'{sid}{"-control" if cohort=="control" else ""}.json'
                cmd=['scripts/eval_model.py','extract','--archive',work/'archives'/f'{sid}.csv.gz',
                     '--set-id',sid,'--cache',cache,'--cohort',cohort]
                if cohort=='control':
                    cmd+=['--max-drafts',protocol['control_extraction_cap']]
                command(cmd,log)
            command(['scripts/deck_fit.py','--games',work/'games'/f'{sid}.csv.gz','--cache',
                     work/'cache'/f'{sid}.json','--split','train','--out',work/'fit'/f'{sid}.json'],log)
        print('prepared',sid,flush=True)

    def measure(sid):
        out=work/'measurements'/f'{sid}.json.gz'
        fit=work/'fit'/f'{sid}.json'
        elite,control=(work/'cache'/f'{sid}{suffix}.json' for suffix in ['', '-control'])
        archive=work/'archives'/f'{sid}.csv.gz'
        if out.exists():
            try:
                with gzip.open(out,'rt') as f:
                    old=json.load(f)
            except (EOFError,OSError,ValueError):
                old={}
            if (old.get('model_signature')==model_signature() and old.get('split')=='validation'
                    and old.get('training_cap')==protocol['training_cap']
                    and old.get('elite_cache')==cache_identity(Cache.load(elite))
                    and old.get('control_cache')==cache_identity(Cache.load(control))
                    and old.get('fit_sha256')==file_sha256(fit)
                    and old.get('archive_sha256')==file_sha256(archive)):
                print('reused matching measurement',sid,flush=True)
                return
        with (work/'log'/f'{sid}.measure.log').open('w') as log:
            command(['scripts/scoring_experiment.py','measure','--elite',elite,'--control',control,
                '--fit',fit,'--archive',archive,'--split','validation','--cap',protocol['training_cap'],
                '--out',out],log)
        print('measured',sid,flush=True)

    for phase,fn in [('prepare',prepare),('measure',measure)]:
        if args.phase in ('all',phase):
            with concurrent.futures.ThreadPoolExecutor(args.workers) as pool:
                list(pool.map(fn,protocol['sets']))
    if args.phase in ('all','report'):
        command(['scripts/scoring_experiment.py','report',*[work/'measurements'/f'{sid}.json.gz'
                for sid in protocol['sets']],'--runs',2000,'--bootstrap-draws',200,'--bootstrap-runs',500,
                '--daily','--day',protocol['date_for_daily_policy'],'--out',args.out],None)


if __name__=='__main__':
    main()
