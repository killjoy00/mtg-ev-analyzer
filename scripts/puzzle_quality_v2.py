#!/usr/bin/env python3
"""Offline strength/context selection. No response data or choice model required."""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
from itertools import product
import json
import math
from pathlib import Path
import re

import puzzle_quality as v1

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'research/puzzle-quality-v2.json'
COLOURS = set('WUBRG')


def is_land(card):
    return 'Land' in str(card.get('type_line', '')).split('—')[0].split()


def mana_options(card):
    """Possible spell-colour requirements, not colour identity or fixing.

    Lands and alternative life/generic payments need richer evidence. Ordinary
    R/G hybrids are alternatives: requiring both colours would be incorrect.
    """
    cost = card.get('mana_cost')
    if is_land(card) or not isinstance(cost, str) or not cost:
        return [], False
    symbols = re.findall(r'\{([^{}]+)\}', cost)
    if not symbols or ''.join('{' + s + '}' for s in symbols) != cost:
        return [], False
    choices = []
    for symbol in symbols:
        if symbol in COLOURS:
            choices.append([symbol])
        elif symbol.isdigit() or symbol in ('X', 'Y', 'Z'):
            continue
        elif re.fullmatch(r'[WUBRG]/[WUBRG]', symbol):
            choices.append(symbol.split('/'))
        else:
            return [], False
    # Bound metadata expansion, even for malformed/adversarial costs.
    if len(choices) > 12:
        return [], False
    options = {frozenset(xs) for xs in product(*choices)} if choices else {frozenset()}
    return sorted(options, key=lambda x: (len(x), ''.join(sorted(x)))), True


def pool_fit(cards, prior):
    hits = dict.fromkeys('WUBRG', 0.)
    unknown, lands, spells = 0, 0, 0
    for card in prior:
        if is_land(card):
            lands += 1
            continue
        spells += 1
        options, known = mana_options(card)
        if not known:
            unknown += 1
            continue
        # Each prior card has at most one unit of commitment, distributed over
        # possible payment colours. Colourless spells add none.
        for option in options:
            for colour in option:
                hits[colour] += 1 / len(options) / len(option)
    maximum = max(hits.values())
    commitment = min(1., spells / 8.)
    fits, knowns = [], []
    for card in cards:
        options, known = mana_options(card)
        knowns.append(known)
        values = []
        for option in options:
            affinity = sum(hits[c] / maximum for c in option) / len(option) if option and maximum else .5
            values.append(commitment * (2 * affinity - 1))
        fits.append(max(values) if values else 0.)
    return fits, knowns, unknown, lands


def prepare_context(puzzle, table, protocol):
    if protocol.get('version') != 'puzzle-quality-v2' or protocol.get('ranking') != 'target-alternative-bottleneck-v1':
        raise ValueError('Unsupported selector protocol')
    # Reuse v1's identity, event, trajectory, and support validation only.
    prepared = v1.prepare_context(puzzle, table, protocol['strength_method'])
    fits, knowns, unknown, lands = pool_fit(puzzle['candidates'], puzzle.get('prior_picks') or [])
    for card, fit, known in zip(prepared['cards'], fits, knowns):
        card.update(colour_fit=fit, fit_known=known)
        evidence = table['cards'].get(card['name'], {})
        other = evidence.get('A_gih_z')
        card['gih_strength_z'] = float(other) if v1.finite(other) else None
        card['strength_estimator_disagreement'] = (
            card['strength_z'] is not None and card['gih_strength_z'] is not None
            and (card['strength_z'] >= protocol['minimum_strength_z']) !=
                (card['gih_strength_z'] >= protocol['minimum_strength_z']))
    # Do not export the old choice features as part of the v2 selector contract.
    return {'cards': prepared['cards'], 'unknown_pool_cards': unknown,
            'unmodeled_prior_lands': lands}


