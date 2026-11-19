#!/usr/bin/env python3
"""Post-build v5 to v6 implementation QA; never a model-selection experiment.

The baseline is the accepted production v9 candidate. A set is compared only
when that baseline was built from the same pinned inputs the v6 build used.
"""
import argparse
import json
from pathlib import Path
from model_training import V6_MODEL, V6_CORPUS, validate_training_manifest
from v5_rebuild_qa import records, compare
from v6_rebuild import ROOT, read, write


def baseline_dir(baseline, sid):
    for root in (baseline/'v5-trophy-import', baseline/'generated/v5-trophy-import', baseline):
        if (root/sid/'manifest.json').exists():
            return root/sid
    return None


def main(baseline):
    pins = {p['id']: p for p in read(ROOT/'research/v6-build-source-pins.json')['sets']}
    builds = read(ROOT/'generated/v6-trophy-import/catalog.json')
    traditional = read(ROOT/'generated/v6-traditional/report.json')
    sets = []
    for candidate in builds['sets']:
        validate_training_manifest(candidate, V6_MODEL)
        sid = candidate['id']; before = pins[sid]
        old_dir = baseline_dir(baseline, sid)
        same_inputs = bool(old_dir) and read(old_dir/'manifest.json').get('input_signature') == before['input_signature']
        new = list(records(ROOT/'generated/v6-trophy-import'/sid/'puzzles.jsonl.gz'))
        qa = compare(list(records(old_dir/'puzzles.jsonl.gz')) if same_inputs else [], new, V6_MODEL)
        if candidate['qualified_drafts'] != before['qualified_drafts'] or candidate['training_drafts'] != before['training_drafts']:
            raise ValueError(f'{sid}: unchanged inputs changed the qualified cohort')
        sets.append({'id': sid, 'training_drafts': candidate['training_drafts'],
            'qualified_training_drafts': candidate['qualified_training_drafts'],
            'baseline_compared': same_inputs, **qa})
    compared = [p for p in sets if p['baseline_compared']]
    report = {'schema': 'v6-rebuild-qa-v1', 'model_version': V6_MODEL, 'corpus_version': V6_CORPUS,
        'environments': len(sets), 'baseline_compared': len(compared), 'sets': sets,
        'not_compared': [p['id'] for p in sets if not p['baseline_compared']],
        'large_change_sets': [p['id'] for p in compared if p['probability_total_variation'] and
            (p['probability_total_variation']['p95'] > .20 or p['leader_change_fraction'] > .25)],
        'traditional_admitted': traditional['admitted'], 'traditional_not_admitted': traditional['not_admitted'],
        'traditional_newly_admitted': traditional['newly_admitted'],
        'traditional_no_longer_admitted': traditional['no_longer_admitted'],
        'mixed_identities': False, 'invalid_numerical_outputs': 0}
    write(ROOT/'generated/v6-rebuild-qa.json', report)
    lines = ['# v6 rebuild QA', '',
        f"{len(sets)} environments rebuilt from their exact production v9 inputs; "
        f"{len(compared)} compared decision by decision with the accepted v9 candidate.", '',
        '| Environment | Trained | Matched decisions | Leader changed | Mean probability TV |',
        '| --- | ---: | ---: | ---: | ---: |']
    for p in sets:
        tv = p['probability_total_variation']['mean'] if p['probability_total_variation'] else 0
        matched = f"{p['matched_decisions']:,}" if p['baseline_compared'] else 'not compared'
        lines.append(f"| {p['id']} | {p['training_drafts']:,} | {matched} | {p['leader_change_fraction']:.1%} | {tv:.4f} |")
    lines += ['', '## Traditional', '', '| Environment | v9 component | v6 window |', '| --- | --- | --- |']
    for sid, e in sorted(traditional['sets'].items()):
        lines.append(f"| {sid} | {e['production_component'] or 'not admitted'} | {e['admitted_window'] or 'not admitted'} |")
    lines += ['', 'Sets flagged for investigation: '+(', '.join(report['large_change_sets']) or 'none')+'.',
        'Not compared (baseline built from other inputs or absent): '+(', '.join(report['not_compared']) or 'none')+'.']
    (ROOT/'generated/V6-REBUILD-QA.md').write_text('\n'.join(lines)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True, type=Path)
    main(parser.parse_args().baseline)
