#!/usr/bin/env python3
"""Pinned-checkpoint, development-only propensity solver audit for issue #529.

This is NOT a new G fit: all five outer checkpoints, Q, G and A targets stay
fixed. The single challenger changes only optimization of the existing offset
conditional-logit objective. No raw archive or assessment-outcome path exists.
NumPy/SciPy are isolated experiment dependencies, not production requirements.
"""
from __future__ import annotations

import argparse
from array import array
from collections import Counter, defaultdict
from dataclasses import asdict, replace
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path
import resource
import time
import zipfile

from contextual_value.archive import ArchiveSignalProvider, GameStore
from contextual_value.checkpoint import (
    _decision_from_dict, _summary_from_dict, canonical_sha256,
    draft_id_sha256, feature_complements_sha256,
)
from contextual_value.dataset import draft_split, choose_primary_decision, normalized_draft_weights
from contextual_value.diagnostics import (
    propensity_diagnostics, outcome_diagnostics, policy_overlap_diagnostics,
    paired_policy_delta_slices, policy_overlap_slices,
)
from contextual_value.dr import PolicyObservation, evaluate_policy
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import NuisancePrediction, NuisanceTrainingRow, nuisance_fold
from contextual_value.outcome import RidgeOutcomeModel
from contextual_value.propensity import PropensityExample
from contextual_value.value import argmax_policy, softmax_values

BASE_SHA = 'aa5b17d96b43f3ce08f52fad55ba17f327472c1b'
BASE_RUN = 36256947308
CORE = ('MSH', 'SOS', 'ECL', 'TLA')
COHORT_ID = 'f9b2055d9fb99c250e79fa7f1a8710941c28957d02598c387ec38e800a0d1ffa'
CONFIG = dict(max_drafts=8000, nuisance_folds=5, inner_feature_folds=5,
              propensity_l2=1.0, outcome_l2=10.0, value_l2=10.0)
# GitHub digests are recorded before this comparison. Never trust a hash supplied
# only by the payload being checked. Retained source ZIPs are never overwritten.
BUNDLES = {
    'cohort': (10911228866, '664bb3a1c84a905f6d8e228cb0af8af529397d13f23e2be7366ca4c55be1a232'),
    'pooled': (10913021100, '107f16b62e2f298653d0f92c8d46a593711de89d3255ecaed97fa1c9ff434be6'),
    'MSH': (10911577821, 'af8097818983a09403166ac8e1653152878b7c727b3ab6b4fc64bb96318e7971'),
    'SOS': (10911124509, '177125c69cbb3d0d1b0d808f07bbd34884eb8a57c31841ea67d891db504db03c'),
    'ECL': (10912115058, 'a5bc3b368359d98469ebb4f049b5d60b8b1753b10c57ebf783c3d1276a734c46'),
    'TLA': (10911672804, '917fae1e880726902825a1a195c032e422b507c39ab057a1626d5e2a168b8c2a'),
}


def emit(stage, started, **fields):
    print(json.dumps(dict(stage=stage, elapsed_seconds=time.monotonic()-started,
                         peak_rss_mib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
                         **fields), sort_keys=True), flush=True)


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def check_zip(path, expected):
    if digest(path) != expected:
        raise ValueError(f'{path.name}: pinned ZIP digest mismatch')
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if len(names) != len(set(names)) or any(Path(n).name != n for n in names):
            raise ValueError('duplicate or non-flat ZIP member')


def read_json(path, member):
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read(member))


def read_rows(path, member):
    with zipfile.ZipFile(path) as z, z.open(member) as raw:
        with gzip.open(raw, 'rt', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)


def check_manifest(m):
    unsigned = dict(m)
    ident = unsigned.pop('cohort_id', None)
    if ident != COHORT_ID or canonical_sha256(unsigned) != ident:
        raise ValueError('cohort identity mismatch')
    if m['code_revision'] != BASE_SHA or m['assessment_outcomes_serialized'] is not False:
        raise ValueError('source revision or assessment boundary mismatch')
    c = m['configuration']
    if (c['max_drafts'], c['nuisance_folds'], c['inner_feature_folds'], c['core_environments']) != (8000, 5, 5, list(CORE)):
        raise ValueError('frozen configuration mismatch')
    rows = m['selected_drafts']
    if len(rows) != 8000 or len({r['draft_id'] for r in rows}) != 8000:
        raise ValueError('cohort cap or duplicate IDs')
    if canonical_sha256(rows) != m['selected_drafts_sha256']:
        raise ValueError('selected identity hash mismatch')
    for r in rows:
        split = draft_split(r['draft_id'])
        fold = nuisance_fold(r['draft_id'], 5) if split == 'train' else None
        if r['split'] != split or r['nuisance_fold'] != fold or r['expansion'] not in CORE:
            raise ValueError('split, fold or environment mismatch')


