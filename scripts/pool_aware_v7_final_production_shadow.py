#!/usr/bin/env python3
"""Read-only counterfactual on actual active v6 puzzle rows (never scores players)."""
import argparse
from collections import Counter,defaultdict
import json
import math
from pathlib import Path

import psycopg
import pool_aware_skill_context_validation as ctx
import pool_aware_skill_expansion as exp
import pool_aware_skill_recovery as rec
import pool_aware_skill_final_correction as correction
import pool_aware_mana_final as parser
from pool_aware_archive import read_json,sha256
import pool_aware_mana_parser_v2 as v2
import pool_aware_skill_parser_correction as prior_parser
import pool_aware_v7_refit as refit
from pool_aware_skill_reviewed_validation import registry_digest

PARENT='elite-trophy-colour-stage-v10'
MODEL='strong-player-colour-stage-v6'

def jsround(x):return math.floor(x+.5)

def summary(values,target):
    ranked=sorted(values,reverse=True)
    if len(ranked)<2 or ranked[0]<=0 or any(not math.isfinite(v) or v<0 for v in values):
        raise ValueError('invalid support')
    top=ranked[0];ratio=ranked[1]/top;tr=values[target]/top
    rating=jsround(100*ratio)
    return {'rating':rating,'band':'easy' if rating<50 else 'medium' if rating<80 else 'hard',
        'ratio':ratio,'target_ratio':tr,'floor':jsround(95*tr)>=20,
        'interesting':len(values)>=4 and top<=.75 and ratio>=.2,
        'grades':[100 if i==target else jsround(95*v/top) for i,v in enumerate(values)],
        'leader':max(range(len(values)),key=lambda i:values[i])}

def corrected(names,pool,support,metadata,context,cards,arm):
    # Production serializes probabilities to six decimals. A stored zero
    # remains zero; the tiny positive floor is used ONLY for feature ratios.
    feature_engine,engine=(v2,prior_parser) if arm=='parser-v2' else (parser,correction)
    f,_=feature_engine.extract(pool,names,tuple(max(v,1e-300) for v in support),metadata)
    d,status=engine.corrections(names,f,metadata,context,cards)
    w=[v*math.exp(x) for v,x in zip(support,d)]
    total=sum(w)
    return [round(x/total,6) for x in w],status

def frozen_fits(root,registry,arm):
    ctx.EXPECTED=set(exp.SETS)
    result={}
    for s in sorted(exp.SETS):
        origin='recovery' if s in rec.RECOVER else 'expansion'
        folder=root/origin/f'pool-aware-{origin}-report-{s}'
        r=ctx.load_frozen(folder,s)
        f=folder/'input/rules.json.gz'
        if sha256(f)!=r['provenance']['sources']['metadata']:
            raise ValueError('fit rules digest mismatch '+s)
        rr=refit.check_fit(registry[s],s,r)
        metadata=read_json(f)
        engine=prior_parser if arm=='parser-v2' else correction
        feature_engine=v2 if arm=='parser-v2' else parser
        fit=rr['fit'] if arm=='refit' else r['fit']
        context,cards=engine.parameters(fit)
        result[s]=(feature_engine.index(metadata),context,cards,
                   refit.sha256(f),v2.index(metadata))
    return result