def pair_details(cards, target_id, eligible_ids):
    """Choose one substantive alternative without a three-way or entropy bonus."""
    target = next((c for c in cards if c['id'] == target_id), None)
    alternatives = [c for c in cards if c['id'] in eligible_ids and c['id'] != target_id]
    if target is None or target_id not in eligible_ids or not alternatives:
        return None
    alternative = min(alternatives, key=lambda c: (-c['strength_z'], -c['support'], c['id']))
    leader = max(c['support'] for c in cards)
    return {'target_id': target_id, 'alternative_id': alternative['id'],
            'target_strength_z': target['strength_z'],
            'alternative_strength_z': alternative['strength_z'],
            'bottleneck_strength_z': min(target['strength_z'], alternative['strength_z']),
            'context_support_floor': min(target['support'], alternative['support']) / leader,
            'colour_fit_floor': min(target['colour_fit'], alternative['colour_fit']),
            'strength_gap_z': abs(target['strength_z'] - alternative['strength_z'])}


def assess(puzzle, table, protocol):
    prepared = prepare_context(puzzle, table, protocol)
    cards = prepared['cards']
    leader = max(c['support'] for c in cards)
    credible = set()
    for card in cards:
        reasons = []
        if card['strength_z'] is None:
            reasons.append('unknown_strength')
        elif card['deck_games'] < protocol['minimum_card_games']:
            reasons.append('thin_strength_evidence')
        elif card['strength_z'] < protocol['minimum_strength_z']:
            reasons.append('below_strength_floor')
        if card['support'] / leader < protocol['minimum_viable_support_ratio']:
            reasons.append('low_contextual_support')
        if not card['fit_known']:
            reasons.append('uncertain_colour_fit')
        elif card['colour_fit'] < protocol['minimum_fit']:
            reasons.append('poor_colour_fit')
        card['review_reasons'] = reasons
        if not reasons:
            credible.add(card['id'])
    target = next((c for c in cards if c['id'] == puzzle.get('historical_pick_id')), None)
    reasons, warnings = [], []
    if puzzle.get('removed'):
        reasons.append('admin_removed')
    if target is None:
        reasons.append('missing_historical_target')
    else:
        if target['support'] / leader < protocol['minimum_trophy_support_ratio']:
            reasons.append('below_existing_serving_floor')
        if target['id'] not in credible:
            reasons.append('historical_target_needs_review')
    if len(credible) < 2:
        reasons.append('fewer_than_two_credible_choices')
    if prepared['unknown_pool_cards']:
        reasons.append('incomplete_pool_colour_evidence')
    if prepared['unmodeled_prior_lands']:
        warnings.append('prior_land_fixing_not_modeled')
    if any(c['strength_estimator_disagreement'] for c in cards if c['id'] in credible):
        warnings.append('credible_card_strength_estimators_disagree')
    pair = pair_details(cards, puzzle.get('historical_pick_id'), credible)
    return {'puzzle_id': puzzle.get('puzzle_id'), 'set_id': puzzle.get('set_id'),
            'source_draft_hash': puzzle.get('source_draft_hash'), 'pick_number': puzzle.get('pick_number'),
            'selector_version': protocol['version'], 'eligible': not reasons,
            'reasons': reasons, 'warnings': warnings, 'credible_choices': len(credible),
            'quality_score': pair['bottleneck_strength_z'] if pair and not reasons else None,
            'score_units': 'weaker_pair_strength_z_not_enjoyment_probability',
            'pair': pair, 'cards': cards}


def choice_warnings(puzzle, probabilities, protocol):
    """Optional sidecar ONLY. This output is never read by assess or portfolio."""
    cards = puzzle['candidates']
    if len(probabilities) != len(cards) or any(not v1.finite(p) or p < 0 for p in probabilities) or abs(sum(probabilities) - 1) > 1e-6:
        raise ValueError('Invalid diagnostic choice distribution')
    target = next((p for c, p in zip(cards, probabilities) if c['id'] == puzzle.get('historical_pick_id')), None)
    warnings = []
    if target is not None and target < protocol['choice_warning_target_below']:
        warnings.append('predicted_historical_choice_rare')
    if max(probabilities) > protocol['choice_warning_dominant_above']:
        warnings.append('predicted_choice_nearly_unanimous')
    return {'puzzle_id': puzzle.get('puzzle_id'), 'warnings': warnings,
            'use': 'diagnostic-only-no-selection-effect'}


def ranking_key(row):
    pair = row.get('pair') or {}
    context = pair.get('context_support_floor', 0.) if row.get('ranking_context_tiebreak', True) else 0.
    return (-row['quality_score'], -context, row['puzzle_id'])


