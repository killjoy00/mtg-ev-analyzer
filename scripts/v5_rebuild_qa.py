#!/usr/bin/env python3
"""Post-build implementation QA; never a pre-build model-selection experiment."""
from collections import Counter
import argparse
import gzip
import json
import math
from pathlib import Path
import statistics
from build_verified_trophy_corpus import puzzle_metrics, js_round_nonnegative
from model_training import V5_MODEL, V5_CORPUS, validate_training_manifest
from v5_rebuild import ROOT, read, write


def records(path):
    with gzip.open(path,'rt') as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def key(puzzle):
    return puzzle['source_draft_hash'],puzzle['pick_number']


def compare(previous,candidate):
    probability,score,rating,changes = [],[],[],[]
    old_bands,new_bands = Counter(),Counter()
    matched,leaders,bands = 0,0,0
    old = {key(p):p for p in previous}
    for p in candidate:
        values = [c['model_probability'] for c in p['candidates']]
        if p.get('model_version')!=V5_MODEL or any(not math.isfinite(v) or v<0 for v in values) or abs(sum(values)-1)>.00005 or not max(values)>0:
            raise ValueError('Invalid or mixed v5 support')
        new_metric = puzzle_metrics(p)
        new_bands[new_metric['band']]+=1
        before = old.get(key(p))
        if not before:
            continue
        a,b = [{c['id']:c['model_probability'] for c in x['candidates']} for x in (before,p)]
        if set(a)!=set(b):
            raise ValueError('Unchanged source decision changed candidate identities')
        old_metric = puzzle_metrics(before)
        old_bands[old_metric['band']]+=1
        distance = sum(abs(a[c]-b[c]) for c in a)/2
        scores = [abs(js_round_nonnegative(95*a[c]/max(a.values()))-js_round_nonnegative(95*b[c]/max(b.values()))) for c in a]
        probability.append(distance);score.extend(scores)
        rating.append(abs(new_metric['rating']-old_metric['rating']))
        leader_changed = max(sorted(a),key=a.get)!=max(sorted(b),key=b.get)
        leaders+=leader_changed;bands+=new_metric['band']!=old_metric['band'];matched+=1
        changes.append({'source_draft_hash':p['source_draft_hash'],'pick_number':p['pick_number'],
            'probability_total_variation':distance,'max_score_displacement':max(scores),
            'old_rating':old_metric['rating'],'new_rating':new_metric['rating'],'leader_changed':leader_changed})
    def describe(values):
        ordered=sorted(values)
        return {'mean':statistics.fmean(values),'p95':ordered[min(len(ordered)-1,int(.95*len(ordered)))],'maximum':max(values)} if values else None
    return {'matched_decisions':matched,'candidate_decisions':sum(new_bands.values()),
        'leader_change_fraction':leaders/max(1,matched),'difficulty_band_change_fraction':bands/max(1,matched),
        'probability_total_variation':describe(probability),'card_score_displacement':describe(score),
        'rating_displacement':describe(rating),'old_difficulty_distribution':dict(old_bands),
        'new_difficulty_distribution':dict(new_bands),
        'largest_changes':sorted(changes,key=lambda x:x['probability_total_variation'],reverse=True)[:20]}


def main(baseline):
    pins = {p['id']:p for p in read(ROOT/'research/v5-production-source-pins.json')['sets']}
    builds = read(ROOT/'generated/v5-trophy-import/catalog.json')
    sets = []
    for candidate in builds['sets']:
        validate_training_manifest(candidate)
        sid=candidate['id'];before=pins[sid]
        old=list(records(baseline/sid/'puzzles.jsonl.gz'))
        new=list(records(ROOT/'generated/v5-trophy-import'/sid/'puzzles.jsonl.gz'))
        qa=compare(old,new)
        refreshed=before['source_archive']['sha256']!=candidate['source_archive']['sha256'] or before['skill_source']['sha256']!=candidate['skill_source']['sha256']
        cohort_drift=candidate['qualified_drafts']!=before['qualified_drafts']
        if cohort_drift and not refreshed:
            raise ValueError(f'{sid}: unchanged input qualification drifted')
        sets.append({'id':sid,'v4_training':before['training_drafts'],'v5_training':candidate['training_drafts'],
            'qualified_drafts':candidate['qualified_drafts'],'qualified_training_drafts':candidate['qualified_training_drafts'],
            'source_refreshed':refreshed,'cohort_changed':cohort_drift,**qa})
    report={'schema':'v5-rebuild-qa-v1','model_version':V5_MODEL,'corpus_version':V5_CORPUS,
        'environments':len(sets),'v4_total_training':sum(p['v4_training'] for p in sets),
        'v5_total_training':sum(p['v5_training'] for p in sets),'sets':sets,
        'large_change_sets':[p['id'] for p in sets if p['probability_total_variation'] and
            (p['probability_total_variation']['p95']>.20 or p['leader_change_fraction']>.25)],
        'mixed_identities':False,'invalid_numerical_outputs':0}
    write(ROOT/'generated/v5-rebuild-qa.json',report)
    lines=['# v5 rebuild QA','',f"{len(sets)} environments; behavior training {report['v4_total_training']:,} → {report['v5_total_training']:,}.",
        '', 'All v5 environments use their complete unchanged qualified training cohort. HOB uses its separately authorized refreshed source.',
        '', '| Environment | v4 trained | v5 trained | Qualified | Matched decisions | Leader changed | Mean probability TV |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for p in sets:
        tv=p['probability_total_variation']['mean'] if p['probability_total_variation'] else 0
        lines.append(f"| {p['id']} | {p['v4_training']:,} | {p['v5_training']:,} | {p['qualified_training_drafts']:,} | {p['matched_decisions']:,} | {p['leader_change_fraction']:.1%} | {tv:.4f} |")
    lines+=['', 'Largest changes and distribution shifts are recorded in the JSON report.',
        'Sets flagged for investigation: '+(', '.join(report['large_change_sets']) or 'none')+'.',
        'Score displacement uses the unchanged 95 × support / leader calculation; ratings use the unchanged support-ratio-v1 calculation.']
    (ROOT/'generated/V5-REBUILD-QA.md').write_text('\n'.join(lines)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',required=True,type=Path)
    main(parser.parse_args().baseline)
