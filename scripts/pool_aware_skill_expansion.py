#!/usr/bin/env python3
"""Frozen skill-contrast expansion: historical scoring, card changes, outcomes.

No serving imports, player records, new model features, or validation tuning.
The first ten environments reuse the actual fitted coefficients byte-for-byte.
Additional environments fit the identical predeclared recipe.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np

import pool_aware_skill_contrast as skill
import pool_aware_statistical_validation as stat
import scoring_experiment as scoring
from pool_aware_archive import (
    MIN_GAMES, BaselineView, choice, load_manifest, read_json, read_picks,
    rows, scan_baseline_games, scan_drafts, select_sources, sha256,
)
from pool_aware_restore import restore, prepare as restore_manifest, time_extent
from pool_aware_pilot import windows_from_extent
from pool_aware_refit import evaluate, weights
from pool_aware_diagnostics import diagnostics, grade
from pool_aware_features import canonical, spell_pips, fixing_colors
from build_replays import (
    candidate_columns, pool_columns, parse_example, parse_rate_bucket,
    parse_games_lower_bound, quantile_cutoff, normalize_probabilities,
    column_card_name, CARD_PREFIX, POOL_PREFIX,
)
from assess_v6_colour_model import build_models
from model_training import V6_MODEL
from build_rules_context_metadata import search_cards, select_records, encode, FIELDS
from fetch_card_metadata import aliases
from pool_aware_review_reference import fetch_collection

ROOT=stat.ROOT
PINS=ROOT/'research/v6-build-source-pins.json'
POLICY=ROOT/'data/selection-policy.json'
PROTOCOL='skill-contrast-expansion-v1'
SETS={r['id']:r for r in read_json(PINS)['sets']}
SELECTABLE=set(read_json(POLICY)['selectable_only_sets'])
ORIGINAL=set(stat.SETS)
NAME=skill.NAME
KEY=skill.KEY
SOURCE=Path(__file__).resolve()
OUTCOME_DRAWS=400
MIN_OUTCOME_STRATUM=200
MIN_CARD_OFFERS=50
MAX_EXAMPLES=12


class Blocked(ValueError):
    """A documented absence of evidence, never silently a passing test."""


def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,indent=2,ensure_ascii=False,allow_nan=False)+'\n',encoding='utf8')


def directory(sid):
    return ROOT/'raw-data/pool-refit'/sid


def source_paths(sid):
    p=SETS[sid]
    return {k:directory(sid)/(p[name]['sha256']+'.csv.gz')
            for k,name in [('draft','source_archive'),('games','skill_source')]}


def recover(sid):
    for name in ('source_archive','skill_source'):
        restore(SETS[sid][name],directory(sid))


def header(path):
    for names,idx,_ in rows(path):
        return names


def prior_report(path,sid):
    r=read_json(path)
    p=r['provenance']; f=r['fit']
    if (r['protocol']!=skill.PROTOCOL or r['release_allowed'] or p['set']!=sid
        or p['lock_sha256']!=sha256(stat.LOCK)
        or p['research_code_sha256']!=sha256(Path(skill.__file__))
        or p['stat_helper_sha256']!=sha256(Path(stat.__file__))
        or f['features']!=list(skill.FEATURES[:6])
        or f['minimum_offered_in_each_fit_cohort']!=skill.MIN_OFFERED
        or f['context_penalty']!=skill.CONTEXT_PENALTY
        or f['card_prior']!=skill.CARD_PRIOR or f['lambda']!=skill.LAMBDA
        or f['max_log_adjustment']!=skill.MAX_LOG_ADJUST):
        raise ValueError('prior trained candidate identity mismatch')
    return r


def metadata_snapshot(sid,draft,dest,original=None):
    names=header(draft)
    wanted=set(column_card_name(c,CARD_PREFIX) for c in candidate_columns(names))
    wanted.update(column_card_name(c,POOL_PREFIX) for c in pool_columns(names))
    if not wanted:
        raise Blocked('archive lacks candidate/pool card columns')
    repo=ROOT/f'research/data/{sid}-rules-context-2026-10-29.json.gz'
    legacy=ROOT/f'research/decision-context-v1/metadata/{sid}.json.gz'
    if original:
        if not dest.is_file() or sha256(dest)!=original['provenance']['sources']['metadata']:
            raise ValueError('original metadata not restored exactly')
        origin='exact previous skill-contrast snapshot'
    elif repo.is_file():
        dest.write_bytes(repo.read_bytes()); origin=str(repo.relative_to(ROOT))
    elif legacy.is_file() and isinstance(read_json(legacy),dict) and any(canonical(v) for v in read_json(legacy).values()):
        dest.write_bytes(legacy.read_bytes()); origin=str(legacy.relative_to(ROOT))
    else:
        # Only archive COLUMN NAMES are read before freezing rules. Keep
        # exact set printings; fill bonus/inserts only on exact unique alias.
        cards=select_records(search_cards(sid),sid)
        missing=wanted-set(cards)
        if missing:
            found=defaultdict(list)
            for c in fetch_collection([{'name':n} for n in sorted(missing)]):
                for n in aliases(c):
                    if n in missing:
                        found[n].append(c)
            for n,options in found.items():
                if len({c.get('oracle_id',c['id']) for c in options})==1:
                    c=min(options,key=lambda x:x['id'])
                    cards[n]={k:c[k] for k in FIELDS if k in c}
        if not cards:
            raise Blocked('no rules records for the archive')
        dest.write_bytes(encode(cards))
        origin='Scryfall set search and exact unique alias collection; frozen before validation'
    data=read_json(dest)
    if not isinstance(data,dict) or not any(canonical(data.get(n)) for n in wanted):
        raise Blocked('rules snapshot contains no supported archive cards')
    return {'origin':origin,'sha256':sha256(dest),'archive_names':len(wanted),
            'mapped_names':len(wanted&set(data)),
            'simple_rule_names':sum(canonical(data.get(n)) is not None for n in wanted),
            'unmapped_names':sorted(wanted-set(data))}


def inputs(sid,work,previous_path):
    stat.verify_source_lock()
    files=source_paths(sid)
    for key,kind in [('draft','source_archive'),('games','skill_source')]:
        if sha256(files[key])!=SETS[sid][kind]['sha256']:
            raise ValueError('pinned source mismatch '+key)
    draft_required={'draft_id','draft_time','user_game_win_rate_bucket','user_n_games_bucket','pack_number','pick_number','pick'}
    game_required={'draft_id','game_time','main_colors','splash_colors'}
    missing={'draft':sorted(draft_required-set(header(files['draft']))),
             'games':sorted(game_required-set(header(files['games'])))}
    if any(missing.values()):
        raise Blocked('archive schema prevents chronological fit: '+json.dumps(missing,sort_keys=True))
    previous=prior_report(previous_path,sid) if previous_path else None
    if (sid in ORIGINAL)!=bool(previous):
        raise ValueError('original ten must use frozen fit reports')
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


def served_with_context(path,eligible,model,metadata,pack_offset,pick_offset,max_pick):
    groups=defaultdict(list); coverage=defaultdict(Counter); seen=set()
    for names,idx,reader in rows(path):
        pack,pool=candidate_columns(names),pool_columns(names)
        if not pack or not pool:
            raise Blocked('archive lacks pack/pool columns')
        for v in reader:
            d=v[idx['draft_id']].strip()
            if d not in eligible:
                continue
            label,info=eligible[d]
            try:
                pk=int(float(v[idx['pack_number']]))+pack_offset
                pi=int(float(v[idx['pick_number']]))+pick_offset
            except (ValueError,TypeError,OverflowError):
                coverage[label]['invalid_numbering']+=1; continue
            if pk!=1 or not 1<=pi<=max_pick:
                continue
            ex=parse_example(dict(zip(names,v)),pack,pool)
            if ex is None or len(ex.candidates)<2:
                coverage[label]['unusable_pack']+=1; continue
            key=(d,pk,pi)
            if key in seen:
                raise ValueError('duplicate served draft/pick')
            seen.add(key)
            if sum(ex.pool.values())!=pi-1:
                coverage[label]['invalid_prior_length']+=1; continue
            row,prior,counts=choice(ex,info[1],model,metadata,(),normalize_probabilities)
            coverage[label].update(counts)
            groups[label].append((row,prior if label.startswith('validation') else (),pi))
    return groups,coverage


def prepare_fit(sid,manifest,previous):
    stat.verify_source_lock()
    m,windows,files=load_manifest(manifest)
    if m['set']!=sid or read_json(files['interactions'])!={'schema':1,'edges':[]}:
        raise ValueError('manifest identity or feature registry mismatch')
    sources,inconsistent=scan_drafts(files['draft'],windows,parse_rate_bucket,parse_games_lower_bound)
    linked,crossed=scan_baseline_games(files['games'],sources,windows['baseline'][1])
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
        'audit_code_sha256':sha256(SOURCE)}
    return val,ordinary,fit,metadata,files['draft'],provenance


def simulate(rows,sid=None,environment='mixed',runs=stat.RUNS,draws=stat.BOOTSTRAP_DRAWS,per_draw=stat.BOOTSTRAP_RUNS):
    if sid not in SELECTABLE:
        return stat.simulate(rows,environment,runs,draws,per_draw,candidate_name=NAME)
    # Candidate-only environments remain standalone; never add to regular
    # Mixed. Use the exact product profile helper's optional single-set mode.
    stat.configure(NAME)
    banks=scoring.source_banks(rows)
    groups=[]
    for cohort,s,p,b in sorted(banks):
        if cohort=='elite':
            n=min(len(banks[cohort,s,p,b]),len(banks.get(('control',s,p,b),[])))
            if n>=5:
                groups.append({'set_id':s,'pick_number':p,'band':b,'n':n})
    opening=2 if rows and min(r['pick'] for r in rows)==2 else 1
    request={'groups':groups,'environment':'mixed','runs':runs,'daily':False,'day':stat.DAY,
             'seed':stat.SEED,'opening_pick':opening,'single_set':sid}
    try:
        call=subprocess.run(['node',str(ROOT/'scripts/scoring_run_profiles.mjs')],
            input=json.dumps(request),text=True,capture_output=True,check=True)
        report=scoring.simulated_report(rows,json.loads(call.stdout),draws,per_draw)
    except subprocess.CalledProcessError as exc:
        if 'Insufficient held-out coverage for this run profile' not in (exc.stderr or ''):
            raise
        return {'status':'unavailable','reason':'insufficient matched single-set profile cells','configurations':{},'opening_pick':opening}
    except ValueError as exc:
        if str(exc) not in ('Insufficient distinct-draft coverage for paired eight-pick runs','Too many bootstrap replicates lacked coverage'):
            raise
        return {'status':'unavailable','reason':str(exc),'configurations':{},'opening_pick':opening}
    return dict(report,status='complete',opening_pick=opening)


def new_cell():
    return [0,0,0,0,0,0,0,0,0,0,0,0]


def update(c,x,y):
    c[0]+=1;c[1]+=y-x;c[2]+=abs(y-x)
    c[3]+=x>=90;c[4]+=y>=90
    c[5]+=x>=90 and y<75
    c[6]+=x>=75 and y<50
    c[7]+=x>=40 and y<40
    c[8]+=y-x>=20;c[9]+=x-y>=20
    c[10]+=x;c[11]+=y


def render(c):
    n=c[0]
    return {'offers':n,'mean_v6':c[10]/n,'mean_skill_aware':c[11]/n,
        'mean_change':c[1]/n,'mean_absolute_change':c[2]/n,
        'v6_90_95':c[3],'skill_aware_90_95':c[4],
        '90_plus_to_below_75':c[5],'75_plus_to_below_50':c[6],
        'crossed_below_40':c[7],'increased_20_plus':c[8],'decreased_20_plus':c[9]}


def card_audit(records,metadata):
    groups=defaultdict(new_cell); cards=defaultdict(new_cell)
    per_card_context=defaultdict(new_cell)
    decreases={}; increases={}; protected={}
    rules={n:(spell_pips(c),fixing_colors(c)) for n,c in metadata.items()}
    leaders=0
    for row,pool,pick in records:
        p=weights(row,skill.ZERO);q=weights(row,skill.APPLY)
        a,b=grade(p),grade(q)
        i0=min(range(len(p)),key=lambda i:(-p[i],row.candidates[i]))
        i1=min(range(len(q)),key=lambda i:(-q[i],row.candidates[i]))
        leaders+=i0!=i1
        known=[rules.get(n,(None,frozenset())) for n in pool]
        access=set(c for req,fix in known for c in set(req or ())|set(fix))
        prior_known=bool(access) and all(req is not None or fix for req,fix in known)
        for i,n in enumerate(row.candidates):
            if i==row.chosen:
                continue
            x,y=a[i],b[i]; f=row.features[i]; req,fix=rules.get(n,(None,frozenset()))
            labels=['all_alternatives','early_picks' if pick<=4 else 'late_picks']
            if pick>=5 and sum(f[1:4])>=.15:
                labels.append('late_missing_access_proxy')
            if pick>=5 and f[0]>=.15 and sum(f[1:4])==0:
                labels.append('late_supported_proxy')
            if f[4]>0:
                labels.append('fixing_utility_proxy')
            if 2<=pick<=4 and prior_known and req and set(req)-access:
                labels.append('early_speculation_proxy')
            if x>=90:
                labels.append('v6_close_alternative')
            if req is None and not fix:
                labels.append('unresolved_or_complex_cost')
            update(cards[n],x,y)
            for label in labels:
                update(groups[label],x,y)
                update(per_card_context[n,label],x,y)
            delta=y-x
            # A bounded deterministic collection of actual public archive
            # contexts, no draft IDs, skill buckets, outcomes, or target pick.
            # One extreme per focal card/direction; ties use lexical context.
            if not delta:
                continue
            candidates=[(decreases,-delta)] if delta<0 else [(increases,delta)]
            if x>=90 and y<75:
                candidates.append((protected,-delta))
            for target,magnitude in candidates:
                old=target.get(n)
                if old is not None and magnitude<old[0]:
                    continue
                fingerprint=(pick,tuple(sorted(pool)),tuple(sorted(row.candidates)))
                if old is not None and magnitude==old[0] and fingerprint>=old[1]:
                    continue
                example={'card':n,'pick':pick,'prior_pool':list(sorted(pool)),
                    'offered_cards':sorted(row.candidates),'v6_score':x,'skill_aware_score':y,'change':delta,
                    'v6_leader':row.candidates[i0],'skill_aware_leader':row.candidates[i1],
                    'groups':labels,'log_adjustment':f[6]}
                target[n]=(magnitude,fingerprint,example)
    def examples(target):
        return [v[2] for _,v in sorted(target.items(),key=lambda kv:(-kv[1][0],kv[0],kv[1][1]))[:MAX_EXAMPLES]]
    qualified=[(n,render(v)) for n,v in cards.items() if v[0]>=MIN_CARD_OFFERS]
    return {'scope':'observed strong-player non-selected alternatives; proxy groups, not correctness labels',
        'decisions':len(records),'leader_changes':leaders,'groups':{k:render(v) for k,v in sorted(groups.items())},
        'minimum_offers_for_card_mean':MIN_CARD_OFFERS,
        'card_means':{n:s for n,s in sorted(qualified)},
        'card_context_means':[{'card':n,'context':g,**render(v)} for (n,g),v in sorted(per_card_context.items()) if v[0]>=MIN_CARD_OFFERS and g not in ('all_alternatives','early_picks','late_picks')],
        'largest_card_mean_increases':[{'card':n,**s} for n,s in sorted(qualified,key=lambda x:(-x[1]['mean_change'],x[0]))[:20]],
        'largest_card_mean_decreases':[{'card':n,**s} for n,s in sorted(qualified,key=lambda x:(x[1]['mean_change'],x[0]))[:20]],
        'examples':{'largest_increases':examples(increases),'largest_decreases':examples(decreases),
                    'previously_close_below_75':examples(protected)}}


def correlations(v):
    """Pair of correlations between the two scores and actual match wins."""
    centered=v-v.mean(axis=0)
    den=np.sqrt((centered*centered).sum(axis=0))
    if np.any(den<=1e-12):
        return None
    return np.clip((centered[:,:2]*centered[:,2,None]).sum(axis=0)/(den[:2]*den[2]),-.999999999,.999999999)


def outcome_study(sid,records,outcomes):
    # Match actual source drafts, not simulated outcomes. A fixed stage slice;
    # P1P2-only archives do not invent P1P1 or double count P1P2.
    first=2 if sid=='powered-cube' or (records and min(p for _,_,p in records)==2) else 1
    last=9 if sid=='powered-cube' else 8
    by=defaultdict(list)
    for r,_,pick in records:
        if first<=pick<=last:
            p=weights(r,skill.ZERO);q=weights(r,skill.APPLY)
            by[r.source].append((pick,grade(p)[r.chosen],grade(q)[r.chosen]))
    groups=defaultdict(list); linked=0
    for d,rs in by.items():
        if len(rs)<4 or d not in outcomes:
            continue
        if len({v[0] for v in rs})!=len(rs):
            raise ValueError('duplicate outcome draft pick')
        skill_bucket,wins=outcomes[d]
        if not skill_bucket:
            continue
        linked+=1
        groups[skill_bucket,len(rs)].append((sum(x[1] for x in rs)/len(rs),sum(x[2] for x in rs)/len(rs),wins))
    usable=[]; excluded=0
    for k,vs in sorted(groups.items()):
        a=np.asarray(vs,dtype=float)
        corr=correlations(a) if len(a)>=MIN_OUTCOME_STRATUM else None
        if corr is None:
            excluded+=len(a); continue
        usable.append((a,corr,len(a)-3))
    if not usable:
        return {'status':'unavailable','linked_drafts':linked,'eligible_drafts':0,'excluded_drafts':excluded,'strata':0}
    total=sum(w for _,_,w in usable)
    sums=sum((np.arctanh(c)*w for _,c,w in usable),start=np.zeros(2))
    rng=np.random.default_rng(int.from_bytes(hashlib.sha256((PROTOCOL+'|'+sid).encode()).digest()[:8],'big'))
    reps=[]
    for _ in range(OUTCOME_DRAWS):
        zz=np.zeros(2); valid=True
        for a,_,w in usable:
            corr=correlations(a[rng.integers(0,len(a),size=len(a))])
            if corr is None:
                valid=False; break
            zz+=np.arctanh(corr)*w
        reps.append(zz.tolist() if valid else None)
    result={'status':'complete' if sum(v is not None for v in reps)>=.9*OUTCOME_DRAWS else 'insufficient_bootstrap',
            'linked_drafts':linked,'eligible_drafts':sum(len(a) for a,_,_ in usable),'excluded_drafts':excluded,
            'strata':len(usable),'pick_slice':[first,last],'weight':total,'fisher_sums':sums.tolist(),
            'bootstrap_fisher_sums':reps}
    result['comparison']=combine_outcomes([result])
    return result


def combine_outcomes(results):
    valid=[r for r in results if r['status']=='complete']
    if not valid:
        return {'status':'unavailable','linked_drafts':sum(r['linked_drafts'] for r in results)}
    weight=sum(r['weight'] for r in valid)
    point=np.tanh(np.sum([r['fisher_sums'] for r in valid],axis=0)/weight)
    reps=[]
    for i in range(OUTCOME_DRAWS):
        values=[r['bootstrap_fisher_sums'][i] for r in valid]
        if all(v is not None for v in values):
            a=np.tanh(np.sum(values,axis=0)/weight)
            reps.append(float(a[1]-a[0]))
    return {'status':'complete' if len(reps)>=.9*OUTCOME_DRAWS else 'insufficient_bootstrap',
        'formats_with_valid_outcomes':len(valid),'formats_without_valid_outcomes':len(results)-len(valid),
        'drafts':sum(r['eligible_drafts'] for r in valid),'strata':sum(r['strata'] for r in valid),
        'v6_r':float(point[0]),'skill_aware_r':float(point[1]),'delta_r':float(point[1]-point[0]),
        'paired_ci95':[float(x) for x in np.quantile(reps,[.025,.975])] if len(reps)>=.9*OUTCOME_DRAWS else None,
        'valid_bootstrap_draws':len(reps),'interpretation':'within exact skill bucket and observed pick count; descriptive association, not causal'}


def measure(sid,work,output,previous_path):
    previous=prior_report(previous_path,sid) if previous_path else None
    val,ordinary,fit,metadata,draft_path,provenance=prepare_fit(sid,directory(sid)/'manifest.json',previous)
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
    report={'protocol':PROTOCOL,'set':sid,'status':'measured','scope':'historical development only',
        'provenance':provenance,'metadata':read_json(work/'metadata-provenance.json'),'fit':fit,
        'cohorts':cohorts,'guardrails':guards,'simulation':simulation,'bank_sha256':sha256(bf),
        'card_audit':audit,'outcomes':actual,'release_allowed':False}
    write(output/'report.json',report)
    print(json.dumps({'set':sid,'status':'measured','simulation':simulation,'guardrails':guards,
        'cohort_decisions':{c:r['decisions'] for c,r in cohorts.items()},'card_groups':audit['groups'],
        'outcomes':actual.get('comparison',{'status':actual['status']})},indent=2),flush=True)


def aggregate(folder,output):
    reports={}; banks={}; blocked={}
    for path in sorted(folder.glob('pool-aware-expansion-transfer-*/report.json')):
        r=read_json(path);sid=r['set']
        if sid not in SETS or sid in reports or sid in blocked or r['protocol']!=PROTOCOL or r['release_allowed']:
            raise ValueError('report identity mismatch')
        if r['status']=='blocked':
            blocked[sid]=r; continue
        p=r['provenance']
        if p['model_recipe_sha256']!=sha256(Path(skill.__file__)) or p['lock_sha256']!=sha256(stat.LOCK) or p['audit_code_sha256']!=sha256(SOURCE):
            raise ValueError('model/audit provenance mismatch')
        bf=path.parent/'simulation-bank.json.gz'
        if sha256(bf)!=r['bank_sha256']:
            raise ValueError('simulation bank checksum mismatch')
        data=read_json(bf)
        if data['set']!=sid:
            raise ValueError('bank set mismatch')
        banks[sid]=list(stat.simulation_rows(sid,data['rows'],NAME)); reports[sid]=r
    missing=sorted(set(SETS)-set(reports)-set(blocked))
    result={'protocol':PROTOCOL,'expected_sets':sorted(SETS),'measured_sets':sorted(reports),'blocked_sets':blocked,
        'missing_sets':missing,'sets':{},'runs':{},'outcome_comparisons':{},'release_allowed':False}
    for sid,r in reports.items():
        result['sets'][sid]={'status':SETS[sid]['status'],'simulation':r['simulation'],'guardrails':r['guardrails'],
            'cohort_decisions':{c:v['decisions'] for c,v in r['cohorts'].items()},
            'card_groups':r['card_audit']['groups'],'outcomes':r['outcomes'].get('comparison',{'status':r['outcomes']['status']}),
            'metadata':r['metadata'],'fit_status':r['provenance']['fit_status'],
            'examples':r['card_audit']['examples']}
    environments={'mixed':[s for s in reports if s!='powered-cube' and s not in SELECTABLE],
                  'powered-cube':[s for s in reports if s=='powered-cube']}
    for sid in sorted(SELECTABLE):
        environments['standalone:'+sid]=[sid] if sid in reports else []
    for env,ids in environments.items():
        if not ids:
            continue
        if env.startswith('standalone:'):
            sim=reports[ids[0]]['simulation']
            expected={ids[0]}
        else:
            sim=simulate([r for s in ids for r in banks[s]],environment=env,runs=10000,per_draw=2000)
            expected={s for s in SETS if (s=='powered-cube' if env=='powered-cube' else s!='powered-cube' and s not in SELECTABLE)}
        c=sim['configurations'].get(KEY)
        guards=all(all(reports[s]['guardrails'][k] for k in ('severe_tail_safe','raw_log_loss_safe','top1_safe')) for s in ids)
        result['runs'][env]=dict(sim,development_gate={
            'expected':sorted(expected),'measured':sorted(ids),'blocked':sorted(expected&set(blocked)),
            'missing':sorted(expected&set(missing)),'all_set_guardrails_safe':guards,
            'auc_delta_positive_interval':bool(c and c['delta_ci95'] and c['delta_ci95'][0]>0),
            'coverage_complete':set(ids)==expected and sim.get('status')=='complete',
            'standalone_unavailable':sorted(s for s in ids if reports[s]['simulation'].get('status')!='complete')})
        result['outcome_comparisons'][env]=combine_outcomes([reports[s]['outcomes'] for s in ids])
    result['outcome_comparisons']['all_measured']=combine_outcomes([r['outcomes'] for r in reports.values()])
    # Reproduce the old ten-format pooled result on their exact stored score
    # banks; avoid claiming a different sample is a matched replication.
    if ORIGINAL<=set(reports):
        result['original_ten_replication']={}
        for env in ('mixed','powered-cube'):
            ids=[s for s in sorted(ORIGINAL) if (s=='powered-cube')==(env=='powered-cube')]
            result['original_ten_replication'][env]=simulate([r for s in ids for r in banks[s]],environment=env,runs=10000,per_draw=2000)
    write(output,result)
    print(json.dumps({'measured_sets':result['measured_sets'],'blocked_sets':{s:r['reason'] for s,r in blocked.items()},
        'missing_sets':missing,'runs':result['runs'],'outcomes':result['outcome_comparisons'],
        'sets':{s:{'guardrails':r['guardrails'],'cohort_decisions':r['cohort_decisions'],'simulation':r['simulation']} for s,r in result['sets'].items()}},indent=2),flush=True)


def self_test():
    skill.self_test()
    c=new_cell();update(c,95,70);update(c,30,55)
    assert render(c)['90_plus_to_below_75']==1 and render(c)['mean_change']==0 and render(c)['decreased_20_plus']==1
    from pool_aware_refit import Choice
    r=Choice('synthetic','2026-01-01T00:00:00Z',('a','b','c'),(.6,.3,.1),
        ((0.,)*8,(0.,)*6+(.2,0.),(0.,)*6+(-.2,0.)),2)
    audit=card_audit([(r,(),1)],{})
    assert audit['groups']['all_alternatives']['offers']==2
    assert 'synthetic' not in json.dumps(audit)
    a=np.array([[1,1,1],[2,2,2],[3,4,3],[4,4,4]],dtype=float)
    assert correlations(a)[0]>correlations(a)[1]
    d={'status':'complete','linked_drafts':300,'eligible_drafts':300,'strata':1,'weight':297,
       'fisher_sums':[20.,30.],'bootstrap_fisher_sums':[[20.,30.]]*OUTCOME_DRAWS}
    assert combine_outcomes([d,d])['delta_r']>0
    assert combine_outcomes([{'status':'unavailable','linked_drafts':10}])['status']=='unavailable'
    synthetic=[[cohort,i,p,b,60 if cohort=='elite' else 40,70 if cohort=='elite' else 38]
         for cohort in ('elite','control') for i in range(12) for p in range(1,9) for b in ('easy','medium','hard')]
    sim=simulate(list(stat.simulation_rows('hbg',synthetic,NAME)),'hbg',runs=20,draws=2,per_draw=10)
    assert sim['status']=='complete' and sim['configurations'][KEY]['auc']==1
    print('Expansion contracts passed: frozen fit, card audit, outcome pooling, standalone profiles.',flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('restore','inputs','measure'))
    p.add_argument('--set',choices=sorted(SETS))
    p.add_argument('--work',type=Path)
    p.add_argument('--prior-report',type=Path)
    p.add_argument('--output',type=Path)
    p.add_argument('--aggregate',type=Path)
    a=p.parse_args()
    if a.self_test:
        self_test();return
    if a.aggregate:
        aggregate(a.aggregate,a.output);return
    if not a.stage or not a.set or not a.work or not a.output:
        p.error('stage, set, work and output required')
    if a.stage=='restore':
        recover(a.set);return
    if (a.output/'report.json').is_file() and read_json(a.output/'report.json')['status']=='blocked':
        print('Known blocked environment; no model fit attempted.');return
    try:
        if a.stage=='inputs':
            inputs(a.set,a.work,a.prior_report)
        else:
            measure(a.set,a.work,a.output,a.prior_report)
    except Blocked as exc:
        write(a.output/'report.json',{'protocol':PROTOCOL,'set':a.set,'status':'blocked',
            'reason':str(exc),'source_status':SETS[a.set]['status'],'release_allowed':False})
        print('BLOCKED '+a.set+': '+str(exc),flush=True)


if __name__=='__main__':
    main()
