#!/usr/bin/env python3
"""Replay the two specified historical anonymous audit packs, not labels.

This descriptive replay is not part of the decision. It never reads
validation draft choices or outcome labels; only pack, prior pool, pick and
historically published model-only scores are selected from old reports.
"""
import argparse
from collections import Counter
from pathlib import Path
import math
import json
import pool_aware_v7_context_stage as study
import pool_aware_skill_expansion as exp
import pool_aware_skill_reviewed_validation as reviewed
import pool_aware_v7_refit as refit
import pool_aware_mana_final as mana
from pool_aware_refit import Choice
from pool_aware_diagnostics import grade
from pool_aware_archive import read_json, sha256

OLD={'blb':('Agate Assault',95,62), 'powered-cube':("Yawgmoth's Will",78,50)}

def find_examples(node,card,before,after):
    if isinstance(node,dict):
        if (node.get('card')==card and node.get('v6_score')==before and
            node.get('skill_aware_score')==after and
            isinstance(node.get('prior_pool'),list) and isinstance(node.get('offered_cards'),list)):
            yield {k:node[k] for k in ('card','pick','prior_pool','offered_cards','v6_score','skill_aware_score','v6_leader')}
        for v in node.values():
            yield from find_examples(v,card,before,after)
    elif isinstance(node,list):
        for v in node:
            yield from find_examples(v,card,before,after)

def raw_support(model,names,pool,pack,pick):
    counts=Counter(pool)
    return tuple(model.card_tendency(n,pack,pick,counts) for n in names)

def infer_numbering(model,records):
    # Confirm raw pack and pick base on residual inputs only. Do not infer
    # from old example scores or use a validation row.
    options=[]
    for pack in (0,1):
        for pick_base in (0,1):
            if all(all(math.isclose(x,y,rel_tol=1e-12,abs_tol=1e-14)
                       for x,y in zip(raw_support(model,r.candidates,p,pack,k-1+pick_base),r.support))
                   for r,p,k in records[:150]):
                options.append((pack,pick_base))
    if not options:
        raise ValueError('no raw numbering matches residual supports')
    return options

def replay(sid,folder,audit_dir,output):
    prior=reviewed.frozen_prior(folder,sid)
    e,o,metadata,_,prov,model,_,_=refit.prepare(sid,exp.directory(sid)/'manifest.json',prior,'residual')
    if prov['phase']!='residual' or any(len(rs)!=prior['fit'][c]['decisions'] for c,rs in zip(study.COHORTS,(e,o))):
        raise ValueError('residual fit provenance mismatch')
    # Audit files contain aggregate historical results and anonymous input
    # contexts; do not open any validation bank or use aggregate metrics.
    unique={}; card,before,after=OLD[sid]
    for path in sorted(audit_dir.rglob('*.json')):
        root=read_json(path)
        for x in find_examples(root,card,before,after):
            if sid=='blb' and x['pick']!=10: continue
            key=(x['pick'],tuple(sorted(x['prior_pool'])),tuple(sorted(x['offered_cards'])))
            unique[key]=x
    result={'set':sid,'scope':'descriptive historical pack inputs only; not decision evidence',
            'original_grades':[before,after],'card':card,'examples':[]}
    if not unique:
        result['status']='exact anonymous audit input not found'
        exp.write(output,result);return
    train,_,cut=study.split(e,o);rules=mana.index(metadata)
    fits,_,_=study.fit_models(train,rules)
    numbers=infer_numbering(model,e+o)
    for key,x in sorted(unique.items()):
        k,pool,names=key
        supports=[raw_support(model,names,pool,pk,k-1+base) for pk,base in numbers]
        if any(any(not math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-14)
                       for a,b in zip(supports[0],p)) for p in supports[1:]):
            result['examples'].append({'audit_input':x,'status':'ambiguous raw numbering'});continue
        support=supports[0];i=names.index(card)
        if grade(support)[i]!=before or names[min(range(len(names)),key=lambda j:(-support[j],names[j]))]!=x['v6_leader']:
            result['examples'].append({'audit_input':x,'status':'historical v6 parity unavailable'});continue
        # Dummy chosen index is required by Choice schema only; scoring never
        # reads it and no actual historical pick or outcome is consulted.
        row=Choice('anonymous-audit-input','2025-01-01T00:00:00Z',names,support,((0.,)*8,)*len(names),0)
        scored={}
        for arm in ('single','stage'):
            probs=study.probabilities(row,pool,k,rules,*study.params(fits,arm,k))
            scored[arm]={'grade':grade(probs)[i],
                         'leader':names[min(range(len(names)),key=lambda j:(-probs[j],names[j]))]}
        result['examples'].append({'audit_input':x,'status':'replayed','scores':scored})
    result['status']='reported'
    result['split']=cut
    exp.write(output,result)

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--set',required=True);p.add_argument('--prior',type=Path,required=True)
    p.add_argument('--audit',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();replay(a.set,a.prior,a.audit,a.output)
