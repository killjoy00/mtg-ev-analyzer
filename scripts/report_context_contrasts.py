#!/usr/bin/env python3
"""Validate aggregate comparisons and render tables from the frozen decision rule."""
import argparse
import hashlib
import json
from pathlib import Path

from compare_context_challengers import CHALLENGERS, CONTRAST_ARMS, contrast_verdict

DEVELOPMENT = ('fra', 'hob', 'msh', 'sos', 'ecl', 'tmt')
CONFIRMATION = ('tla', 'eoe', 'fin', 'tdm', 'dft')
PREREGISTRATION = 'bf5f8f6313077a3886ab3f4597b57c87aeeb1af6'
FROZEN_PREFIX_SHA256 = '3653937725a1ee60e291621966bca831c0bddc565cf8f1ef124507edcc9e0798'


def assemble(results, original):
    if set(results) != set(DEVELOPMENT + CONFIRMATION):
        raise ValueError('Every preregistered set is required; no substitutions')
    for sid, result in results.items():
        if result['set'] != sid or result['split'] != 'validation':
            raise ValueError('Only matching validation results may enter the report')
        if result['challengers']['explicit-matched']['cards_with_colour_judgment'] != result['challengers']['v5']['cards_with_colour_judgment']:
            raise ValueError('Matched coverage differs from v5')
        for source in ('draft_sha256', 'games_sha256', 'metadata_sha256'):
            value = result['sources'][source]
            if len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
                raise ValueError('Missing source checksum')
    reproduced = {}
    for sid in DEVELOPMENT:
        current, before = results[sid], original['sets'][sid]
        if any(current['challengers'][arm] != before['challengers'][arm] for arm in CHALLENGERS):
            raise ValueError(f'{sid}: original arm outputs changed')
        for field in ('train_drafts', 'training_picks', 'held_out_drafts', 'train_games', 'backbone'):
            if current[field] != before[field]:
                raise ValueError(f'{sid}: original cohort or model changed')
        for source in ('draft_sha256', 'games_sha256', 'metadata_sha256'):
            if current['sources'][source] != before['sources'][source]:
                raise ValueError(f'{sid}: original source changed')
        if current['sources']['cache']['train_ids_sha256'] != before['sources']['cache']['train_ids_sha256']:
            raise ValueError(f'{sid}: training identities changed')
        reproduced[sid] = {'four_arm_outputs_exact': True, 'source_checksums_exact': True,
                           'training_identity_exact': True,
                           'cache_bytes_exact': current['sources']['cache'] == before['sources']['cache']}
    keys = [f'{b}-minus-{a}' for i, a in enumerate(CONTRAST_ARMS) for b in CONTRAST_ARMS[i+1:]]
    if any(set(r['contrasts']) != set(keys) for r in results.values()):
        raise ValueError('All six pairwise comparisons are required')
    for result in results.values():
        for key, row in result['contrasts'].items():
            if key != f"{row['candidate']}-minus-{row['baseline']}":
                raise ValueError('Contrast key and direction disagree')
    verdicts = {}
    for key in keys:
        rows = [results[sid]['contrasts'][key] for sid in CONFIRMATION]
        if len({(r['baseline'], r['candidate']) for r in rows}) != 1:
            raise ValueError('Inconsistent contrast direction')
        verdicts[key] = {'baseline': rows[0]['baseline'], 'candidate': rows[0]['candidate'],
                         'verdict': contrast_verdict(rows),
                         'candidate_log_loss_wins': sum(r['log_loss_ci95'][1] < 0 for r in rows),
                         'baseline_log_loss_wins': sum(r['log_loss_ci95'][0] > 0 for r in rows),
                         'candidate_top1_losses': sum(r['top1_ci95'][1] < 0 for r in rows),
                         'baseline_top1_losses': sum(r['top1_ci95'][0] > 0 for r in rows)}
    return {'preregistration_commit': PREREGISTRATION, 'split': 'validation',
            'role': {sid: 'development' if sid in DEVELOPMENT else 'confirmation' for sid in results},
            'interpretation': 'Pick prediction only; cannot establish decision quality or authorize a release.',
            'multiplicity': 'Six contrasts; pointwise 95% intervals, no family-wise adjustment.',
            'reproduction': reproduced, 'verdicts': verdicts, 'sets': results}


