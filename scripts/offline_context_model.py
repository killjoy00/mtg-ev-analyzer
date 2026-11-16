#!/usr/bin/env python3
"""Research-only contextual reranker of frozen Pack One candidate probabilities.

Only the ranking *inside* a castability/commitment group may change. The
baseline probability mass for lands, unknown cards and each number of unseen
required colors is preserved. This protects legitimate pivots from a blanket
out-of-color penalty. Scores are behavioral likelihoods, not card win values.

The input is an existing, immutable replay/corpus file. No database, website,
scoring or published result is changed.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import statistics

try:
    from rules_mana_context import card_mana_context
except ModuleNotFoundError:
    from scripts.rules_mana_context import card_mana_context

COLORS = 'WUBRG'
LAND_SUBTYPES = {'Plains': 'W', 'Island': 'U', 'Swamp': 'B',
                 'Mountain': 'R', 'Forest': 'G'}
FEATURES = ('prior_color_overlap', 'known_land_fixing')


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def read_json_or_jsonl(path):
    opener = gzip.open if str(path).endswith('.gz') else open
    with opener(path, 'rt', encoding='utf-8') as handle:
        first = handle.read(1)
        handle.seek(0)
        if first == '[' or first == '{':
            try:
                result = json.load(handle)
            except json.JSONDecodeError:
                handle.seek(0)
            else:
                if isinstance(result, list):
                    yield from result
                    return
                if isinstance(result, dict) and isinstance(result.get('puzzles'), list):
                    yield from result['puzzles']
                    return
                if isinstance(result, dict) and result.get('candidates'):
                    yield result
                    return
                raise ValueError('Expected a replay or a list of replay decisions')
        for line in handle:
            if line.strip():
                yield json.loads(line)


def source_fold(source_hash):
    """All decisions from one source draft must stay on the same partition."""
    if not isinstance(source_hash, str) or not source_hash:
        raise ValueError('Source draft identity is required for source-separated evaluation')
    bucket = hashlib.md5(source_hash.encode('utf-8')).hexdigest()[0]
    return 'train' if bucket < '9' else ('validation' if bucket < 'c' else 'assessment')


def metadata_view(card, metadata, display_preview=False):
    """Never promote stripped display metadata into verified card rules silently."""
    name = card.get('name') if isinstance(card, dict) else None
    if not name:
        return None
    canonical = metadata.get(name)
    if canonical is not None:
        return canonical
    if not display_preview or card.get('display_faces') or card.get('card_faces'):
        return None
    if not card.get('type_line'):
        return None
    # Preview mode is explicitly *not* Scryfall-certified. All results from it
    # are diagnostic and may not be used to promote a production model.
    return {**card, 'layout': 'normal'}


def typed_land_colors(context, raw_card):
    """Unconditional mana from basic land subtypes only; never guess fetch mana."""
    if context.get('status') != 'known' or not context.get('land'):
        return set()
    type_line = raw_card.get('type_line', '')
    if not isinstance(type_line, str) or '—' not in type_line:
        return set()
    before, after = type_line.split('—', 1)
    if 'Land' not in before.split():
        return set()
    types = set(after.strip().split())
    return {color for subtype, color in LAND_SUBTYPES.items() if subtype in types}


def pool_state(prior_cards, metadata, display_preview):
    demand = Counter()
    direct_mana = Counter()
    unknown = 0
    for card in prior_cards:
        view = metadata_view(card, metadata, display_preview)
        context = card_mana_context(view)
        if context['status'] != 'known':
            unknown += 1
            continue
        if context['land']:
            direct_mana.update(typed_land_colors(context, view))
        elif context['cast']:
            # Count *cards*, not pips; double pips remain in the canonical
            # context for a later separate experiment, not guessed castability.
            demand.update(context['cast']['colors'])
    return demand, direct_mana, unknown


def candidate_features(candidate, prior_cards, metadata, display_preview=False, state=None):
    demand, direct, unknown = state or pool_state(prior_cards, metadata, display_preview)
    view = metadata_view(candidate, metadata, display_preview)
    context = card_mana_context(view)
    if context['status'] != 'known':
        return ('unknown', (0.0, 0.0))
    if context['land']:
        produced = typed_land_colors(context, view)
        # A typed land's usefulness for unmet pre-pick color demand is a proxy,
        # not a claim about ETB costs, available fetch targets or win value.
        coverage = sum(bool(demand[color]) and not direct[color] for color in produced)
        return ('land', (0.0, float(min(2, coverage))))
    colors = context['cast']['colors']
    missing = sum(not demand[color] and not direct[color] for color in colors)
    overlap = sum(demand[color] for color in colors) / max(1, len(prior_cards))
    return (f'spell:new{missing}', (float(overlap), 0.0))


def prepare_case(puzzle, metadata, display_preview=False):
    src = puzzle.get('source_draft_hash')
    fold = source_fold(src)
    candidates = puzzle.get('candidates')
    prior = puzzle.get('prior_picks')
    picked = puzzle.get('historical_pick_id')
    if not isinstance(prior, list) or not isinstance(candidates, list) or len(candidates) < 2:
        raise ValueError('Missing prior picks or candidate pack')
    if not isinstance(picked, str) or not picked:
        raise ValueError('Missing historical pick')
    ids = [card.get('id') for card in candidates]
    if any(not isinstance(cid, str) or not cid for cid in ids) or len(set(ids)) != len(ids):
        raise ValueError('Missing or duplicate candidate identities')
    if ids.count(picked) != 1:
        raise ValueError('Historical pick is absent from candidates')
    try:
        probs = [float(card['model_probability']) for card in candidates]
    except (KeyError, ValueError, TypeError) as exc:
        raise ValueError('Missing or nonnumeric frozen model probabilities') from exc
    total = sum(probs)
    if not all(math.isfinite(p) and p > 0 for p in probs) or not (0.99 <= total <= 1.01):
        raise ValueError('Frozen probability distribution is incomplete')
    probs = [p / total for p in probs]
    state = pool_state(prior, metadata, display_preview)
    groups, features = zip(*(candidate_features(card, prior, metadata, display_preview, state)
                              for card in candidates))
    return {'src': src, 'fold': fold, 'pick_number': puzzle.get('pick_number'),
            'probs': tuple(probs), 'groups': groups, 'features': features,
            'chosen': ids.index(picked)}


def rerank(case, weights):
    """Exact within-group normalization preserves every group's original mass."""
    probs, groups, feature_rows = case['probs'], case['groups'], case['features']
    by_group = defaultdict(list)
    for i, group in enumerate(groups):
        by_group[group].append(i)
    result = [0.0] * len(probs)
    for positions in by_group.values():
        old_mass = sum(probs[i] for i in positions)
        logits = [math.log(probs[i]) + sum(w*x for w, x in zip(weights, feature_rows[i]))
                  for i in positions]
        center = max(logits)
        weights_in_group = [math.exp(logit - center) for logit in logits]
        denom = sum(weights_in_group)
        for i, share in zip(positions, weights_in_group):
            result[i] = old_mass * share / denom
    assert math.isclose(sum(result), 1.0, abs_tol=1e-9)
    return result


