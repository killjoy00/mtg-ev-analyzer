#!/usr/bin/env python3
"""Reproducible private v1/v2 selection audit; no UAT or production writes.

Freeze first, then derive later-game corroboration and open response diagnostics.
Neither assessment source is imported by the inference module.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse

import card_strength_benchmark as strength
import puzzle_quality as v1
import puzzle_quality_experiment as experiment
import puzzle_quality_v2 as v2

ROOT = Path(__file__).resolve().parents[1]


def digest_sources(values):
    return hashlib.sha256('\n'.join(sorted(values)).encode()).hexdigest()


def verify_inputs(inputs, previous):
    provenance = json.loads((previous / 'provenance.json').read_text())
    required = ['contexts.json', 'responses.json', 'removals.json'] + [p.name for p in sorted(inputs.glob('inventory-*.json'))]
    if not any(p.startswith('inventory-') for p in required):
        raise ValueError('No inventory snapshots')
    for name in required:
        if strength.sha256(inputs / name) != provenance['inputs_sha256'].get(name):
            raise ValueError('Input differs from frozen v1 snapshot: ' + name)
    contexts, inventory, responses = experiment.read_inputs(inputs)
    sources = {sid: sorted({r['source_draft_hash'] for r in contexts + inventory if r['set_id'] == sid})
               for sid in {r['set_id'] for r in contexts + inventory}}
    audit = json.loads((previous / 'strength-audit.json').read_text())
    for sid, values in sources.items():
        if audit[sid]['excluded_source_sha256'] != digest_sources(values):
            raise ValueError('Source exclusion scope changed')
        if any(b['source_overlap'] for b in audit[sid]['budgets'].values()):
            raise ValueError('Puzzle source entered strength fitting')
    return contexts, inventory, responses, sources


def score_variants(puzzle, table, model, protocol):
    prepared = v1.prepare_context(puzzle, table, model['strength_method'])
    probabilities = v1.predict(prepared, model['coefficients'])
    old = v1.assess(puzzle, prepared, probabilities, model['protocol'])
    credible = {c['id'] for c in old['cards'] if not c['review_reasons']}
    pair = v2.pair_details(old['cards'], puzzle['historical_pick_id'], credible)
    old.update(pair=pair, ranking_context_tiebreak=False)
    rank_only = dict(old, ranking_context_tiebreak=True,
                     quality_score=pair['bottleneck_strength_z'] if pair and old['eligible'] else None)
    new = v2.assess(puzzle, table, protocol)
    target = next((c for c in prepared['cards'] if c['id'] == puzzle['historical_pick_id']), None)
    floor_ok = target is not None and target['support'] / max(c['support'] for c in prepared['cards']) >= protocol['minimum_trophy_support_ratio']
    seed = hashlib.sha256((str(protocol['seed']) + '|' + puzzle['puzzle_id']).encode()).hexdigest()
    # Reproducible uniform ordering within strata; no quality or response signal.
    baseline = dict(new, eligible=bool(floor_ok and not puzzle.get('removed')),
                    reasons=[] if floor_ok and not puzzle.get('removed') else ['serving_floor_or_removal'],
                    quality_score=int(seed[:13], 16) / 16**13,
                    ranking_context_tiebreak=False)
    return {'serving_floor_sample': baseline, 'v1_disagreement': old,
            'v1_gates_v2_rank': rank_only, 'v2_strength': new}, v2.choice_warnings(puzzle, probabilities, protocol)


def freeze(protocol, inputs, previous, out):
    contexts, inventory, responses, sources = verify_inputs(inputs, previous)
    old_protocol = json.loads((ROOT / 'research/puzzle-quality-v1.json').read_text())
    # Join only for cohort validation. No counts enter selection or parameters.
    labeled, exclusions = experiment.join_labels(contexts, responses, old_protocol)
    response_contexts = [r['context'] for r in labeled]
    portfolios, scored, warnings, cohort_scored = {}, {}, {}, {}
    for budget in protocol['strength_budgets']:
        table_path = previous / f'strength-{budget}.json'
        tables = json.loads(table_path.read_text())
        model = json.loads((previous / f'model-{budget}.json').read_text())
        if model['strength_sha256'] != strength.sha256(table_path):
            raise ValueError('Strength file differs from frozen v1 evidence')
        scored[budget], warnings[budget], cohort_scored[budget] = defaultdict(list), [], defaultdict(list)
        for puzzles, target in [(inventory, scored[budget]), (response_contexts, cohort_scored[budget])]:
            for puzzle in puzzles:
                variants, diagnostic = score_variants(puzzle, tables[puzzle['set_id']], model, protocol)
                for name, result in variants.items():
                    target[name].append(result)
                if target is scored[budget]:
                    warnings[budget].append(diagnostic)
        native = {name: v2.select_portfolio(rows, protocol['selection_fraction']) for name, rows in scored[budget].items()}
        matched = v2.matched_portfolios(scored[budget]['v1_disagreement'], scored[budget]['v2_strength'], protocol['selection_fraction'])
        portfolios[budget] = {'native': native, 'matched': dict(zip(('v1_disagreement', 'v2_strength'), matched))}
        artifact = {'version': protocol['version'], 'use': 'offline-research-only',
                    'protocol': protocol, 'strength_sha256': strength.sha256(table_path),
                    'excluded_sources': sources}
        strength.write_json(out / f'selector-{budget}.json', artifact)
    strength.write_json(out / 'frozen-inventory.json', scored)
    strength.write_json(out / 'frozen-portfolios.json', portfolios)
    strength.write_json(out / 'frozen-response-cohort.json', cohort_scored)
    strength.write_json(out / 'choice-warnings.json', warnings)
    frozen_names = ['frozen-inventory.json', 'frozen-portfolios.json', 'frozen-response-cohort.json', 'choice-warnings.json']
    provenance = {'protocol_sha256': strength.sha256(v2.PROTOCOL),
                  'code_sha256': {p: strength.sha256(ROOT / 'scripts' / p) for p in
                                  ('puzzle_quality.py', 'puzzle_quality_experiment.py', 'puzzle_quality_v2.py', 'puzzle_quality_compare.py')},
                  'input_sha256': {p.name: strength.sha256(p) for p in inputs.glob('*.json') if p.name in
                                   ('contexts.json', 'responses.json', 'removals.json') or p.name.startswith('inventory-')},
                  'strength_sha256': {b: strength.sha256(previous / f'strength-{b}.json') for b in protocol['strength_budgets']},
                  'frozen_sha256': {p: strength.sha256(out / p) for p in frozen_names},
                  'sources_sha256': {s: digest_sources(v) for s, v in sources.items()},
                  'label_exclusions': exclusions, 'new_untouched_assessment': False}
    strength.write_json(out / 'provenance.json', provenance)
    print('Selection portfolios frozen; response and later-game outcomes not assessed.', flush=True)


def verify_freeze(protocol, inputs, previous, out):
    contexts, inventory, responses, sources = verify_inputs(inputs, previous)
    provenance = json.loads((out / 'provenance.json').read_text())
    if provenance['protocol_sha256'] != strength.sha256(v2.PROTOCOL):
        raise ValueError('Protocol changed after freeze')
    for name, expected in provenance['code_sha256'].items():
        if strength.sha256(ROOT / 'scripts' / name) != expected:
            raise ValueError('Code changed after freeze: ' + name)
    for name, expected in provenance['frozen_sha256'].items():
        if strength.sha256(out / name) != expected:
            raise ValueError('Selection artifact changed after freeze: ' + name)
    for budget, expected in provenance['strength_sha256'].items():
        if strength.sha256(previous / f'strength-{budget}.json') != expected:
            raise ValueError('Strength changed after freeze')
    return contexts, inventory, responses, sources


def later_evidence(protocol, inputs, previous, out):
    _, _, _, sources = verify_freeze(protocol, inputs, previous, out)
    old_protocol = json.loads((ROOT / 'research/card-strength-v1.json').read_text())
    raw = ROOT / 'raw-data/card-strength-v1'
    cache = ROOT / 'artifacts/card-strength-v1/cache'
    manifest = json.loads((raw / 'sources.json').read_text())
    original_audit = json.loads((previous / 'strength-audit.json').read_text())
    tables, audit = {}, {}
    for sid in protocol['sets']:
        upper = sid.upper()
        if manifest[upper]['sha256'] != original_audit[sid]['source_sha256']:
            raise ValueError('Game archive differs from fitting evidence')
        info = strength.prepare_one(upper, raw / f'{upper}.csv.gz', cache, manifest[upper])
        rows = dict(np.load(cache / f'{upper}-rows.npz'))
        ids = np.sort(pd.read_csv(raw / f'{upper}.csv.gz', usecols=['draft_id'], dtype=str)['draft_id'].dropna().unique())
        if len(ids) != info['drafts'] or info['duplicate_games_excluded']:
            raise ValueError('Game-cache identity mapping not verified')
        hashes = np.array([experiment.source_hash(sid, i) for i in ids])
        train, validation, test = strength.partitions(rows['draft'], rows['time'], old_protocol)
        test = experiment.independent_training_ids(test, hashes, set(sources[sid]))
        if set(test) & (set(train) | set(validation)):
            raise AssertionError('Later-game assessment overlaps fitting/calibration drafts')
        # Also reconstruct the original fitting-source proof for all budgets.
        allowed_train = experiment.independent_training_ids(train, hashes, set(sources[sid]))
        for budget in protocol['strength_budgets']:
            fitting = allowed_train if budget == 'all' else allowed_train[:int(budget)]
            if digest_sources(hashes[fitting]) != original_audit[sid]['budgets'][budget]['fitting_source_hash_sha256']:
                raise ValueError('Cannot reproduce strength fitting sources')
        mask = np.isin(rows['draft'], test)
        hand = sparse.load_npz(cache / f'{upper}-hand.npz')[mask]
        y = rows['y'][mask]
        _, draft_codes = np.unique(rows['draft'][mask], return_inverse=True)
        grouping = sparse.csr_matrix((np.ones(len(y)), (draft_codes, np.arange(len(y)))), shape=(len(test), len(y)))
        games = np.asarray(hand.sum(axis=0)).ravel()
        drafts = np.asarray((grouping @ hand).getnnz(axis=0)).ravel()
        wins = np.asarray(hand.T @ y).ravel()
        prior, baseline = old_protocol['prior_games'], float(y.mean())
        gih = (wins + prior * baseline) / (games + prior)
        observed = games > 0
        mean, sd = float(gih[observed].mean()), float(gih[observed].std())
        if sd <= 0:
            raise ValueError('No later-game strength variation')
        tables[sid] = {name: {'gih': float(gih[i]), 'gih_z': float((gih[i] - mean) / sd),
                              'hand_games': int(games[i]), 'hand_drafts': int(drafts[i])}
                       for i, name in enumerate(info['cards']) if observed[i]}
        audit[sid] = {'games': int(mask.sum()), 'drafts': len(test), 'source_overlap': 0,
                      'train_validation_overlap': 0, 'source_sha256': manifest[upper]['sha256'],
                      'assessment_sources_sha256': digest_sources(hashes[test]),
                      'excluded_sources_sha256': digest_sources(sources[sid]),
                      'cache_sha256': {kind: strength.sha256(cache / f'{upper}-{kind}.npz') for kind in ('rows', 'hand')},
                      'gih_mean': mean, 'gih_sd': sd}
        print(f'{sid}: later-game evidence prepared with zero puzzle-source overlap', flush=True)
    strength.write_json(out / 'later-game-strength.json', tables)
    strength.write_json(out / 'later-game-audit.json', audit)
    strength.write_json(out / 'later-game-provenance.json', {
        'selection_provenance_sha256': strength.sha256(out / 'provenance.json'),
        'table_sha256': strength.sha256(out / 'later-game-strength.json'),
        'audit_sha256': strength.sha256(out / 'later-game-audit.json')})


def later_pair(row, evidence, protocol):
    pair = row.get('pair')
    if not pair:
        return None
    cards = {c['id']: c for c in row['cards']}
    values = [evidence.get(row['set_id'], {}).get(cards[pair[k]]['name']) for k in ('target_id', 'alternative_id')]
    if any(v is None or v['hand_games'] < protocol['minimum_assessment_hand_games'] or
           v['hand_drafts'] < protocol['minimum_assessment_hand_drafts'] for v in values):
        return None
    return min(v['gih_z'] for v in values)


def summarize(rows, portfolio, evidence, protocol):
    selected = set(portfolio['selected_puzzle_ids'])
    chosen = [r for r in rows if r['puzzle_id'] in selected]
    later = [(r, later_pair(r, evidence, protocol)) for r in chosen]
    known = [(r, x) for r, x in later if x is not None]
    by_set = defaultdict(list)
    for row, value in known:
        by_set[row['set_id']].append(value)
    strengths = [r['pair']['bottleneck_strength_z'] for r in chosen if r.get('pair')]
    return {'inventory': len(rows), 'eligible': sum(r['eligible'] for r in rows), 'selected': len(chosen),
            'shortfall': sum(s['shortfall'] for s in portfolio['strata']),
            'rejection_reasons': dict(Counter(reason for r in rows for reason in r['reasons'])),
            'training_pair_strength_mean': float(np.mean(strengths)) if strengths else None,
            'later_strength_known': len(known), 'later_strength_unknown': len(chosen) - len(known),
            'no_qualifying_pair': sum(not r.get('pair') for r in chosen),
            'pair_with_thin_later_evidence': sum(bool(r.get('pair')) and x is None for r, x in later),
            'later_both_above_average': sum(x >= 0 for _, x in known),
            'later_pair_strength_set_macro': float(np.mean([np.mean(v) for v in by_set.values()])) if by_set else None,
            'later_by_set': {sid: {'known': len(values), 'mean_bottleneck_z': float(np.mean(values)),
                                 'both_above_average': sum(x >= 0 for x in values)} for sid, values in sorted(by_set.items())},
            'strata': portfolio['strata']}


def comparison_interval(left_rows, right_rows, left_portfolio, right_portfolio, evidence, protocol):
    # Paired source-level bootstrap on the union of selected source drafts;
    # preserve repeated cards within a source but do not claim card-level CIs.
    groups = defaultdict(dict)
    coverage = []
    for arm, (rows, portfolio) in enumerate(((left_rows, left_portfolio), (right_rows, right_portfolio))):
        selected = set(portfolio['selected_puzzle_ids'])
        n_known = 0
        for row in rows:
            if row['puzzle_id'] not in selected:
                continue
            value = later_pair(row, evidence, protocol)
            if value is not None:
                key = row['set_id'], row['source_draft_hash']
                groups[row['set_id']].setdefault(key, [None, None])[arm] = value
                n_known += 1
        coverage.append({'selected': len(selected), 'known': n_known})
    arrays = {}
    for sid, values in groups.items():
        array = np.array([[np.nan if x is None else x for x in v] for v in values.values()])
        if np.isfinite(array).any(axis=0).all():
            arrays[sid] = array
    if not arrays:
        return {'difference': None, 'ci95': None, 'coverage': coverage}
    point = float(np.mean([np.nanmean(a[:, 1]) - np.nanmean(a[:, 0]) for a in arrays.values()]))
    rng, draws = np.random.default_rng(protocol['seed']), []
    for _ in range(protocol['bootstrap_draws']):
        differences = []
        for array in arrays.values():
            sample = array[rng.integers(len(array), size=len(array))]
            if not np.isfinite(sample).any(axis=0).all():
                break
            differences.append(np.nanmean(sample[:, 1]) - np.nanmean(sample[:, 0]))
        if len(differences) == len(arrays):
            draws.append(np.mean(differences))
    return {'difference_v2_minus_v1': point, 'ci95': np.quantile(draws, [.025, .975]).tolist() if draws else None,
            'coverage': coverage, 'sets': sorted(arrays), 'valid_draws': len(draws),
            'conditional_on_fixed_card_estimates': True, 'shared_card_uncertainty_included': False}


def wilson(k, n):
    if type(n) is not int or type(k) is not int or n < 1 or k < 0 or k > n:
        raise ValueError('Invalid binomial counts')
    z = 1.959963984540054
    p, d = k / n, 1 + z*z/n
    center = (p + z*z/(2*n)) / d
    radius = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return [max(0., center-radius), min(1., center+radius)]


def response_audit(contexts, responses, scored, protocol):
    lookup = {r['puzzle_id']: r for r in responses if r.get('source_event_type') == protocol['event_type']}
    contexts = {r['puzzle_id']: r for r in contexts}
    report = {}
    for name, rows in scored.items():
        strata = defaultdict(Counter)
        for row in rows:
            response = lookup.get(row['puzzle_id'])
            if response is None:
                continue
            group = ('fra_assessment' if row['set_id'] == 'fra' else 'other_sets_development') + ('_eligible' if row['eligible'] else '_ineligible')
            result = strata[group]
            result['puzzles'] += 1
            n = response['n']
            if n < protocol['minimum_observed_answers']:
                result['thin_response_evidence'] += 1
                continue
            result['qualified_response_evidence'] += 1
            counts = {r['id']: r['n'] for r in response['choices']}
            target_n = counts.get(contexts[row['puzzle_id']]['historical_pick_id'], 0)
            if wilson(target_n, n)[1] < protocol['choice_warning_target_below']:
                result['historical_choice_rare_upper95_below_5pct'] += 1
            if wilson(max(counts.values()), n)[0] > protocol['choice_warning_dominant_above']:
                result['nearly_unanimous_lower95_above_90pct'] += 1
        report[name] = {k: dict(v) for k, v in strata.items()}
    return report


def assess(protocol, inputs, previous, out):
    contexts, _, responses, _ = verify_freeze(protocol, inputs, previous, out)
    evidence_provenance = json.loads((out / 'later-game-provenance.json').read_text())
    for key, path in [('selection_provenance_sha256', 'provenance.json'), ('table_sha256', 'later-game-strength.json'), ('audit_sha256', 'later-game-audit.json')]:
        if strength.sha256(out / path) != evidence_provenance[key]:
            raise ValueError('Later-game evidence provenance mismatch')
    evidence = json.loads((out / 'later-game-strength.json').read_text())
    scored = json.loads((out / 'frozen-inventory.json').read_text())
    portfolios = json.loads((out / 'frozen-portfolios.json').read_text())
    cohort = json.loads((out / 'frozen-response-cohort.json').read_text())
    report = {'objective': 'strong_contextually_defensible_competition', 'enjoyment_measured': False,
              'production_changed': False, 'new_untouched_assessment': False, 'budgets': {}}
    for budget, variants in scored.items():
        result = {'native': {name: summarize(rows, portfolios[budget]['native'][name], evidence, protocol) for name, rows in variants.items()},
                  'matched': {name: summarize(variants[name], portfolio, evidence, protocol) for name, portfolio in portfolios[budget]['matched'].items()},
                  'response_diagnostics': response_audit(contexts, responses, cohort[budget], protocol)}
        left, right = [portfolios[budget]['matched'][name] for name in ('v1_disagreement', 'v2_strength')]
        result['matched_later_strength_contrast'] = comparison_interval(variants['v1_disagreement'], variants['v2_strength'], left, right, evidence, protocol)
        a, b = set(left['selected_puzzle_ids']), set(right['selected_puzzle_ids'])
        result['matched_selection_changes'] = {'shared': len(a & b), 'removed': sorted(a-b), 'added': sorted(b-a)}
        report['budgets'][budget] = result
    strength.write_json(out / 'comparison.json', report)
    print(json.dumps({b: {'selected': {n: r['selected'] for n, r in v['native'].items()},
                         'matched_later_strength': v['matched_later_strength_contrast']} for b, v in report['budgets'].items()}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['freeze', 'evidence', 'assess'])
    parser.add_argument('--inputs', type=Path, default=ROOT / 'raw-data/puzzle-quality-v1')
    parser.add_argument('--previous', type=Path, default=ROOT / 'artifacts/puzzle-quality-v1')
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/puzzle-quality-v2')
    args = parser.parse_args()
    protocol = json.loads(v2.PROTOCOL.read_text())
    {'freeze': freeze, 'evidence': later_evidence, 'assess': assess}[args.command](protocol, args.inputs, args.previous, args.out)


if __name__ == '__main__':
    main()