def render(report):
    lines = [f'Scored after preregistration `{PREREGISTRATION[:7]}`. All original four-arm outputs reproduced exactly on all six development sets. Archive/metadata checksums and training identities match. Regenerated cache byte hashes can differ because gzip timestamps and cache filenames are part of the encoding; the committed report records each new cache identity.',
             '', 'Full aggregates and source checksums: [context-challenger-contrasts-2026-10-29.json](data/context-challenger-contrasts-2026-10-29.json). The original preregistration and results are unchanged. Run `python scripts/report_context_contrasts.py --check` to verify every table and verdict without raw archives.', '',
             '### Fresh confirmation summaries', '',
             '| Set | Decisions | v5 log loss | splash | explicit | explicit-fixing | explicit-matched |',
             '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for sid in CONFIRMATION:
        arms = report['sets'][sid]['challengers']
        values = ' | '.join(f"{arms[a]['served_slice']['log_loss']:.5f}" for a in (*CHALLENGERS, 'explicit-matched'))
        lines.append(f"| {sid.upper()} | {arms['v5']['served_slice']['decisions']:,} | {values} |")
    lines += ['', 'Color-judgment coverage (known cards / fitted cards):', '',
              '| Set | v5 | splash | explicit | explicit-fixing | explicit-matched |',
              '| --- | ---: | ---: | ---: | ---: | ---: |']
    for sid in CONFIRMATION:
        arms = report['sets'][sid]['challengers']
        values = ' | '.join(f"{arms[a]['cards_with_colour_judgment']}/{arms[a]['fit_cards']}" for a in (*CHALLENGERS, 'explicit-matched'))
        lines.append(f'| {sid.upper()} | {values} |')
    lines += ['', '### v5 reference comparisons', '',
              'These reference comparisons do not determine the six challenger verdicts. Negative log loss favors the arm; positive top-1 favors the arm.', '',
              '| Set | Arm minus v5 | Log-loss delta [95% CI] | Top-1 delta [95% CI], pp |',
              '| --- | --- | ---: | ---: |']
    for sid in CONFIRMATION:
        for arm in CONTRAST_ARMS:
            row = report['sets'][sid]['challengers'][arm]['vs_v5']
            loss = f"{row['log_loss_delta']:+.5f} [{row['log_loss_ci95'][0]:+.5f}, {row['log_loss_ci95'][1]:+.5f}]"
            hit = f"{100*row['top1_delta']:+.3f} [{100*row['top1_ci95'][0]:+.3f}, {100*row['top1_ci95'][1]:+.3f}]"
            lines.append(f'| {sid.upper()} | {arm} | {loss} | {hit} |')
    lines += ['', '### Frozen-rule verdicts', '', '| Comparison | Result |', '| --- | --- |']
    for verdict in report['verdicts'].values():
        baseline, candidate = verdict['baseline'], verdict['candidate']
        outcome = verdict['verdict']
        if outcome == 'candidate beats baseline': outcome = f'{candidate} beats {baseline}'
        if outcome == 'baseline beats candidate': outcome = f'{baseline} beats {candidate}'
        lines.append(f'| {candidate} vs {baseline} | {outcome} |')
    for key, verdict in report['verdicts'].items():
        lines += ['', f"### {verdict['candidate']} minus {verdict['baseline']}", '',
                  f"**Verdict: {verdict['verdict']}.** Candidate log-loss wins: {verdict['candidate_log_loss_wins']}/5; baseline wins: {verdict['baseline_log_loss_wins']}/5. Significantly worse top-1 sets: candidate {verdict['candidate_top1_losses']}, baseline {verdict['baseline_top1_losses']}.", '',
                  'Negative log loss favors the candidate; positive top-1 favors the candidate. Top-1 is in percentage points. Development rows do not enter the verdict.', '',
                  '| Set | Role | Log-loss delta [95% CI] | Top-1 delta [95% CI], pp |',
                  '| --- | --- | ---: | ---: |']
        for sid in (*CONFIRMATION, *DEVELOPMENT):
            row = report['sets'][sid]['contrasts'][key]
            loss = f"{row['log_loss_delta']:+.5f} [{row['log_loss_ci95'][0]:+.5f}, {row['log_loss_ci95'][1]:+.5f}]"
            hit = f"{100*row['top1_delta']:+.3f} [{100*row['top1_ci95'][0]:+.3f}, {100*row['top1_ci95'][1]:+.3f}]"
            lines.append(f"| {sid.upper()} | {report['role'][sid]} | {loss} | {hit} |")
    winners = {a: set() for a in CONTRAST_ARMS}
    for v in report['verdicts'].values():
        if v['verdict'] == 'candidate beats baseline': winners[v['candidate']].add(v['baseline'])
        if v['verdict'] == 'baseline beats candidate': winners[v['baseline']].add(v['candidate'])
    dominant = [a for a in CONTRAST_ARMS if len(winners[a]) == len(CONTRAST_ARMS)-1]
    lines += ['', '### Interpretation', '',
              ('An arm beats every other arm under the frozen rule: '+', '.join(dominant)+'.') if dominant else 'No arm beats every other arm under the frozen rule; no omnibus winner is selected.', '',
              'These are comparisons of strong-player pick prediction. They do not measure contextual scoring fairness or causal win value and cannot authorize a release. Commitment still counts any color overlap; demanding pips, alternate costs and landcycling remain outside these arms. The matched arm controls color-judgment eligibility, not every interaction between coverage and refitted statistics. Intervals are pointwise across multiple comparisons. The test split was not scored or used for selection.']
    for arm in dominant:
        worse = [sid.upper() for sid in CONFIRMATION
                 if report['sets'][sid]['challengers'][arm]['vs_v5']['log_loss_ci95'][0] > 0]
        if worse:
            lines += ['', f"The v5 reference is a material caveat: {arm} has significantly higher log loss on {', '.join(worse)}. Winning among challengers does not imply improvement over v5 in every format."]
    if report['verdicts']['explicit-matched-minus-explicit']['verdict'] == 'inconclusive':
        lines += ['', 'The explicit versus explicit-matched comparison is inconclusive. This check does not establish expanded color-judgment coverage as the explanation for the earlier explicit-arm gains.']
    return '\n'.join(lines) + '\n'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--results-dir', type=Path, help='Per-set run outputs; defaults to the committed aggregate')
    p.add_argument('--check', action='store_true')
    args = p.parse_args()
    original = json.loads(Path('research/data/context-challengers-2026-10-29.json').read_text())
    output = Path('research/data/context-challenger-contrasts-2026-10-29.json')
    results = ({sid: json.loads((args.results_dir / f'{sid}.json').read_text())
                for sid in (*DEVELOPMENT, *CONFIRMATION)} if args.results_dir
               else json.loads(output.read_text())['sets'])
    report = assemble(results, original)
    note = Path('research/CONTEXT-CHALLENGER-CONTRASTS.md')
    prefix = note.read_text().split('## Results\n', 1)[0]
    if hashlib.sha256(prefix.encode()).hexdigest() != FROZEN_PREFIX_SHA256:
        raise ValueError('Preregistered text changed')
    data = json.dumps(report, indent=2) + '\n'
    document = prefix + '## Results\n\n' + render(report)
    if args.check:
        if output.read_text() != data or note.read_text() != document:
            raise ValueError('Report or table differs from aggregate JSON')
        print('Every table number and verdict matches the aggregate source; frozen rules unchanged.')
    else:
        output.write_text(data)
        note.write_text(document)
        print('Wrote aggregate JSON and generated tables.')


if __name__ == '__main__':
    main()
