import copy
import hashlib
import json
from itertools import combinations
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from report_context_contrasts import (DEVELOPMENT, CONFIRMATION, FROZEN_PREFIX_SHA256,
                                      assemble, render)
from compare_context_challengers import CHALLENGERS, CONTRAST_ARMS


def fixture():
    arms = {a: {'cards_with_colour_judgment': 5, 'fit_cards': 6,
                'served_slice': {'decisions': 20, 'log_loss': 1.23456}} for a in (*CHALLENGERS, 'explicit-matched')}
    contrasts = {f'{b}-minus-{a}': {'baseline': a, 'candidate': b, 'log_loss_delta': -.12345,
                                   'log_loss_ci95': [-.2, -.1], 'top1_delta': .01,
                                   'top1_ci95': [0, .02]} for a, b in combinations(CONTRAST_ARMS, 2)}
    for arm in CONTRAST_ARMS:
        arms[arm]['vs_v5'] = copy.deepcopy(next(iter(contrasts.values())))
    results = {s: {'set': s, 'split': 'validation', 'challengers': copy.deepcopy(arms),
                   'contrasts': copy.deepcopy(contrasts), 'sources': {
                       **{k: 'a'*64 for k in ('draft_sha256', 'games_sha256', 'metadata_sha256')},
                       'cache': {'train_ids_sha256': 'b'*64}},
                   'train_drafts': 2, 'training_picks': 4, 'held_out_drafts': 3,
                   'train_games': {'games': 5}, 'backbone': 'fixture'}
               for s in (*DEVELOPMENT, *CONFIRMATION)}
    original = {'sets': copy.deepcopy(results)}
    return results, original


class ReportTests(unittest.TestCase):
    def test_committed_tables_and_metadata_match_aggregate_without_raw_archives(self):
        root = Path(__file__).resolve().parents[1]
        report = json.loads((root / 'research/data/context-challenger-contrasts-2026-10-29.json').read_text())
        original = json.loads((root / 'research/data/context-challengers-2026-10-29.json').read_text())
        self.assertEqual(report, assemble(report['sets'], original))
        prefix, results = (root / 'research/CONTEXT-CHALLENGER-CONTRASTS.md').read_text().split('## Results\n', 1)
        self.assertEqual(hashlib.sha256(prefix.encode()).hexdigest(), FROZEN_PREFIX_SHA256)
        self.assertEqual(results, '\n' + render(report))
        for sid, result in report['sets'].items():
            metadata = root / f'research/data/{sid}-rules-context-2026-10-29.json.gz'
            self.assertEqual(hashlib.sha256(metadata.read_bytes()).hexdigest(), result['sources']['metadata_sha256'])

    def test_tables_use_json_values_and_only_confirmation_determines_verdict(self):
        results, original = fixture()
        for sid in DEVELOPMENT:
            for row in results[sid]['contrasts'].values():
                row['log_loss_ci95'] = [.3, .4]
        report = assemble(results, original)
        self.assertTrue(all(v['verdict'] == 'candidate beats baseline' for v in report['verdicts'].values()))
        text = render(report)
        self.assertIn('-0.12345', text)
        self.assertIn('+1.000 [+0.000, +2.000]', text)
        self.assertIn('FRA | development', text)
        self.assertIn('TLA | confirmation', text)
        self.assertIn('explicit-matched.', text)

    def test_incomplete_or_unreserved_evidence_is_rejected(self):
        for change in ('missing_set', 'test_split', 'coverage', 'old_output', 'checksum', 'contrast', 'direction'):
            results, original = fixture()
            if change == 'missing_set': results.pop('tla')
            if change == 'test_split': results['tla']['split'] = 'test'
            if change == 'coverage': results['tla']['challengers']['explicit-matched']['cards_with_colour_judgment'] = 6
            if change == 'old_output': results['fra']['challengers']['explicit']['served_slice']['log_loss'] = 0
            if change == 'checksum': results['tla']['sources']['draft_sha256'] = 'missing'
            if change == 'contrast': results['tla']['contrasts'].pop('explicit-minus-splash')
            if change == 'direction': results['fra']['contrasts']['explicit-minus-splash']['candidate'] = 'splash'
            with self.subTest(change=change), self.assertRaises(ValueError):
                assemble(results, original)


if __name__ == '__main__':
    unittest.main()
