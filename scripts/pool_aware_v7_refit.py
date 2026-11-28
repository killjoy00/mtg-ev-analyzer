"""Reviewed v7 preparation and residual-only fitting (no production writes).

Source identities/windows/cutoff are inherited exactly for historical sets.
Only one fixed recipe. The fit phase never parses validation pick labels.
"""
from collections import Counter, defaultdict
from pathlib import Path
import math
import json

import pool_aware_skill_expansion as exp
import pool_aware_skill_recovery as rec
import pool_aware_skill_contrast as skill
import pool_aware_statistical_validation as stat
import pool_aware_skill_context_validation as ctx
import pool_aware_skill_final_correction as correction
import pool_aware_mana_final as parser
from pool_aware_archive import (MIN_GAMES,BaselineView,choice,load_manifest,read_json,
    read_picks,rows,scan_baseline_games,scan_drafts,select_sources,sha256)
from build_replays import (candidate_columns,pool_columns,parse_example,parse_rate_bucket,
    parse_games_lower_bound,quantile_cutoff,normalize_probabilities)
from assess_v6_colour_model import build_models
from model_training import V6_MODEL

PROTOCOL='v7-reviewed-residual-fit-v1'
SOURCE=Path(__file__).resolve()
TRAD={x['set_id']:x for x in read_json(exp.ROOT/'research/v6-traditional-source-pins.json')['sets']}

def read_records(path,eligible,model,metadata,pack_offset,pick_offset,max_pick,min_pick=1):
    groups=defaultdict(list);coverage=defaultdict(Counter);seen=set()
    for names,idx,reader in rows(path):
        pack,pool=candidate_columns(names),pool_columns(names)
        if not pack or not pool:
            raise exp.Blocked('archive lacks pack/pool columns')
        for v in reader:
            d=v[idx['draft_id']].strip()
            if d not in eligible:continue
            label,info=eligible[d]
            try:
                pk=int(float(v[idx['pack_number']]))+pack_offset
                pi=int(float(v[idx['pick_number']]))+pick_offset
            except (ValueError,TypeError,OverflowError):
                coverage[label]['invalid_numbering']+=1;continue
            if pk!=1 or not min_pick<=pi<=max_pick:continue
            ex=parse_example(dict(zip(names,v)),pack,pool)
            if ex is None or len(ex.candidates)<2:
                coverage[label]['unusable_pack']+=1;continue
            if (d,pk,pi) in seen:raise ValueError('duplicate served draft/pick')
            seen.add((d,pk,pi))
            if sum(ex.pool.values())!=pi-1:
                coverage[label]['invalid_prior_length']+=1;continue
            row,prior,counts=choice(ex,info[1],model,metadata,(),normalize_probabilities)
            coverage[label].update(counts)
            groups[label].append((row,prior,pi))
    return groups,coverage

