"""Read public source headers only. Never open final-assessment picks."""
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request,urlopen

SETS=('dft','tdm','ktk','hob','powered-cube')


def inspect(item):
    set_id,kind,pin=item
    url=pin['url']
    p=urlparse(url)
    if p.scheme!='https' or p.hostname!='17lands-public.s3.amazonaws.com' or not p.path.startswith('/analysis_data/') or p.query or p.username or p.password:
        raise ValueError('unexpected archive URL')
    result={'set':set_id,'kind':kind,'v6_pin':{k:pin[k] for k in ('etag','last_modified','compressed_bytes','sha256')}}
    try:
        with urlopen(Request(url,method='HEAD',headers={'User-Agent':'PackOne-research/1.0 (source headers only)'}),timeout=20) as r:
            if r.geturl()!=url:
                raise ValueError('unexpected redirected archive URL')
            h=r.headers
            current={'etag':h.get('ETag'),'last_modified':h.get('Last-Modified'),'compressed_bytes':int(h.get('Content-Length','-1'))}
        result['current']=current
        if not current['etag'] or not current['last_modified'] or current['compressed_bytes']<1:
            result['status']='unverifiable_headers'
        elif (current['etag']==pin['etag'] and current['compressed_bytes']==pin['compressed_bytes']
              and parsedate_to_datetime(current['last_modified'])==parsedate_to_datetime(pin['last_modified'])):
            result['status']='same_pinned_object_headers'
        else:
            result['status']='changed_headers_candidate_only'
    except Exception as exc:
        result['status']='header_check_failed'
        result['error_type']=type(exc).__name__
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pins',type=Path,default=Path('research/v6-build-source-pins.json'))
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    rows={r['id']:r for r in json.loads(a.pins.read_text())['sets']}
    tasks=[(s,k,rows[s][field]) for s in SETS for k,field in [('draft','source_archive'),('game','skill_source')]]
    with ThreadPoolExecutor(max_workers=3) as executor:
        reports=list(executor.map(inspect,tasks))
    result={'scope':'HEAD metadata only; no labels, drafts, game rows or changed archive bytes opened',
            'fresh_assessment_proven':False,'sources':reports}
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print(json.dumps([{k:v for k,v in r.items() if k not in ('v6_pin',)} for r in reports],indent=2))


if __name__=='__main__':
    main()
