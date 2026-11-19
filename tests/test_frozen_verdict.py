import contextlib
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from frozen_verdict import BASE, CAND, main, verdict


class FrozenVerdictTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original=json.loads((ROOT/'results/decision-1/reserve-result.json').read_text())

    def test_original_archived_report_still_passes(self):
        self.assertTrue(verdict(self.original)['passed'])

    def test_incomplete_duplicate_wrong_cap_and_unpaired_artifacts_rejected(self):
        cases=[]
        r=copy.deepcopy(self.original);r['runs'].pop();cases.append(r)
        r=copy.deepcopy(self.original);r['runs'].append(r['runs'][0]);cases.append(r)
        r=copy.deepcopy(self.original);r['runs'][0]['cap']=8000;cases.append(r)
        r=copy.deepcopy(self.original);r['comparisons']=[c for c in r['comparisons'] if c['set_id']!='ktk'];cases.append(r)
        r=copy.deepcopy(self.original);r['runs'][0]['served_slice']['n']+=1;cases.append(r)
        for r in cases:
            with self.assertRaises(ValueError):
                verdict(r)

    def test_failed_rule_returns_nonzero_and_prints_fail(self):
        r=copy.deepcopy(self.original)
        for row in r['runs']:
            if row['variant']['name']==CAND:
                base=next(b for b in r['runs'] if b['set_id']==row['set_id'] and b['variant']['name']==BASE)
                row['served_slice']['log_loss']=base['served_slice']['log_loss']+.01
                row['served_slice']['top1_accuracy']=base['served_slice']['top1_accuracy']-.01
        for c in r['comparisons']:
            if c['slice'].startswith('served'):
                c['paired'].update(log_loss_delta=.01,log_loss_ci95=[.005,.02],
                                   top1_delta=-.01,top1_ci95=[-.02,-.005])
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'result.json';path.write_text(json.dumps(r))
            output=io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main([str(path)]),1)
        self.assertIn('FROZEN TEST FAIL',output.getvalue())
        self.assertNotIn('FROZEN TEST PASS',output.getvalue())


if __name__=='__main__':
    unittest.main()
