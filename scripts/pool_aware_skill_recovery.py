#!/usr/bin/env python3
"""Complete outstanding format measurements and diagnose color score movements.

The prior frozen skill model and expansion script are untouched. Legacy games
without game timestamps can only support a source-draft-disjoint historical
comparison; that evidence is reported separately from strict chronology.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import gzip
import json
import math
from pathlib import Path
import tempfile

import pool_aware_skill_expansion as exp
import pool_aware_skill_contrast as skill
import pool_aware_statistical_validation as stat
import scoring_experiment as scoring
from pool_aware_archive import (
    MIN_GAMES, BaselineView, load_manifest, read_json, read_picks, rows,
    scan_baseline_games, scan_drafts, select_sources, sha256, time_utc,
)
from pool_aware_restore import prepare as restore_manifest, time_extent
from pool_aware_pilot import windows_from_extent
from pool_aware_refit import evaluate, weights
from pool_aware_diagnostics import diagnostics, grade
from build_replays import (
    candidate_columns, pool_columns, parse_example, parse_rate_bucket,
    parse_games_lower_bound, quantile_cutoff,
)
from assess_v6_colour_model import build_models
from model_training import V6_MODEL

ROOT=exp.ROOT
SETS=exp.SETS
SELECTABLE=exp.SELECTABLE
ORIGINAL=exp.ORIGINAL
RECOVER=('bro','dmu','hbg','mom','neo','one','sir','snc','woe')
ABLATION=('dft','fra','ltr','tdm','powered-cube')
PROTOCOL='skill-contrast-recovery-v1'
SOURCE=Path(__file__).resolve()
NAME=skill.NAME
KEY=skill.KEY
Blocked=exp.Blocked
directory=exp.directory
source_paths=exp.source_paths
header=exp.header
write=exp.write
metadata_snapshot=exp.metadata_snapshot
prior_report=exp.prior_report
served_with_context=exp.served_with_context
simulate=exp.simulate
card_audit=exp.card_audit
outcome_study=exp.outcome_study


def invalid_pick_sources(path,sources):
    """Discard a complete source draft on any ambiguous repeated pick key.

    Read only IDs and pick coordinates; no validation choice is consulted.
    Compact bitsets avoid retaining millions of tuple keys in memory.
    """
    masks={}; duplicate=set(); invalid=set()
    for names,idx,reader in rows(path):
        for v in reader:
            d=v[idx['draft_id']].strip()
            if d not in sources or d in duplicate or d in invalid:
                continue
            try:
                pack=float(v[idx['pack_number']]); pick=float(v[idx['pick_number']])
                if not pack.is_integer() or not pick.is_integer() or not 0<=pack<=4 or not 0<=pick<=31:
                    raise ValueError('unsupported coordinate')
                bit=1 << (32*int(pack)+int(pick))
            except (ValueError,TypeError,OverflowError):
                invalid.add(d);continue
            mask=masks.get(d,0)
            if mask&bit:
                duplicate.add(d)
            masks[d]=mask|bit
    return duplicate,invalid


def linked_games(path,sources,end):
    """Use strict game chronology when available; never invent game times."""
    names=header(path)
    if 'game_time' in names:
        linked,crossed=scan_baseline_games(path,sources,end)
        return linked,crossed,{'classification':'strict_game_time','game_time_present':True,
            'linked_baseline_drafts':len(linked),'excluded_mismatches':len(crossed)}
    if not {'draft_id','main_colors','splash_colors'}<=set(names):
        raise Blocked('legacy archive lacks required deck evidence')
    linked={}; invalid=set(); has_draft_time='draft_time' in names
    for names,idx,reader in rows(path):
        for v in reader:
            if len(v)!=len(names):
                raise ValueError('malformed game row')
            d=v[idx['draft_id']].strip()
            if d not in sources or sources[d][0]!='baseline':
                continue
            if has_draft_time:
                try:
                    if time_utc(v[idx['draft_time']])!=sources[d][1]:
                        invalid.add(d);continue
                except (ValueError,TypeError):
                    invalid.add(d);continue
            # This is a verified link to a BASELINE source draft, not a game
            # completion time. build_models consumes only baseline draft IDs.
            linked[d]=True
    return linked,invalid,{'classification':'source_draft_disjoint_only',
        'game_time_present':False,'game_archive_draft_time_verified':has_draft_time,
        'linked_baseline_drafts':len(linked),'excluded_mismatches':len(invalid),
        'limitation':'actual linked game completion before baseline cutoff cannot be established; not strict chronological evidence'}

def recovered_inputs(sid,work,previous_path=None):
    stat.verify_source_lock()
    files=source_paths(sid)
    for key,kind in [('draft','source_archive'),('games','skill_source')]:
        if sha256(files[key])!=SETS[sid][kind]['sha256']:
            raise ValueError('pinned source mismatch '+key)
    draft_required={'draft_id','draft_time','user_game_win_rate_bucket','user_n_games_bucket','pack_number','pick_number','pick'}
    game_required={'draft_id','main_colors','splash_colors'}
    missing={'draft':sorted(draft_required-set(header(files['draft']))),
             'games':sorted(game_required-set(header(files['games'])))}
    if any(missing.values()):
        raise Blocked('archive schema prevents chronological fit: '+json.dumps(missing,sort_keys=True))
    previous=prior_report(previous_path,sid) if previous_path else None
    if previous or sid not in RECOVER:
        raise ValueError('recovery inputs are restricted to the nine outstanding formats')
    work.mkdir(parents=True,exist_ok=True)
    metadata=metadata_snapshot(sid,files['draft'],work/'rules.json.gz',previous)
    if previous:
        w=previous['provenance']['windows']; purge=previous['provenance']['purge_days']
    else:
        extent=time_extent(files['draft'],'draft_time')
        try:
            w=windows_from_extent(extent['first_utc'],extent['last_utc'],purge_days=0)
        except ValueError as exc:
            raise Blocked(str(exc)) from exc
        purge=0
    write(work/'windows.json',w)
    write(work/'metadata-provenance.json',metadata)
    report=restore_manifest(sid,directory(sid),work/'rules.json.gz',work/'windows.json',purge_days=purge)
    m=read_json(report['manifest'])
    if previous:
        p=previous['provenance']
        if (m['windows']!=p['windows'] or m['purge_days']!=p['purge_days']
            or {k:v['sha256'] for k,v in m['sources'].items()}!=p['sources']):
            raise ValueError('original manifest changed')
    print(json.dumps({'set':sid,'metadata':metadata,'windows':w},indent=2),flush=True)


def prepare_recovered(sid,manifest,previous=None):
    stat.verify_source_lock()
    m,windows,files=load_manifest(manifest)
    if m['set']!=sid or read_json(files['interactions'])!={'schema':1,'edges':[]}:
        raise ValueError('manifest identity or feature registry mismatch')
    sources,inconsistent=scan_drafts(files['draft'],windows,parse_rate_bucket,parse_games_lower_bound)
    duplicates, invalid_numbering=invalid_pick_sources(files['draft'],sources)
    for d in duplicates|invalid_numbering:
        sources.pop(d,None)
    linked,crossed,chronology=linked_games(files['games'],sources,windows['baseline'][1])
    try:
        strong,_,cutoff=select_sources(sources,crossed,quantile_cutoff)
    except ValueError as exc:
        if 'No experienced drafts' in str(exc):
            raise Blocked('no qualifying chronological baseline cohort') from exc
        raise
    baseline={d:v for d,v in strong.items() if v[0]=='baseline'}
    base,skips=read_picks(files['draft'],baseline,parse_example,candidate_columns,pool_columns)
    if not base or not set(base)&set(linked):
        raise Blocked('no qualifying baseline picks with chronological game evidence')
    if set(base)!=set(baseline):
        raise ValueError('qualified baseline draft lacks usable picks')
    models,colour,baseline_picks=build_models(BaselineView(sid,base),files['games'],sorted(base))
    if previous:
        p=previous['provenance']
        if (p['baseline_drafts']!=len(base) or p['baseline_picks']!=baseline_picks
            or p['baseline_cutoff']!=cutoff):
            raise ValueError('original baseline parity failure')
    pack_min=min(x.raw_pack_number for xs in base.values() for x in xs)
    pick_min=min(x.raw_pick_number for xs in base.values() for x in xs)
    if pack_min not in (0,1) or pick_min not in (0,1):
        raise Blocked('unrecognized archive numbering')
    model=models[V6_MODEL]
    del base,models
    eligible={}
    for d,v in sources.items():
        phase,t,rate,games=v
        if (phase not in ('residual','validation') or (previous and phase=='residual')
            or d in crossed or rate is None or games is None or games<MIN_GAMES):
            continue
        eligible[d]=(phase+('_elite' if rate>=cutoff else '_control'),v)
    if set(baseline)&set(eligible):
        raise ValueError('baseline overlap')
    metadata=read_json(files['metadata'])
    groups,coverage=served_with_context(files['draft'],eligible,model,metadata,1-pack_min,1-pick_min,11 if sid=='powered-cube' else 10)
    del model
    labels=('validation_elite','validation_control') if previous else ('residual_elite','residual_control','validation_elite','validation_control')
    ids=set()
    for label in labels:
        records=groups[label]
        current={r.source for r,_,_ in records}
        if not current:
            raise Blocked('empty chronological cohort: '+label)
        if ids&current:
            raise ValueError('overlapping source cohorts')
        ids.update(current)
    if previous:
        fit=previous['fit']
    else:
        e=[r for r,_,_ in groups.pop('residual_elite')]
        o=[r for r,_,_ in groups.pop('residual_control')]
        cards=skill.eligible_cards(e,o)
        penalty=skill.CARD_PRIOR/min(len(e),len(o))
        print(f'{sid}: residual strong={len(e)}, ordinary={len(o)}, eligible cards={len(cards)}',flush=True)
        ec,ei,ef=skill.cohort_fit(e,cards,penalty)
        oc,oi,of=skill.cohort_fit(o,cards,penalty)
        fit={'features':list(skill.FEATURES[:6]),'eligible_card_count':len(cards),
            'minimum_offered_in_each_fit_cohort':skill.MIN_OFFERED,'context_penalty':skill.CONTEXT_PENALTY,
            'card_penalty':penalty,'card_prior':skill.CARD_PRIOR,'lambda':skill.LAMBDA,
            'max_log_adjustment':skill.MAX_LOG_ADJUST,'elite':ef,'control':of,
            'elite_context':ec,'control_context':oc,'elite_card_effects':ei,'control_card_effects':oi}
        del e,o
    context=tuple(a-b for a,b in zip(fit['elite_context'],fit['control_context']))
    cards={c:fit['elite_card_effects'][c]-fit['control_card_effects'][c] for c in fit['elite_card_effects']}
    if set(fit['elite_card_effects'])!=set(fit['control_card_effects']):
        raise ValueError('cohort card identity mismatch')
    val=skill.predict_pairs(groups['validation_elite'],context,cards)
    ordinary=skill.predict_pairs(groups['validation_control'],context,cards)
    del groups
    provenance={'set':sid,'status':SETS[sid]['status'],'mode':m['mode'],
        'sources':{k:v['sha256'] for k,v in m['sources'].items()},'windows':m['windows'],'purge_days':m['purge_days'],
        'baseline_drafts':len(baseline),'baseline_picks':baseline_picks,'baseline_cutoff':cutoff,
        'baseline_colour_coverage':colour[V6_MODEL],'inconsistent_drafts':inconsistent,'purged_game_crossings':len(crossed),
        'fit_status':'exact previous fit' if previous else 'same fixed recipe; residual only',
        'coverage':{k:dict(v) for k,v in coverage.items()},
        'model_recipe_sha256':sha256(Path(skill.__file__)),'lock_sha256':sha256(stat.LOCK),
        'audit_code_sha256':sha256(SOURCE),
        'recovery':{'duplicate_sources_excluded':len(duplicates),
                    'invalid_numbering_sources_excluded':len(invalid_numbering),
                    'chronology':chronology,
                    'source_draft_disjoint':True}}
    return val,ordinary,fit,metadata,files['draft'],provenance


def measure_recovered(sid,work,output,previous_path=None):
    previous=prior_report(previous_path,sid) if previous_path else None
    val,ordinary,fit,metadata,draft_path,provenance=prepare_recovered(sid,directory(sid)/'manifest.json',previous)
    outcome=stat.selected_outcomes(draft_path,{r.source for r,_,_ in val+ordinary})
    cohorts,bank=stat.summarize(sid,skill.APPLY,val,ordinary,outcome,candidate_name=NAME)
    output.mkdir(parents=True,exist_ok=True)
    bf=output/'simulation-bank.json.gz'
    bf.write_bytes(gzip.compress(json.dumps({'set':sid,'rows':bank},separators=(',',':')).encode(),mtime=0))
    if previous:
        # Reuse the successful prior simulations only after exact bank parity.
        if sha256(bf)!=previous['bank_sha256']:
            raise ValueError('previous frozen-coefficient simulation-bank parity mismatch')
        for cohort in ('elite','control'):
            for model in ('v6',NAME):
                old=previous['cohorts'][cohort]['prediction'][model]
                new=cohorts[cohort]['prediction'][model]
                for k in ('decisions','top1','raw_log_loss','display_log_loss','display_brier'):
                    if not math.isclose(old[k],new[k],rel_tol=1e-9,abs_tol=1e-10):
                        raise ValueError('previous frozen scoring parity mismatch')
        simulation=previous['simulation']
    else:
        simulation=simulate(list(stat.simulation_rows(sid,bank,NAME)),sid,'powered-cube' if sid=='powered-cube' else 'mixed')
    pred=diagnostics(val,skill.APPLY)['paired']['all']
    a=cohorts['elite']['scores']['all']
    tail=a[NAME]['below_25']-a['v6']['below_25']
    guards={'severe_tail_delta':tail,'severe_tail_safe':tail<=stat.TAIL_LIMIT,
            'raw_log_loss_delta':pred['raw_log_loss'],
            'raw_log_loss_safe':pred['raw_log_loss']['ci95'] is not None and pred['raw_log_loss']['ci95'][1]<=.005,
            'top1_delta':pred['top1'],'top1_safe':pred['top1']['ci95'] is not None and pred['top1']['ci95'][0]>=-.01}
    audit=card_audit(val,metadata)
    actual=outcome_study(sid,val+ordinary,outcome)
    report={'protocol':PROTOCOL,'set':sid,'status':'measured','scope':'historical development; see chronology classification',
        'provenance':provenance,'metadata':read_json(work/'metadata-provenance.json'),'fit':fit,
        'cohorts':cohorts,'guardrails':guards,'simulation':simulation,'bank_sha256':sha256(bf),
        'card_audit':audit,'outcomes':actual,'release_allowed':False}
    write(output/'report.json',report)
    print(json.dumps({'set':sid,'status':'measured','simulation':simulation,'guardrails':guards,
        'cohort_decisions':{c:r['decisions'] for c,r in cohorts.items()},'recovery':provenance['recovery'],'card_groups':audit['groups'],
        'outcomes':actual.get('comparison',{'status':actual['status']})},indent=2),flush=True)



def load_previous(folder,sid):
    path=folder/'result/report.json'
    r=read_json(path)
    p=r['provenance']
    if (r['protocol']!=exp.PROTOCOL or r['set']!=sid or r['status']!='measured'
        or r['release_allowed'] or p['model_recipe_sha256']!=sha256(Path(skill.__file__))
        or p['audit_code_sha256']!=sha256(Path(exp.__file__)) or p['lock_sha256']!=sha256(stat.LOCK)):
        raise ValueError('frozen expansion report mismatch')
    f=r['fit']
    if f['lambda']!=skill.LAMBDA or f['max_log_adjustment']!=skill.MAX_LOG_ADJUST:
        raise ValueError('frozen fit recipe mismatch')
    return r


def ablation_inputs(sid,folder,work):
    previous=load_previous(folder,sid)
    p=previous['provenance']; files=source_paths(sid)
    work.mkdir(parents=True,exist_ok=True)
    src=folder/'input/rules.json.gz'
    dest=work/'rules.json.gz'; dest.write_bytes(src.read_bytes())
    if sha256(dest)!=p['sources']['metadata']:
        raise ValueError('original rules digest mismatch')
    for k,name in [('draft','source_archive'),('games','skill_source')]:
        if sha256(files[k])!=p['sources'][k] or p['sources'][k]!=SETS[sid][name]['sha256']:
            raise ValueError('original source digest mismatch')
    write(work/'windows.json',p['windows'])
    m=restore_manifest(sid,directory(sid),dest,work/'windows.json',purge_days=p['purge_days'])
    manifest=read_json(m['manifest'])
    if {k:v['sha256'] for k,v in manifest['sources'].items()}!=p['sources']:
        raise ValueError('original manifest digest mismatch')


def multi_simulation(sid,banks,arms):
    # Identical choice and draft order for every arm. Never use a separately
    # sampled v6 comparison or compare unpaired simulations.
    records=[]
    base=banks['full']
    for arm,bank in banks.items():
        if len(bank)!=len(base):
            raise ValueError('arm score bank length mismatch')
    for i,b in enumerate(base):
        row=next(stat.simulation_rows(sid,[b],NAME))
        row['scores']={'v6|1':b[4]}
        for arm in arms:
            other=banks[arm][i]
            if b[:5]!=other[:5]:
                raise ValueError('unpaired arm score bank')
            row['scores'][arm+'|1']=other[5]
        records.append(row)
    scoring.MODELS=['v6',*arms];scoring.EXPONENTS=[1.]
    scoring.BASELINE='v6|1';scoring.SEED=stat.SEED
    env='powered-cube' if sid=='powered-cube' else 'mixed'
    opening=2 if env=='mixed' and min(r['pick'] for r in records)==2 else 1
    profiles=scoring.profiles_for(records,env,stat.RUNS,False,stat.DAY,opening_pick=opening)
    return scoring.simulated_report(records,profiles,stat.BOOTSTRAP_DRAWS,stat.BOOTSTRAP_RUNS)


def ablation(sid,folder,output):
    previous=load_previous(folder,sid)
    val,ordinary,fit,metadata,draft_path,provenance=exp.prepare_fit(sid,directory(sid)/'manifest.json',previous)
    context=tuple(a-b for a,b in zip(fit['elite_context'],fit['control_context']))
    cards={c:fit['elite_card_effects'][c]-fit['control_card_effects'][c] for c in fit['elite_card_effects']}
    # The already-applied feature slot 6 is overwritten by skill.apply.
    # Do not refit coefficients, change the score curve, or choose a new cap.
    arms={'full':(context,cards),'card-only':((0.,)*6,cards),
          'context-only':(context,{}),'card-plus-elite-context':(tuple(fit['elite_context']),cards)}
    outcomes=stat.selected_outcomes(draft_path,{r.source for r,_,_ in val+ordinary})
    reports={}; banks={}
    for arm,(ctx,card) in arms.items():
        e,o=skill.predict_pairs(val,ctx,card),skill.predict_pairs(ordinary,ctx,card)
        cohorts,bank=stat.summarize(sid,skill.APPLY,e,o,outcomes,candidate_name=NAME)
        if arm=='full':
            # Check exact original byte identity (same gzip encoding).
            import hashlib
            digest=hashlib.sha256(gzip.compress(json.dumps({'set':sid,'rows':bank},separators=(',',':')).encode(),mtime=0)).hexdigest()
            if digest!=previous['bank_sha256']:
                raise ValueError('frozen full candidate score bank changed')
        audit=card_audit(e,metadata)
        pred=diagnostics(e,skill.APPLY)['paired']['all']
        a=cohorts['elite']['scores']['all']
        reports[arm]={'card_groups':audit['groups'],'examples':audit['examples'],
            'elite_score_distribution':a,'prediction':cohorts['elite']['prediction'],
            'paired_prediction':pred,'outcomes':outcome_study(sid,e+o,outcomes).get('comparison'),
            'severe_tail_delta':a[NAME]['below_25']-a['v6']['below_25']}
        banks[arm]=bank
        del e,o,audit
    simulation=multi_simulation(sid,banks,list(arms))
    r={'protocol':'skill-contrast-component-ablation-v1','set':sid,'release_allowed':False,
       'scope':'fixed coefficient component screen on previously evaluated decisions',
       'features':list(skill.FEATURES[:6]),'elite_context':fit['elite_context'],
       'ordinary_context':fit['control_context'],'contrast_context':context,
       'original_report_sha256':sha256(folder/'result/report.json'),'arms':reports,'simulation':simulation}
    write(output/'ablation.json',r)
    print(json.dumps({'set':sid,'simulation':simulation,'contrast_context':context,
        'arms':{a:{'groups':v['card_groups'],'severe_tail_delta':v['severe_tail_delta'],
                   'paired_prediction':v['paired_prediction'],'outcomes':v['outcomes']} for a,v in reports.items()}},indent=2),flush=True)


def combine(previous_dir,recovered_dir,ablation_dir,output):
    reports={}; banks={}; blocked={}
    for folder,pattern,protocol,code in [
        (previous_dir,'pool-aware-expansion-transfer-*',exp.PROTOCOL,Path(exp.__file__)),
        (recovered_dir,'pool-aware-recovery-transfer-*',PROTOCOL,SOURCE)]:
        for path in sorted(folder.glob(pattern+'/report.json')):
            r=read_json(path); sid=r['set']
            if sid not in SETS or r['protocol']!=protocol or r['release_allowed']:
                raise ValueError('unexpected report identity')
            if protocol==PROTOCOL:
                if sid not in RECOVER or sid in reports:
                    raise ValueError('unexpected recovered set')
                blocked.pop(sid,None)
            elif sid in reports or sid in blocked:
                raise ValueError('duplicate original report')
            if r['status']=='blocked':
                blocked[sid]=r;continue
            p=r['provenance']
            if (p['model_recipe_sha256']!=sha256(Path(skill.__file__)) or p['lock_sha256']!=sha256(stat.LOCK)
                or p['audit_code_sha256']!=sha256(code)):
                raise ValueError('measurement provenance mismatch')
            bf=path.parent/'simulation-bank.json.gz'
            if sha256(bf)!=r['bank_sha256']:
                raise ValueError('bank digest mismatch')
            d=read_json(bf)
            if d['set']!=sid:
                raise ValueError('bank set mismatch')
            banks[sid]=list(stat.simulation_rows(sid,d['rows'],NAME))
            reports[sid]=r
    if not reports:
        raise ValueError('no reports')
    strict={s for s,r in reports.items() if r['provenance'].get('recovery',{}).get('chronology',{}).get('classification','strict_game_time')=='strict_game_time'}
    legacy=set(reports)-strict
    missing=sorted(set(SETS)-set(reports)-set(blocked))
    result={'protocol':PROTOCOL,'release_allowed':False,'expected_sets':sorted(SETS),
        'strict_chronology_sets':sorted(strict),'legacy_source_disjoint_sets':sorted(legacy),
        'blocked_sets':{s:r['reason'] for s,r in blocked.items()},'missing_sets':missing,'sets':{},
        'runs':{},'outcomes':{},'ablation':{}}
    for s,r in reports.items():
        result['sets'][s]={'evidence_class':'strict_game_time' if s in strict else 'source_draft_disjoint_only',
            'recovery':r['provenance'].get('recovery'),'guardrails':r['guardrails'],'simulation':r['simulation'],
            'cohort_decisions':{k:v['decisions'] for k,v in r['cohorts'].items()},
            'card_groups':r['card_audit']['groups'],'outcomes':r['outcomes'].get('comparison'),
            'examples':r['card_audit']['examples']}
    reg=set(SETS)-SELECTABLE-{'powered-cube'}
    scopes={'strict_mixed':strict&reg,'legacy_mixed':legacy&reg,'mixed_sensitivity_all_measured':set(reports)&reg,
            'powered-cube':set(reports)&{'powered-cube'}}
    scopes.update({'standalone:'+s:{s} for s in sorted(SELECTABLE&set(reports))})
    for label,sids in scopes.items():
        ids=sorted(sids)
        if not ids:
            continue
        if label.startswith('standalone:'):
            sim=reports[ids[0]]['simulation']
        else:
            env='powered-cube' if label=='powered-cube' else 'mixed'
            sim=simulate([r for s in ids for r in banks[s]],environment=env,runs=10000,per_draw=2000)
        result['runs'][label]={'sets':ids,'simulation':sim,
            'guardrails_safe':all(all(reports[s]['guardrails'][k] for k in ('severe_tail_safe','raw_log_loss_safe','top1_safe')) for s in ids),
            'all_regular_formats_strictly_validated':reg<=strict,
            'note':'legacy sensitivity is not proof of strict chronology' if 'legacy' in label or 'sensitivity' in label else 'strict chronology unless standalone evidence class says otherwise'}
        result['outcomes'][label]=exp.combine_outcomes([reports[s]['outcomes'] for s in ids])
    for path in sorted(ablation_dir.glob('pool-aware-ablation-*/ablation.json')):
        a=read_json(path)
        if a['set'] not in ABLATION or a['protocol']!='skill-contrast-component-ablation-v1' or a['release_allowed'] or a['set'] in result['ablation']:
            raise ValueError('ablation report mismatch')
        result['ablation'][a['set']]=a
    result['ablation_missing']=sorted(set(ABLATION)-set(result['ablation']))
    write(output,result)
    print(json.dumps({'strict_chronology_sets':result['strict_chronology_sets'],'legacy_source_disjoint_sets':result['legacy_source_disjoint_sets'],
        'blocked_sets':result['blocked_sets'],'missing_sets':missing,'runs':result['runs'],
        'outcomes':result['outcomes'],'ablation_missing':result['ablation_missing'],
        'ablation':{s:{'simulation':a['simulation'],'contrast_context':a['contrast_context'],
                       'groups':{k:{g:v for g,v in arm['card_groups'].items() if g in ('late_supported_proxy','late_missing_access_proxy','fixing_utility_proxy','early_speculation_proxy','v6_close_alternative')}
                                 for k,arm in a['arms'].items()}} for s,a in result['ablation'].items()}},indent=2),flush=True)


def self_test():
    exp.self_test()
    from datetime import datetime,timezone
    with tempfile.TemporaryDirectory() as tmp:
        path=Path(tmp)/'draft.csv'
        path.write_text('draft_id,pack_number,pick_number\na,0,0\na,0,0\nb,0,0\nb,0,1\nc,0,wrong\n')
        dup,invalid=invalid_pick_sources(path,{'a':1,'b':1,'c':1})
        assert dup=={'a'} and invalid=={'c'}
        game=Path(tmp)/'games.csv'
        t=datetime(2025,1,1,tzinfo=timezone.utc)
        sources={'a':('baseline',t,.6,100),'b':('validation',t,.6,100),'c':('baseline',t,.6,100)}
        game.write_text('draft_id,draft_time,main_colors,splash_colors\na,2025-01-01T00:00:00Z,W,U\nb,2025-01-01T00:00:00Z,U,W\nc,2025-01-02T00:00:00Z,W,B\n')
        linked,invalid,meta=linked_games(game,sources,datetime(2025,2,1,tzinfo=timezone.utc))
        assert set(linked)=={'a'} and invalid=={'c'} and meta['classification']=='source_draft_disjoint_only'
    b=[[cohort,d,pick,band,60 if cohort=='elite' else 40,70 if cohort=='elite' else 38]
         for cohort in ('elite','control') for d in range(12) for pick in range(1,9) for band in ('easy','medium','hard')]
    # Real multi-arm helper with tiny test profile count; restore defaults.
    before=(stat.RUNS,stat.BOOTSTRAP_DRAWS,stat.BOOTSTRAP_RUNS)
    stat.RUNS,stat.BOOTSTRAP_DRAWS,stat.BOOTSTRAP_RUNS=20,2,10
    try:
        sim=multi_simulation('dft',{'full':b,'card-only':b},['full','card-only'])
        assert sim['runs']==20 and sim['configurations']['full|1']['auc']==1
    finally:
        stat.RUNS,stat.BOOTSTRAP_DRAWS,stat.BOOTSTRAP_RUNS=before
    print('Recovery contracts passed: whole-draft duplicate exclusion, legacy source isolation and paired ablation.',flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('restore','inputs','measure','ablation-inputs','ablation','combine'))
    p.add_argument('--set',choices=sorted(set(RECOVER)|set(ABLATION)))
    p.add_argument('--work',type=Path)
    p.add_argument('--previous',type=Path)
    p.add_argument('--recovered',type=Path)
    p.add_argument('--ablations',type=Path)
    p.add_argument('--output',type=Path)
    a=p.parse_args()
    if a.self_test:
        self_test();return
    if a.stage=='combine':
        combine(a.previous,a.recovered,a.ablations,a.output);return
    if not a.set or not a.work or not a.output:
        p.error('set, work and output required')
    if a.stage=='restore':
        exp.recover(a.set);return
    if a.stage=='ablation-inputs':
        ablation_inputs(a.set,a.previous,a.work);return
    if a.stage=='ablation':
        ablation(a.set,a.previous,a.output);return
    if a.set not in RECOVER:
        p.error('not a recovery set')
    if (a.output/'report.json').is_file() and read_json(a.output/'report.json')['status']=='blocked':
        return
    try:
        if a.stage=='inputs':
            recovered_inputs(a.set,a.work)
        elif a.stage=='measure':
            measure_recovered(a.set,a.work,a.output)
        else:
            p.error('stage required')
    except Blocked as exc:
        write(a.output/'report.json',{'protocol':PROTOCOL,'set':a.set,'status':'blocked',
            'reason':str(exc),'source_status':SETS[a.set]['status'],'release_allowed':False})
        print('BLOCKED '+a.set+': '+str(exc),flush=True)


if __name__=='__main__':
    main()
