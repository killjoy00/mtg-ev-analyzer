import hashlib
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_replays import CountStore, OutOfFoldModel, PickExample
from model_training import V5_MODEL
from trace_partial_credit import trace_card, trace_decision, verify_archive


def fixture():
    counts = CountStore.empty()
    for name, picked in [('Gold', 8), ('Black', 5), ('Green', 3)]:
        counts.exact_seen[(name, 0, 4)] = 40
        counts.exact_picked[(name, 0, 4)] = picked
        counts.pair_seen[(name, 'Prior Black')] = 40
        counts.pair_picked[(name, 'Prior Black')] = 2 if name == 'Gold' else 10
        counts.pair_expected[(name, 'Prior Black')] = 8
    fit = {
        'cards': {name: {'colours': color} for name, color in
                  [('Gold', 'RW'), ('Black', 'B'), ('Green', 'G'), ('Prior Black', 'B'), ('Prior Green', 'G')]},
        'by_stage': {'s3-5': {'0': .2, '1-2': .4, '3-5': .8, '*': .5}},
        'by_commitment': {'0': .2, '1-2': .4, '3-5': .8}, 'play_rate': .5,
    }
    return (OutOfFoldModel(counts, CountStore.empty(), fit),
            PickExample('synthetic', 0, 4, 'Green', ['Gold', 'Black', 'Green'],
                        {'Prior Black': 3, 'Prior Green': 1}))


def stored(report):
    return {
        'model_version': V5_MODEL, 'pick_number': report['pick_number'],
        'prior_picks': [{'name': n} for n, count in report['prior_pool'].items() for _ in range(count)],
        'candidates': [{'id': c['name'], 'name': c['name'], 'model_probability': c['raw_support']}
                       for c in report['candidates']],
        'historical_pick_id': next(c['name'] for c in report['candidates'] if c['trophy_match']),
    }


