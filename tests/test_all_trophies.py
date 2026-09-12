import csv
import gzip
import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from import_all_trophies import eligible_trophies, trajectory, rows, collect, premier_sources, BASE
from build_replays import PickExample

class FullTrophyTests(unittest.TestCase):
    def test_trophies_have_no_replay_or_training_cap(self):
        drafts={f'd{i}':{'wins':7,'games':100,'rate':.65} for i in range(6001)}
        drafts['loser']={'wins':6,'games':100,'rate':.9}
        drafts['novice']={'wins':7,'games':99,'rate':.9}
        drafts['low']={'wins':7,'games':100,'rate':.59}
        selected,rejected=eligible_trophies(drafts,.62)
        self.assertEqual(len(selected),6001)
        self.assertEqual(set(rejected),{'novice','low'})
        self.assertNotIn('loser',selected)

    def test_legacy_requires_actual_rank_and_experience(self):
        drafts={'ok':{'wins':7,'games':100,'rank':'diamond'},'no':{'wins':7,'games':100,'rank':'platinum'},'missing':{'wins':7,'games':None,'rank':'mythic'}}
        selected,rejected=eligible_trophies(drafts,None,True)
        self.assertEqual(set(selected),{'ok'})
        self.assertEqual(len(rejected),2)

    def test_valid_prefix_survives_later_gap_but_no_history_is_invented(self):
        a=PickExample('d',0,0,'A',['A','B','C','D'],{})
        gap=PickExample('d',0,2,'B',['B','C','D','E'],{'A':2})
        valid,prior,reason=trajectory([gap,a],11)
        self.assertEqual(valid,[a]);self.assertEqual(prior,[])
        self.assertEqual(reason,'trajectory_gap_or_duplicate')
        self.assertEqual(trajectory([gap],11)[0],[])

    def test_p1p2_uses_real_initial_pool_and_detects_mismatch(self):
        a=PickExample('d',0,1,'B',['B','C','D','E'],{'A':1})
        b=PickExample('d',0,2,'C',['C','D','E','F'],{'A':2})
        valid,prior,reason=trajectory([a,b],12)
        self.assertEqual(valid,[a]);self.assertEqual(prior,['A'])
        self.assertEqual(reason,'trajectory_pool_mismatch')

    def test_tar_gz_and_plain_csv_gz_are_equivalent(self):
        content=b'draft_id,event_type\na,PremierDraft\nb,PremierDraft\n'
        with tempfile.TemporaryDirectory() as tmp:
            plain=Path(tmp)/'plain.gz';plain.write_bytes(gzip.compress(content))
            tarred=Path(tmp)/'tar.gz'
            with tarfile.open(tarred,'w:gz') as f:
                info=tarfile.TarInfo('nested/data.csv');info.size=len(content);f.addfile(info,io.BytesIO(content))
            self.assertEqual(list(rows(plain,{'b'})),list(rows(tarred,{'b'})))
            self.assertEqual(list(rows(tarred,{'b'})),[{'draft_id':'b','event_type':'PremierDraft'}])

    def test_output_drafts_need_not_be_in_training(self):
        header=['draft_id','pack_number','pick_number','pick','pack_card_A','pack_card_B','pack_card_C','pack_card_D','pool_A']
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'a.gz'
            with gzip.open(p,'wt',newline='') as f:
                w=csv.writer(f);w.writerow(header)
                w.writerow(['training',0,0,'A',1,1,1,1,0]);w.writerow(['trophy',0,0,'B',1,1,1,1,0])
            counts,folds,output,invalid,n=collect(p,{'training'},{'trophy'},header)
            self.assertEqual(n,1);self.assertEqual(set(output),{'trophy'})
            self.assertEqual(output['trophy'][0].historical_pick,'B')

    def test_discovery_does_not_depend_on_local_catalog(self):
        def record(exp,fmt,link=True):
            return {'expansion':[{'text':exp}],'format':[{'text':fmt}],'draft_data':[{'spans':[{'type':'hyperlink','data':{'url':f'{BASE}/draft_data/draft_data_public.{exp}.{fmt}.csv.gz'}}] if link else []}]}
        doc={'results':[{'data':{'datasets':[record('NEW','PremierDraft'),record('MISSING','PremierDraft',False),record('OM1','PickTwoDraft'),record('Cube_-_Powered','PremierDraft')]}}]}
        sources,missing=premier_sources(doc)
        self.assertEqual(sources,{'new':'NEW','powered-cube':'Cube_-_Powered'})
        self.assertEqual(missing,[{'expansion':'MISSING','reason':'no_public_draft_archive'}])

    def test_later_packs_cannot_enter_trophy_output(self):
        example=PickExample('d',1,0,'A',['A','B','C','D'],{})
        self.assertEqual(trajectory([example],10),([],[],'non_first_pack'))
        header=['draft_id','pack_number','pick_number','pick','pack_card_A','pack_card_B','pack_card_C','pack_card_D','pool_A']
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'first-pack.gz'
            with gzip.open(p,'wt',newline='') as f:
                w=csv.writer(f);w.writerow(header)
                for pack in (0,1,2):w.writerow(['trophy',pack,0,'A',1,1,1,1,0])
            *_,output,invalid,n=collect(p,set(),{'trophy'},header)
            self.assertEqual(len(output['trophy']),1)
            self.assertEqual(output['trophy'][0].raw_pack_number,0)

    def test_retired_environment_is_rejected_before_network_or_files(self):
        import hashlib
        from unittest.mock import patch
        import set_policy
        from import_all_trophies import build_set
        fake=hashlib.sha256(b'retired').hexdigest()
        with patch.dict(set_policy.POLICY,{'retired_set_fingerprints':[fake]}):
            with patch('import_all_trophies.request',side_effect=AssertionError('Network must not be called')):
                with self.assertRaisesRegex(ValueError,'permanently retired'):
                    build_set('retired','unused')

if __name__=='__main__':unittest.main()
