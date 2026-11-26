"""Blinded independent-review sampling frame, not labels or score evidence.

Only public 17Lands card-context fields are exported. No source IDs, timestamps,
historical choices, scores, outcome, cohort, stratum or model information.
Recreate the same selection from the immutable manifest after reviews lock.
"""
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path
import re

from pool_aware_diagnostics import grade
from pool_aware_refit import weights
from pool_aware_fixing import Context
from pool_aware_features import canonical

STRATA=('synergy_screen','splash_fixing','established_lane','early_speculation','close_alternative')
ZERO=(0.,)*8
# This rules-text screen is sampling ONLY. The reviewer must confirm
# a meaningful interaction; words alone are not evidence of pick quality.
TERMS=('Dragon','Dwarf','Equipment','Vehicle','artifact','Warrior','Goblin','Elf','Zombie',
       'instant','sorcery','token','Food','Treasure','+1/+1 counter','graveyard','land','creature card',
       'creature with flying','flying','exhaust','Mobilize','morph','prowess','sacrifice')
PAYOFF=re.compile(r'\b(?:when|whenever|each|if|for each|other|you control|costs? less|gets? \+|have)\b',re.I)


def digest(*x):
    return hashlib.sha256(('blind-review-v1|'+'|'.join(map(str,x))).encode()).hexdigest()


def screening(row,pool,pick,ctx):
    _,_,groups=ctx.describe(row,pool)
    scores=grade(weights(row,ZERO))
    result=defaultdict(list)
    prior=[ctx.canonical.get(n) for n in pool]
    prior_text=' '.join((c['type_line']+' '+c['oracle_text']) for c in prior if c).casefold()
    prior_colors={c for n in pool for c in (ctx.pips.get(n) or {})}
    for i,(n,f,tags,s) in enumerate(zip(row.candidates,row.features,groups,scores)):
        card=ctx.canonical.get(n)
        pips=ctx.pips.get(n)
        if not card:
            continue
        text=card['oracle_text']
        if pick>=4 and PAYOFF.search(text) and any(term.casefold() in text.casefold() and term.casefold() in prior_text for term in TERMS):
            result['synergy_screen'].append(i)
        if pick>=4 and ('recognized_fixer' in tags or 'single_pip_splash_proxy' in tags):
            result['splash_fixing'].append(i)
        if pick>=7 and ('old_supported_proxy' in tags or 'old_missing_access_proxy' in tags) and s>=25:
            result['established_lane'].append(i)
        if 2<=pick<=4 and pips and set(pips)-prior_colors and s>=35:
            result['early_speculation'].append(i)
        if s>=75 and sum(x>=75 for x in scores)>=2:
            result['close_alternative'].append(i)
    return result


def select(set_id,partitions,metadata,per_stratum_cohort=10):
    ctx=Context(metadata)
    used=set()
    chosen=[]
    counts={}
    for cohort in ('validation','ordinary_validation'):
        buckets=defaultdict(list)
        for row,pool,pick in partitions[cohort][0]:
            for stratum,indices in screening(row,pool,pick,ctx).items():
                for i in indices:
                    buckets[stratum].append((digest(set_id,stratum,row.source,pick,row.candidates[i]),row,pool,pick,i))
        for stratum in STRATA:
            got=0
            for key,row,pool,pick,i in sorted(buckets[stratum],key=lambda x:x[0]):
                if row.source in used:
                    continue
                used.add(row.source)
                chosen.append((digest(set_id,'order',row.source,pick,row.candidates[i]),stratum,cohort,row,pool,pick,i))
                got+=1
                if got==per_stratum_cohort:
                    break
            counts[cohort+'_'+stratum]=got
    # Hide sample category and cohort; cases are ordered by a separate hash.
    ordered=sorted(chosen,key=lambda x:x[0])
    cases=[]
    internal=[]
    for j,(_,stratum,cohort,row,pool,pick,i) in enumerate(ordered,1):
        cid=f'{set_id.upper()}-{j:03d}'
        cases.append({'case_id':cid,'set':set_id,'pick':f'P1P{pick}',
                      'prior_pool':list(sorted(pool)),'pack':list(sorted(row.candidates)),
                      'focal_card':row.candidates[i]})
        internal.append((cid,stratum,cohort,row,pick,i))
    return cases,internal,counts


def write_packet(output,set_id,partitions,metadata):
    cases,internal,counts=select(set_id,partitions,metadata)
    output=Path(output)
    output.mkdir(parents=True,exist_ok=True)
    # No source identifiers, timestamps, labels, model scores or model key.
    (output/'blind-cases.json').write_text(json.dumps(cases,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    with (output/'review.csv').open('w',encoding='utf-8-sig',newline='') as f:
        fields=('case_id','set','pick','prior_pool','pack','focal_card','quality_band','confidence','reason','category_confirmed','abstain')
        writer=csv.DictWriter(f,fieldnames=fields)
        writer.writeheader()
        for case in cases:
            writer.writerow(dict(case,prior_pool=' | '.join(case['prior_pool']),pack=' | '.join(case['pack'])))
    (output/'REVIEW.md').write_text(
        '# Independent draft review\n\nReview the focal card in the complete pack and prior pool. '
        'Use the information available at that pick, not the eventual deck or outcome. '
        'Multiple choices may be excellent. Do not consult model scores, historical picks, '
        'another reviewer, or the model-development report. Ordinary draft decisions are '
        'included. Rate each focal choice independently: excellent (90–95), good (75–89), '
        'defensible (50–74), questionable (25–49), poor (0–24). These are quality bands, '
        'not a request to guess the model score. Give confidence and a concise reason; '
        'abstain if context is insufficient. Note any clear synergy, speculative pivot, '
        'or fixing considerations in the reason. category_confirmed may remain blank '
        'during blinded review. Use a separate copy of review.csv for each reviewer.\n\n'
        'Public draft data: 17Lands public datasets, CC BY 4.0, '
        'https://www.17lands.com/public_datasets . Card rules: pinned public Scryfall metadata.\n',
        encoding='utf8')
    return {'cases':len(cases),'source_distinct_within_set':len(cases)==len({x[3].source for x in internal}),
            'stratum_counts':counts,'target_per_stratum_cohort':10,
            'sample_sha256':hashlib.sha256((output/'blind-cases.json').read_bytes()).hexdigest(),
            'status':'unlabeled historical sampling frame; fresh blinded reviewer judgments required',
            'synergy_screen_is_ground_truth':False}