def train(cases, ridge=0.018, learning_rate=0.65, iterations=280):
    """Regularized conditional log likelihood, trained on source-disjoint drafts.

    The choice of *group* is treated as already priced by the frozen baseline.
    Therefore training only learns how choices are ordered INSIDE that group.
    No target/assessment picks enter the gradient.
    """
    fitted = [case for case in cases if case['fold'] == 'train']
    if not fitted:
        raise ValueError('No fitting decisions in source-separated train fold')
    theta = [0.0, 0.0]
    for _ in range(iterations):
        gradient = [ridge * x for x in theta]
        for case in fitted:
            chosen = case['chosen']
            indices = [i for i, group in enumerate(case['groups'])
                       if group == case['groups'][chosen]]
            if len(indices) < 2:
                continue
            adjusted = rerank(case, theta)
            group_mass = sum(adjusted[i] for i in indices)
            for j in range(2):
                expected = sum(adjusted[i] * case['features'][i][j] for i in indices) / group_mass
                gradient[j] += (expected - case['features'][chosen][j]) / len(fitted)
        theta = [theta[i] - learning_rate * gradient[i] for i in range(2)]
    return tuple(theta)


def evaluate(cases, weights):
    result = {}
    for fold in ('train', 'validation', 'assessment'):
        subset = [case for case in cases if case['fold'] == fold]
        if not subset:
            continue
        baseline_loss, new_loss, base_top, new_top = [], [], [], []
        pivot_before, pivot_after = [], []
        source_deltas = defaultdict(list)
        pivot_sources = set()
        max_mass_drift = 0.0
        for case in subset:
            old = case['probs']
            new = rerank(case, weights)
            chosen = case['chosen']
            l0, l1 = -math.log(old[chosen]), -math.log(new[chosen])
            baseline_loss.append(l0)
            new_loss.append(l1)
            base_top.append(int(max(range(len(old)), key=lambda i: old[i]) == chosen))
            new_top.append(int(max(range(len(new)), key=lambda i: new[i]) == chosen))
            source_deltas[case['src']].append(l1-l0)
            group = case['groups'][chosen]
            if group.startswith('spell:new') and group != 'spell:new0':
                pivot_before.append(l0)
                pivot_after.append(l1)
                pivot_sources.add(case['src'])
            for g in set(case['groups']):
                old_mass = sum(old[i] for i, item in enumerate(case['groups']) if item == g)
                new_mass = sum(new[i] for i, item in enumerate(case['groups']) if item == g)
                max_mass_drift = max(max_mass_drift, abs(old_mass-new_mass))
        draft_deltas = [statistics.fmean(v) for v in source_deltas.values()]
        mean_diff = statistics.fmean(draft_deltas)
        ci_half = (1.96 * statistics.stdev(draft_deltas) / math.sqrt(len(draft_deltas))
                   if len(draft_deltas) > 1 else None)
        result[fold] = {
            'decisions': len(subset), 'source_drafts': len(source_deltas),
            'baseline_log_loss': round(statistics.fmean(baseline_loss), 5),
            'context_log_loss': round(statistics.fmean(new_loss), 5),
            'baseline_top1': round(statistics.fmean(base_top), 5),
            'context_top1': round(statistics.fmean(new_top), 5),
            'source_cluster_mean_delta_log_loss': round(mean_diff, 5),
            'source_cluster_approx_ci95': None if ci_half is None else
                [round(mean_diff-ci_half, 5), round(mean_diff+ci_half, 5)],
            'new_color_trophy_choices': len(pivot_before),
            'new_color_baseline_log_loss': round(statistics.fmean(pivot_before), 5) if pivot_before else None,
            'new_color_context_log_loss': round(statistics.fmean(pivot_after), 5) if pivot_after else None,
            'new_color_source_drafts': len(pivot_sources),
            'max_absolute_group_mass_drift': round(max_mass_drift, 12),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, help='Immutable local replay JSON, JSONL, or gzip')
    parser.add_argument('--input-sha256', help='Fail closed on an unexpected source snapshot')
    parser.add_argument('--metadata', type=Path, help='Canonical card metadata keyed by name, JSON or gzip')
    parser.add_argument('--metadata-sha256', help='Expected sha256 of canonical metadata')
    parser.add_argument('--display-preview', action='store_true',
                        help='Use unverified display mana for exploratory checks ONLY')
    parser.add_argument('--output', type=Path, required=True, help='Aggregate-only JSON report')
    args = parser.parse_args()
    if args.input_sha256 and sha256(args.input) != args.input_sha256:
        parser.error('Input corpus hash mismatch')
    if args.metadata and not args.metadata_sha256:
        parser.error('--metadata requires --metadata-sha256')
    if args.metadata and sha256(args.metadata) != args.metadata_sha256:
        parser.error('Canonical card metadata hash mismatch')
    if not args.metadata and not args.display_preview:
        parser.error('Pass pinned --metadata or explicit --display-preview')
    metadata = json.load(gzip.open(args.metadata, 'rt', encoding='utf-8')
                         if str(args.metadata).endswith('.gz') else
                         open(args.metadata, encoding='utf-8')) if args.metadata else {}
    cases, rejected = [], Counter()
    for puzzle in read_json_or_jsonl(args.input):
        try:
            cases.append(prepare_case(puzzle, metadata, args.display_preview))
        except ValueError as exc:
            rejected[str(exc)] += 1
    if not cases:
        raise SystemExit('No valid source-separated puzzles')
    weights = train(cases)
    report = {
        'status': 'research_only_nonpromotable' if args.display_preview else 'offline_metadata_backed',
        'source_sha256': sha256(args.input), 'metadata_sha256': sha256(args.metadata) if args.metadata else None,
        'correction': 'within-group anchored multinomial model',
        'features': FEATURES, 'ridge': 0.018, 'iterations': 280,
        'learned_weights': {feature: round(w, 6) for feature, w in zip(FEATURES, weights)},
        'partitions': evaluate(cases, weights),
        'excluded_puzzles_by_reason': dict(sorted(rejected.items())),
        'limitations': ['Predicts observed trophy selections, not counterfactual wins or grading fairness.',
                        'Basic land subtypes prove colors only; fetch/activation/fixing modes may be unknown.',
                        'Splits are source-separated, but historical data may have informed model design.',
                        'No player vote data, player identity, individual decisions or raw telemetry in output.'],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(f"Offline only: {len(cases)} decisions; weights {report['learned_weights']}; wrote aggregate report")


if __name__ == '__main__':
    main()
