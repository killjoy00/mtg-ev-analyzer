#!/usr/bin/env python3
"""Private offline evaluation. Inputs/outputs must remain outside public git.

The pure inference module accepts no observed responses. This harness alone
joins aggregate labels for training and held-out evaluation.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.optimize import minimize
from scipy.special import logsumexp

import card_strength_benchmark as strength
import puzzle_quality as quality

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'research/puzzle-quality-v1.json'


def source_hash(sid, draft_id):
    return hashlib.sha256(f'{sid.lower()}|{draft_id}'.encode()).hexdigest()[:32]


def independent_training_ids(ordered, source_hashes, forbidden):
    allowed = np.array([i for i in ordered if source_hashes[i] not in forbidden], dtype=int)
    if set(source_hashes[allowed]) & set(forbidden):
        raise AssertionError('Puzzle source entered strength fitting')
    return allowed


def read_inputs(directory):
    contexts = json.loads((directory / 'contexts.json').read_text())
    inventory = [r for p in sorted(directory.glob('inventory-*.json')) for r in json.loads(p.read_text())]
    removals = {r['puzzle_id'] for r in json.loads((directory / 'removals.json').read_text())}
    for row in contexts + inventory:
        row['removed'] = row['puzzle_id'] in removals
    responses = json.loads((directory / 'responses.json').read_text())
    return contexts, inventory, responses


def fit_strength_tables(protocol, inputs, out):
    contexts, inventory, _ = read_inputs(inputs)
    source_protocol = json.loads((ROOT / 'research/card-strength-v1.json').read_text())
    raw = ROOT / 'raw-data/card-strength-v1'
    cache = ROOT / 'artifacts/card-strength-v1/cache'
    manifest = json.loads((raw / 'sources.json').read_text())
    audit, tables = {}, {str(b) if b else 'all': {} for b in protocol['strength_budgets']}
    for sid in protocol['sets']:
        upper = sid.upper()
        info = strength.prepare_one(upper, raw / f'{upper}.csv.gz', cache, manifest[upper])
        rows = dict(np.load(cache / f'{upper}-rows.npz'))
        # The original cache encodes sorted unique valid draft IDs. Exact ID-set
        # cardinality and zero duplicate exclusions are required before mapping.
        ids = pd.read_csv(raw / f'{upper}.csv.gz', usecols=['draft_id'], dtype=str)['draft_id']
        ids = np.sort(ids.dropna().unique())
        if len(ids) != info['drafts'] or info['duplicate_games_excluded'] != 0:
            raise ValueError('Raw/cache identity mapping requires a fresh verified cache')
        hashes = np.array([source_hash(sid, i) for i in ids])
        forbidden = {r['source_draft_hash'] for r in contexts + inventory if r['set_id'] == sid}
        train, _, _ = strength.partitions(rows['draft'], rows['time'], source_protocol)
        allowed = independent_training_ids(train, hashes, forbidden)
        deck = sparse.load_npz(cache / f'{upper}-deck.npz')
        hand = sparse.load_npz(cache / f'{upper}-hand.npz')
        audit[sid] = {'excluded_sources': len(train) - len(allowed),
                      'requested_source_exclusions': len(forbidden),
                      'excluded_source_sha256': hashlib.sha256('\n'.join(sorted(forbidden)).encode()).hexdigest(),
                      'sources_absent_from_game_archive': len(forbidden - set(hashes)),
                      'source_sha256': manifest[upper]['sha256'], 'budgets': {}}
        for budget in protocol['strength_budgets']:
            label = str(budget) if budget else 'all'
            fitting = allowed[:budget] if budget else allowed
            if budget and len(fitting) < budget: raise ValueError('Insufficient independent strength evidence')
            mask = np.isin(rows['draft'], fitting)
            norm, raw_scores, nd, nh, baseline = strength.estimate_strengths(
                deck[mask], hand[mask], rows['x'][mask], rows['y'][mask],
                source_protocol['prior_games'], source_protocol['adjusted_model_C'])
            table = {'set': sid, 'training_drafts': len(fitting), 'baseline': baseline,
                     'source_exclusion_count': len(forbidden), 'cards': {}}
            for i, name in enumerate(info['cards']):
                table['cards'][name] = {'deck_games': int(nd[i]), 'in_hand_games': int(nh[i]),
                    **{m + '_z': float(norm[m][i]) for m in ('A_gih', 'C_adjusted')}}
            tables[label][sid] = table
            audit[sid]['budgets'][label] = {'drafts': len(fitting), 'games': int(mask.sum()),
                'fitting_source_hash_sha256': hashlib.sha256('\n'.join(sorted(hashes[fitting])).encode()).hexdigest(),
                'source_overlap': len(set(hashes[fitting]) & forbidden)}
            print(f'{sid}/{label}: independently fitted, zero puzzle-source overlap', flush=True)
    out.mkdir(parents=True, exist_ok=True)
    for label, values in tables.items(): strength.write_json(out / f'strength-{label}.json', values)
    strength.write_json(out / 'strength-audit.json', audit)


def join_labels(contexts, responses, protocol):
    lookup, excluded = {}, Counter()
    for row in responses:
        if row.get('source_event_type') != protocol['event_type']:
            excluded['unsupported_response_format'] += 1
            continue
        if row['puzzle_id'] in lookup: raise ValueError('Duplicate response aggregate')
        if row.get('is_admin') or row['corpus_version'] != protocol['corpus_version'] or row['scoring_version'] != protocol['scoring_version']:
            raise ValueError('Invalid response cohort/version')
        lookup[row['puzzle_id']] = row
    result = []
    for context in contexts:
        row = lookup.get(context['puzzle_id'])
        if row is None: excluded['no_response'] += 1; continue
        if context['corpus_version'] != protocol['corpus_version'] or context['model_version'] != protocol['model_version']:
            raise ValueError('Context version differs from frozen cohort')
        if row['source_draft_hash'] != context['source_draft_hash'] or row['set_id'] != context['set_id']:
            raise ValueError('Response/context identity mismatch')
        ids = [c['id'] for c in context['candidates']]
        counts = {c['id']: c['n'] for c in row['choices']}
        if len(counts) != len(row['choices']) or not set(counts).issubset(ids):
            raise ValueError('Duplicate or unknown choice identity')
        if any(type(n) is not int or n < 0 for n in counts.values()) or sum(counts.values()) != row['n'] or row['n'] < 1:
            raise ValueError('Invalid choice counts')
        result.append({'context': context, 'counts': np.array([counts.get(i, 0) for i in ids], float),
                       'n': row['n'], 'set_id': context['set_id'], 'source': context['source_draft_hash']})
    return result, dict(excluded)


def weights(rows):
    source_counts = Counter((r['set_id'], r['source']) for r in rows)
    set_sources = Counter(s for s, _ in source_counts)
    result = np.array([1 / set_sources[r['set_id']] / source_counts[r['set_id'], r['source']] for r in rows])
    return result / result.sum()


def fit_choice(rows, prepared, variant, ridge):
    free = quality.VARIANTS[variant]
    if not free: return [1., 0., 0., 0.]
    prior = np.array([1., 0., 0., 0.])
    w = weights(rows)
    matrices = [np.asarray(p['features']) for p in prepared]
    targets = [r['counts'] / r['n'] for r in rows]

    def objective(parameters):
        beta = np.zeros(4); beta[list(free)] = parameters
        loss, grad = 0., np.zeros(4)
        for x, target, weight in zip(matrices, targets, w):
            logits = x @ beta
            logp = logits - logsumexp(logits)
            loss -= weight * (target @ logp)
            grad += weight * (x.T @ (np.exp(logp) - target))
        delta = beta - prior
        return loss + .5 * ridge * (delta @ delta), (grad + ridge * delta)[list(free)]

    result = minimize(objective, prior[list(free)], jac=True, method='L-BFGS-B',
                      bounds=[(.25, 4.) if f == 0 else (None, None) for f in free],
                      options={'maxiter': 500, 'ftol': 1e-12, 'gtol': 1e-7})
    if not result.success: raise ValueError('Choice fit did not converge: ' + result.message)
    beta = np.zeros(4); beta[list(free)] = result.x
    return beta.tolist()


def fit_without_target(rows, prepared, target_set, variant, ridge):
    indices = [i for i, r in enumerate(rows) if r['set_id'] != target_set]
    if not indices: raise ValueError('No foreign-set training data')
    return fit_choice([rows[i] for i in indices], [prepared[i] for i in indices], variant, ridge)


def metrics(row, probability):
    target = row['counts'] / row['n']
    p = np.asarray(probability)
    result = {'log_loss': float(-(target @ np.log(np.maximum(p, 1e-12)))),
              'brier': float(1 - 2 * target @ p + p @ p),
              'predicted_disagreement': float(1 - p @ p)}
    if row['n'] >= 2:
        result['observed_disagreement'] = float(1 - sum(row['counts'] * (row['counts'] - 1)) / row['n'] / (row['n'] - 1))
    return result


def paired_interval(rows, differences, draws, seed):
    by_source = defaultdict(list)
    for row, value in zip(rows, differences): by_source[row['source']].append(value)
    values = np.array([np.mean(v) for v in by_source.values()])
    rng = np.random.default_rng(seed)
    estimates = np.array([values[rng.integers(len(values), size=len(values))].mean() for _ in range(draws)])
    return {'difference': float(values.mean()), 'ci95': np.quantile(estimates, [.025, .975]).tolist(),
            'source_drafts': len(values)}


def run(protocol, inputs, out, final_test):
    contexts, inventory, responses = read_inputs(inputs)
    rows, excluded = join_labels(contexts, responses, protocol)
    target = protocol['assessment_set']
    target_indices = [i for i, r in enumerate(rows) if r['set_id'] == target]
    development_indices = [i for i, r in enumerate(rows) if r['set_id'] != target]
    models, predictions, all_scored, development = {}, {}, {}, {}
    strength_audit = json.loads((out / 'strength-audit.json').read_text())
    for sid, audit in strength_audit.items():
        if any(b['source_overlap'] for b in audit['budgets'].values()): raise ValueError('Leaking strength tables')
        sources = {r['source_draft_hash'] for r in contexts + inventory if r['set_id'] == sid}
        if audit.get('excluded_source_sha256') != hashlib.sha256('\n'.join(sorted(sources)).encode()).hexdigest():
            raise ValueError('Contexts changed after source exclusion; rebuild strength tables')
    for budget in protocol['strength_budgets']:
        label = str(budget) if budget else 'all'
        tables = json.loads((out / f'strength-{label}.json').read_text())
        prepared = {m: [quality.prepare_context(r['context'], tables[r['set_id']], m) for r in rows]
                    for m in ('C_adjusted', 'A_gih')}
        models[label], predictions[label], all_scored[label], development[label] = {}, {}, {}, {}
        for variant in quality.VARIANTS:
            method = 'A_gih' if variant == 'gih_fit' else 'C_adjusted'
            values = prepared[method]
            beta = fit_without_target(rows, values, target, variant, protocol['ridge'])
            artifact = {'use': 'offline-research-only', 'feature_names': quality.FEATURES,
                        'coefficients': beta, 'strength_method': method, 'variant': variant,
                        'training_sets': sorted({rows[i]['set_id'] for i in development_indices}),
                        'assessment_set_excluded': target, 'protocol': protocol,
                        'protocol_sha256': strength.sha256(PROTOCOL),
                        'strength_sha256': strength.sha256(out / f'strength-{label}.json')}
            models[label][variant] = artifact
            predictions[label][variant] = [quality.predict(values[i], beta) for i in target_indices]
            # Leave each development set out; Reality Fracture stays excluded.
            dev_results = []
            for sid in artifact['training_sets']:
                train = [i for i in development_indices if rows[i]['set_id'] != sid]
                test = [i for i in development_indices if rows[i]['set_id'] == sid]
                dev_beta = fit_choice([rows[i] for i in train], [values[i] for i in train], variant, protocol['ridge'])
                metric_rows = [metrics(rows[i], quality.predict(values[i], dev_beta)) for i in test]
                dev_results.append({'set': sid, 'log_loss': float(np.average([m['log_loss'] for m in metric_rows], weights=weights([rows[i] for i in test])))})
            development[label][variant] = dev_results
            scored = []
            for puzzle in inventory:
                item = quality.prepare_context(puzzle, tables[puzzle['set_id']], method)
                scored.append(quality.assess(puzzle, item, quality.predict(item, beta), protocol))
            all_scored[label][variant] = scored
        print(f'{label}: choice models and assessment predictions frozen', flush=True)
    strength.write_json(out / 'models.json', models)
    strength.write_json(out / 'frozen-predictions.json', predictions)
    strength.write_json(out / 'development.json', development)
    strength.write_json(out / 'inventory-scores.json', all_scored)
    for label in models:
        strength.write_json(out / f'model-{label}.json', models[label]['adjusted_fit'])
    provenance = {'protocol_sha256': strength.sha256(PROTOCOL),
                  'code_sha256': strength.sha256(__file__),
                  'inference_code_sha256': strength.sha256(quality.__file__),
                  'inputs_sha256': {p.name: strength.sha256(p) for p in sorted(inputs.glob('*.json'))},
                  'prediction_sha256': strength.sha256(out / 'frozen-predictions.json'),
                  'training_sets': sorted({r['set_id'] for r in rows if r['set_id'] != target}),
                  'assessment_set': target, 'label_exclusions': excluded}
    strength.write_json(out / 'provenance.json', provenance)
    if not final_test:
        print('Predictions frozen; assessment not opened.'); return
    target_rows = [rows[i] for i in target_indices]
    report = {'assessment_set': target, 'puzzles': len(target_rows),
              'answers': sum(r['n'] for r in target_rows), 'budgets': {}, 'inventory': {},
              'causal_quality_claim': False, 'production_change': False}
    differences = []
    for label, variants in predictions.items():
        report['budgets'][label] = {}
        report['inventory'][label] = {}
        losses = {}
        for variant, ps in variants.items():
            ms = [metrics(r, p) for r, p in zip(target_rows, ps)]
            losses[variant] = np.array([m['log_loss'] for m in ms])
            row = {metric: float(np.average([m[metric] for m in ms], weights=weights(target_rows))) for metric in ['log_loss', 'brier', 'predicted_disagreement']}
            reliable = [i for i, r in enumerate(target_rows) if r['n'] >= protocol['minimum_debate_answers']]
            row['debate_diagnostic_puzzles'] = len(reliable)
            row['disagreement_mae'] = float(np.mean([abs(ms[i]['observed_disagreement'] - ms[i]['predicted_disagreement']) for i in reliable])) if reliable else None
            report['budgets'][label][variant] = row
            scored = all_scored[label][variant]
            report['inventory'][label][variant] = {
                'puzzles': len(scored), 'eligible': sum(s['eligible'] for s in scored),
                'reasons': dict(Counter(reason for s in scored for reason in s['reasons'])),
                'portfolio': quality.select_portfolio(scored, protocol['selection_fraction'])}
        differences.append(losses['adjusted_fit'] - losses['calibrated'])
    report['primary_contrast'] = paired_interval(target_rows, np.mean(differences, axis=0), protocol['bootstrap_draws'], protocol['seed'])
    report['candidate_improves_calibrated'] = report['primary_contrast']['ci95'][1] < 0
    report['macro_log_loss'] = {v: float(np.mean([report['budgets'][b][v]['log_loss'] for b in report['budgets']])) for v in quality.VARIANTS}
    strength.write_json(out / 'assessment.json', report)
    print(json.dumps({'macro_log_loss': report['macro_log_loss'], 'primary_contrast': report['primary_contrast']}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['strengths', 'evaluate'])
    parser.add_argument('--inputs', type=Path, default=ROOT / 'raw-data/puzzle-quality-v1')
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/puzzle-quality-v1')
    parser.add_argument('--final-test', action='store_true')
    args = parser.parse_args()
    protocol = json.loads(PROTOCOL.read_text())
    if args.command == 'strengths': fit_strength_tables(protocol, args.inputs, args.out)
    else: run(protocol, args.inputs, args.out, args.final_test)


if __name__ == '__main__': main()
