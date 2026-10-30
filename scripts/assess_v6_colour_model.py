#!/usr/bin/env python3
"""Held-out comparison of the v6 colour policy against v5 for one set.

Both arms are the production OutOfFoldModel with their own colour policy
(model_training.colour_policy). They share uncapped train-split counts and
stage-matched pair expectations; each colour table is rebuilt from the same
game archive on the train split. Scores the served slice of one held-out split.

Writes an aggregate report for the repository and, separately, per-draft
deltas for the pooled bootstrap. The per-draft file holds draft identifiers,
so keep it under ignored artifacts/ or raw-data/ and never commit it.
Preregistration and results: research/V6-COLOUR-MODEL.md.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
from collections import defaultdict
from pathlib import Path

from build_replays import CountStore, OutOfFoldModel, normalize_probabilities
from deck_fit import MISSING, card_colours, estimate, observe_examples, scan_decks
from eval_model import (Cache, award, cache_identity, file_sha256, guard_test_split, load_examples,
                        pair_expectations, paired_bootstrap, pick_metrics, sharpen, train_counts,
                        validation_role)
from model_training import V5_MODEL, V6_MODEL, colour_policy

SERVED_MAX_PICK = 11
TEMPERATURE_GRID = (1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0)


def served(cache, examples):
    pack, pick = cache.meta['pack_offset'], cache.meta['pick_offset']
    return [x for x in examples
            if x.raw_pack_number + pack == 1 and x.raw_pick_number + pick <= SERVED_MAX_PICK]


def build_models(cache, games, train_ids):
    keep = set(train_ids)
    counts, training_picks = train_counts(cache, train_ids)
    counts.pair_expected.update(pair_expectations(cache, train_ids, counts))
    pairs = [(d, x) for d, x in cache.examples() if d in keep]
    models, coverage = {}, {}
    for model_version in (V5_MODEL, V6_MODEL):
        policy = colour_policy(model_version)
        played, colour_hits = scan_decks(games, keep, policy['deck_colours'])
        colours = card_colours(colour_hits)
        by_bucket, by_card, by_stage = observe_examples(pairs, played, colours)
        fit = estimate(by_bucket, by_card, colours, by_stage)
        models[model_version] = OutOfFoldModel(counts, CountStore.empty(), fit,
                                               policy['zero_rates_are_data'])
        coverage[model_version] = {
            'fit_cards': len(fit['cards']),
            'cards_with_colour_judgment': sum(colours.get(card, MISSING) not in (MISSING, None)
                                              for card in fit['cards'])}
    return models, coverage, training_picks


def tendencies(model, example):
    return {card: model.card_tendency(card, example.raw_pack_number, example.raw_pick_number,
                                      example.pool) for card in example.candidates}


def score(model, examples):
    rows, supports = [], []
    for x in examples:
        normalized = normalize_probabilities(tendencies(model, x))
        probabilities = [normalized[card] for card in x.candidates]
        loss, brier, hit, _ = pick_metrics(probabilities, x.candidates.index(x.historical_pick))
        rows.append((x.draft_id, loss, brier, 1 if hit else 0))
        supports.append(probabilities)
    return rows, supports


def summary(rows):
    n = len(rows)
    return {'decisions': n, 'log_loss': round(sum(r[1] for r in rows) / n, 6),
            'brier': round(sum(r[2] for r in rows) / n, 6),
            'top1': round(sum(r[3] for r in rows) / n, 6)}


def award_shift(baseline, candidate):
    leaders = moved = total = 0
    for base, other in zip(baseline, candidate):
        leaders += base.index(max(base)) != other.index(max(other))
        for i in range(len(base)):
            moved += abs(award(other, i) - award(base, i))
            total += 1
    return {'leader_change_rate': round(leaders / len(baseline), 6),
            'mean_abs_award_change': round(moved / total, 4)}


def temperature_losses(model, examples):
    """Summed display-calibration log loss per exponent; never fitted on test."""
    totals = dict.fromkeys(TEMPERATURE_GRID, 0.0)
    for x in examples:
        raw = tendencies(model, x)
        for temperature in TEMPERATURE_GRID:
            p = normalize_probabilities(sharpen(raw, temperature))[x.historical_pick]
            totals[temperature] += -math.log(max(p, 1e-12))
    return {'decisions': len(examples), 'summed_log_loss': {f'{t:g}': round(v, 6) for t, v in totals.items()}}


def draft_deltas(baseline, candidate):
    by_draft = defaultdict(lambda: [0.0, 0.0, 0, 0])
    for (draft_id, base_loss, base_brier, base_hit), (other_id, loss, brier, hit) in zip(baseline, candidate):
        if draft_id != other_id:
            raise ValueError('Arms must score identical decisions')
        cell = by_draft[draft_id]
        cell[0] += loss - base_loss
        cell[1] += brier - base_brier
        cell[2] += hit - base_hit
        cell[3] += 1
    return {draft_id: [round(a, 10), round(b, 10), c, n] for draft_id, (a, b, c, n) in by_draft.items()}


def assess(cache, games, split, draws):
    train_ids = cache.split_drafts('train')
    models, coverage, training_picks = build_models(cache, games, train_ids)
    held_ids = cache.split_drafts(split)
    examples = served(cache, load_examples(cache, held_ids))
    if not examples:
        raise ValueError(f'{cache.set_id}: no served decisions in the {split} split')
    rows = {m: score(models[m], examples) for m in models}
    calibration = served(cache, load_examples(
        cache, [d for d in cache.split_drafts('validation') if validation_role(d) == 'calibration']))
    report = {
        'set': cache.set_id, 'split': split, 'served_definition': f'pack 1, picks 1-{SERVED_MAX_PICK}',
        'train_drafts': len(train_ids), 'training_picks': training_picks, 'held_out_drafts': len(held_ids),
        'arms': {m: {'served_slice': summary(rows[m][0]), 'colour_coverage': coverage[m],
                     'validation_calibration': temperature_losses(models[m], calibration)}
                 for m in models},
        'v6_minus_v5': {**paired_bootstrap(rows[V5_MODEL][0], rows[V6_MODEL][0], draws),
                        **award_shift(rows[V5_MODEL][1], rows[V6_MODEL][1])},
    }
    return report, draft_deltas(rows[V5_MODEL][0], rows[V6_MODEL][0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True, help='eval_model.py extract output')
    parser.add_argument('--games', type=Path, required=True)
    parser.add_argument('--games-sha256', required=True)
    parser.add_argument('--draft-sha256', required=True, help='archive the cache was extracted from')
    parser.add_argument('--split', default='validation', choices=['validation', 'test'])
    parser.add_argument('--final-test', action='store_true')
    parser.add_argument('--bootstrap-draws', type=int, default=2000)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--draft-deltas', type=Path, required=True,
                        help='ignored local file of per-draft deltas for the pooled bootstrap')
    args = parser.parse_args()
    guard_test_split(args.split, args.final_test)
    if file_sha256(args.games) != args.games_sha256:
        parser.error('games checksum mismatch')
    cache = Cache.load(args.cache)
    report, deltas = assess(cache, args.games, args.split, args.bootstrap_draws)
    report['sources'] = {'cache': cache_identity(cache), 'draft_sha256': args.draft_sha256,
                         'games_sha256': args.games_sha256}
    for path in (args.output, args.draft_deltas):
        path.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    with gzip.open(args.draft_deltas, 'wt', encoding='utf-8') as handle:
        json.dump({'set': cache.set_id, 'split': args.split, 'drafts': deltas}, handle)
    print(f'Wrote {cache.set_id} v6 assessment.')


if __name__ == '__main__':
    main()
