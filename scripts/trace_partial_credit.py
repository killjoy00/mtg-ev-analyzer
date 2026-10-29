#!/usr/bin/env python3
"""Offline explanation of the existing grader, not a replacement scoring model.

Reconstruct one v5 decision from pinned public archives and refuse to explain
stored scores unless the source state and rounded model supports reproduce.
Detailed reports belong in ignored artifacts/, never public issue attachments.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from build_replays import (
    CONTEXT_STRENGTH, FIT_STRENGTH, PAIR_MIN_SEEN, PAIR_PRIOR_STRENGTH,
    CountStore, DraftSkill, OutOfFoldModel, build_colour_tables_by_fold,
    logit, logistic, normalize_probabilities, select_strong_drafts, stable_fold,
)
from import_all_trophies import collect_isolated, digest, scan_metadata, trajectory
from model_training import V5_MODEL, current_model_version
from rules_mana_context import candidate_pool_context, card_mana_context


def trace_card(model, card, pack_number, pick_number, pool):
    """Expose the actual baseline, supported pairs and color term in log odds.

    These are model arithmetic and evidence counts, not causal contributions to
    wins. Inferred colors describe deck affinity, not verified mana requirements.
    """
    base = model.base_tendency(card, pack_number, pick_number)
    pairs = []
    weighted_lift = total_weight = 0.0
    for pool_card, copies in pool.items():
        key = (card, pool_card)
        seen = model._count('pair_seen', key)
        expected = model._expected(key)
        row = {'pool_card': pool_card, 'seen': seen, 'used': False}
        if seen >= PAIR_MIN_SEEN and expected:
            reference = min(1 - 1e-6, max(1e-6, expected / seen))
            picked = model._count('pair_picked', key)
            rate = (picked + PAIR_PRIOR_STRENGTH * reference) / (seen + PAIR_PRIOR_STRENGTH)
            lift = logit(rate) - logit(reference)
            weight = min(1.0, math.sqrt(seen / 80.0)) * min(1.5, 1 + .15 * max(0, int(copies) - 1))
            weighted_lift += lift * weight
            total_weight += weight
            row.update(used=True, picked=picked, reference=reference,
                       shrunk_rate=rate, log_odds_lift=lift, weight=weight)
        pairs.append(row)
    commitment = min(1.0, sum(pool.values()) / 8.0)
    pair_shift = CONTEXT_STRENGTH * commitment * weighted_lift / total_weight if total_weight else 0.0
    color_shift = FIT_STRENGTH * model.fit_shift(card, pool)
    reconstructed = logistic(logit(base) + pair_shift + color_shift)
    actual = model.card_tendency(card, pack_number, pick_number, pool)
    if not math.isclose(reconstructed, actual, rel_tol=0, abs_tol=1e-12):
        raise ValueError('Trace no longer matches the production model arithmetic')
    return {
        'name': card, 'base_pick_tendency': base,
        'inferred_color_affinity': (model.fit or {}).get('cards', {}).get(card, {}).get('colours', '?'),
        'matched_pool_cards': model._commitment(dict(pool), model.fit_colours, card),
        'pair_evidence': pairs, 'pool_depth_multiplier': commitment,
        'pair_log_odds_shift': pair_shift, 'color_log_odds_shift': color_shift,
        'context_odds_multiplier': math.exp(pair_shift + color_shift),
        'final_tendency': actual,
    }


def trace_decision(model, example, expected=None):
    rows = [trace_card(model, name, example.raw_pack_number, example.raw_pick_number, example.pool)
            for name in example.candidates]
    normalized = normalize_probabilities({r['name']: r['final_tendency'] for r in rows})
    # The importer persists six decimals, and those stored values drive awards.
    supports = {name: round(value, 6) for name, value in normalized.items()}
    if expected is not None:
        verify_served_state(example, expected, supports)
    leader = max(supports.values())
    for row in rows:
        row['raw_support'] = supports[row['name']]
        row['model_only_credit'] = math.floor(95 * row['raw_support'] / leader + .5)
        row['trophy_match'] = row['name'] == example.historical_pick
        row['awarded_credit'] = 100 if row['trophy_match'] else row['model_only_credit']
        if expected is not None:
            metadata = next(c for c in expected['candidates'] if c['name'] == row['name'])
            context = candidate_pool_context(metadata, expected['prior_picks'])
            row['explicit_mana_context'] = context
            cast = context['card'].get('cast')
            affinity = row['inferred_color_affinity']
            row['required_colors_missing_from_affinity'] = (
                [c for c in cast['colors'] if c not in affinity]
                if cast is not None and affinity != '?' else None)
    return {
        'model_version': V5_MODEL,
        'interpretation': 'Observed pick tendency; points are not win probability or confidence.',
        'stored_evidence_verified': expected is not None,
        'pick_number': example.raw_pick_number + 1,
        'prior_pool': dict(example.pool),
        'prior_pool_inferred_affinities': {
            name: (model.fit or {}).get('cards', {}).get(name, {}).get('colours', '?')
            for name in example.pool},
        'prior_pool_explicit_mana': {
            c['name']: card_mana_context(c) for c in expected['prior_picks']
        } if expected is not None else None,
        'candidates': sorted(rows, key=lambda r: (-r['raw_support'], r['name'])),
    }


def verify_served_state(example, expected, supports):
    """Do not mistake a current rebuild or different decision for old evidence."""
    from collections import Counter
    if expected.get('model_version') != V5_MODEL:
        raise ValueError('Expected puzzle is not the supported frozen model')
    candidates = expected.get('candidates', [])
    if (len({c['name'] for c in candidates}) != len(candidates)
            or set(supports) != {c['name'] for c in candidates}
            or Counter(c['name'] for c in expected.get('prior_picks', [])) != example.pool
            or expected.get('pick_number') != example.raw_pick_number + 1):
        raise ValueError('Source decision does not match stored candidate/pool state')
    historical = next((c['name'] for c in candidates if c['id'] == expected.get('historical_pick_id')), None)
    if historical != example.historical_pick:
        raise ValueError('Source historical pick does not match stored evidence')
    for card in candidates:
        if not math.isclose(supports[card['name']], float(card['model_probability']), rel_tol=0, abs_tol=1e-9):
            raise ValueError('Rebuilt model support does not reproduce the stored decision')


def verify_archive(path, expected_hash):
    if digest(path) != expected_hash:
        raise ValueError('Archive checksum mismatch; do not substitute a refreshed source')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--set', required=True)
    p.add_argument('--draft-data', required=True, type=Path)
    p.add_argument('--game-data', required=True, type=Path)
    p.add_argument('--draft-sha256', required=True)
    p.add_argument('--game-sha256', required=True)
    p.add_argument('--source-draft-hash', required=True)
    p.add_argument('--pick-number', required=True, type=int)
    p.add_argument('--expected-puzzle', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    args = p.parse_args()
    if current_model_version() != V5_MODEL or not 1 <= args.pick_number <= 11:
        p.error('This reconstruction supports current v5 Premier Pack 1 picks 1–11 only')
    verify_archive(args.draft_data, args.draft_sha256)
    verify_archive(args.game_data, args.game_sha256)
    drafts, header, _, conflicts = scan_metadata(args.draft_data)
    ids = [did for did in drafts if hashlib.sha256(f'{args.set}|{did}'.encode()).hexdigest()[:32] == args.source_draft_hash]
    if len(ids) != 1 or ids[0] in conflicts:
        raise ValueError('Source draft is missing, ambiguous or inconsistent')
    did = ids[0]
    skills = {key: DraftSkill(v['rate'], v['games']) for key, v in drafts.items()
              if key not in conflicts and v['rate'] is not None and v['games'] is not None}
    training, cutoff, _ = select_strong_drafts(skills, 100, .15, None)
    print(f'Rebuilding from {len(training)} qualified drafts.', flush=True)
    folds, output, invalid, _, examples = collect_isolated(args.draft_data, set(training), {did}, header)
    if invalid[did]:
        raise ValueError('Source draft contains invalid pick records')
    fold = folds[stable_fold(did, 5)]
    if did in fold.training_ids:
        raise ValueError('Source draft reached its own training complement')
    fit = build_colour_tables_by_fold(args.game_data, examples, [fold], args.set)[0]
    model = OutOfFoldModel(fold.counts, CountStore.empty(), fit)
    valid, _, _ = trajectory(output[did], 11)
    example = next((x for x in valid if x.raw_pick_number == args.pick_number - 1), None)
    if example is None:
        raise ValueError('Requested pick has no verified contiguous source prefix')
    report = trace_decision(model, example, json.loads(args.expected_puzzle.read_text()))
    report['reconstruction'] = {
        'draft_sha256': args.draft_sha256, 'game_sha256': args.game_sha256,
        'qualified_training_drafts': len(training), 'cohort_cutoff': cutoff,
        'fold_training_drafts': len(fold.training_ids),
        'source_excluded_from_training': True,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('Stored decision and all candidate supports reproduced. Wrote local diagnostic.', flush=True)


if __name__ == '__main__':
    main()