def prepare(sid,manifest,prior=None,phase='residual'):
    stat.verify_source_lock()
    m,windows,files=load_manifest(manifest)
    if m['set']!=sid or m['mode']!='PremierDraft' or read_json(files['interactions'])!={'schema':1,'edges':[]}:
        raise ValueError('manifest identity or feature registry mismatch')
    shas={k:v['sha256'] for k,v in m['sources'].items()}
    p=prior['provenance'] if prior else None
    if p and (p['sources']!=shas or p['windows']!=m['windows'] or p['purge_days']!=m['purge_days']):
        raise ValueError('frozen input parity failure')
    sources,inconsistent=scan_drafts(files['draft'],windows,parse_rate_bucket,parse_games_lower_bound)
    recovery=None
    if sid in rec.RECOVER and prior:
        dup,bad=rec.invalid_pick_sources(files['draft'],sources)
        for d in dup|bad:sources.pop(d,None)
        linked,crossed,chronology=rec.linked_games(files['games'],sources,windows['baseline'][1])
        recovery={'duplicate_sources_excluded':len(dup),'invalid_numbering_sources_excluded':len(bad),
                  'chronology':chronology,'source_draft_disjoint':True}
    else:
        # Historical strict formats retain exact old inclusion. A genuinely
        # new set may use whole-source duplicate exclusion before its fit.
        if not prior:
            dup,bad=rec.invalid_pick_sources(files['draft'],sources)
            for d in dup|bad:sources.pop(d,None)
        linked,crossed=scan_baseline_games(files['games'],sources,windows['baseline'][1])
    if p and p.get('recovery')!=recovery:raise ValueError('recovery parity failure')
    try:
        strong,_,cutoff=select_sources(sources,crossed,quantile_cutoff)
    except ValueError as exc:
        if 'No experienced drafts' in str(exc):
            raise exp.Blocked('no qualifying chronological baseline cohort') from exc
        raise
    baseline={d:v for d,v in strong.items() if v[0]=='baseline'}
    base,skips=read_picks(files['draft'],baseline,parse_example,candidate_columns,pool_columns)
    if not base or not set(base)&set(linked):
        raise exp.Blocked('no baseline picks with chronological game evidence')
    if set(base)!=set(baseline):raise ValueError('missing baseline draft picks')
    models,colour,baseline_picks=build_models(BaselineView(sid,base),files['games'],sorted(base))
    if p and (p['baseline_drafts']!=len(base) or p['baseline_picks']!=baseline_picks
              or p['baseline_cutoff']!=cutoff or p['baseline_colour_coverage']!=colour[V6_MODEL]):
        raise ValueError('original baseline fit parity failure')
    pack_min=min(x.raw_pack_number for xs in base.values() for x in xs)
    pick_min=min(x.raw_pick_number for xs in base.values() for x in xs)
    if pack_min not in (0,1) or pick_min not in (0,1):raise ValueError('invalid numbering')
    model=models[V6_MODEL];del base,models
    eligible={}
    for d,v in sources.items():
        ph,t,rate,games=v
        if ph!=phase or d in crossed or rate is None or games is None or games<MIN_GAMES:continue
        eligible[d]=(ph+('_elite' if rate>=cutoff else '_control'),v)
    if set(eligible)&set(baseline):raise ValueError('baseline overlap')
    metadata=read_json(files['metadata'])
    groups,coverage=read_records(files['draft'],eligible,model,metadata,1-pack_min,1-pick_min,11 if sid=='powered-cube' else 10)
    elite,ordinary=[groups[phase+'_'+c] for c in ('elite','control')]
    if not elite or not ordinary:raise exp.Blocked('empty '+phase+' cohort')
    if {r.source for r,_,_ in elite}&{r.source for r,_,_ in ordinary}:raise ValueError('cohort overlap')
    provenance={'set':sid,'sources':shas,'windows':m['windows'],'purge_days':m['purge_days'],
        'baseline_cutoff':cutoff,'baseline_picks':baseline_picks,'baseline_drafts':len(baseline),
        'baseline_colour_coverage':colour[V6_MODEL],'recovery':recovery,'phase':phase,
        'inconsistent_drafts':inconsistent,'purged_game_crossings':len(crossed),
        'coverage':{k:dict(v) for k,v in coverage.items()},
        'cohorts':{k:{'decisions':len(v),'drafts':len({r.source for r,_,_ in v})}
                   for k,v in ((phase+'_elite',elite),(phase+'_control',ordinary))},
        'parser_sha256':sha256(Path(parser.__file__)),'correction_sha256':sha256(Path(correction.__file__)),
        'recipe_sha256':sha256(Path(skill.__file__)),'prepare_sha256':sha256(SOURCE),'lock_sha256':sha256(stat.LOCK)}
    return elite,ordinary,metadata,files['draft'],provenance,model,set(sources),windows

def fit_rows(elite,ordinary,metadata):
    rules=parser.index(metadata)
    e=[correction.fit_features(r,p,rules) for r,p,_ in elite]
    o=[correction.fit_features(r,p,rules) for r,p,_ in ordinary]
    cards=skill.eligible_cards(e,o)
    penalty=skill.CARD_PRIOR/min(len(e),len(o))
    ec,ei,ef=skill.cohort_fit(e,cards,penalty);oc,oi,of=skill.cohort_fit(o,cards,penalty)
    return {'features':list(skill.FEATURES[:6]),'eligible_card_count':len(cards),
        'minimum_offered_in_each_fit_cohort':skill.MIN_OFFERED,'context_penalty':skill.CONTEXT_PENALTY,
        'card_penalty':penalty,'card_prior':skill.CARD_PRIOR,'lambda':skill.LAMBDA,
        'max_log_adjustment':skill.MAX_LOG_ADJUST,'actual_centered_clip':parser.HALF_SPAN,
        'elite':ef,'control':of,'elite_context':ec,'control_context':oc,
        'elite_card_effects':ei,'control_card_effects':oi}

def fit(sid,manifest,prior=None):
    elite,ordinary,metadata,_,prov,_,_,_=prepare(sid,manifest,prior,'residual')
    if prior:
        for c,rs in [('elite',elite),('control',ordinary)]:
            if len(rs)!=prior['fit'][c]['decisions']:
                raise ValueError('original residual decision count mismatch '+c)
    fit=fit_rows(elite,ordinary,metadata)
    return {'protocol':PROTOCOL,'set':sid,'release_allowed':False,'fit':fit,
        'provenance':prov,'previous_fit':prior['fit'] if prior else None}

def check_fit(r,sid,prior=None):
    p=r['provenance'];f=r['fit']
    if (r['protocol']!=PROTOCOL or r['set']!=sid or r['release_allowed'] or p['phase']!='residual'
        or p['parser_sha256']!=sha256(Path(parser.__file__))
        or p['correction_sha256']!=sha256(Path(correction.__file__))
        or p['recipe_sha256']!=sha256(Path(skill.__file__))
        or p['prepare_sha256']!=sha256(SOURCE) or p['lock_sha256']!=sha256(stat.LOCK)
        or f['actual_centered_clip']!=parser.HALF_SPAN
        or f['context_penalty']!=skill.CONTEXT_PENALTY or f['card_prior']!=skill.CARD_PRIOR
        or f['lambda']!=skill.LAMBDA or f['minimum_offered_in_each_fit_cohort']!=skill.MIN_OFFERED
        or not all(f[c]['converged'] for c in ('elite','control'))):
        raise ValueError('refit provenance mismatch '+sid)
    if prior and (r['previous_fit']!=prior['fit'] or p['sources']!=prior['provenance']['sources']
                  or p['windows']!=prior['provenance']['windows']):
        raise ValueError('refit original input mismatch '+sid)
    correction.parameters(f)
    return r