def development_rows(rows, membership):
    """Reject before constructing a Decision; never silently drop a bad row."""
    seen = set()
    for row in rows:
        ident = row['draft_id']
        if membership.get(ident) not in ('train', 'validation') or draft_split(ident) == 'assessment':
            raise ValueError('assessment or unknown draft in development payload')
        decision = _decision_from_dict(row)
        if decision.decision_id in seen or decision.expansion not in CORE:
            raise ValueError('duplicate decision or non-core environment')
        seen.add(decision.decision_id)
        yield decision


class Design:
    """Sparse ragged choice matrix; same objective as the native scalar fitter."""
    def __init__(self, examples):
        import numpy as np
        from scipy.sparse import csr_matrix
        names, at = [], {}
        data, columns, pointers = array('d'), array('i'), array('q', [0])
        starts, selected, offsets, weights = [], [], array('d'), []
        n_actions = 0
        for ex in examples:
            ex.validate()
            actions = tuple(ex.features)
            starts.append(n_actions)
            selected.append(n_actions + actions.index(ex.selected_action))
            weights.append(ex.sample_weight)
            for action in actions:
                for name, value in ex.features[action].items():
                    if name not in at:
                        at[name] = len(names); names.append(name)
                    if value != 0:
                        columns.append(at[name]); data.append(float(value))
                pointers.append(len(data))
                offsets.append(float(ex.offsets[action]) if ex.offsets is not None else 0.0)
                n_actions += 1
        if not weights or sum(weights) <= 0:
            raise ValueError('nonempty positive-weight design required')
        x = csr_matrix((np.asarray(data), np.asarray(columns), np.asarray(pointers)),
                       shape=(n_actions, len(names)))
        self.names = tuple(sorted(names))
        self.x = x[:, [at[n] for n in self.names]].tocsr()
        self.starts = np.asarray(starts, dtype=np.int64)
        self.lengths = np.diff(np.append(self.starts, n_actions))
        self.selected = np.asarray(selected, dtype=np.int64)
        self.offsets = np.asarray(offsets)
        self.weights = np.asarray(weights)
        self.total = float(self.weights.sum())
        self.action_weights = np.repeat(self.weights, self.lengths)

    def values(self, beta):
        import numpy as np
        scores = self.x @ beta + self.offsets
        peak = np.maximum.reduceat(scores, self.starts)
        exp = np.exp(scores - np.repeat(peak, self.lengths))
        denom = np.add.reduceat(exp, self.starts)
        p = exp / np.repeat(denom, self.lengths)
        losses = peak + np.log(denom) - scores[self.selected]
        return p, losses

    def objective(self, beta, l2=1.0):
        import numpy as np
        p, losses = self.values(beta)
        residual = p * self.action_weights
        residual[self.selected] -= self.weights
        gradient = (self.x.T @ residual + l2 * beta) / self.total
        objective = (float(self.weights @ losses) + 0.5*l2*float(beta @ beta))/self.total
        if not math.isfinite(objective) or not np.all(np.isfinite(gradient)):
            raise ValueError('nonfinite objective/gradient')
        return objective, gradient

    def native_updates(self, epochs=250):
        import numpy as np
        beta = np.zeros(len(self.names))
        trace = []
        for epoch in range(epochs):
            value, gradient = self.objective(beta)
            if epoch % 25 == 0:
                trace.append(dict(epoch=epoch, objective=value, gradient_inf=float(abs(gradient).max())))
            beta -= (0.2/math.sqrt(1+epoch/25))*gradient
        value, gradient = self.objective(beta)
        trace.append(dict(epoch=epochs, objective=value, gradient_inf=float(abs(gradient).max())))
        return beta, trace


