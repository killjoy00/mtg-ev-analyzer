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
            counts,folds,output,invalid,n,colour=collect(p,{'training'},{'trophy'},header)
            self.assertEqual(n,1);self.assertEqual(set(output),{'trophy'})
            self.assertEqual(output['trophy'][0].historical_pick,'B')
            # The colour table may learn from the training draft but never from
            # the trophy, which is the puzzle this build will serve.
            self.assertEqual({did for did,_ in colour},{'training'})

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
            *_,output,invalid,n,colour=collect(p,set(),{'trophy'},header)
            self.assertEqual(colour,[])
            self.assertEqual(len(output['trophy']),1)
            self.assertEqual(output['trophy'][0].raw_pack_number,0)

    def test_training_cap_default_matches_the_published_constant(self):
        import inspect
        from import_all_trophies import TRAINING_DRAFT_CAP, build_set
        # The published corpus was scored at this cap. build_set must keep
        # defaulting to it, or an ordinary import would silently re-score.
        self.assertEqual(TRAINING_DRAFT_CAP, 5000)
        self.assertEqual(inspect.signature(build_set).parameters['training_cap'].default,
                         TRAINING_DRAFT_CAP)

    def test_changing_the_cap_is_refused_once_a_set_has_published_puzzles(self):
        from import_all_trophies import TRAINING_DRAFT_CAP, check_training_cap
        with self.assertRaisesRegex(ValueError, 'differs from the published baseline cap'):
            check_training_cap('blb', TRAINING_DRAFT_CAP * 2, 1200)

    def test_cap_change_is_allowed_for_a_set_with_no_published_puzzles(self):
        from import_all_trophies import TRAINING_DRAFT_CAP, check_training_cap
        check_training_cap('brandnew', TRAINING_DRAFT_CAP * 2, 0)
        check_training_cap('blb', TRAINING_DRAFT_CAP, 1200)

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


class CorpusVersionTests(unittest.TestCase):
    """The corpus version is hashed into every puzzle id. A bump that lands in
    one language and not the other makes the server unable to resolve its own
    puzzles - and worse, lets the importer reuse old payloads under a new
    label, putting two models in one corpus."""

    def test_python_reads_the_version_from_the_javascript(self):
        from set_policy import corpus_version
        import import_all_trophies
        self.assertEqual(import_all_trophies.VERSION, corpus_version())

    # Superseded corpus builders, predecessors of import_all_trophies.py and
    # wired to no workflow. They carry their own dead lineages rather than stale
    # copies of the live one, so they are named here instead of being silently
    # matched - if either is ever revived, this list is the note explaining why
    # its version does not track the current corpus.
    SUPERSEDED_BUILDERS = ('scripts/build_draft_run_corpus.py',
                           'scripts/verify_draft_run_corpus.py')

    def test_no_stale_copy_of_the_version_survives_anywhere(self):
        """Nine places held a version literal. Any one missed during a bump
        reproduces exactly the failure this suite exists to prevent: puzzle ids
        the server cannot resolve, and old payloads reused under a new label."""
        from set_policy import corpus_version
        root = Path(__file__).resolve().parents[1]
        current = corpus_version()
        stale = []
        for path in list(root.glob('scripts/*.py')) + list(root.glob('tests/*.mjs')) \
                + list(root.glob('*.mjs')) + list(root.glob('worker/*.mjs')):
            if str(path.relative_to(root)) in self.SUPERSEDED_BUILDERS:
                continue
            text = path.read_text(encoding='utf-8', errors='ignore')
            for line in text.splitlines():
                if 'elite-trophy-' in line and current not in line \
                        and 'corpus_version' not in line:
                    stale.append(f'{path.relative_to(root)}: {line.strip()[:90]}')
        self.assertEqual(stale, [], 'stale corpus version literal(s) found')

    def test_the_exempt_builders_really_are_wired_to_nothing(self):
        """The exemption is only safe while they stay dead. If one becomes live
        again its version has to start tracking, and this fails first."""
        root = Path(__file__).resolve().parents[1]
        live = list(root.glob('.github/workflows/*.yml')) + list(root.glob('worker/*.mjs'))
        for builder in self.SUPERSEDED_BUILDERS:
            stem = Path(builder).stem
            for path in live:
                with self.subTest(builder=stem, caller=path.name):
                    self.assertNotIn(stem, path.read_text(encoding='utf-8', errors='ignore'))


class SupersedeTests(unittest.TestCase):
    """A baseline at a different version is superseded, not broken. Without
    this, a bump fails every re-verification; without the version check, the
    importer silently keeps old payloads and ships two models as one."""

    def rows(self, version, n=3):
        return [{'puzzle_id': f'p{i}', 'corpus_version': version} for i in range(n)]

    def test_a_baseline_at_the_current_version_is_kept(self):
        from import_all_trophies import VERSION
        rows = self.rows(VERSION)
        superseded = [r for r in rows if r.get('corpus_version') != VERSION]
        self.assertEqual(superseded, [])

    def test_a_baseline_at_an_older_version_is_discarded_whole(self):
        from import_all_trophies import VERSION
        rows = self.rows('elite-trophy-verified-v5')
        superseded = [r for r in rows if r.get('corpus_version') != VERSION]
        self.assertEqual(len(superseded), len(rows))

    def test_a_mixed_baseline_is_refused_rather_than_guessed(self):
        """Half-superseded means an earlier bump went wrong. Picking a side
        would bake that in."""
        from import_all_trophies import VERSION
        rows = self.rows(VERSION, 2) + self.rows('elite-trophy-verified-v5', 2)
        superseded = [r for r in rows if r.get('corpus_version') != VERSION]
        self.assertTrue(0 < len(superseded) < len(rows))

    def test_the_source_of_the_rule_is_present_in_build_set(self):
        import inspect
        from import_all_trophies import build_set
        source = inspect.getsource(build_set)
        self.assertIn('superseded', source)
        self.assertIn('refusing to guess which model produced which puzzle', source)