class CreditTraceTests(unittest.TestCase):
    def test_trace_reproduces_predictor_with_negative_and_positive_context(self):
        model, example = fixture()
        trace = trace_decision(model, example)
        for row in trace['candidates']:
            self.assertAlmostEqual(row['final_tendency'], model.card_tendency(row['name'], 0, 4, example.pool), places=12)
        rows = {r['name']: r for r in trace['candidates']}
        self.assertLess(rows['Gold']['pair_log_odds_shift'], 0)
        self.assertLess(rows['Gold']['color_log_odds_shift'], 0)
        self.assertGreater(rows['Black']['pair_log_odds_shift'], 0)
        self.assertGreater(rows['Black']['color_log_odds_shift'], 0)
        self.assertEqual(rows['Gold']['pool_depth_multiplier'], .5)

    def test_unknown_color_and_thin_pairs_are_not_invented_evidence(self):
        model, example = fixture()
        model.fit_colours.pop('Gold')
        model.all.pair_seen[('Gold', 'Prior Black')] = 7
        row = trace_card(model, 'Gold', 0, 4, example.pool)
        self.assertEqual(row['color_log_odds_shift'], 0)
        self.assertEqual(row['pair_log_odds_shift'], 0)
        self.assertTrue(all(not pair['used'] for pair in row['pair_evidence']))

    def test_current_gold_affinity_counts_any_intersection_not_all_colors(self):
        model, example = fixture()
        model.fit_colours['Gold'] = frozenset('BR')
        row = trace_card(model, 'Gold', 0, 4, example.pool)
        self.assertEqual(row['matched_pool_cards'], 3)
        # This records the old behavior; it is not evidence that red is castable.
        self.assertGreater(row['color_log_odds_shift'], 0)

    def test_trophy_label_changes_award_not_model_evidence(self):
        model, example = fixture()
        before = trace_decision(model, example)
        example.historical_pick = 'Gold'
        after = trace_decision(model, example)
        self.assertEqual([c['raw_support'] for c in before['candidates']],
                         [c['raw_support'] for c in after['candidates']])
        self.assertEqual(next(c for c in after['candidates'] if c['name'] == 'Gold')['awarded_credit'], 100)
        self.assertEqual(after['candidates'][0]['model_only_credit'], 95)

    def test_reconstruction_requires_exact_stored_state_and_scores(self):
        model, example = fixture()
        payload = stored(trace_decision(model, example))
        self.assertTrue(trace_decision(model, example, payload)['stored_evidence_verified'])
        for edit in ('support', 'prior', 'historical', 'pick', 'model', 'duplicate'):
            bad = json.loads(json.dumps(payload))
            if edit == 'support': bad['candidates'][0]['model_probability'] += .001
            if edit == 'prior': bad['prior_picks'].pop()
            if edit == 'historical': bad['historical_pick_id'] = 'Gold'
            if edit == 'pick': bad['pick_number'] = 6
            if edit == 'model': bad['model_version'] = 'unsupported'
            if edit == 'duplicate': bad['candidates'].append(bad['candidates'][0])
            with self.subTest(edit=edit), self.assertRaises(ValueError):
                trace_decision(model, example, bad)

    def test_trace_fails_when_predictor_arithmetic_has_changed(self):
        model, example = fixture()
        with patch.object(model, 'card_tendency', return_value=.99), self.assertRaises(ValueError):
            trace_decision(model, example)

    def test_verified_report_exposes_colored_spell_with_flexible_affinity(self):
        model, example = fixture()
        model.fit_colours['Gold'] = frozenset()
        model.fit['cards']['Gold']['colours'] = 'C'
        before = trace_decision(model, example)
        payload = stored(before)
        for c in payload['candidates']:
            if c['name'] == 'Gold':
                c.update(mana_cost='{2}{R}{W}', type_line='Artifact — Equipment', layout='normal')
        report = trace_decision(model, example, payload)
        row = next(c for c in report['candidates'] if c['name'] == 'Gold')
        self.assertEqual(row['required_colors_missing_from_affinity'], ['W', 'R'])
        self.assertEqual([c['awarded_credit'] for c in report['candidates']],
                         [c['awarded_credit'] for c in before['candidates']])

    def test_pinned_canonical_metadata_is_needed_for_a_mana_judgment(self):
        model, example = fixture()
        model.fit_colours['Gold'] = frozenset()
        model.fit['cards']['Gold']['colours'] = 'C'
        payload = stored(trace_decision(model, example))
        display = next(c for c in payload['candidates'] if c['name'] == 'Gold')
        display.update(mana_cost='{2}{R}{W}', type_line='Artifact — Equipment')
        unknown = trace_decision(model, example, payload)
        row = next(c for c in unknown['candidates'] if c['name'] == 'Gold')
        self.assertIsNone(row['required_colors_missing_from_affinity'])
        canonical = {'Gold': {**display, 'layout': 'normal'}}
        known = trace_decision(model, example, payload, canonical)
        row = next(c for c in known['candidates'] if c['name'] == 'Gold')
        self.assertEqual(row['required_colors_missing_from_affinity'], ['W', 'R'])

    def test_pinned_source_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'source'
            p.write_bytes(b'frozen source')
            verify_archive(p, hashlib.sha256(p.read_bytes()).hexdigest())
            p.write_bytes(b'refreshed source')
            with self.assertRaises(ValueError):
                verify_archive(p, hashlib.sha256(b'frozen source').hexdigest())

    def test_empty_pool_has_no_context_and_does_not_imply_confidence(self):
        model, example = fixture()
        example.pool = {}
        for name in example.candidates:
            row = trace_card(model, name, 0, 4, {})
            self.assertEqual(row['context_odds_multiplier'], 1)
            self.assertAlmostEqual(row['final_tendency'], row['base_pick_tendency'])
        report = trace_decision(model, example)
        self.assertLess(report['candidates'][0]['raw_support'], .6)
        self.assertEqual(report['candidates'][0]['model_only_credit'], 95)


if __name__ == '__main__':
    unittest.main()
