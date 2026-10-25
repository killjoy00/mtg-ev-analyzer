#!/usr/bin/env python3
"""Offline puzzle inference. No response store, database, or production imports.

Learned coefficients may come from historical choices; this module can score a
brand-new puzzle using only card/context inputs and independent strength data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ['log_support', 'strength_z', 'colour_fit', 'strength_unknown']
VARIANTS = {
    'incumbent': (), 'calibrated': (0,), 'fit': (0, 2),
    'adjusted': (0, 1, 3), 'adjusted_fit': (0, 1, 2, 3),
    'gih_fit': (0, 1, 2, 3),
}


def finite(value):
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def card_colours(card):
    """Conservative mana-symbol proxy; ambiguous costs are explicitly unknown."""
    cost = card.get('mana_cost')
    if not isinstance(cost, str) or not cost:
        return set(), False
    symbols = re.findall(r'\{([^{}]+)\}', cost)
    if not symbols or ''.join('{' + x + '}' for x in symbols) != cost:
        return set(), False
    if any('/' in s or (s not in set('WUBRGCXSYZ') and not s.isdigit()) for s in symbols):
        return set(), False
    return {s for s in symbols if s in 'WUBRG'}, True


def pool_fits(cards, prior):
    hits = {c: 0. for c in 'WUBRG'}
    unknown = 0
    for card in prior:
        colours, known = card_colours(card)
        unknown += not known
        for colour in colours:
            hits[colour] += 1 / len(colours)
    maximum = max(hits.values())
    commitment = min(1., len(prior) / 8.)
    values, knowns = [], []
    for card in cards:
        colours, known = card_colours(card)
        knowns.append(known)
        affinity = sum(hits[c] / maximum for c in colours) / len(colours) if colours and maximum else .5
        values.append(commitment * (2 * affinity - 1) if known else 0.)
    return values, knowns, unknown


def prepare_context(puzzle, table, method='C_adjusted'):
    """Explicit field selection: attached observations cannot become predictors."""
    if method not in ('C_adjusted', 'A_gih'):
        raise ValueError('Unsupported strength method')
    if str(puzzle.get('set_id', '')).lower() != str(table.get('set', '')).lower():
        raise ValueError('Strength table is from another set')
    if puzzle.get('source_event_type', 'PremierDraft') != table.get('event_type', 'PremierDraft'):
        raise ValueError('Strength table is from another event type')
    cards = puzzle.get('candidates')
    prior = puzzle.get('prior_picks') or []
    pick = puzzle.get('pick_number')
    if not isinstance(cards, list) or len(cards) < 2 or not isinstance(prior, list):
        raise ValueError('Incomplete puzzle context')
    if type(pick) is not int or pick != len(prior) + 1:
        raise ValueError('Prior-pick trajectory mismatch')
    ids = [c.get('id') for c in cards]
    if any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('Missing or duplicate candidate identity')
    if any(not finite(c.get('model_probability')) or float(c['model_probability']) < 0 for c in cards):
        raise ValueError('Invalid model support')
    supports = [float(c['model_probability']) for c in cards]
    total = sum(supports)
    if total <= 0:
        raise ValueError('No model support')
    supports = [p / total for p in supports]
    fit, fit_known, unknown_pool = pool_fits(cards, prior)
    estimates = table['cards']
    x, evidence = [], []
    for i, card in enumerate(cards):
        row = estimates.get(card.get('name'), {})
        games = row.get('deck_games', 0)
        known = type(games) is int and games > 0 and finite(row.get(method + '_z'))
        strength = float(row[method + '_z']) if known else None
        x.append([math.log(max(supports[i], 1e-8)),
                  max(-3., min(3., strength)) if known else 0., fit[i], float(not known)])
        evidence.append({'id': ids[i], 'name': card.get('name'), 'support': supports[i],
                         'strength_z': strength, 'deck_games': games if known else 0,
                         'colour_fit': fit[i], 'fit_known': fit_known[i]})
    return {'features': x, 'cards': evidence, 'unknown_pool_cards': unknown_pool}


def predict(prepared, coefficients):
    if len(coefficients) != len(FEATURES) or not all(finite(c) for c in coefficients):
        raise ValueError('Invalid portable model coefficients')
    values = [sum(a * float(b) for a, b in zip(row, coefficients)) for row in prepared['features']]
    largest = max(values)
    exp = [math.exp(v - largest) for v in values]
    total = sum(exp)
    return [v / total for v in exp]


def assess(puzzle, prepared, probabilities, protocol):
    """Research eligibility hypotheses, separate from the choice predictor."""
    cards = [dict(c, predicted_share=float(p)) for c, p in zip(prepared['cards'], probabilities)]
    if len(cards) != len(probabilities) or any(not finite(p) or p < 0 for p in probabilities) or abs(sum(probabilities)-1) > 1e-6:
        raise ValueError('Invalid predicted distribution')
    leader = max(c['support'] for c in cards)
    credible = []
    for c in cards:
        reasons = []
        if c['support'] / leader < protocol['minimum_viable_support_ratio']: reasons.append('low_contextual_support')
        if c['strength_z'] is None: reasons.append('unknown_strength')
        elif c['deck_games'] < protocol['minimum_card_games']: reasons.append('thin_strength_evidence')
        elif c['strength_z'] < protocol['minimum_strength_z']: reasons.append('below_strength_floor')
        if not c['fit_known']: reasons.append('uncertain_colour_fit')
        elif c['colour_fit'] < protocol['minimum_fit']: reasons.append('poor_colour_fit')
        if c['predicted_share'] < min(protocol['minimum_predictions']): reasons.append('low_predicted_choice')
        c['review_reasons'] = reasons
        if not reasons: credible.append(c)
    reasons = []
    target = next((c for c in cards if c['id'] == puzzle.get('historical_pick_id')), None)
    if puzzle.get('removed'): reasons.append('admin_removed')
    if target is None: reasons.append('missing_historical_target')
    elif target['support'] / leader < protocol['minimum_trophy_support_ratio']: reasons.append('below_existing_serving_floor')
    if len(credible) < 2: reasons.append('fewer_than_two_credible_choices')
    if target is not None and target not in credible: reasons.append('historical_target_needs_review')
    if prepared['unknown_pool_cards']: reasons.append('incomplete_pool_colour_evidence')
    top = sorted(credible, key=lambda c: (-c['predicted_share'], c['id']))[:3]
    mass = sum(c['predicted_share'] for c in top)
    disagreement = mass * mass - sum(c['predicted_share'] ** 2 for c in top)
    all_top = sorted(probabilities, reverse=True)
    return {'puzzle_id': puzzle.get('puzzle_id'), 'set_id': puzzle.get('set_id'),
            'source_draft_hash': puzzle.get('source_draft_hash'), 'pick_number': puzzle.get('pick_number'),
            'eligible': not reasons, 'reasons': reasons,
            'quality_score': min(1., 1.5 * disagreement) if not reasons else 0.,
            'predicted_top_three_mass': sum(all_top[:3]),
            'predicted_disagreement': 1 - sum(p * p for p in probabilities),
            'credible_choices': len(credible), 'cards': cards}


def select_portfolio(scored, fraction):
    """Preserve set and pick-position quotas; never silently backfill failures."""
    groups = {}
    for row in scored:
        if not row.get('source_draft_hash'):
            raise ValueError('Source identity required for diversity')
        groups.setdefault((row['set_id'], row['pick_number']), []).append(row)
    used, selected, audit = set(), [], []
    # Allocate small strata first to avoid a large stratum consuming all sources.
    for key, rows in sorted(groups.items(), key=lambda item: (len(item[1]), item[0])):
        quota = math.ceil(len(rows) * fraction)
        chosen = []
        for row in sorted(rows, key=lambda r: (-r['quality_score'], r['puzzle_id'])):
            source = (row['set_id'], row['source_draft_hash'])
            if not row['eligible'] or source in used: continue
            chosen.append(row['puzzle_id']);used.add(source)
            if len(chosen) == quota: break
        selected.extend(chosen)
        audit.append({'set': key[0], 'pick': key[1], 'available': len(rows),
                      'eligible': sum(r['eligible'] for r in rows), 'quota': quota,
                      'selected': len(chosen), 'shortfall': quota - len(chosen)})
    return {'selected_puzzle_ids': selected, 'strata': audit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('contexts', 'strength', 'model', 'out'):
        parser.add_argument('--' + flag, type=Path, required=True)
    args = parser.parse_args()
    contexts = json.loads(args.contexts.read_text())
    tables = json.loads(args.strength.read_text())
    artifact = json.loads(args.model.read_text())
    if artifact.get('feature_names') != FEATURES or artifact.get('use') != 'offline-research-only':
        raise ValueError('Unrecognized model contract')
    if artifact.get('strength_sha256') != hashlib.sha256(args.strength.read_bytes()).hexdigest():
        raise ValueError('Strength table does not match model provenance')
    results = []
    for puzzle in contexts:
        prepared = prepare_context(puzzle, tables[puzzle['set_id']], artifact['strength_method'])
        probability = predict(prepared, artifact['coefficients'])
        results.append(assess(puzzle, prepared, probability, artifact['protocol']))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({'puzzles': results,
        'portfolio': select_portfolio(results, artifact['protocol']['selection_fraction'])}, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