def run(inputs, out):
    import numpy as np
    import scipy
    from scipy.optimize import minimize
    started = time.monotonic()
    paths = {key: inputs / (key+'.zip') for key in BUNDLES}
    for key, (_, sha) in BUNDLES.items():
        check_zip(paths[key], sha)
    manifest = read_json(paths['cohort'], 'cohort-manifest.json')
    check_manifest(manifest)
    membership = {r['draft_id']: r['split'] for r in manifest['selected_drafts']}
    train_ids = frozenset(k for k, v in membership.items() if v == 'train')
    val_ids = frozenset(k for k, v in membership.items() if v == 'validation')
    decisions = list(development_rows(read_rows(paths['cohort'], 'development-decisions.jsonl.gz'), membership))
    if {r.draft_id for r in decisions} != train_ids | val_ids:
        raise ValueError('incomplete development payload')
    train = [r for r in decisions if r.draft_id in train_ids]
    validation = [r for r in decisions if r.draft_id in val_ids]
    weights = normalized_draft_weights(train)
    expected = {r.decision_id: r for r in train}
    feature_meta = {}
    for env in CORE:
        meta = read_json(paths[env], f'train-feature-fold--1-{env}.meta.json')
        required = dict(cohort_id=COHORT_ID, code_revision=BASE_SHA, fold=-1,
                        expansion=env, configuration=CONFIG, kind='nuisance_training_features',
                        training_drafts_sha256=draft_id_sha256(train_ids),
                        held_drafts_sha256=draft_id_sha256(val_ids),
                        feature_complements_sha256=feature_complements_sha256(train_ids, 5),
                        selected_drafts_sha256=manifest['selected_drafts_sha256'],
                        archive_sha256=[dict(kind=r['kind'], sha256=r['sha256']) for r in manifest['archives']])
        if any(meta.get(k) != v for k, v in required.items()):
            raise ValueError('incompatible feature checkpoint')
        feature_meta[env] = meta

    def examples():
        seen = set()
        for env in CORE:
            count = 0
            for r in read_rows(paths[env], f'train-feature-fold--1-{env}.jsonl.gz'):
                ident = r['decision_id']
                d = expected.get(ident)
                if d is None or ident in seen or r['draft_id'] != d.draft_id or r['expansion'] != env:
                    raise ValueError('duplicate, mismatched or non-train feature row')
                if set(r['features']) != set(d.candidates) or r['selected_action'] != d.selected_card or not math.isclose(r['sample_weight'], weights[ident], rel_tol=1e-14):
                    raise ValueError('action or weight mismatch')
                seen.add(ident); count += 1
                yield PropensityExample(r['features'], r['selected_action'], r['sample_weight'], r['offsets'])
            if count != feature_meta[env]['row_count']:
                raise ValueError('feature count mismatch')
        if seen != set(expected):
            raise ValueError('incomplete train feature coverage')
    design = Design(examples())
    emit('compile_pinned_train_features', started, decisions=len(train), candidates=design.x.shape[0], features=len(design.names))
    base_beta, trace = design.native_updates()
    emit('reproduce_250_updates', started, **trace[-1])
    # This train-only optimization does not inspect validation to stop/select.
    opt = minimize(design.objective, base_beta, jac=True, method='L-BFGS-B',
                   options=dict(maxiter=500, ftol=1e-12, gtol=1e-7))
    base_obj, base_grad = design.objective(base_beta)
    challenger_obj, challenger_grad = design.objective(opt.x)
    report = dict(scope='development_nuisance_sensitivity_only', source_run=BASE_RUN,
                  source_revision=BASE_SHA, audit_revision=os.environ.get('GITHUB_SHA', 'local'),
                  cohort_id=COHORT_ID, assessment_opened=False,
                  specification_change='optimizer_only; no feature or regularization change',
                  skill_interaction_status='blocked_pending_source_timing',
                  bundles={k: dict(artifact_id=v[0], zip_sha256=v[1]) for k,v in BUNDLES.items()},
                  solver=dict(baseline_trace=trace, baseline_objective=base_obj,
                              baseline_gradient_inf=float(abs(base_grad).max()),
                              challenger_objective=challenger_obj,
                              challenger_gradient_inf=float(abs(challenger_grad).max()),
                              scipy_success=bool(opt.success), message=str(opt.message),
                              iterations=int(opt.nit), gradient_tolerance_met=bool(abs(challenger_grad).max() <= 1e-7)),
                  versions=dict(numpy=np.__version__, scipy=scipy.__version__), feature_names=list(design.names))
    emit('same_objective_lbfgs', started, **report['solver'])
    del design

    summaries = {}
    for r in read_rows(paths['cohort'], 'development-games.jsonl.gz'):
        if membership.get(r['draft_id']) not in ('train', 'validation') or r['draft_id'] in summaries:
            raise ValueError('assessment, unknown or duplicate game draft')
        summaries[r['draft_id']] = _summary_from_dict(r['summary'])
    provider = ArchiveSignalProvider(decisions, GameStore(summaries))
    saved = {}
    for r in read_rows(paths['pooled'], 'validation-nuisance.jsonl.gz'):
        if r['draft_id'] not in val_ids or r['decision_id'] in saved or r['fold'] != -1:
            raise ValueError('invalid validation prediction')
        saved[r['decision_id']] = NuisancePrediction(**r)
    if set(saved) != {r.decision_id for r in validation}:
        raise ValueError('validation prediction coverage mismatch')
    value = read_json(paths['pooled'], 'value-model.json')
    original = read_json(paths['pooled'], 'development-report.json')
    if value['cohort_id'] != COHORT_ID or value['assessment_opened'] is not False or original['assessment_opened'] is not False:
        raise ValueError('model/report provenance mismatch')
    qvalue = RidgeOutcomeModel(tuple(value['feature_names']), tuple(value['coefficients']), value['l2'])
    by_draft = defaultdict(list)
    for d in validation:
        by_draft[d.draft_id].append(d)
    primary = [choose_primary_decision(ds) for ds in by_draft.values()]
    primary = [d for d in primary if d is not None]
    primary_ids = {d.decision_id for d in primary}
    arms = {label: [] for label in ('baseline', 'solver_only')}
    observations = {label: {policy: [] for policy in ('A', 'G')} for label in arms}
    max_error = 0.0
    # Use scalar probability scoring from the existing implementation, not a new
    # validation feature representation; this is an independent replay check.
    from contextual_value.propensity import LinearSoftmaxPropensityModel
    names = tuple(report['feature_names'])
    models = {k: LinearSoftmaxPropensityModel(names, tuple(b), 1.0)
              for k,b in (('baseline', base_beta), ('solver_only', opt.x))}
    for d in validation:
        signals = provider(d, train_ids)
        features = model_feature_map(d, signals)
        offsets = strong_choice_offsets(signals, d.candidates)
        p0 = models['baseline'].probabilities(features, offsets)
        p1 = models['solver_only'].probabilities(features, offsets)
        prior = saved[d.decision_id]
        max_error = max(max_error, max(abs(p0[a]-prior.behavior[a]) for a in p0))
        for label, p in (('baseline', p0), ('solver_only', p1)):
            arms[label].append(replace(prior, behavior=p))
        if d.decision_id in primary_ids:
            targets = dict(A=argmax_policy({a: signals[a].strong_choice_probability or 0.0 for a in d.candidates}),
                           G=softmax_values({a:qvalue.predict(features[a]) for a in d.candidates}, temperature=0.25))
            for label, p in (('baseline', p0), ('solver_only', p1)):
                for policy, target in targets.items():
                    observations[label][policy].append(PolicyObservation(
                        action=d.selected_card, outcome=float(d.event_match_wins),
                        behavior=p, target=target, q_values=prior.q_values, cluster=d.draft_id))
    if max_error > 1e-9:
        raise ValueError(f'baseline replay mismatch: max probability difference {max_error}')
    report['baseline_replay_max_abs_probability_error'] = max_error
    report['drafts'] = dict(train=len(train_ids), validation=len(val_ids), assessment_withheld=1993)
    report['q_unchanged_validation'] = outcome_diagnostics(validation, list(saved.values()))
    report['arms'] = {}
    for label in arms:
        obs = observations[label]
        report['arms'][label] = dict(
            propensity=propensity_diagnostics(validation, arms[label]),
            estimates={policy: {str(cap):asdict(evaluate_policy(v, cap)) for cap in (10,20,50)} for policy,v in obs.items()},
            overlap={policy:policy_overlap_diagnostics(v) for policy,v in obs.items()},
            local_support={policy:policy_overlap_slices(primary,v) for policy,v in obs.items()},
            fixed_target_delta_slices=paired_policy_delta_slices(primary,obs['G'],obs['A']))
    for policy,key in [('A','A_current_v4_strong_player'), ('G','G_contextual_value')]:
        ref = original['models'][key]
        if policy == 'G': ref = ref['selected_estimates']
        for cap in ('10','20','50'):
            if abs(report['arms']['baseline']['estimates'][policy][cap]['dr']-ref[cap]['dr']) > 1e-8:
                raise ValueError('primary target replay mismatch')
    report['interpretation'] = 'Exploratory fixed-target nuisance sensitivity; not a new G fit, gate pass, or authorization to open assessment.'
    report['elapsed_seconds'] = time.monotonic()-started
    report['peak_rss_mib'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
    out.mkdir(parents=True, exist_ok=True)
    (out/'nuisance-audit.json').write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False)+'\n')
    emit('audit_complete', started, baseline_replay_max_error=max_error)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.inputs.resolve() == args.out.resolve():
        raise SystemExit('outputs must not overwrite source checkpoints')
    run(args.inputs, args.out)


if __name__ == '__main__':
    main()
