#!/usr/bin/env python3
"""Offline, aggregate-only audit of v5 context features, not an error-rate test.

Rebuilds all five training complements from checksum-pinned public archives.
Never reads player feedback or writes served puzzles. Detailed per-draft data
stays in memory; the result contains only counts and source hashes.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path

from build_replays import DraftSkill, build_colour_tables_by_fold, open_text, select_strong_drafts
from deck_fit import count_of, parse_colour_mark
from import_all_trophies import collect_isolated, digest, scan_metadata
from rules_mana_context import card_mana_context


def audit_fits(fits, metadata):
    folds, union = [], set()
    for fit in fits:
        counts = Counter(fit_cards=len(fit['cards']), known_simple_colored_spells=0,
                         unsupported_or_missing_metadata=0, unknown_affinity=0,
                         required_color_omitted=0, colored_spell_flexible_affinity=0,
                         colored_spell_partial_affinity=0, zero_stage_cells=0,
                         zero_marginal_cells=0)
        for name, row in fit['cards'].items():
            context = card_mana_context(metadata.get(name))
            if context['status'] != 'known':
                counts['unsupported_or_missing_metadata'] += 1
                continue
            cast = context.get('cast')
            if not cast or not cast['colors']:
                continue
            counts['known_simple_colored_spells'] += 1
            affinity = parse_colour_mark(row.get('colours'))
            if affinity is None:
                counts['unknown_affinity'] += 1
                continue
            if set(cast['colors']) - affinity:
                union.add(name)
                counts['required_color_omitted'] += 1
                counts['colored_spell_partial_affinity' if affinity
                       else 'colored_spell_flexible_affinity'] += 1
        # Only cells consumed by the pooled production color feature count.
        counts['zero_stage_cells'] = sum(
            rate == 0 for cell in fit.get('by_stage', {}).values() for rate in cell.values())
        counts['zero_marginal_cells'] = sum(
            rate == 0 for rate in fit.get('by_commitment', {}).values())
        counts['zero_reference_rate'] = fit.get('play_rate') == 0
        folds.append({'holdout_fold': fit['holdout_fold'], **dict(counts)})
    return {'folds': folds, 'distinct_cards_with_required_color_omitted': len(union)}


def summarize_copy_observations(drafted, maximum_deck_counts):
    """Name-level deck inclusion cannot identify which drafted copy was used.

    Maximum observed deck count is conservative across deck edits. It is still
    only observed games, not proof that an extra copy was never used or useful.
    """
    result = Counter(drafts_with_game_observations=len(maximum_deck_counts),
                     repeated_card_draft_groups=0, repeated_groups_ever_played=0,
                     groups_with_fewer_observed_deck_copies=0,
                     picks_in_those_groups=0, copies_above_maximum_observed_deck_count=0)
    for did, deck in maximum_deck_counts.items():
        for name, count in drafted.get(did, {}).items():
            if count < 2:
                continue
            result['repeated_card_draft_groups'] += 1
            played = deck.get(name, 0)
            if played:
                result['repeated_groups_ever_played'] += 1
            if 0 < played < count:
                result['groups_with_fewer_observed_deck_copies'] += 1
                result['picks_in_those_groups'] += count
                result['copies_above_maximum_observed_deck_count'] += count - played
    return dict(result)


def audit_copy_labels(game_archive, examples):
    drafted = defaultdict(Counter)
    for did, example in examples:
        drafted[did][example.historical_pick] += 1
    maximum = {}
    with open_text(game_archive) as handle:
        reader = csv.reader(handle)
        header = next(reader)
        did_at = header.index('draft_id')
        deck_columns = [(i, name[5:]) for i, name in enumerate(header) if name.startswith('deck_')]
        if not deck_columns:
            raise ValueError('Game archive has no deck columns')
        for values in reader:
            if len(values) != len(header) or values[did_at].strip() not in drafted:
                continue
            deck = maximum.setdefault(values[did_at].strip(), Counter())
            for i, name in deck_columns:
                count = count_of(values[i])
                if count > deck[name]:
                    deck[name] = count
    return summarize_copy_observations(drafted, maximum)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--set', required=True)
    for name in ('draft', 'game', 'metadata'):
        parser.add_argument(f'--{name}', type=Path, required=True)
        parser.add_argument(f'--{name}-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    hashes = {}
    for name in ('draft', 'game', 'metadata'):
        hashes[name] = digest(getattr(args, name))
        if hashes[name] != getattr(args, name + '_sha256'):
            parser.error(f'{name} checksum mismatch')
    with open_text(args.metadata) as handle:
        metadata = json.load(handle)
    drafts, header, _, conflicts = scan_metadata(args.draft)
    skills = {did: DraftSkill(v['rate'], v['games']) for did, v in drafts.items()
              if did not in conflicts and v['rate'] is not None and v['games'] is not None}
    training, cutoff, _ = select_strong_drafts(skills, 100, .15, None)
    folds, _, _, _, examples = collect_isolated(args.draft, set(training), set(), header)
    fits = build_colour_tables_by_fold(args.game, examples, folds, args.set)
    report = {'set': args.set, 'source_sha256': hashes,
              'qualified_training_drafts': len(training), 'cohort_cutoff': cutoff,
              'training_pick_rows': len(examples), 'affinity': audit_fits(fits, metadata),
              'copy_labels': audit_copy_labels(args.game, examples),
              'interpretation': 'Feature and label coverage, not recommendation errors or causal pick value.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('Wrote aggregate context audit.')


if __name__ == '__main__':
    main()
