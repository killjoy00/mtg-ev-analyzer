"""Augment only the blinded review reference, never change model inputs.

Use exact printing IDs where present and exact names for unresolved inserts.
All inputs are checksum-pinned in the existing frozen candidate lock. Keep
the original rules text when present; report discrepancies instead of silently
substituting a later Oracle or rebalanced version.
"""
import argparse
import gzip
import hashlib
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from fetch_card_metadata import USER_AGENT, aliases

FIELDS=('id','oracle_id','name','layout','mana_cost','type_line','oracle_text','power','toughness',
        'loyalty','defense','produced_mana','card_faces','rarity','set','collector_number')
FACE_FIELDS=('name','mana_cost','type_line','oracle_text','power','toughness','loyalty','defense')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def fetch_collection(ids):
    result=[]
    for start in range(0,len(ids),75):
        payload=json.dumps({'identifiers':ids[start:start+75]}).encode()
        request=Request('https://api.scryfall.com/cards/collection',data=payload,method='POST',
            headers={'User-Agent':USER_AGENT,'Accept':'application/json','Content-Type':'application/json'})
        for attempt in range(3):
            time.sleep(.2)
            try:
                with urlopen(request,timeout=45) as response:
                    data=json.load(response)
                result.extend(data.get('data',[]))
                break
            except HTTPError as e:
                if e.code not in (429,500,502,503,504) or attempt==2:
                    raise
                time.sleep(2**attempt)
            except URLError:
                if attempt==2:
                    raise
                time.sleep(2**attempt)
    return result


def compact(c):
    result={k:c[k] for k in FIELDS if k in c and k!='card_faces'}
    if c.get('card_faces'):
        result['card_faces']=[{k:f[k] for k in FACE_FIELDS if k in f} for f in c['card_faces']]
    return result


def stats_missing(card):
    faces=card.get('card_faces') or [card]
    missing=[]
    for f in faces:
        typ=f.get('type_line','')
        if 'Creature' in typ or 'Vehicle' in typ:
            if 'power' not in f or 'toughness' not in f:
                missing.append(f.get('name',card.get('name')))
        if 'Planeswalker' in typ and 'loyalty' not in f:
            missing.append(f.get('name',card.get('name')))
        if 'Battle' in typ and 'defense' not in f:
            missing.append(f.get('name',card.get('name')))
    return missing


def compatible(old,new):
    for field in ('name','layout','type_line','mana_cost','oracle_text'):
        if field in old and old[field]!=new.get(field):
            return False
    of,nf=old.get('card_faces') or [],new.get('card_faces') or []
    if len(of)!=len(nf):
        return False
    return all(all(f not in a or a[f]==b.get(f) for f in ('name','type_line','mana_cost','oracle_text')) for a,b in zip(of,nf))


def enrich(old,live,name):
    if not live:
        if old:
            return dict(compact(old),review_reference_status='pinned_only_lookup_failed')
        return {'name':name,'review_reference_status':'unavailable'}
    if old and (live.get('id')!=old.get('id') or not compatible(old,live)):
        return dict(compact(old),review_reference_status='pinned_rules_differ_live_reference',live_reference=compact(live))
    if not old and name not in aliases(live):
        return {'name':name,'review_reference_status':'unresolved_name'}
    return dict(compact(live),review_reference_status='exact_pinned_printing' if old else 'exact_name_unpinned_printing')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,required=True)
    p.add_argument('--lock',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    lock=json.loads(a.lock.read_text())
    all_rules={}; reports={}; pinned={}; samples={}; wanted_ids=set(); missing_names=set()
    for sid,entry in lock['environments'].items():
        src=a.input/('ktk' if sid=='ktk' else 'main')
        blob=(src/f'pool-aware-development-{sid}'/'metadata/rules.json.gz').read_bytes()
        sample=(src/f'pool-aware-blind-review-{sid}'/'blind-cases.json').read_bytes()
        if sha(blob)!=entry['sources']['metadata'] or sha(sample)!=entry['sample_sha256']:
            raise ValueError('pinned input mismatch '+sid)
        cases=json.loads(sample)
        if len(cases)!=100 or any(set(c)!={'case_id','set','pick','prior_pool','pack','focal_card'} for c in cases):
            raise ValueError('non-blind or incomplete packet')
        samples[sid]=sample
        old=json.loads(gzip.decompress(blob))
        names=sorted({n for c in cases for n in c['prior_pool']+c['pack']})
        pinned[sid]={n:old.get(n) for n in names}
        for n,c in pinned[sid].items():
            if c and c.get('id'):
                wanted_ids.add(c['id'])
            else:
                missing_names.add(n)
    cards=fetch_collection([{'id':x} for x in sorted(wanted_ids)])
    by_id={c['id']:c for c in cards}
    by_name={}
    if missing_names:
        for c in fetch_collection([{'name':n} for n in sorted(missing_names)]):
            for n in aliases(c):
                if n in missing_names:
                    by_name.setdefault(n,[]).append(c)
    for sid,old in pinned.items():
        rules={}
        for n,c in old.items():
            live=by_id.get(c['id']) if c and c.get('id') else None
            if not c:
                matches=by_name.get(n,[])
                if len({x.get('oracle_id',x['id']) for x in matches})==1 and matches:
                    live=matches[0]
            rules[n]=enrich(c,live,n)
        all_rules[sid]=rules
        reports[sid]={'names':len(rules),
            'status_counts':{status:sum(c['review_reference_status']==status for c in rules.values()) for status in sorted({c['review_reference_status'] for c in rules.values()})},
            'missing_stats':sorted({n for n,c in rules.items() if stats_missing(c)}),
            'unresolved_names':sorted(n for n,c in rules.items() if c['review_reference_status'] in ('unavailable','unresolved_name')),
            'sample_sha256':sha(samples[sid])}
    a.output.mkdir(parents=True,exist_ok=True)
    for sid,sample in samples.items():
        (a.output/f'{sid}-cases.json').write_bytes(sample)
    blob=(json.dumps(all_rules,ensure_ascii=False,indent=2)+'\n').encode()
    (a.output/'review-rules-by-set.json').write_bytes(blob)
    report={'scope':'AI-review reference only; original model and sample locks unchanged',
            'rules_sha256':sha(blob),'formats':reports,
            'note':'Exact-name fallback is unpinned; Oracle conflicts retained and marked. Reviewers abstain if unresolved material.'}
    (a.output/'reference-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
