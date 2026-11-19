#!/usr/bin/env python3
"""Frozen, offline three-model benchmark. No application or database writes.

Requires numpy, scipy, pandas, scikit-learn. See research/CARD-STRENGTH-V1.md.
Raw/row-level files must stay outside public results. Model fitting only uses
17Lands game archives; there is no Pack One telemetry input or serving import.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import warnings
import zipfile

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.special import logit
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROTOCOL = ROOT / 'research/card-strength-v1.json'
BASICS = {'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
          'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
          'Snow-Covered Mountain', 'Snow-Covered Forest'}
MODELS = ('A_gih', 'B_iwd', 'C_adjusted')
BASE = 'https://17lands-public.s3.amazonaws.com/analysis_data/game_data/'
META = ('draft_id', 'game_time', 'match_number', 'game_number', 'build_index',
        'rank', 'main_colors', 'on_play', 'num_mulligans', 'won',
        'user_game_win_rate_bucket')


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def write_npz(path, writer):
    """Serialize in memory, then atomically replace a complete, checked archive.

    Some mounted workspaces do not reliably preserve repeated seek/write calls
    to a long-lived file. A single write also prevents reuse of partial caches.
    """
    buffer = io.BytesIO()
    writer(buffer)
    with zipfile.ZipFile(buffer) as archive:
        if archive.testzip() is not None:
            raise ValueError('Invalid serialized array archive')
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    temporary.write_bytes(buffer.getvalue())
    temporary.replace(path)


def cache_valid(prefix, expected=None):
    for label in ('deck', 'hand', 'opening', 'rows'):
        path = Path(str(prefix) + f'-{label}.npz')
        try:
            if expected and sha256(path) != expected[label]:
                return False
            with zipfile.ZipFile(path) as archive:
                if archive.testzip() is not None:
                    return False
        except (OSError, zipfile.BadZipFile, KeyError):
            return False
    return True


def download(protocol, raw):
    raw.mkdir(parents=True, exist_ok=True)
    manifest_path = raw / 'sources.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest = {}
    for sid in protocol['sets']:
        path = raw / f'{sid}.csv.gz'
        url = BASE + f'game_data_public.{sid}.{protocol["event_type"]}.csv.gz'
        if path.exists():
            record = previous.get(sid)
            if not record or record['url'] != url or sha256(path) != record['sha256']:
                raise ValueError(f'{sid}: existing archive has no matching frozen provenance')
        else:
            request = urllib.request.Request(url, headers={'User-Agent': 'PackOne-CardStrengthResearch/1'})
            tmp = path.with_suffix('.download')
            with urllib.request.urlopen(request, timeout=120) as response, tmp.open('wb') as out:
                expected = response.headers.get('Content-Length')
                while block := response.read(1024 * 1024):
                    out.write(block)
                record = {'url': url, 'last_modified': response.headers.get('Last-Modified'),
                          'etag': response.headers.get('ETag')}
            if expected and tmp.stat().st_size != int(expected):
                raise ValueError(f'{sid}: incomplete download')
            tmp.replace(path)
            record.update(sha256=sha256(path), bytes=path.stat().st_size)
        manifest[sid] = record
        # A stopped run may resume, but may not silently replace source bytes.
        write_json(manifest_path, {**previous, **manifest})
        print(f'{sid}: source frozen ({record["bytes"]:,} bytes)', flush=True)
    return manifest


def parse_bool(series):
    text = series.astype(str).str.strip().str.lower()
    valid = text.isin(['true', 'false', '1', '0'])
    return text.isin(['true', '1']).to_numpy(), valid.to_numpy()


def controls(frame, deck_size):
    # Exported skill buckets are controls, not event wins or future deck results.
    skill = pd.to_numeric(frame['user_game_win_rate_bucket'], errors='coerce').to_numpy(float)
    known = np.isfinite(skill) & (skill >= 0) & (skill <= 1)
    skill = np.where(known, skill, .55)
    rank = frame['rank'].fillna('').astype(str).str.lower()
    colours = frame['main_colors'].fillna('').astype(str).str.upper()
    play, play_valid = parse_bool(frame['on_play'])
    mull = pd.to_numeric(frame['num_mulligans'], errors='coerce').to_numpy(float)
    mull_known = np.isfinite(mull) & (mull >= 0) & (mull <= 7)
    values = [(skill - .55) / .1, ~known, play, ~play_valid,
              np.where(mull_known, mull, 0), ~mull_known, (deck_size - 40) / 10]
    values += [(rank == r).to_numpy() for r in ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'mythic']]
    values += [colours.str.contains(c, regex=False).to_numpy() for c in 'WUBRG']
    return np.column_stack(values).astype(np.float64)


def prepare_one(sid, path, cache, source):
    if sha256(path) != source['sha256']:
        raise ValueError(f'{sid}: raw archive differs from frozen source hash')
    prefix = cache / sid
    manifest_path = cache / f'{sid}.json'
    if manifest_path.exists():
        info = json.loads(manifest_path.read_text())
        if info['source_sha256'] != source['sha256'] or info.get('cache_schema') != 1:
            raise ValueError('Prepared cache does not match source')
        if cache_valid(prefix, info.get('array_sha256')):
            return info
        print(f'{sid}: incomplete/corrupt prepared cache; rebuilding from frozen source', flush=True)
    header = pd.read_csv(path, nrows=0).columns.tolist()
    required = {'draft_id', 'game_time', 'won', 'on_play', 'num_mulligans'}
    if not required.issubset(header):
        raise ValueError(f'{sid}: missing required fields {required - set(header)}')
    all_names = [c[5:] for c in header if c.startswith('deck_')]
    if not all_names:
        raise ValueError('No deck columns')
    names = [n for n in all_names if n not in BASICS]
    groups = ('deck_', 'opening_hand_', 'drawn_', 'tutored_')
    for group in groups[:3]:
        if any(group + n not in header for n in all_names):
            raise ValueError(f'{sid}: incomplete {group} schema')
    card_cols = [group + name for group in groups for name in all_names if group + name in header]
    columns = [m for m in META if m in header] + card_cols
    dtype = {c: ('float32' if c in card_cols else str) for c in columns}
    keep_indices = [all_names.index(n) for n in names]
    decks, hands, opening, xs, ys, ids, times, game_keys = [], [], [], [], [], [], [], []
    raw_rows = invalid_rows = 0
    for frame in pd.read_csv(path, usecols=columns, dtype=dtype, chunksize=12000):
        raw_rows += len(frame)
        for m in META:
            if m not in frame:
                frame[m] = ''
        matrices = []
        invalid = np.zeros(len(frame), dtype=bool)
        for group in groups:
            cols = [group + n for n in all_names]
            matrix = frame.reindex(columns=cols, fill_value=0).fillna(0).to_numpy(float)
            invalid |= (~np.isfinite(matrix) | (matrix < 0) | (matrix != np.floor(matrix)) | (matrix > 255)).any(axis=1)
            matrices.append(np.nan_to_num(matrix).clip(0, 255).astype(np.uint8))
        deck, oh, drawn, tutored = matrices
        seen = (oh.astype(int) + drawn.astype(int) + tutored.astype(int)) > 0
        invalid |= ((seen & (deck == 0)).any(axis=1) | (oh > deck).any(axis=1))
        size = deck.sum(axis=1)
        invalid |= (size < 40) | (size > 100) | (oh.sum(axis=1) > 7)
        y, y_valid = parse_bool(frame['won'])
        timestamp = pd.to_datetime(frame['game_time'], errors='coerce', utc=True)
        valid = ~invalid & y_valid & timestamp.notna().to_numpy() & frame['draft_id'].notna().to_numpy()
        valid &= frame['draft_id'].fillna('').str.len().to_numpy() > 0
        invalid_rows += int((~valid).sum())
        decks.append(sparse.csr_matrix(deck[valid][:, keep_indices], dtype=np.float64))
        hands.append(sparse.csr_matrix(seen[valid][:, keep_indices], dtype=np.float64))
        opening.append(sparse.csr_matrix(oh[valid][:, keep_indices], dtype=np.float64))
        xs.append(controls(frame, size)[valid])
        ys.append(y[valid].astype(float))
        ids.extend(frame.loc[valid, 'draft_id'].astype(str))
        times.append(timestamp.astype('int64').to_numpy()[valid])
        keys = frame[['draft_id', 'game_time', 'build_index', 'match_number', 'game_number']].fillna('').astype(str).agg('|'.join, axis=1)
        game_keys.extend(keys[valid])
    # Ambiguous duplicate game identities: exclude all copies, not an arbitrary winner.
    unique = ~pd.Series(game_keys).duplicated(keep=False).to_numpy()
    ids = np.asarray(ids)[unique]
    draft_names, draft = np.unique(ids, return_inverse=True)
    arrays = {'x': np.concatenate(xs)[unique], 'y': np.concatenate(ys)[unique],
              'draft': draft, 'time': np.concatenate(times)[unique]}
    cache.mkdir(parents=True, exist_ok=True)
    for label, chunks in [('deck', decks), ('hand', hands), ('opening', opening)]:
        matrix = sparse.vstack(chunks, format='csr')[unique]
        write_npz(str(prefix) + f'-{label}.npz', lambda buffer: sparse.save_npz(buffer, matrix))
    write_npz(str(prefix) + '-rows.npz', lambda buffer: np.savez_compressed(buffer, **arrays))
    info = {'set': sid, 'cache_schema': 1, 'source_sha256': source['sha256'], 'raw_games': raw_rows,
            'invalid_games': invalid_rows, 'duplicate_games_excluded': int((~unique).sum()),
            'games': len(ids), 'drafts': len(draft_names), 'cards': names,
            'code_sha256': sha256(__file__),
            'array_sha256': {label: sha256(str(prefix) + f'-{label}.npz')
                             for label in ('deck', 'hand', 'opening', 'rows')}}
    write_json(manifest_path, info)
    print(f'{sid}: prepared {info["games"]:,} games / {info["drafts"]:,} drafts', flush=True)
    return info


def partitions(draft, times, protocol):
    n = int(draft.max()) + 1
    first = np.full(n, np.iinfo(np.int64).max, dtype=np.int64)
    last = np.zeros(n, dtype=np.int64)
    np.minimum.at(first, draft, times)
    np.maximum.at(last, draft, times)
    order = np.lexsort((np.arange(n), first))
    a = int(n * protocol['train_fraction'])
    b = int(n * (protocol['train_fraction'] + protocol['validation_fraction']))
    if a <= 0 or b >= n:
        raise ValueError('Insufficient drafts')
    val_start, test_start = first[order[a]], first[order[b]]
    train = order[:a][last[order[:a]] < val_start]
    val = order[a:b][(first[order[a:b]] < test_start) & (last[order[a:b]] < test_start)]
    # Move all drafts tied at the final boundary into test; none into calibration.
    test = order[first[order] >= test_start]
    if len(train) < protocol['minimum_training_drafts'] or len(val) < protocol['minimum_validation_drafts'] or len(test) < protocol['minimum_test_drafts']:
        raise ValueError('Partition below frozen minimum sample size')
    return train, val, test


def logistic_fit(x, y, C, weight=None):
    model = LogisticRegression(C=C, solver='lbfgs', max_iter=1000, tol=1e-7)
    with warnings.catch_warnings():
        warnings.simplefilter('error', ConvergenceWarning)
        model.fit(x, y, sample_weight=weight)
    return model


def estimate_strengths(deck, hand, x, y, prior, adjusted_C):
    baseline = float(y.mean())
    present = deck.copy()
    present.data[:] = 1
    n_hand = np.asarray(hand.sum(axis=0)).ravel()
    n_deck = np.asarray(present.sum(axis=0)).ravel()
    w_hand = np.asarray(hand.T @ y).ravel()
    w_deck = np.asarray(present.T @ y).ravel()
    n_not = n_deck - n_hand
    gih = (w_hand + prior * baseline) / (n_hand + prior)
    gnd = (w_deck - w_hand + prior * baseline) / (n_not + prior)
    support = np.minimum(n_hand, n_not)
    iwd = (gih - gnd) * support / (support + prior)
    # Separate control and card columns; only card coefficients become strength.
    scaler = StandardScaler().fit(x)
    design = sparse.hstack([sparse.csr_matrix(scaler.transform(x)), deck], format='csr')
    adjusted = logistic_fit(design, y, adjusted_C).coef_[0, x.shape[1]:]
    raw = {'A_gih': gih - baseline, 'B_iwd': iwd, 'C_adjusted': adjusted}
    seen = n_deck > 0
    normalized = {}
    for name, values in raw.items():
        sd = float(values[seen].std())
        normalized[name] = np.where(seen, (values - values[seen].mean()) / max(sd, 1e-8), 0.)
    return normalized, raw, n_deck, n_hand, baseline


def mean_strength(matrix, values):
    count = np.asarray(matrix.sum(axis=1)).ravel()
    return np.asarray(matrix @ values).ravel() / np.maximum(count, 1)


def draft_weights(ids):
    _, inverse, counts = np.unique(ids, return_inverse=True, return_counts=True)
    weights = 1 / counts[inverse]
    return weights / weights.mean()


def make_features(protocol, raw, cache, out):
    manifest = json.loads((raw / 'sources.json').read_text())
    audit, all_features = {}, {}
    for sid in protocol['sets']:
        info = prepare_one(sid, raw / f'{sid}.csv.gz', cache, manifest[sid])
        rows = dict(np.load(cache / f'{sid}-rows.npz'))
        deck = sparse.load_npz(cache / f'{sid}-deck.npz')
        hand = sparse.load_npz(cache / f'{sid}-hand.npz')
        opening = sparse.load_npz(cache / f'{sid}-opening.npz')
        train, val, test = partitions(rows['draft'], rows['time'], protocol)
        audit[sid] = {k: v for k, v in info.items() if k != 'cards'}
        audit[sid].update(train_drafts=len(train), validation_drafts=len(val), test_drafts=len(test),
                          purged_drafts=info['drafts'] - len(train) - len(val) - len(test))
        all_features[sid] = {}
        for budget in protocol['draft_budgets']:
            label = str(budget) if budget else 'all'
            fitting = train[:budget] if budget else train
            if budget and len(fitting) < budget:
                raise ValueError(f'{sid}: fewer fitting drafts than budget {budget}')
            mask = np.isin(rows['draft'], fitting)
            norm, raw_scores, n_deck, n_hand, baseline = estimate_strengths(
                deck[mask], hand[mask], rows['x'][mask], rows['y'][mask],
                protocol['prior_games'], protocol['adjusted_model_C'])
            unobserved = n_deck == 0
            count = np.asarray(deck.sum(axis=1)).ravel()
            unknown = mean_strength(deck, unobserved.astype(float))
            oh_count = np.asarray(opening.sum(axis=1)).ravel()
            common = np.column_stack([rows['x'], np.full(len(count), logit(np.clip(baseline, .001, .999))),
                                      unknown, count / 25, oh_count / 7])
            strength = np.column_stack([mean_strength(deck, norm[name]) for name in MODELS])
            initial = np.column_stack([mean_strength(opening, norm[name]) for name in MODELS]) - strength
            # If no nonbasic card is kept, there is no measured hand-strength deviation.
            initial[oh_count == 0] = 0
            splits = {}
            for name, draft_ids in [('validation', val), ('test', test)]:
                take = np.isin(rows['draft'], draft_ids)
                splits[name] = {'x': common[take], 'strength': strength[take], 'opening': initial[take],
                                'y': rows['y'][take], 'draft': rows['draft'][take]}
            all_features[sid][label] = splits
            strengths = [{'name': card, 'deck_games': int(n_deck[j]), 'in_hand_games': int(n_hand[j]),
                          **{name: float(raw_scores[name][j]) for name in MODELS},
                          **{name + '_z': float(norm[name][j]) for name in MODELS}}
                         for j, card in enumerate(info['cards'])]
            write_json(out / 'card-strengths' / f'{sid}-{label}.json',
                       {'set': sid, 'draft_budget': budget, 'training_drafts': len(fitting),
                        'training_games': int(mask.sum()), 'baseline_win_rate': baseline, 'cards': strengths})
            audit[sid][label] = {'training_drafts': len(fitting), 'training_games': int(mask.sum()),
                                'test_unknown_copy_fraction': float(splits['test']['x'][:, -3].mean()),
                                'observed_cards': int((~unobserved).sum())}
            print(f'{sid}/{label}: three strength tables fitted; assessment unopened', flush=True)
    return all_features, audit


def calibrate_and_predict(features, protocol):
    predictions = {}
    for target in protocol['sets']:
        predictions[target] = {}
        for budget in protocol['draft_budgets']:
            label = str(budget) if budget else 'all'
            others = [features[s][label]['validation'] for s in protocol['sets'] if s != target]
            test = features[target][label]['test']
            x = np.concatenate([d['x'] for d in others])
            y = np.concatenate([d['y'] for d in others])
            weight = np.concatenate([draft_weights(d['draft']) / len(d['y']) for d in others])
            weight *= len(weight) / weight.sum()
            strength = np.concatenate([d['strength'] for d in others])
            opening = np.concatenate([d['opening'] for d in others])
            result = {}
            for index, name in enumerate(('baseline',) + MODELS):
                sx = x if index == 0 else np.column_stack([x, strength[:, index - 1]])
                tx = test['x'] if index == 0 else np.column_stack([test['x'], test['strength'][:, index - 1]])
                scaler = StandardScaler().fit(sx)
                model = logistic_fit(scaler.transform(sx), y, protocol['calibration_C'], weight)
                result[name] = model.predict_proba(scaler.transform(tx))[:, 1]
                if index:
                    sx = np.column_stack([sx, opening[:, index - 1]])
                    tx = np.column_stack([tx, test['opening'][:, index - 1]])
                    scaler = StandardScaler().fit(sx)
                    model = logistic_fit(scaler.transform(sx), y, protocol['calibration_C'], weight)
                    result[name + '_opening'] = model.predict_proba(scaler.transform(tx))[:, 1]
            predictions[target][label] = result
    return predictions


def losses(y, p):
    p = np.clip(p, 1e-7, 1 - 1e-7)
    return -(y * np.log(p) + (1 - y) * np.log1p(-p))


def by_draft(values, ids):
    _, inverse, counts = np.unique(ids, return_inverse=True, return_counts=True)
    return np.bincount(inverse, weights=values) / counts


def bootstrap(scores, draws, seed):
    """Paired sets/drafts; scores[set] has drafts x budgets x model columns."""
    rng = np.random.default_rng(seed)
    # One independent within-set resample for each position in the resampled
    # set list. A set selected twice must not reuse the same draft resample.
    selected_sets = rng.integers(len(scores), size=(draws, len(scores)))
    totals = np.zeros((draws, scores[0].shape[2]))
    for sid, values in enumerate(scores):
        # Preserve all regimes/models when sampling a draft.
        average = values.mean(axis=1)
        replicates, _ = np.where(selected_sets == sid)
        for start in range(0, len(replicates), 40):
            take = replicates[start:start + 40]
            size = len(take)
            pick = rng.integers(len(average), size=(size, len(average)))
            np.add.at(totals, take, average[pick].mean(axis=1))
    return totals / len(scores)


def choose_winner(means, boot):
    names = ('baseline',) + MODELS
    leader = min(MODELS, key=lambda n: means[n])
    leader_i = names.index(leader)
    tied = [n for n in MODELS if means[n] - means[leader] <= np.std(boot[:, names.index(n)] - boot[:, leader_i], ddof=1) + 1e-12]
    recommended = tied[0]
    comparisons = {}
    for i, left in enumerate(MODELS):
        for right in MODELS[i + 1:]:
            delta = boot[:, names.index(left)] - boot[:, names.index(right)]
            comparisons[left + '_minus_' + right] = {
                'delta': means[left] - means[right], 'ci98333': np.quantile(delta, [.05 / 6, 1 - .05 / 6]).tolist()}
    supported = True
    for other in MODELS:
        if other != leader:
            delta = boot[:, leader_i] - boot[:, names.index(other)]
            supported &= np.quantile(delta, 1 - .05 / 6) < 0
    base_delta = boot[:, leader_i] - boot[:, 0]
    baseline_ci = np.quantile(base_delta, [.025, .975]).tolist()
    supported &= baseline_ci[1] < 0
    return {'empirical_leader': leader, 'operational_recommendation': recommended,
            'demonstrated_winner': leader if supported else None,
            'leader_vs_baseline_ci95': baseline_ci, 'pairwise': comparisons,
            'recommendation_has_baseline_evidence': bool(np.quantile(boot[:, names.index(recommended)] - boot[:, 0], .975) < 0)}


def evaluate(features, predictions, protocol):
    names = ('baseline',) + MODELS
    metrics, scores = {}, []
    for sid in protocol['sets']:
        metrics[sid] = {}
        per_budget = []
        for budget in protocol['draft_budgets']:
            label = str(budget) if budget else 'all'
            data = features[sid][label]['test']
            row = {}
            per_model = []
            for name, p in predictions[sid][label].items():
                loss = by_draft(losses(data['y'], p), data['draft'])
                row[name] = {'log_loss': float(loss.mean()),
                             'brier': float(by_draft((data['y'] - p) ** 2, data['draft']).mean()),
                             'mean_prediction': float(np.average(p, weights=draft_weights(data['draft']))),
                             'actual_win_rate': float(np.average(data['y'], weights=draft_weights(data['draft'])))}
                if name in names:
                    per_model.append(loss)
            metrics[sid][label] = row
            per_budget.append(np.column_stack(per_model))
        scores.append(np.stack(per_budget, axis=1))
    means_array = np.mean([s.mean(axis=(0, 1)) for s in scores], axis=0)
    means = dict(zip(names, means_array.tolist()))
    boot = bootstrap(scores, protocol['bootstrap_draws'], protocol['seed'])
    return {'primary_macro_log_loss': means, 'winner': choose_winner(means, boot),
            'by_set_and_budget': metrics,
            'primary_definition': 'equal sets, equal budgets, equal source drafts; pregame deck-strength log loss',
            'causal_claim': False, 'pack_one_data_used': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['download', 'run'])
    parser.add_argument('--protocol', type=Path, default=DEFAULT_PROTOCOL)
    parser.add_argument('--raw', type=Path, default=ROOT / 'raw-data/card-strength-v1')
    parser.add_argument('--cache', type=Path, default=ROOT / 'artifacts/card-strength-v1/cache')
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/card-strength-v1/results')
    parser.add_argument('--final-test', action='store_true')
    args = parser.parse_args(argv)
    protocol = json.loads(args.protocol.read_text())
    if args.command == 'download':
        download(protocol, args.raw)
        return 0
    args.out.mkdir(parents=True, exist_ok=True)
    features, audit = make_features(protocol, args.raw, args.cache, args.out)
    predictions = calibrate_and_predict(features, protocol)
    # Freeze predictions before evaluating any target-set assessment outcome.
    prediction_dir = args.out.parent / 'sealed-predictions'
    prediction_dir.mkdir(parents=True, exist_ok=True)
    for sid, budgets in predictions.items():
        for label, values in budgets.items():
            write_npz(prediction_dir / f'{sid}-{label}.npz',
                      lambda buffer: np.savez_compressed(buffer, **values))
    hashes = {p.name: sha256(p) for p in sorted(prediction_dir.glob('*.npz'))}
    provenance = {'protocol_sha256': sha256(args.protocol), 'code_sha256': sha256(__file__),
                  'sources': json.loads((args.raw / 'sources.json').read_text()),
                  'prediction_sha256': hashes, 'data_audit': audit}
    write_json(args.out / 'provenance.json', provenance)
    if not args.final_test:
        print('Models/predictions frozen. Assessment not opened; use --final-test.', flush=True)
        return 0
    report = evaluate(features, predictions, protocol)
    report.update(protocol_version=protocol['version'], protocol_sha256=provenance['protocol_sha256'],
                  code_sha256=provenance['code_sha256'])
    write_json(args.out / 'report.json', report)
    print(json.dumps({'primary': report['primary_macro_log_loss'], 'winner': report['winner']}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
