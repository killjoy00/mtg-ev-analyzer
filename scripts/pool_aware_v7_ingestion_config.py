#!/usr/bin/env python3
"""Immutable v7 new-set configuration and local-fit promotion evidence.

Run on exact ingestion inputs BEFORE a v7 candidate is staged. This creates
no DB rows and does not activate a corpus. New sets never fall back to v6.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

import pool_aware_skill_reviewed_validation as validation
import pool_aware_v7_refit as refit
import pool_aware_skill_expansion as exp
import pool_aware_mana_final as parser
import pool_aware_mana_parser_v2 as v2
import pool_aware_skill_final_correction as final
import pool_aware_skill_parser_correction as predecessor
from pool_aware_archive import read_json,sha256

PROTOCOL='v7-ingestion-model-config-v1'
MODEL='strong-player-colour-stage-v7'

def signature(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()

def immutable_config(sid,arm,state,context,cards,rules_sha,registry_sha,fit_sha=None):
    core={'schema':1,'protocol':PROTOCOL,'set':sid,'model_version':MODEL,
        'arm':arm,'configuration':state,'context':list(context),'card_effects':cards,
        'rules_sha256':rules_sha,'fit_registry_sha256':registry_sha,'local_fit_sha256':fit_sha}
    digest=signature(core)
    return dict(core,configuration_sha256=digest,
        # Distinct immutable per-set generation; loader must register this
        # as a versioned v7 corpus/component, never overwrite an old puzzle.
        corpus_version=f'elite-trophy-colour-stage-v11-{sid}-{digest[:20]}')

def starting(sid,rules,combined,decision,registry):
    digest=validation.registry_digest(registry)
    if (combined['protocol']!=validation.PROTOCOL or decision['protocol']!=validation.PROTOCOL
        or combined['fit_registry_sha256']!=digest or decision['release_allowed']
        or combined['release_allowed'] or not decision['all_reviewed_checks_pass']):
        raise ValueError('no reviewed candidate passed; owner must resolve failed release checks')
    arm=decision['recommended_candidate']
    if arm not in validation.ORDER:raise ValueError('invalid selected model')
    evidence=combined['arms'][arm]['starting_configuration']
    if not evidence['validated_leave_one_format_out'] or len(evidence['source_formats'])!=31:
        raise ValueError('new-set v7 configuration failed or lacks LOO evidence; notify owner')
    if evidence!=decision['new_set_starting_configuration']:
        raise ValueError('starting configuration evidence mismatch')
    context=refit.mean_context(registry,previous=arm!='refit')
    if list(context)!=evidence['context'] or evidence['card_effects']!={}:
        raise ValueError('starting coefficients mismatch')
    # Parse exact set metadata; no generic assumption about unfamiliar layouts.
    metadata=read_json(rules)
    if not isinstance(metadata,dict) or not metadata:raise ValueError('pinned set rules required')
    engine=v2 if arm=='parser-v2' else parser
    idx=engine.index(metadata)
    if not any(c.status in ('readable','land') for c in idx.cards.values()):
        raise ValueError('no interpretable pinned rules')
    return immutable_config(sid,arm,'starting_cross_format',context,{},sha256(rules),digest)

def verify_config(config):
    core={k:v for k,v in config.items() if k not in ('configuration_sha256','corpus_version')}
    digest=signature(core)
    if config['configuration_sha256']!=digest or config['corpus_version']!=f"elite-trophy-colour-stage-v11-{config['set']}-{digest[:20]}":
        raise ValueError('model configuration/corpus identity mismatch')
    if config['configuration']=='starting_cross_format' and config['card_effects']:
        raise ValueError('starting configuration cannot contain card terms')
    return config

def candidate(sid,rules,combined,decision,registry,manifest=None,current_version=None):
    start=starting(sid,rules,combined,decision,registry)
    result={'protocol':PROTOCOL,'set':sid,'current_corpus_version':current_version,
        'starting_config':start,'proposed_config':start,'local_fit_status':'not_yet_eligible',
        'promotion_authorized':False,'preserve_historical_scores':True,
        'note':'Stage a distinct immutable version, verify full corpus health and exact snapshot; never rewrite prior awards.'}
    if manifest is None:
        result['reason']='no adequate pinned chronological training/validation manifest yet'
        return result
    m=read_json(manifest)
    if m['set']!=sid or m['sources']['metadata']['sha256']!=sha256(rules):
        raise ValueError('ingestion manifest/rules mismatch')
    if start['arm']!='refit':
        # Fallback engines use their own fixed feature recipe. Do not silently
        # train an incompatible local model. This must be resolved at release.
        result['local_fit_status']='blocked_fallback_recipe_requires_review'
        return result
    try:
        fitted=refit.fit(sid,manifest)
        if fitted['fit']['eligible_card_count']==0:
            result['reason']='no card offered 100 times in both residual cohorts'
            return result
        e,o,meta,_,p,_,_,_=refit.prepare(sid,manifest,None,'validation')
    except exp.Blocked as exc:
        result['reason']=str(exc);return result
    for key in ('sources','windows','purge_days','baseline_cutoff','baseline_drafts','baseline_picks'):
        if p[key]!=fitted['provenance'][key]:raise ValueError('local fit/validation identity mismatch')
    f=fitted['fit']
    predictions=validation.apply_arm('refit',e,meta,f)
    guards=validation.guard_only(predictions)
    maximum=validation.max_movement(predictions)
    ordinary=validation.apply_arm('refit',o,meta,f)
    maximum=max(maximum,validation.max_movement(ordinary))
    result['local_fit']={'fit':f,'provenance':fitted['provenance'],'guardrails':guards,'maximum_absolute_change':maximum}
    if not validation.safe(guards) or maximum>20:
        result['local_fit_status']='failed_guardrails'
        result['reason']='keep existing reviewed starting v7; never silently use v6'
        return result
    context,cards=final.parameters(f)
    proposed=immutable_config(sid,'refit','per_set_fit',context,cards,sha256(rules),
        start['fit_registry_sha256'],signature(fitted))
    if proposed['corpus_version']==start['corpus_version'] or proposed['corpus_version']==current_version:
        raise ValueError('local fit promotion must create a new immutable corpus version')
    result.update({'local_fit_status':'passed','proposed_config':proposed,
                   'eligible_for_versioned_staging':True})
    return result

def self_test():
    c=immutable_config('trk','refit','starting_cross_format',[.1]*6,{},'a'*64,'b'*64)
    d=immutable_config('trk','refit','per_set_fit',[.1]*6,{'card':.2},'a'*64,'b'*64,'c'*64)
    assert verify_config(c)==c and verify_config(d)==d and c['corpus_version']!=d['corpus_version']
    try:verify_config(dict(c,card_effects={'x':.2}))
    except ValueError:pass
    else:raise AssertionError('accepted mutable configuration')
    print('V7 ingestion configuration contracts passed: starting model, distinct local fit identity, immutable promotion.')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true');p.add_argument('--set')
    for k in ('rules','combined','decision','registry','manifest','output'):p.add_argument('--'+k,type=Path)
    p.add_argument('--current-version');a=p.parse_args()
    if a.self_test:self_test();return
    if not all((a.set,a.rules,a.combined,a.decision,a.registry,a.output)):p.error('set, rules, combined, decision, registry, output required')
    r=candidate(a.set,a.rules,read_json(a.combined),read_json(a.decision),refit.load_fits(a.registry),a.manifest,a.current_version)
    exp.write(a.output,r)
    print(json.dumps({k:v for k,v in r.items() if k!='local_fit'},indent=2),flush=True)

if __name__=='__main__':main()
