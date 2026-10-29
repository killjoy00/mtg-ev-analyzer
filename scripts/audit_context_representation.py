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
from deck_fit import (COLOURS, MISSING, card_colours, colour_hits_for_drafts, colour_mark,
                      count_of, parse_colour_mark)
from import_all_trophies import collect_isolated, digest, scan_metadata
from rules_mana_context import card_mana_context


def affinity_counts(cards, metadata, union=None):
    """Compare explicit mana metadata with one table of inferred affinities."""
    counts = Counter(fit_cards=len(cards), known_simple_colored_spells=0,
                     unsupported_or_missing_metadata=0, unknown_affinity=0,
                     required_color_omitted=0, colored_spell_flexible_affinity=0,
                     colored_spell_partial_affinity=0, lands_with_colored_affinity=0,
                     fixing_lands=0, fixing_land_unknown_affinity=0,
                     fixing_land_flexible_affinity=0, fixing_land_partial_affinity=0)
    for name, row in cards.items():
        context = card_mana_context(metadata.get(name))
        if context['status'] != 'known':
            counts['unsupported_or_missing_metadata'] += 1
            continue
        affinity = parse_colour_mark(row.get('colours'))
        if context['land']:
            counts['lands_with_colored_affinity'] += bool(affinity)
            # A land producing two or more colors is fixing. Flexible affinity
            # hides it from colored spells; a single inferred color hides the rest.
            produced = {c for c in context['produced_mana'] or [] if c in COLOURS}
            if len(produced) < 2:
                continue
            counts['fixing_lands'] += 1
            if affinity is None:
                counts['fixing_land_unknown_affinity'] += 1
            elif not affinity:
                counts['fixing_land_flexible_affinity'] += 1
            elif produced - affinity:
                counts['fixing_land_partial_affinity'] += 1
            continue
        cast = context.get('cast')
        if not cast or not cast['colors']:
            continue
        counts['known_simple_colored_spells'] += 1
        if affinity is None:
            counts['unknown_affinity'] += 1
            continue
        if set(cast['colors']) - affinity:
            if union is not None:
                union.add(name)
            counts['required_color_omitted'] += 1
            counts['colored_spell_partial_affinity' if affinity
                   else 'colored_spell_flexible_affinity'] += 1
    return counts


def audit_fits(fits, metadata):
    folds, union = [], set()
    for fit in fits:
        counts = affinity_counts(fit['cards'], metadata, union)
        # Only cells consumed by the pooled production color feature count.
        counts['zero_stage_cells'] = sum(
            rate == 0 for cell in fit.get('by_stage', {}).values() for rate in cell.values())
        counts['zero_marginal_cells'] = sum(
            rate == 0 for rate in fit.get('by_commitment', {}).values())
        counts['zero_reference_rate'] = fit.get('play_rate') == 0
        folds.append({'holdout_fold': fit['holdout_fold'], **dict(counts)})
    return {'folds': folds, 'distinct_cards_with_required_color_omitted': len(union)}


def scan_deck_colours(game_archive, keep):
    """Played names, modal main and main-plus-splash colors per draft, and
    game counts. Mirrors deck_fit.scan_deck_observations, which reads only
    main_colors.
    """
    played, main, both = defaultdict(set), defaultdict(Counter), defaultdict(Counter)
    games = Counter(games=0, games_with_splash=0)
    with open_text(game_archive) as handle:
        reader = csv.reader(handle)
        header = next(reader)
        index = {name: i for i, name in enumerate(header)}
        for required in ('draft_id', 'main_colors', 'splash_colors'):
            if required not in index:
                raise ValueError(f'Game archive has no {required} column')
        deck_columns = [(i, name[5:]) for i, name in enumerate(header) if name.startswith('deck_')]
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[index['draft_id']].strip()
            if not did or did not in keep:
                continue
            core = ''.join(c for c in values[index['main_colors']].strip().upper() if c in COLOURS)
            splash = values[index['splash_colors']].strip().upper()
            games['games'] += 1
            games['games_with_splash'] += any(c in splash for c in COLOURS)
            main[did][core] += 1
            both[did][''.join(c for c in COLOURS if c in core or c in splash)] += 1
            for i, name in deck_columns:
                if count_of(values[i]):
                    played[did].add(name)
    modal = lambda by: {did: counter.most_common(1)[0][0] for did, counter in by.items()}
    return dict(played), modal(main), modal(both), dict(games)


def audit_splash_sensitivity(fits, fold_ids, played, main_by_draft, both_by_draft, metadata):
    """Recount the same fit cards with splash colors counted as deck colors.

    A diagnosis of why printed colors go missing, not a proposed feature: it
    also gives basic and fixing lands the colors of the decks that play them.
    """
    folds, union = [], set()
    for fit, contributing in zip(fits, fold_ids):
        main = card_colours(colour_hits_for_drafts(played, main_by_draft, contributing))
        reproduced = {name: colour_mark(main.get(name, MISSING)) for name in fit['cards']}
        if reproduced != {name: row['colours'] for name, row in fit['cards'].items()}:
            raise ValueError('Deck color scan no longer reproduces the production fit')
        both = card_colours(colour_hits_for_drafts(played, both_by_draft, contributing))
        cards = {name: {'colours': colour_mark(both.get(name, MISSING))} for name in fit['cards']}
        folds.append({'holdout_fold': fit['holdout_fold'], **affinity_counts(cards, metadata, union)})
    return {'definition': 'Same folds and cards; deck colors are main plus splash colors.',
            'folds': folds, 'distinct_cards_with_required_color_omitted': len(union)}


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
    example_ids = {did for did, _ in examples}
    fold_ids = [example_ids & set(fold.training_ids) for fold in folds]
    played, main_by_draft, both_by_draft, games = scan_deck_colours(args.game, set().union(*fold_ids))
    report = {'set': args.set, 'source_sha256': hashes,
              'qualified_training_drafts': len(training), 'cohort_cutoff': cutoff,
              'training_pick_rows': len(examples), 'affinity': audit_fits(fits, metadata),
              'splash_sensitivity': {**games, **audit_splash_sensitivity(
                  fits, fold_ids, played, main_by_draft, both_by_draft, metadata)},
              'copy_labels': audit_copy_labels(args.game, examples),
              'interpretation': 'Feature and label coverage, not recommendation errors or causal pick value.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print('Wrote aggregate context audit.')


if __name__ == '__main__':
    main()