def load_fits(root):
    result={}
    for path in sorted(root.glob('pool-aware-v7-refit-*/fit.json')):
        r=read_json(path);sid=r['set']
        if sid not in exp.SETS or sid in result:raise ValueError('unexpected fit identity')
        result[sid]=check_fit(r,sid)
    if set(result)!=set(exp.SETS):raise ValueError('missing frozen refits: '+','.join(sorted(set(exp.SETS)-set(result))))
    return result

def mean_context(fits,exclude=None,previous=False):
    # Equal format weighting, no target-format coefficient, no card terms.
    ids=sorted(s for s in fits if s!=exclude)
    if not ids:raise ValueError('empty cross-format fit average')
    key='previous_fit' if previous else 'fit'
    return tuple(math.fsum(fits[s][key]['elite_context'][i] for s in ids)/len(ids) for i in range(6))

def traditional(sid,model,metadata,cutoff,windows,premier_ids):
    if sid not in TRAD:return {'status':'not_in_28_pins'},[],[]
    pin=TRAD[sid]['source_archive']
    path=exp.directory(sid)/(pin['sha256']+'.csv.gz')
    if not path.is_file():return {'status':'unavailable','archive_sha256':pin['sha256'],
        'has_win_rate_bucket':None,'has_games_bucket':None,'reason':'retained Traditional archive unavailable',
        'outcome_correlation':'unavailable: no stored Traditional game archive'},[],[]
    if sha256(path)!=pin['sha256']:raise ValueError('Traditional pin mismatch')
    header=exp.header(path)
    has_rate='user_game_win_rate_bucket' in header;has_games='user_n_games_bucket' in header
    report={'status':'unavailable','archive_sha256':pin['sha256'],'has_win_rate_bucket':has_rate,
        'has_games_bucket':has_games,'outcome_correlation':'unavailable: no stored Traditional game archive',
        'validation_window':[x.isoformat() for x in windows['validation']],
        'cohort_cutoff':cutoff,'minimum_games':MIN_GAMES,'baseline':'chronological Premier v6; no Traditional training'}
    if not has_rate or not has_games or 'draft_time' not in header:
        report['reason']='required Traditional cohort/timestamp fields absent';return report,[],[]
    sources,bad=scan_drafts(path,windows,parse_rate_bucket,parse_games_lower_bound)
    sources={d:v for d,v in sources.items() if v[0]=='validation'}
    duplicates,invalid=rec.invalid_pick_sources(path,sources)
    overlap=set(sources)&premier_ids
    for d in duplicates|invalid|overlap:sources.pop(d,None)
    eligible={d:('elite' if v[2]>=cutoff else 'control',v)
        for d,v in sources.items() if v[2] is not None and v[3] is not None and v[3]>=MIN_GAMES}
    report.update({'validation_sources':len(sources),'experienced_sources':len(eligible),
        'inconsistent_sources':bad,'duplicate_sources_excluded':len(duplicates),
        'invalid_numbering_sources_excluded':len(invalid),'premier_overlap_excluded':len(overlap)})
    if not eligible:
        report['reason']='no experienced Traditional sources in the frozen validation window';return report,[],[]
    pack_min=pick_min=999
    for names,idx,reader in rows(path):
        for v in reader:
            if v[idx['draft_id']].strip() in eligible:
                pack_min=min(pack_min,int(float(v[idx['pack_number']])));pick_min=min(pick_min,int(float(v[idx['pick_number']])))
    if pack_min not in (0,1) or pick_min not in (0,1):
        report['reason']='unrecognized Traditional numbering';return report,[],[]
    first,last=(2,7) if sid=='powered-cube' else (1,6) if sid=='fra' else (1,8)
    groups,coverage=read_records(path,eligible,model,metadata,1-pack_min,1-pick_min,last,first)
    e,o=groups['elite'],groups['control']
    report.update({'approved_pick_window':[first,last],'elite_decisions':len(e),'ordinary_decisions':len(o),
        'elite_drafts':len({r.source for r,_,_ in e}),'ordinary_drafts':len({r.source for r,_,_ in o}),
        'coverage':{c:dict(v) for c,v in coverage.items()}})
    if len(e)<50 or len(o)<50 or min(report['elite_drafts'],report['ordinary_drafts'])<2:
        report['reason']='insufficient matched cohort coverage';return report,[],[]
    report['status']='measured'
    return report,e,o
