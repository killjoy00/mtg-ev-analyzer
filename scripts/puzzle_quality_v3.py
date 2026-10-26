#!/usr/bin/env python3
"""Portable strength-estimator comparison and selected-model inference.

Same v2 puzzle gates; no Pack One response model or future source outcomes.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

import puzzle_quality_v2 as v2

CANDIDATES = ('gih', 'iwd', 'adjusted', 'equal_blend', 'adaptive_blend')


def selected_strength(card, estimator, adjusted_weight=None):
    if estimator not in CANDIDATES:
        raise ValueError('Unknown strength estimator')
    if estimator in ('gih', 'iwd', 'adjusted'):
        value = card.get({'gih': 'A_gih_z', 'iwd': 'B_iwd_z', 'adjusted': 'C_adjusted_z'}[estimator])
        return float(value) if v2.v1.finite(value) else None
    weight = .5 if estimator == 'equal_blend' else adjusted_weight
    if not v2.v1.finite(weight) or not 0 <= weight <= 1:
        raise ValueError('Blend weight must be explicitly frozen in [0,1]')
    if weight == 0:
        return selected_strength(card, 'gih')
    if weight == 1:
        return selected_strength(card, 'adjusted')
    a, c = selected_strength(card, 'gih'), selected_strength(card, 'adjusted')
    return (1 - weight) * a + weight * c if a is not None and c is not None else None


def adapt_table(table, estimator, adjusted_weight=None):
    # v1/v2 are frozen. Adapt a copy to their internal scalar-strength interface;
    # never change the original C coefficient or mislabel this as a new C fit.
    result = dict(table, cards={})
    for name, evidence in table['cards'].items():
        result['cards'][name] = dict(evidence, C_adjusted_z=selected_strength(evidence, estimator, adjusted_weight))
    return result


def assess(puzzle, table, base_protocol, estimator, adjusted_weight=None):
    protocol = dict(base_protocol, strength_method='C_adjusted')
    row = v2.assess(puzzle, adapt_table(table, estimator, adjusted_weight), protocol)
    row.update(selector_version='puzzle-quality-v3', strength_estimator=estimator,
               adjusted_weight=adjusted_weight if estimator == 'adaptive_blend' else .5 if estimator == 'equal_blend' else None,
               score_units='weaker_pair_selected_strength_not_enjoyment_probability')
    return row


def score_artifact(contexts, tables, artifact, removals):
    if artifact.get('version') != 'puzzle-quality-v3' or artifact.get('use') != 'offline-research-only':
        raise ValueError('Unrecognized v3 artifact')
    estimator = artifact['strength_estimator']
    if estimator not in CANDIDATES:
        raise ValueError('Unknown estimator')
    protocol = artifact['base_protocol']
    scored = []
    identities = set()
    for p in contexts:
        sid = p['set_id']
        if p['puzzle_id'] in identities:
            raise ValueError('Duplicate puzzle')
        identities.add(p['puzzle_id'])
        if p['source_draft_hash'] not in artifact['excluded_sources'].get(sid, []):
            raise ValueError('Puzzle source was not excluded from fitting')
        if any(p.get(k) != protocol[k] for k in ('corpus_version', 'model_version')):
            raise ValueError('Unvalidated corpus/context model')
        context = dict(p, removed=bool(p.get('removed')) or p['puzzle_id'] in removals)
        scored.append(assess(context, tables[sid], protocol, estimator, artifact.get('adjusted_weight')))
    return {'selector_version':'puzzle-quality-v3', 'strength_estimator':estimator,
            'puzzles':scored, 'portfolio':v2.select_portfolio(scored, protocol['selection_fraction'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('contexts', 'strength', 'selector', 'removals', 'out'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    artifact = json.loads(args.selector.read_text())
    if hashlib.sha256(args.strength.read_bytes()).hexdigest() != artifact.get('strength_sha256'):
        raise ValueError('Strength file differs from selector provenance')
    result = score_artifact(json.loads(args.contexts.read_text()), json.loads(args.strength.read_text()), artifact,
                            {r['puzzle_id'] for r in json.loads(args.removals.read_text())})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')


if __name__ == '__main__':
    main()