def revision(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT revision::text FROM draft_run_serving_revision WHERE singleton")
        return cur.fetchone()[0]

def begin(conn):
    conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    assert conn.execute('SHOW transaction_read_only').fetchone()[0]=='on'

def audit(conn,policy,fits,registry,arm):
    if policy['parent']!=PARENT or policy['model']!=MODEL:
        raise ValueError('production version changed; do not infer v6 baseline')
    membership=policy['membership'].replace('$1',"'"+PARENT+"'")
    if '$' in membership or ';' in membership:
        raise ValueError('unexpected membership template')
    # Exact current production membership including live components, removal
    # and source exclusions; do not prefilter interesting or trophy floor.
    where=f"""({membership}) AND p.pack_number=1
      AND NOT EXISTS(SELECT 1 FROM draft_run_pick_removal_members m JOIN draft_run_pick_removals q USING(decision_key)
          WHERE m.puzzle_id=p.puzzle_id AND q.removed)
      AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id
          AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash)"""
    begin(conn)
    first=revision(conn)
    env=conn.execute("""SELECT e.set_id,e.status,s.corpus_version FROM draft_run_environment_policy e
      LEFT JOIN corpus_source_snapshots s ON s.source_snapshot_id=e.active_snapshot_id ORDER BY e.set_id""").fetchall()
    live=[s for s,status,_ in env if status=='Live']
    conn.commit()
    result={'protocol':correction.PROTOCOL,'scope':'production active membership; stored puzzle counterfactual only',
        'production_policy_commit':policy['commit'],'parent':PARENT,'revision_start':first,
        'environment_status':{s:{'status':status,'active_corpus_version':version} for s,status,version in env},
        'sets':{},'fit_digests':{s:f[3] for s,f in fits.items()},'release_allowed':False,
        'parser_sha256':sha256(Path(parser.__file__)),'correction_sha256':sha256(Path(correction.__file__)),
        'arm':arm,'fit_registry_sha256':registry_digest(registry),
        'starting_configuration':{'context':list(refit.mean_context(registry,previous=arm!='refit')),'card_effects':{}},
        'new_sets_without_rules':[],
        'no_fit_rule':'v7 uses cross-format mean and zero card terms. Missing pinned rules block this audit; never substitute v6.'}
    query=f"""SELECT p.corpus_version,coalesce(p.payload->>'source_event_type','PremierDraft'),
      p.payload->>'model_version',p.pick_number,p.interesting,p.payload->>'historical_pick_id',
      r.rating,r.band,r.top_two_ratio,r.target_support_ratio,
      (SELECT jsonb_agg(jsonb_build_array(c->>'id',c->>'name',c->'model_probability') ORDER BY ord)
        FROM jsonb_array_elements(p.payload->'candidates') WITH ORDINALITY AS t(c,ord)),
      (SELECT coalesce(jsonb_agg(c->>'name' ORDER BY ord),'[]'::jsonb)
        FROM jsonb_array_elements(p.payload->'prior_picks') WITH ORDINALITY AS t(c,ord)),
      f.trophy_strength_margin,f.trophy_off_colour
      FROM draft_run_verified_puzzles p
      LEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
      LEFT JOIN draft_run_puzzle_selection_features f ON f.puzzle_id=p.puzzle_id AND f.feature_version='stakes-v1'
      WHERE p.set_id=%s AND {where}"""
    for sid in live:
        if sid not in fits:
            result['new_sets_without_rules'].append(sid)
            continue
        begin(conn); rev=revision(conn)
        cells=defaultdict(Counter); bands=defaultdict(Counter); availability=defaultdict(Counter)
        hard_supply=defaultdict(Counter); cost_stats=defaultdict(lambda:defaultdict(Counter))
        extreme={}; maximum=policy['max_pick']['powered-cube' if sid=='powered-cube' else 'mixed']
        with conn.cursor(name='audit_puzzles') as cur:
            cur.itersize=500
            cur.execute(query,(sid,))
            for version,mode,model,pick,interesting,target,rating,band,ratio,tr,pack,pool,margin,off in cur:
                c=cells[mode];c['stored_rows']+=1
                if not pack or len({v[0] for v in pack})!=len(pack) or target not in [v[0] for v in pack]:
                    c['invalid_payload']+=1;continue
                ids,names,support=zip(*pack);support=list(map(float,support)); ti=ids.index(target)
                try:old=summary(support,ti)
                except ValueError:c['invalid_payload']+=1;continue
                if rating is None or tr is None or ratio is None:
                    c['missing_rating']+=1;continue
                if old['rating']!=rating or old['band']!=band or abs(old['ratio']-float(ratio))>1e-9 or abs(old['target_ratio']-float(tr))>1e-9:
                    c['stored_rating_mismatch']+=1
                if bool(interesting)!=old['interesting']:c['stored_interesting_mismatch']+=1
                stored_floor=jsround(95*float(tr))>=20
                eligible=bool(interesting) and stored_floor
                in_window=(2 if sid=='powered-cube' else 1)<=pick<=maximum
                c['v6_eligible_all_picks']+=eligible
                if in_window:c['v6_eligible_run_window']+=eligible
                fit=fits.get(sid)
                fallback=model!=MODEL
                if fallback:
                    c['unexpected_non_v6_model']+=1
                    new=old;new_eligible=eligible;statuses=['fallback']*len(pack)
                elif len(set(names))!=len(names) or len(pool)!=pick-1:
                    c['unscorable_with_fit']+=1;new=old;new_eligible=eligible;statuses=['fallback']*len(pack)
                else:
                    metadata,context,cards,_,old_rules=fit
                    try:
                        values,statuses=corrected(names,pool,support,metadata,context,cards,arm)
                        new=summary(values,ti)
                    except ValueError:
                        c['unscorable_with_fit']+=1;new=old;new_eligible=eligible;statuses=['fallback']*len(pack)
                    else:
                        c['rescored']+=1
                        # Preserve any extra persisted non-score gate when
                        # interesting does not equal the current pure formula.
                        new_interesting=new['interesting'] if bool(interesting)==old['interesting'] else bool(interesting)
                        new_eligible=new_interesting and new['floor']
                c['v7_eligible_all_picks']+=new_eligible
                c['floor_enter']+=not stored_floor and new['floor'];c['floor_leave']+=stored_floor and not new['floor']
                if eligible and band=='hard':hard_supply[mode][f'v6:{pick}']+=1
                if new_eligible and new['band']=='hard':hard_supply[mode][f'v7:{pick}']+=1
                if in_window:
                    c['v7_eligible_run_window']+=new_eligible
                    c['enters_service']+=not eligible and new_eligible
                    c['leaves_service']+=eligible and not new_eligible
                    if eligible:availability[mode][f'v6:{pick}:{band}']+=1
                    if new_eligible:availability[mode][f'v7:{pick}:{new["band"]}']+=1
                    if eligible and new_eligible:bands[mode][band+'->'+new['band']]+=1
                    if margin is None or off is None:c['missing_clear_easy_features']+=1
                    else:
                        context_ok=float(margin)>=0 and (pick<3 or off is False)
                        c['v6_clear_easy']+=eligible and band=='easy' and float(tr)>=1 and context_ok
                        c['v7_clear_easy']+=new_eligible and new['band']=='easy' and new['target_ratio']>=1 and context_ok
                c['band_changes_all_rows']+=band!=new['band']
                c['leader_changes']+=old['leader']!=new['leader']
                assert old['grades'][ti]==new['grades'][ti]==100
                for i,(x,y) in enumerate(zip(old['grades'],new['grades'])):
                    if i==ti:continue
                    d=y-x;c['alternatives']+=1;c['abs_change_sum']+=abs(d);c['signed_change_sum']+=d
                    c['changed_20_plus']+=abs(d)>=20;c['decreased_20_plus']+=d<=-20
                    c['maximum_absolute_change']=max(c['maximum_absolute_change'],abs(d))
                    c['movement_above_20']+=abs(d)>20
                    c['close_drops']+=x>=90 and y<75
                    c['cost_'+statuses[i]]+=1
                    if not fallback and statuses[i]!='fallback':
                        cp=fit[0].get(names[i]);old_profile=fit[4].get(names[i])
                        c['cost_transition_'+cp.previous_status+'_to_'+cp.status]+=1
                        cls=('recovered_cost' if old_profile.previous_status=='unreadable' and old_profile.status=='readable' else
                             'newly_readable' if old_profile.status=='unreadable' and cp.status=='readable' else cp.status)
                        for group in ('overall',cls):
                            g=cost_stats[mode][group];g['offers']+=1;g['sum_delta']+=d
                            g['90_to_below_75']+=x>=90 and y<75;g['drop_20_plus']+=d<=-20
                            g['maximum_absolute_change']=max(g['maximum_absolute_change'],abs(d))
                    if d<=-15:
                        key=(mode,names[i])
                        if key not in extreme or d<extreme[key]['delta']:
                            extreme[key]={'mode':mode,'card':names[i],'pick':pick,'pool':pool,
                                'pack':list(names),'old':x,'new':y,'delta':d,'cost_status':statuses[i]}
        conn.commit()
        result['sets'][sid]={'revision':rev,'modes':{k:dict(v) for k,v in cells.items()},
            'retained_eligible_band_transitions':{k:dict(v) for k,v in bands.items()},
            'pick_band_supply':{k:dict(v) for k,v in availability.items()},
            'hard_band_supply_all_picks':{mode:{str(p):{'v6':v[f'v6:{p}'],'v7':v[f'v7:{p}'],
                'change_pct':100*(v[f'v7:{p}']/v[f'v6:{p}']-1) if v[f'v6:{p}'] else None,
                'in_run_window':(2 if sid=='powered-cube' else 1)<=p<=maximum}
                for p in range(1,12)} for mode,v in hard_supply.items()},
            'cost_classes':{mode:{g:dict(c,mean_delta=c['sum_delta']/c['offers']) for g,c in groups.items()}
                           for mode,groups in cost_stats.items()},
            'largest_reductions':sorted(extreme.values(),key=lambda r:(r['delta'],r['card']))[:20]}
        print(json.dumps({'set':sid,'revision':rev,'modes':result['sets'][sid]['modes']},separators=(',',':')),flush=True)
    begin(conn);result['revision_end']=revision(conn);conn.commit()
    result['consistent_serving_revision']=all(v['revision']==first for v in result['sets'].values()) and result['revision_end']==first
    result['totals_by_mode']={}
    for s,v in result['sets'].items():
        for mode,c in v['modes'].items():
            t=result['totals_by_mode'].setdefault(mode,Counter());previous_max=t['maximum_absolute_change'];t.update(c)
            t['maximum_absolute_change']=max(previous_max,c.get('maximum_absolute_change',0))
    result['parity_complete']=result['consistent_serving_revision'] and not result['new_sets_without_rules'] and not any(
        c.get(k,0) for c in result['totals_by_mode'].values()
        for k in ('invalid_payload','missing_rating','stored_rating_mismatch','stored_interesting_mismatch','unscorable_with_fit','unexpected_non_v6_model'))
    return result

def self_test():
    correction.self_test()
    s=summary([.5,.4,.1],0);assert s['rating']==80 and s['band']=='hard' and s['grades']==[100,76,19]
    assert summary([.5,.4,.1],2)['floor'] is False
    assert summary([.5,.39,.11],2)['floor'] is True
    assert 'trk' not in exp.SETS # starting mean is defined, not an invented local fit
    print('Production shadow contracts passed: exact integer score/floor/band; new sets require v7 starting configuration.')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--connection-file',type=Path);p.add_argument('--policy',type=Path)
    p.add_argument('--fits',type=Path);p.add_argument('--output',type=Path)
    p.add_argument('--registry',type=Path);p.add_argument('--arm',choices=('refit','no-refit','parser-v2'))
    a=p.parse_args()
    if a.self_test:self_test();return
    registry=refit.load_fits(a.registry)
    fits=frozen_fits(a.fits,registry,a.arm)
    # The connection is never logged. All transactions are explicitly read-only;
    # no temp tables, functions that refresh cache, or player/account queries.
    with psycopg.connect(a.connection_file.read_text().strip(),
        options='-c default_transaction_read_only=on -c statement_timeout=120000 -c application_name=packone-v7-shadow-audit',
        autocommit=False) as conn:
        result=audit(conn,read_json(a.policy),fits,registry,a.arm)
    exp.write(a.output,result)
    print(json.dumps({'production_shadow_totals':result['totals_by_mode'],
        'arm':a.arm,'consistent_serving_revision':result['consistent_serving_revision'],'parity_complete':result['parity_complete'],
        'new_sets_without_rules':result['new_sets_without_rules'],
        'hard_band_supply':{s:r['hard_band_supply_all_picks'] for s,r in result['sets'].items()}},indent=2),flush=True)

if __name__=='__main__':main()