def select_portfolio(scored, fraction, quotas=None):
    if not v1.finite(fraction) or not 0 < fraction <= 1:
        raise ValueError('Invalid selection fraction')
    groups = defaultdict(list)
    identities = set()
    for row in scored:
        if not row.get('source_draft_hash') or not row.get('puzzle_id') or row['puzzle_id'] in identities:
            raise ValueError('Missing source/puzzle identity or duplicate puzzle')
        identities.add(row['puzzle_id'])
        if row['eligible'] and not v1.finite(row.get('quality_score')):
            raise ValueError('Eligible puzzle has no finite ranking score')
        groups[row['set_id'], row['pick_number']].append(row)
    used, selected, audit = set(), [], []
    for key, rows in sorted(groups.items(), key=lambda item: (len(item[1]), item[0])):
        quota = quotas.get(key, 0) if quotas is not None else math.ceil(len(rows) * fraction)
        if type(quota) is not int or quota < 0:
            raise ValueError('Invalid stratum quota')
        chosen = []
        if quota:
            for row in sorted((r for r in rows if r['eligible']), key=ranking_key):
                source = row['set_id'], row['source_draft_hash']
                if source in used:
                    continue
                chosen.append(row['puzzle_id'])
                used.add(source)
                if len(chosen) == quota:
                    break
        selected.extend(chosen)
        audit.append({'set': key[0], 'pick': key[1], 'quota': quota, 'selected': len(chosen),
                      'available': len(rows), 'eligible': sum(r['eligible'] for r in rows),
                      'shortfall': quota - len(chosen)})
    return {'selected_puzzle_ids': selected, 'strata': audit}


def matched_portfolios(left, right, fraction):
    """Equal set/pick counts AND source diversity; disclose any lost capacity."""
    portfolios = [select_portfolio(rows, fraction) for rows in (left, right)]
    quotas = {(r['set'], r['pick']): r['selected'] for r in portfolios[0]['strata']}
    for _ in range(sum(quotas.values()) + 1):
        other = {(r['set'], r['pick']): r['selected'] for r in portfolios[1]['strata']}
        quotas = {k: min(n, other.get(k, 0)) for k, n in quotas.items()}
        portfolios = [select_portfolio(rows, fraction, quotas) for rows in (left, right)]
        achieved = [{(r['set'], r['pick']): r['selected'] for r in p['strata']} for p in portfolios]
        lower = {k: min(n, *(a.get(k, 0) for a in achieved)) for k, n in quotas.items()}
        if lower == quotas:
            return portfolios
        quotas = lower
    raise AssertionError('Matched quotas did not converge')


def score_artifact(contexts, tables, artifact, removals):
    if artifact.get('use') != 'offline-research-only' or artifact.get('version') != 'puzzle-quality-v2':
        raise ValueError('Unrecognized selector artifact')
    protocol = artifact['protocol']
    result = []
    for puzzle in contexts:
        sid = puzzle['set_id']
        if puzzle.get('source_draft_hash') not in artifact['excluded_sources'].get(sid, []):
            raise ValueError('Puzzle source was not excluded from strength fitting')
        if puzzle.get('corpus_version') != protocol['corpus_version'] or puzzle.get('model_version') != protocol['model_version']:
            raise ValueError('Unvalidated corpus or contextual model version')
        # A fresh explicit removals snapshot overrides neither prior removal nor
        # current removal. Do not silently resurrect a removed puzzle.
        context = dict(puzzle, removed=bool(puzzle.get('removed')) or puzzle['puzzle_id'] in removals)
        result.append(assess(context, tables[sid], protocol))
    return {'selector_version': protocol['version'], 'puzzles': result,
            'portfolio': select_portfolio(result, protocol['selection_fraction'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('contexts', 'strength', 'selector', 'removals', 'out'):
        parser.add_argument('--' + flag, type=Path, required=True)
    args = parser.parse_args()
    artifact = json.loads(args.selector.read_text())
    if hashlib.sha256(args.strength.read_bytes()).hexdigest() != artifact.get('strength_sha256'):
        raise ValueError('Strength evidence differs from selector provenance')
    removals = {r['puzzle_id'] for r in json.loads(args.removals.read_text())}
    output = score_artifact(json.loads(args.contexts.read_text()), json.loads(args.strength.read_text()), artifact, removals)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
