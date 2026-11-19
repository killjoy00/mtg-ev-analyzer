import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import v5_rebuild as rebuild
from v5_rebuild_qa import compare
from model_training import V5_MODEL


class V5RebuildTests(unittest.TestCase):
    def test_checkpoint_survives_a_new_runner_and_rejects_corrupt_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            remote=root/'remote';remote.mkdir()
            build=root/'build';build.mkdir()
            original=root/'original';original.mkdir()
            (original/'manifest.json').write_text('{"model":"v5"}')
            def transfer(local,key,upload=False,optional=False):
                import shutil
                dest=remote/Path(key).name
                if upload:
                    shutil.copyfile(local,dest)
                elif dest.exists():
                    shutil.copyfile(dest,local)
                else:
                    return False
                return True
            with patch.object(rebuild,'BUILD',build),patch.object(rebuild,'r2',side_effect=transfer):
                rebuild.checkpoint(original,'mom/replay','a'*64)
                restored=root/'fresh-runner'
                self.assertTrue(rebuild.restore(restored,'mom/replay','a'*64))
                self.assertEqual((restored/'manifest.json').read_bytes(),(original/'manifest.json').read_bytes())
                (original/'manifest.json').write_text('corrupt')
                # Archive corruption is not masked by a nominal successful R2 download.
                import tarfile
                with tarfile.open(remote/'replay.tgz','w:gz') as archive:
                    for p in original.iterdir():archive.add(p,arcname=p.name)
                with self.assertRaisesRegex(ValueError,'Corrupt or stale'):
                    rebuild.restore(root/'corrupt-runner','mom/replay','a'*64)

    def test_post_build_qa_measures_real_support_leader_score_and_difficulty_changes(self):
        def puzzle(a,b):
            return {'model_version':V5_MODEL,'source_draft_hash':'a'*32,'pick_number':1,
                'historical_pick_id':'A','prior_picks':[],
                'candidates':[{'id':'A','model_probability':a},{'id':'B','model_probability':b}]}
        result=compare([puzzle(.8,.2)],[puzzle(.4,.6)])
        self.assertEqual(result['matched_decisions'],1)
        self.assertEqual(result['leader_change_fraction'],1)
        self.assertAlmostEqual(result['probability_total_variation']['mean'],.4)
        self.assertGreater(result['card_score_displacement']['maximum'],0)
        self.assertGreater(result['rating_displacement']['maximum'],0)
        for invalid in (puzzle(float('nan'),.5),{**puzzle(.4,.6),'model_version':'strong-player-colour-stage-v4'}):
            with self.assertRaisesRegex(ValueError,'Invalid or mixed'):
                compare([], [invalid])


if __name__=='__main__':unittest.main()
