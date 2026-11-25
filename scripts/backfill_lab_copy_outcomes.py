#!/usr/bin/env python3
"""One-time backfill of reviewed active game sources. No recurring downloads."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.request
from lab_copy_outcomes import build_report, digest, write_report

ROOT=Path(__file__).resolve().parent.parent
PINS=ROOT/'research/pack-one-lab/copy-outcome-pins.json'
MAX_BYTES=500*1024*1024

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('lab-backfill-redirect')

def validate_pin(row):
    sid=row.get('set_id','')
    if not re.fullmatch('[a-z0-9]+',sid):
        raise ValueError('lab-backfill-identity')
    expected='https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.'+sid.upper()+'.PremierDraft.csv.gz'
    if row.get('url')!=expected or not re.fullmatch('[a-f0-9]{64}',row.get('sha256','')) or type(row.get('bytes')) is not int or not 0<row['bytes']<=MAX_BYTES or not re.fullmatch('"[a-f0-9]{32}(-[0-9]+)?"',row.get('etag','')):
        raise ValueError('lab-backfill-pin')

def fetch(row,path):
    validate_pin(row)
    opener=urllib.request.build_opener(NoRedirect())
    request=urllib.request.Request(row['url'],headers={'User-Agent':'PackOne-Trophy-Import/2.0 (https://github.com/killjoy00/mtg-ev-analyzer)','If-Match':row['etag']})
    h=hashlib.sha256()
    size=0
    with opener.open(request,timeout=60) as source, open(path,'xb') as target:
        if source.geturl()!=row['url']:
            raise ValueError('lab-backfill-redirect')
        for chunk in iter(lambda:source.read(1024*1024),b''):
            size+=len(chunk)
            if size>row['bytes']:
                raise ValueError('lab-backfill-size')
            h.update(chunk)
            target.write(chunk)
    if size!=row['bytes'] or h.hexdigest()!=row['sha256']:
        raise ValueError('lab-backfill-hash')

def run_one(row,out,local=None):
    validate_pin(row)
    target=out/(row['set_id']+'.json')
    if target.exists():
        old=json.loads(target.read_text())
        if old.get('set_id')==row['set_id'] and old.get('source_sha256')==row['sha256'] and old.get('definition')=='copy-outcomes-v1':
            return {'set_id':row['set_id'],'game_sha256':row['sha256'],'artifact_sha256':digest(target),'status':'existing'}
        raise ValueError('lab-backfill-existing-mismatch')
    with tempfile.TemporaryDirectory(prefix='lab-game-backfill-') as tmp:
        archive=local if local is not None else Path(tmp)/'games.csv.gz'
        if local is None:
            fetch(row,archive)
        if archive.stat().st_size!=row['bytes'] or digest(archive)!=row['sha256']:
            raise ValueError('lab-backfill-hash')
        report=build_report(archive,row['set_id'],row['sha256'])
        sha=write_report(target,report)
        result={'set_id':row['set_id'],'game_sha256':row['sha256'],'artifact_sha256':sha,
                'status':'built','games':report['games'],'drafts':report['drafts'],'cards':len(report['cards'])}
        # Only aggregate cells; useful readback for the requested example.
        if row['set_id']=='hob':
            result['lakeshore_apothecary']=report['cards'].get('Lakeshore Apothecary')
        return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sets',nargs='+',required=True)
    p.add_argument('--out-dir',type=Path,required=True)
    p.add_argument('--local-archive',type=Path)
    a=p.parse_args()
    if a.local_archive and len(a.sets)!=1:
        p.error('local archive requires one set')
    pins=json.loads(PINS.read_text())
    byset={r['set_id']:r for r in pins['sources']}
    if not a.sets or len(set(a.sets))!=len(a.sets) or not set(a.sets)<=set(byset):
        p.error('only reviewed pinned sets are supported')
    a.out_dir.mkdir(parents=True,exist_ok=True)
    results=[]
    for sid in a.sets:
        try:
            result=run_one(byset[sid],a.out_dir,a.local_archive)
        except urllib.error.HTTPError as e:
            result={'set_id':sid,'status':'unavailable','reason':'http-'+str(e.code)}
        except (OSError,ValueError,StopIteration) as e:
            code=str(e)
            result={'set_id':sid,'status':'unavailable','reason':code if re.fullmatch('lab-[a-z-]+',code) else 'source-or-build-error'}
        results.append(result)
        print(json.dumps(result,ensure_ascii=False),flush=True)
    (a.out_dir/'backfill-results.json').write_text(json.dumps(results,indent=2)+'\n')
    return int(any(r['status']=='unavailable' for r in results))

if __name__=='__main__':
    raise SystemExit(main())
