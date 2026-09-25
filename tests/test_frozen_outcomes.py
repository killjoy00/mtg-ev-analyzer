from pathlib import Path
import hashlib
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from audit_frozen_outcomes import dispositions

class FrozenOutcomesTests(unittest.TestCase):
    def test_all_legal_trophies_and_every_blocked_source_are_accounted(self):
        drafts={str(n):{'wins':7,'losses':n} for n in range(4)}
        drafts['conflict']={'wins':7,'losses':1};drafts['unknown']={'wins':7,'losses':None}
        sources=[{'draft_id':d,'source_draft_hash':hashlib.sha256(f'test|{d}'.encode()).hexdigest()[:32],'puzzles':8} for d in [*drafts,'missing']]
        result=dispositions('test',sources,drafts,{'conflict'})
        self.assertEqual(result['approved_outcomes'],{'7-0':1,'7-1':1,'7-2':1})
        self.assertEqual(result['approved_sources'],3);self.assertEqual(result['included_sources'],7)
        self.assertEqual(len(result['blocked_sources']),4);self.assertEqual(result['excluded_decisions'],32)
        with self.assertRaisesRegex(ValueError,'identity'):dispositions('test',sources+sources[:1],drafts,set())

if __name__=='__main__':unittest.main()
