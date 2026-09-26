import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import contextual_value_nuisance_audit as audit
from contextual_value.dataset import draft_split
from contextual_value.propensity import PropensityExample, LinearSoftmaxPropensityModel
try:
    import numpy as np
    import scipy
except ImportError:
    np = None


def examples():
    # Unequal action sets, nonuniform weights, missing features and nonzero
    # offsets; state-only controls cancel but candidate interactions need not.
    return [
        PropensityExample({'a': {'x': 1.2, 'skill': .6}, 'b': {'x': -.5, 'skill': .6}},
                          'a', .25, {'a': -.2, 'b': -1.7}),
        PropensityExample({'a': {'x': -.2, 'y': 1., 'skill': .4},
                           'b': {'x': 1.4, 'skill': .4},
                           'c': {'x': .1, 'y': -2., 'skill': .4}},
                          'c', .75, {'a': -1.6, 'b': -.5, 'c': -1.2}),
        PropensityExample({'z': {'x': .8, 'skill': .9}}, 'z', 1.),
    ]


@unittest.skipIf(np is None, 'NumPy/SciPy are isolated audit dependencies; numerical-audit workflow requires them')
class SolverAuditTests(unittest.TestCase):
    def test_native_250_update_equivalence(self):
        ex = examples()
        reference = LinearSoftmaxPropensityModel.fit(ex)
        d = audit.Design(ex)
        beta, trace = d.native_updates()
        self.assertEqual(d.names, reference.feature_names)
        np.testing.assert_allclose(beta, reference.coefficients, rtol=1e-11, atol=1e-12)
        p, _ = d.values(beta)
        for i, row in enumerate(ex):
            expected = reference.probabilities(row.features, row.offsets)
            np.testing.assert_allclose(p[d.starts[i]:d.starts[i]+d.lengths[i]],
                                       list(expected.values()), rtol=1e-12, atol=1e-13)
        self.assertEqual(trace[-1]['epoch'], 250)

    def test_analytic_gradient_matches_finite_difference(self):
        d = audit.Design(examples())
        beta = np.array([.2, -.1, .4])
        _, analytic = d.objective(beta)
        for j in range(len(beta)):
            shift = np.zeros(len(beta)); shift[j] = 1e-6
            numeric = (d.objective(beta+shift)[0]-d.objective(beta-shift)[0])/2e-6
            self.assertAlmostEqual(analytic[j], numeric, places=8)

    def test_same_objective_has_correct_l2_scaling(self):
        d = audit.Design(examples()); beta = np.array([.4, .2, -.1])
        f0,g0 = d.objective(beta, l2=0)
        f1,g1 = d.objective(beta, l2=1)
        self.assertAlmostEqual(f1-f0, (beta@beta)/(2*d.total), places=12)
        np.testing.assert_allclose(g1-g0, beta/d.total, atol=1e-12)

    def test_state_additive_feature_cancellation(self):
        d = audit.Design(examples())
        b = np.zeros(len(d.names)); shifted = b.copy()
        shifted[d.names.index('skill')] = 30
        np.testing.assert_allclose(d.values(b)[0], d.values(shifted)[0], atol=1e-14)

    def test_lbfgs_reduces_same_training_objective(self):
        from scipy.optimize import minimize
        d = audit.Design(examples()); beta, _ = d.native_updates()
        result = minimize(d.objective, beta, jac=True, method='L-BFGS-B',
                          options=dict(maxiter=500, ftol=1e-12, gtol=1e-7))
        self.assertLessEqual(result.fun, d.objective(beta)[0]+1e-12)
        self.assertTrue(result.success)

    def test_rejects_empty_nonfinite_and_zero_weight_design(self):
        for ex in ([], [PropensityExample({'a': {'x': float('nan')}}, 'a')],
                   [PropensityExample({'a': {'x': 1}}, 'a', 0)]):
            with self.assertRaises(ValueError): audit.Design(ex)


class AuditIsolationTests(unittest.TestCase):
    def test_assessment_is_rejected_before_decision_construction(self):
        ident = next('locked-'+str(i) for i in range(100) if draft_split('locked-'+str(i)) == 'assessment')
        with patch.object(audit, '_decision_from_dict', side_effect=AssertionError('must not parse')) as decoder:
            with self.assertRaisesRegex(ValueError, 'assessment'):
                list(audit.development_rows([{'draft_id': ident, 'event_match_wins': 7}], {ident:'assessment'}))
            decoder.assert_not_called()

    def test_unknown_draft_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unknown'):
            list(audit.development_rows([{'draft_id':'unknown'}], {}))

    def test_zip_tampering_and_duplicate_members_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            p = Path(root)/'x.zip'
            with zipfile.ZipFile(p, 'w') as z: z.writestr('ok.json', '{}')
            good = audit.digest(p)
            audit.check_zip(p, good)
            with p.open('ab') as f: f.write(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'digest mismatch'): audit.check_zip(p, good)
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                with zipfile.ZipFile(p, 'w') as z:
                    z.writestr('a', '{}'); z.writestr('a', '{}')
            with self.assertRaisesRegex(ValueError, 'duplicate'): audit.check_zip(p, audit.digest(p))

    def test_manifest_rejects_rehashed_cohort_substitution(self):
        # The externally pinned cohort identity cannot be replaced by rehashing
        # a self-consistent but different payload.
        fake = {'code_revision':audit.BASE_SHA, 'assessment_outcomes_serialized':False}
        fake['cohort_id'] = audit.canonical_sha256(fake)
        with self.assertRaisesRegex(ValueError, 'cohort identity'):
            audit.check_manifest(fake)


if __name__ == '__main__':
    unittest.main()
