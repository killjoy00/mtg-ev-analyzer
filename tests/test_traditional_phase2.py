from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))

from traditional_phase2 import SETS, CUBE, REGRESSION, serving_window, late_floor, expansion

class TraditionalPhase2Tests(unittest.TestCase):
    def test_scope_is_exactly_phase1_testable_environments(self):
        self.assertEqual(len(SETS),27)
        for excluded in ('tmt','ecl','tla','mid','vow','stx'):
            self.assertNotIn(excluded,SETS)
        for included in ('blb','dft','fin','hob','msh','hbg','sir','pio',CUBE):
            self.assertIn(included,SETS)

    def test_cube_uses_true_eight_decision_window(self):
        self.assertEqual(serving_window(CUBE),(2,9))
        self.assertEqual(late_floor(CUBE),8)
        self.assertEqual(expansion(CUBE),'Cube_-_Powered')

    def test_regular_window_is_unchanged(self):
        self.assertEqual(serving_window('blb'),(1,8))
        self.assertEqual(late_floor('blb'),7)
        self.assertEqual(expansion('blb'),'BLB')

    def test_reference_results_are_predeclared(self):
        self.assertEqual(REGRESSION,{'blb':True,'dft':True,'fin':True,'hob':False})

if __name__=='__main__':unittest.main()
