#!/usr/bin/env python3
"""Fixed offline information screen. No causal ranking or production writes."""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
from pathlib import Path
import time
import urllib.request

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

from decision_context import PickState, feature_blocks
from decision_context_audit import digest, write

ROOT = Path(__file__).resolve().parents[1]
SETS = ('blb','dsk','woe')
RAW = ROOT/'raw-data/decision-context-v1'
OUT = ROOT/'artifacts/decision-context-v1'
SEED = 1427
CAP = 15000


def hashed(text):
    return int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], 'big')


def source_pins():
    pins=json.loads((ROOT/'research/v5-production-source-pins.json').read_text())
    return {x['id']:{'draft':x['source_archive'],'game':x['skill_source']} for x in pins['sets'] if x['id'] in SETS}


def download():
    RAW.mkdir(parents=True,exist_ok=True)
    def fetch(job):
        sid,kind,pin=job; path=RAW/f'{sid}-{kind}.csv.gz'
        if not path.exists():
            req=urllib.request.Request(pin['url'],headers={'User-Agent':'PackOne-Research/1','Accept':'application/octet-stream'})
            tmp=path.with_suffix('.download')
            with urllib.request.urlopen(req,timeout=60) as response,tmp.open('wb') as out:
                while block:=response.read(1024*1024):out.write(block)
            tmp.replace(path)
        if digest(path)!=pin['sha256']:raise ValueError(f'{sid} {kind}: pinned archive mismatch')
        print(sid,kind,'verified',flush=True)
    with ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(fetch,[(sid,kind,pin) for sid,kinds in source_pins().items() for kind,pin in kinds.items()]))
    for sid in SETS:
        path=RAW/f'{sid}-metadata.json'
        if path.exists():continue
        cards={};url=f'https://api.scryfall.com/cards/search?q=set%3A{sid}&unique=cards'
        while url:
            req=urllib.request.Request(url,headers={'User-Agent':'PackOne-Research/1 (https://packone.pro)','Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=60) as response:payload=json.load(response)
            for card in payload['data']:
                compact={k:card[k] for k in ('name','mana_cost','type_line','oracle_text','rarity','card_faces') if k in card}
                cards[card['name']]=compact
                for face in card.get('card_faces',[]):cards[face['name']]=compact
            url=payload.get('next_page') if payload.get('has_more') else None
            time.sleep(.12)
        write(path,cards)
        print(sid,len(cards),'metadata fetched',flush=True)


def header(path):
    return list(pd.read_csv(path,nrows=0).columns)


def collect_decisions(sid):
    """Sample IDs before reading candidate vectors; no outcome-based subsampling."""
    path=RAW/f'{sid}-draft.csv.gz'
    meta=['draft_id','draft_time','expansion','event_type','pack_number','pick_number','pick','event_match_wins','event_match_losses']
    missing=set(meta)-set(header(path))
    if missing:raise ValueError(f'{sid}: missing columns {sorted(missing)}')
    drafts={};excluded=Counter()
    for chunk in pd.read_csv(path,usecols=meta,dtype=str,keep_default_na=False,chunksize=100000):
        first=chunk[(chunk.pack_number=='0') & (chunk.pick_number=='0')]
        for r in first.to_dict('records'):
            if r['event_type']!='PremierDraft':continue
            try:
                wins=float(r['event_match_wins']);losses=float(r['event_match_losses'])
                if wins!=int(wins) or losses!=int(losses):raise ValueError()
                wins,losses=int(wins),int(losses)
                if not ((wins==7 and 0<=losses<=2) or (losses==3 and 0<=wins<=6)):raise ValueError()
                pd.Timestamp(r['draft_time'])
            except (ValueError,TypeError):excluded['nonterminal_or_invalid_outcome_time']+=1;continue
            item={'id':r['draft_id'],'time':r['draft_time'],'wins':wins,'losses':losses}
            if item['id'] in drafts and drafts[item['id']]!=item:raise ValueError('Conflicting source summary')
            drafts[item['id']]=item
    eligible_count=len(drafts)
    keep=set(sorted(drafts,key=lambda x:hashed('context-sample:'+x))[:CAP])
    drafts={k:v for k,v in drafts.items() if k in keep}
    h=header(path);dynamic=[c for c in h if c.startswith(('pool_','pack_card_'))]
    dtype={c:'int16' for c in dynamic};dtype.update({c:str for c in meta})
    positions={};seen={};selected={};inconsistent=set()
    for chunk in pd.read_csv(path,usecols=meta+dynamic,dtype=dtype,keep_default_na=False,chunksize=25000):
        part=chunk[(chunk.pack_number=='0') & chunk.draft_id.isin(keep)]
        for r in part.to_dict('records'):
            did=r['draft_id'];pick=int(r['pick_number'])
            target=3+hashed('context-pick:'+did)%5
            if not 0<=pick<=target:continue
            signature=(r['pick'],int(float(r['event_match_wins'])),int(float(r['event_match_losses'])))
            if signature[1:]!=(drafts[did]['wins'],drafts[did]['losses']):
                inconsistent.add(did);continue
            old=seen.setdefault(did,{}).setdefault(pick,signature)
            if old!=signature:
                inconsistent.add(did);continue
            if pick==target:
                candidates=tuple(c[10:] for c in dynamic if c.startswith('pack_card_') and r[c]>0)
                pool=tuple(sorted((c[5:],int(r[c])) for c in dynamic if c.startswith('pool_') and r[c]>0))
                selected[did]={'set':sid,'pick':pick+1,'selected':r['pick'],'candidates':candidates,'pool':pool}
    result=[]
    for did,item in sorted(drafts.items()):
        if did in inconsistent:excluded['inconsistent_source_draft']+=1;continue
        r=selected.get(did)
        if not r:excluded['missing_target_pick']+=1;continue
        prefix=seen[did]
        if sorted(prefix)!=list(range(r['pick'])):excluded['incomplete_prefix']+=1;continue
        expected=Counter(prefix[p][0] for p in range(r['pick']-1))
        if expected!=Counter(dict(r['pool'])):excluded['pool_prefix_mismatch']+=1;continue
        if r['selected'] not in r['candidates']:excluded['selected_not_offered']+=1;continue
        PickState(sid,r['pick'],tuple(r['candidates']),tuple(r['pool']))
        result.append({**item,**r})
    return result,{'eligible_complete_drafts':eligible_count,'sampled':len(keep),'retained':len(result),'exclusions':dict(excluded)}


def collect_games(sid,ids):
    path=RAW/f'{sid}-game.csv.gz';h=header(path)
    required={'draft_id','game_time','won','match_number','game_number'}
    if not required<=set(h):raise ValueError('Game timestamps and outcomes required')
    decks=[c for c in h if c.startswith('deck_')]
    names=[c[5:] for c in decks]
    inhand={n:[p+n for p in ('opening_hand_','drawn_','tutored_') if p+n in h] for n in names}
    if any(not v for v in inhand.values()):raise ValueError('Missing in-hand columns')
    cols=list(required)+decks+[c for v in inhand.values() for c in v]
    numeric=set(cols)-required
    dtype={c:'int16' for c in numeric};dtype.update({c:str for c in required})
    result={};seen_games=set()
    for chunk in pd.read_csv(path,usecols=cols,dtype=dtype,keep_default_na=False,chunksize=25000):
        part=chunk[chunk.draft_id.isin(ids)]
        for r in part.to_dict('records'):
            if r['won'] not in ('True','False','true','false','1','0'):raise ValueError('Invalid game result')
            won=int(r['won'] in ('True','true','1'));did=r['draft_id']
            game_key=(did,r['match_number'],r['game_number'])
            if game_key in seen_games:raise ValueError('Duplicate source game key')
            seen_games.add(game_key)
            stamp=pd.Timestamp(r['game_time']).isoformat()
            d=result.setdefault(did,{'games':0,'wins':0,'last':stamp,'cards':{}})
            d['games']+=1;d['wins']+=won;d['last']=max(d['last'],stamp)
            for name,deck in zip(names,decks):
                if r[deck]<=0 or not any(r[c]>0 for c in inhand[name]):continue
                pair=d['cards'].setdefault(name,[0,0]);pair[0]+=won;pair[1]+=1
    return result


def chronology(rows,games):
    linked=[r for r in rows if r['id'] in games]
    complete=[r for r in linked if games[r['id']]['wins']==r['wins'] and games[r['id']]['games']==r['wins']+r['losses']]
    ordered=sorted(complete,key=lambda r:(pd.Timestamp(r['time']),r['id']))
    if len(ordered)<500:raise ValueError('Insufficient linked source drafts')
    t1=pd.Timestamp(ordered[int(.6*len(ordered))]['time']);t2=pd.Timestamp(ordered[int(.8*len(ordered))]['time'])
    groups={'fit':[],'validation':[],'later_development':[]};purged=0
    for r in ordered:
        start=pd.Timestamp(r['time']);end=pd.Timestamp(games[r['id']]['last'])
        if end<start:raise ValueError('Game precedes draft')
        if start<t1:
            if end>=t1:purged+=1;continue
            group='fit'
        elif start<t2:
            if end>=t2:purged+=1;continue
            group='validation'
        else:group='later_development'
        groups[group].append(r)
    return groups,{'purged_boundary_crossers':purged,'missing_games':len(rows)-len(linked),'incomplete_game_history':len(linked)-len(complete),
                   'boundaries':[t1.isoformat(),t2.isoformat()]}


def strengths(games,ids):
    counts={};wins=total=0
    for did in sorted(ids):
        d=games[did];wins+=d['wins'];total+=d['games']
        for name,pair in d['cards'].items():
            acc=counts.setdefault(name,[0,0]);acc[0]+=pair[0];acc[1]+=pair[1]
    if not total:raise ValueError('No training games')
    prior=wins/total
    return {name:((w+400*prior)/(n+400),n) for name,(w,n) in counts.items()},prior


def matrix_rows(rows,metadata,table,prior):
    result=[]
    for r in rows:
        state=PickState(r['set'],r['pick'],tuple(r['candidates']),tuple((n,int(c)) for n,c in r['pool']))
        result.append(feature_blocks(state,r['selected'],metadata,table.get(r['selected'],(prior,0))))
    return result


def train_features(rows,games,metadata):
    groups={i:[r for r in rows if hashed('context-gih:'+r['id'])%3==i] for i in range(3)}
    by_id={}
    for fold,held in groups.items():
        complement={r['id'] for f,rs in groups.items() if f!=fold for r in rs}
        assert not complement & {r['id'] for r in held}
        table,prior=strengths(games,complement)
        by_id.update({r['id']:x for r,x in zip(held,matrix_rows(held,metadata,table,prior))})
    return [by_id[r['id']] for r in rows]


def fit_predict(train,y,held):
    predictions={}
    for label,blocks in [('B',1),('P',2),('C',3)]:
        def merge(row):return {f'{b}:{k}':v for b in range(blocks) for k,v in row[b].items()}
        names=sorted(merge(train[0]))
        x=np.array([[m[k] for k in names] for m in map(merge,train)],dtype=float)
        z=np.array([[m[k] for k in names] for m in map(merge,held)],dtype=float)
        if not np.isfinite(x).all() or not np.isfinite(z).all():raise ValueError('Nonfinite feature')
        scaler=StandardScaler().fit(x)
        model=Ridge(alpha=10).fit(scaler.transform(x),y)
        predictions[label]=np.clip(model.predict(scaler.transform(z)),0,7)
    return predictions


def paired_summary(y,pred,sets,picks,draws=2000):
    y=np.asarray(y);sets=np.asarray(sets);picks=np.asarray(picks)
    groups=[np.flatnonzero(sets==s) for s in sorted(set(sets))]
    if any(len(g)<2 for g in groups):raise ValueError('Too few independent drafts')
    mean=lambda a:float(np.mean([np.mean(a[g]) for g in groups]))
    metrics={k:{'mse':mean((v-y)**2),'mae':mean(abs(v-y)),'mean_bias':mean(v-y)} for k,v in pred.items()}
    rng=np.random.default_rng(SEED)
    contrasts={}
    for other in ('P','B'):
        diff=(pred['C']-y)**2-(pred[other]-y)**2
        boots=np.array([np.mean([np.mean(diff[rng.choice(g,len(g),replace=True)]) for g in groups]) for _ in range(draws)])
        se=np.sqrt(sum(np.var(diff[g],ddof=1)/len(g) for g in groups))/len(groups)
        contrasts['C_minus_'+other]={'mse_difference':mean(diff),'ci95':np.quantile(boots,[.025,.975]).tolist(),
                                  'approx_80pct_power_mde_mse':float(2.80*se)}
    by_set={s:{k:float(np.mean((v[sets==s]-y[sets==s])**2)) for k,v in pred.items()} for s in sorted(set(sets))}
    per_set_ci={}
    diff=(pred['C']-y)**2-(pred['P']-y)**2
    for sid,g in zip(sorted(set(sets)),groups):
        boot=np.array([np.mean(diff[rng.choice(g,len(g),replace=True)]) for _ in range(draws)])
        per_set_ci[sid]=np.quantile(boot,[.025,.975]).tolist()
    by_pick={str(p):{k:float(np.mean((v[picks==p]-y[picks==p])**2)) for k,v in pred.items()} for p in sorted(set(picks))}
    return {'drafts':len(y),'metrics':metrics,'contrasts':contrasts,'mse_by_set':by_set,'mse_by_pick':by_pick,'C_minus_P_ci95_by_set':per_set_ci}


def prepare(sid):
    source=source_pins()[sid]
    identity={'sources':{kind:pin['sha256'] for kind,pin in source.items()},'cap':CAP,
              'preparation_schema':3}
    for kind,pin in source.items():
        if digest(RAW/f'{sid}-{kind}.csv.gz')!=pin['sha256']:raise ValueError('Source changed')
    cache=OUT/f'{sid}-prepared.json.gz'
    if cache.exists():
        payload=json.loads(gzip.open(cache,'rt').read())
        if payload['identity']==identity:return payload
    print(sid,'collecting broad draft sample',flush=True)
    rows,audit=collect_decisions(sid)
    print(sid,len(rows),'decisions; collecting game evidence',flush=True)
    games=collect_games(sid,{r['id'] for r in rows})
    groups,split_audit=chronology(rows,games)
    payload={'identity':identity,'groups':groups,'games':games,'audit':{**audit,**split_audit}}
    cache.parent.mkdir(parents=True,exist_ok=True)
    tmp=cache.with_suffix('.tmp')
    with gzip.open(tmp,'wt') as f:json.dump(payload,f)
    tmp.replace(cache)
    print(sid,{k:len(v) for k,v in groups.items()},'prepared',flush=True)
    return payload


def run():
    OUT.mkdir(parents=True,exist_ok=True)
    prepared={s:prepare(s) for s in SETS}
    metadata={s:json.loads((RAW/f'{s}-metadata.json').read_text()) for s in SETS}
    fit=[];fit_rows=[];held={k:[] for k in ('validation','later_development')};held_rows={k:[] for k in held}
    for sid,payload in prepared.items():
        groups=payload['groups'];games=payload['games'];rows=groups['fit']
        fit.extend(train_features(rows,games,metadata[sid]));fit_rows.extend(rows)
        table,prior=strengths(games,{r['id'] for r in rows})
        for partition in held:
            held[partition].extend(matrix_rows(groups[partition],metadata[sid],table,prior))
            held_rows[partition].extend(groups[partition])
    y=np.array([r['wins'] for r in fit_rows],float)
    results={};prediction_rows={}
    for partition,x in held.items():
        pred=fit_predict(fit,y,x);rows=held_rows[partition]
        results[partition]=paired_summary([r['wins'] for r in rows],pred,[r['set'] for r in rows],[r['pick'] for r in rows])
        prediction_rows[partition]={'ids':[r['id'] for r in rows],'predictions':{k:v.tolist() for k,v in pred.items()}}
    # True zero-target-evidence diagnostic. Rebuild training features without
    # GIH for ALL source rows too, so missingness does not define a new regime.
    transfer={}
    for holdout in SETS:
        train=[];train_y=[];test=[];test_rows=[]
        prior_ids=[(s,r['id']) for s in SETS if s!=holdout for r in prepared[s]['groups']['fit']]
        prior=sum(prepared[s]['games'][did]['wins'] for s,did in prior_ids)/sum(prepared[s]['games'][did]['games'] for s,did in prior_ids)
        for sid in SETS:
            rows=prepared[sid]['groups']['later_development' if sid==holdout else 'fit']
            feats=matrix_rows(rows,metadata[sid],{},prior)
            if sid==holdout:test.extend(feats);test_rows.extend(rows)
            else:train.extend(feats);train_y.extend(r['wins'] for r in rows)
        pred=fit_predict(train,np.array(train_y),test)
        transfer[holdout]=paired_summary([r['wins'] for r in test_rows],pred,[r['set'] for r in test_rows],[r['pick'] for r in test_rows])
    primary=results['later_development']
    info_pass=primary['contrasts']['C_minus_P']['ci95'][1]<0 and all(ci[0]<=0 for ci in primary['C_minus_P_ci95_by_set'].values())
    coverage={}
    for sid,payload in prepared.items():
        coverage[sid]={}
        for partition,rs in payload['groups'].items():
            coverage[sid][partition]={'drafts':len(rs),'selected_without_metadata':sum(r['selected'] not in metadata[sid] for r in rs),
                                      'selected_without_rules_text':sum(metadata[sid].get(r['selected'],{}).get('oracle_text') is None for r in rs)}
    report={'information_screen_pass':info_pass,'metadata_coverage':coverage,'scope':'retrospective_development_information_screen','causal_gain_estimated':False,
            'compared_against_deployed_v5_outcome_value':False,'protocol_sha256':digest(ROOT/'research/DECISION-CONTEXT-V1.md'),
            'code_sha256':{p:digest(ROOT/p) for p in ('scripts/decision_context.py','scripts/decision_context_experiment.py')},
            'metadata_sha256':{s:digest(RAW/f'{s}-metadata.json') for s in SETS},
            'source_sha256':{s:p['identity']['sources'] for s,p in prepared.items()},
            'sample_audit':{s:{**p['audit'],'partitions':{k:len(v) for k,v in p['groups'].items()}} for s,p in prepared.items()},
            'results':results,'zero_target_evidence_transfer':transfer,
            'versions':{'numpy':np.__version__,'pandas':pd.__version__,'sklearn':__import__('sklearn').__version__},
            'limitations':['Observed-action prediction is not counterfactual pick value.',
                          'Current metadata is not a historical release-day snapshot.',
                          'Lexical roles are incomplete proxies; no learned card-name identity.',
                          'Completed events only; no stable player identifiers.',
                          'Only three historical environments; no fresh confirmatory data.',
                          'Leave-one-set-out uses later source sets when the target is older; not calendar-time transfer.']}
    write(OUT/'predictions.json',prediction_rows)
    write(OUT/'report.json',report)
    print(json.dumps({'results':results,'transfer':transfer},indent=2))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['download','run','prepare'])
    parser.add_argument('--set',choices=SETS)
    args=parser.parse_args()
    if args.command=='download':download()
    elif args.command=='prepare':
        if not args.set:parser.error('--set required for prepare')
        prepare(args.set)
    else:run()


if __name__=='__main__':main()
