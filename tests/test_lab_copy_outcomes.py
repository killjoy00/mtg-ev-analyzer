import csv
import gzip
import json
import tempfile
import unittest
from pathlib import Path
from scripts.lab_copy_outcomes import build_report, digest, write_report

class CopyOutcomeTests(unittest.TestCase):
    def test_exact_and_pooled_counts_with_duplicate_exclusion(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'fixture.csv.gz'
            header=['draft_id','game_time','build_index','match_number','game_number','won','main_colors','user_game_win_rate_bucket','user_n_games_bucket','deck_Forest','deck_Island','deck_Fixture Card']
            rows=[]
            for n in (1,2,3,4):
                for d in range(40):
                    for g in range(5):
                        rows.append([f'private-fixture-{n}-{d}',f't-{g}',0,g,0,str(g<({1:2,2:3,3:3,4:4}[n])), 'GU','.65','100',20,20-n,n])
            rows.extend([rows[0].copy(),['bad','t',0,0,0,'unknown','UG','.65','100',20,19,1]])
            with gzip.open(p,'wt',newline='') as f:
                writer=csv.writer(f)
                writer.writerow(header)
                writer.writerows(rows)
            report=build_report(p,'fixture',digest(p))
            self.assertEqual((report['raw_games'],report['games'],report['duplicate_games'],report['invalid_games']),(802,799,2,1))
            c=report['cards']['Fixture Card']
            self.assertEqual(c['all'],{'1':[79,199,40],'2':[120,200,40],'3':[120,200,40],'4+':[160,200,40],'2+':[400,600,120]})
            self.assertEqual(c['strata']['UG|60plus']['2+'],[400,600,120])
            self.assertNotIn('private-fixture',json.dumps(report))
            self.assertEqual(write_report(Path(tmp)/'out.json',report),digest(Path(tmp)/'out.json'))
            with self.assertRaisesRegex(ValueError,'lab-outcomes-source-hash'):
                build_report(p,'fixture','a'*64)

    def test_missing_schema_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'fixture.csv.gz'
            with gzip.open(p,'wt') as f:
                f.write('won,deck_Forest\nTrue,40\n')
            with self.assertRaisesRegex(ValueError,'lab-outcomes-schema'):
                build_report(p,'fixture',digest(p))

if __name__=='__main__':
    unittest.main()
