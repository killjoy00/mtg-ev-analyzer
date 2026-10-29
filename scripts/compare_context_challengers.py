#!/usr/bin/env python3
"""Offline comparison of color-context representations; not a release gate.

Holds the v5 arithmetic, card counts and pair expectations fixed, refits only
the color table on the harness train split for each frozen representation,
and scores the served slice of a held-out split. Pick prediction is the
secondary check in research/PARTIAL-CREDIT-CONTEXT.md: it cannot show that a
challenger grades decisions better. Preregistration and results:
research/CONTEXT-CHALLENGERS.md.
"""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

from audit_context_representation import scan_deck_colours
from build_replays import normalize_probabilities
from deck_fit import (COLOURS, MISSING, card_colours, colour_hits_for_drafts, estimate,
                      observe_examples, scan_decks)
from eval_model import (VARIANTS, Cache, VariantModel, award, cache_identity, file_sha256,
                        guard_test_split, load_examples, pair_expectations, paired_bootstrap,
                        pick_metrics, train_counts)
from rules_mana_context import card_mana_context

CHALLENGERS = ('v5', 'splash', 'explicit', 'explicit-fixing')
SERVED_MAX_PICK = 11
BACKBONE = 'v3-colour-and-pair'


def explicit_colours(names, inferred, metadata, fixing=False):
    """Printed cast colors where metadata is complete, inferred affinity otherwise.

    Lands are flexible, or with fixing take the colors of the mana they make.
    Unknown metadata, and a land with unknown produced mana, keep the inferred
    value rather than being guessed colorless.
    """
    result = dict(inferred)
    for name in names:
        context = card_mana_context(metadata.get(name))
        if context['status'] != 'known':
            continue
        if not context['land']:
            result[name] = frozenset(context['cast']['colors'])
        elif not fixing:
            result[name] = frozenset()
        elif context['produced_mana'] is not None:
            result[name] = frozenset(c for c in context['produced_mana'] if c in COLOURS)
    return result


def challenger_colours(names, played, main_by_draft, both_by_draft, train_ids, metadata):
    inferred = card_colours(colour_hits_for_drafts(played, main_by_draft, train_ids))
    return {
        'v5': inferred,
        'splash': card_colours(colour_hits_for_drafts(played, both_by_draft, train_ids)),
        'explicit': explicit_colours(names, inferred, metadata),
        'explicit-fixing': explicit_colours(names, inferred, metadata, fixing=True),
    }


def served(cache, examples):
    pack, pick = cache.meta['pack_offset'], cache.meta['pick_offset']
    return [x for x in examples
            if x.raw_pack_number + pack == 1 and x.raw_pick_number + pick <= SERVED_MAX_PICK]


def score(model, examples):
    rows, supports = [], []
    for x in examples:
        raw = {card: model.card_tendency(card, x.raw_pack_number, x.raw_pick_number, x.pool)
               for card in x.candidates}
        normalized = normalize_probabilities(raw)
        probabilities = [normalized[card] for card in x.candidates]
        loss, brier, hit, _ = pick_metrics(probabilities, x.candidates.index(x.historical_pick))
        rows.append((x.draft_id, loss, brier, 1 if hit else 0))
        supports.append(probabilities)
    return rows, supports


def summary(rows):
    n = len(rows)
    return {'decisions': n, 'log_loss': round(sum(r[1] for r in rows) / n, 5),
            'brier': round(sum(r[2] for r in rows) / n, 5),
            'top1': round(sum(r[3] for r in rows) / n, 5)}


def award_shift(baseline, candidate):
    """How a challenger moves model-only points on the same packs."""
    leaders = moved = total = 0
    for base, other in zip(baseline, candidate):
        leaders += base.index(max(base)) != other.index(max(other))
        for i in range(len(base)):
            moved += abs(award(other, i) - award(base, i))
            total += 1
    return {'leader_change_rate': round(leaders / len(baseline), 5),
            'mean_abs_award_change': round(moved / total, 4)}


def compare(cache, games, metadata, split, draws):
    train_ids = cache.split_drafts('train')
    held_ids = cache.split_drafts(split)
    keep = set(train_ids)
    counts, training_picks = train_counts(cache, train_ids)
    expectations = pair_expectations(cache, train_ids, counts)
    played, colour_hits = scan_decks(games, keep)
    scanned, main_by_draft, both_by_draft, games_seen = scan_deck_colours(games, keep)
    colours = challenger_colours(cache.names, scanned, main_by_draft, both_by_draft, keep, metadata)
    if colours['v5'] != card_colours(colour_hits) or scanned != played:
        raise ValueError('Deck color scan no longer reproduces the harness color table')
    pairs = [(d, x) for d, x in cache.examples() if d in keep]
    examples = served(cache, load_examples(cache, held_ids))
    if not examples:
        raise ValueError(f'{cache.set_id}: no served decisions in the {split} split')
    results, baseline = {}, None
    for name in CHALLENGERS:
        by_bucket, by_card, by_stage = observe_examples(pairs, played, colours[name])
        fit = estimate(by_bucket, by_card, colours[name], by_stage)
        model = VariantModel(counts, VARIANTS[BACKBONE], expectations, fit)
        rows, supports = score(model, examples)
        results[name] = {
            'served_slice': summary(rows),
            'cards_with_colour_judgment': sum(colours[name].get(card, MISSING) not in (MISSING, None)
                                              for card in fit['cards']),
            'fit_cards': len(fit['cards']),
        }
        if baseline is None:
            baseline = rows, supports
        else:
            results[name]['vs_v5'] = {**paired_bootstrap(baseline[0], rows, draws),
                                      **award_shift(baseline[1], supports)}
    return {'set': cache.set_id, 'split': split, 'backbone': BACKBONE, 'training_cap': None,
            'served_definition': f'pack 1, picks 1-{SERVED_MAX_PICK}',
            'train_drafts': len(train_ids), 'training_picks': training_picks,
            'held_out_drafts': len(held_ids), 'train_games': games_seen, 'challengers': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True, help='eval_model.py extract output')
    parser.add_argument('--games', type=Path, required=True)
    parser.add_argument('--games-sha256', required=True)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--metadata-sha256', required=True)
    parser.add_argument('--split', default='validation', choices=['validation', 'test'])
    parser.add_argument('--final-test', action='store_true')
    parser.add_argument('--bootstrap-draws', type=int, default=2000)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    guard_test_split(args.split, args.final_test)
    for name in ('games', 'metadata'):
        if file_sha256(getattr(args, name)) != getattr(args, name + '_sha256'):
            parser.error(f'{name} checksum mismatch')
    cache = Cache.load(args.cache)
    with gzip.open(args.metadata, 'rt', encoding='utf-8') as handle:
        metadata = json.load(handle)
    report = compare(cache, args.games, metadata, args.split, args.bootstrap_draws)
    report['sources'] = {'cache': cache_identity(cache), 'games_sha256': args.games_sha256,
                         'metadata_sha256': args.metadata_sha256}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Wrote {cache.set_id} challenger comparison.')


if __name__ == '__main__':
    main()
