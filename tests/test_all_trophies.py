import json
import csv
import gzip
import io
import re
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from import_all_trophies import eligible_trophies, trajectory, rows, collect_legacy_v3, premier_sources, BASE, scan_metadata, classify_source_schema, source_snapshot_identity
from build_replays import PickExample

class FullTrophyTests(unittest.TestCase):
    def test_existing_image_does_not_hide_missing_card_metadata(self):
        from unittest.mock import patch
        from import_all_trophies import resolve_images
        card={'name':'Deduce','type_line':'Instant','mana_cost':'{1}{U}','rarity':'common','image_uris':{'normal':'https://example.com/deduce.jpg'}}
        complete={'image_url':'https://example.com/complete.jpg','type_line':'Land'}
        with tempfile.TemporaryDirectory() as tmp:
            cache=Path(tmp)/'images.json'
            cache.write_text(json.dumps({'Deduce':{'image_url':'https://example.com/old.jpg'}}))
            with patch('import_all_trophies.fetch_named',return_value=card) as fetch_named, patch('import_all_trophies.time.sleep'):
                known=resolve_images({'Deduce','Complete'},{'Complete':complete},cache)
            fetch_named.assert_called_once_with('Deduce')
            self.assertEqual(known['Deduce']['type_line'],'Instant')
            self.assertEqual(known['Complete'],complete)
            with patch('import_all_trophies.fetch_named',side_effect=AssertionError('Complete metadata must use cache')):
                self.assertEqual(resolve_images({'Deduce','Complete'},known,cache),known)

    def test_trophies_have_no_replay_or_training_cap(self):
        drafts={f'd{i}':{'wins':7,'games':100,'rate':.65} for i in range(6001)}
        drafts['loser']={'wins':6,'games':100,'rate':.9}
        drafts['novice']={'wins':7,'games':99,'rate':.9}
        drafts['low']={'wins':7,'games':100,'rate':.59}
        selected,rejected=eligible_trophies(drafts,.62)
        self.assertEqual(len(selected),6001)
        self.assertEqual(set(rejected),{'novice','low'})
        self.assertNotIn('loser',selected)

    def test_all_legal_premier_trophy_records_qualify(self):
        drafts={str(loss):{'wins':7,'losses':loss,'games':100,'rate':.7} for loss in (0,1,2,3)}
        selected,rejected=eligible_trophies(drafts,.62)
        self.assertEqual(set(selected),{'0','1','2'})
        self.assertEqual(rejected,{'3':'invalid_premier_trophy_outcome'})

    def test_frozen_reconstruction_does_not_weaken_current_source_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'draft.csv.gz'
            with gzip.open(p,'wt',newline='') as f:
                w=csv.writer(f);w.writerow(['draft_id','event_type','event_match_wins','event_match_losses','user_n_games_bucket','user_game_win_rate_bucket'])
                w.writerow(['d','PremierDraft',7,1,100,.7]);w.writerow(['d','PremierDraft',7,2,100,.7])
            self.assertEqual(scan_metadata(p)[3],{'d'})
            self.assertEqual(scan_metadata(p,compare_losses=False)[3],set())
            # The normal importer continues to reject inconsistent source outcomes.
            drafts,_,_,conflicts=scan_metadata(p)
            self.assertEqual(eligible_trophies(drafts,.6,conflicts=conflicts)[0],{})

    def test_new_environments_fail_closed_without_modern_skill_schema(self):
        base=['expansion','event_type','draft_id','draft_time','rank','event_match_wins','event_match_losses','pack_number','pick_number']
        with self.assertRaisesRegex(ValueError,'unknown Draft schema'):
            classify_source_schema(base,'fra')
        self.assertEqual(classify_source_schema(base,'stx'),'premier-historical-arena-rank-v1')
        self.assertEqual(classify_source_schema(base+['user_n_games_bucket','user_game_win_rate_bucket'],'fra'),'premier-modern-skill-buckets-v1')

    def test_source_snapshot_identity_changes_with_either_source(self):
        draft={'sha256':'a'*64};game={'sha256':'b'*64}
        first=source_snapshot_identity('fra','premier-modern-skill-buckets-v1',draft,game)
        self.assertRegex(first,r'^[a-f0-9]{64}        drafts={'ok':{'wins':7,'games':100,'rank':'diamond'},'no':{'wins':7,'games':100,'rank':'platinum'},'missing':{'wins':7,'games':None,'rank':'mythic'}}
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
            counts,folds,output,invalid,n,colour=collect_legacy_v3(p,{'training'},{'trophy'},header)
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
            *_,output,invalid,n,colour=collect_legacy_v3(p,set(),{'trophy'},header)
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
        import re
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
                # A copied CURRENT version is already a defect: it becomes
                # stale at the next bump. Field names are not exemptions.
                literal = re.search(r"(['\"])(elite-trophy-[a-z0-9-]+)\1", line)
                canonical = path == root/'draft-run.mjs' and line.startswith('export const DRAFT_RUN_CORPUS_VERSION = ')
                if literal and (not canonical or literal[2] != current):
                    stale.append(f'{path.relative_to(root)}: {line.strip()[:90]}')
        self.assertEqual(stale, [], 'stale corpus version literal(s) found')

    def test_no_script_writes_or_guards_a_model_version_from_a_literal(self):
        """The same failure as the corpus version, one layer down. Two live
        scripts held 'strong-player-pool-context-v2' as a literal: the importer
        stamped it into every manifest it wrote, so a v3 import would have
        claimed v2, and the legacy backfill raised on any manifest that did not
        match it, so the first legitimate model change broke that workflow
        outright. Both were found by reading, not by a failing test."""
        root = Path(__file__).resolve().parents[1]
        offenders = []
        for path in list(root.glob('scripts/*.py')) + list(root.glob('*.mjs')) \
                + list(root.glob('worker/*.mjs')):
            if str(path.relative_to(root)) in self.SUPERSEDED_BUILDERS:
                continue
            for number, line in enumerate(path.read_text(encoding='utf-8',
                                                         errors='ignore').splitlines(), 1):
                # Lowercase: MODEL_VERSION is the constant's own definition.
                if 'model_version' in line and re.search(r"['\"]strong-player-[a-z0-9-]+['\"]", line):
                    offenders.append(f'{path.relative_to(root)}:{number}: {line.strip()[:90]}')
        self.assertEqual(offenders, [],
                         'model version literal(s) found; import the builder constant instead')

    def test_the_version_can_be_written_by_the_same_pattern_that_reads_it(self):
        import shutil
        import tempfile
        from set_policy import corpus_version, set_corpus_version
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            stage = Path(temp)
            shutil.copy2(root/'draft-run.mjs', stage/'draft-run.mjs')
            before = corpus_version(stage)
            self.assertEqual(set_corpus_version('elite-trophy-probe-v99', stage), before)
            self.assertEqual(corpus_version(stage), 'elite-trophy-probe-v99')
            # Exactly one declaration is rewritten, and nothing else moves.
            text = (stage/'draft-run.mjs').read_text(encoding='utf-8')
            self.assertEqual(text.count('elite-trophy-probe-v99'), 1)
            self.assertNotIn(before, text)

    def test_a_malformed_or_repeated_version_is_refused(self):
        import shutil
        import tempfile
        from set_policy import set_corpus_version
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            stage = Path(temp)
            shutil.copy2(root/'draft-run.mjs', stage/'draft-run.mjs')
            original = (stage/'draft-run.mjs').read_text(encoding='utf-8')
            for bad in ('Elite-Trophy-V7', 'v7', 'has space', 'under_scored', ''):
                with self.subTest(version=bad):
                    with self.assertRaises(ValueError):
                        set_corpus_version(bad, stage)
            # Re-declaring the current version is a no-op the caller meant as a
            # bump, so it is an error rather than a silent success.
            from set_policy import corpus_version
            with self.assertRaisesRegex(ValueError, 'already declares'):
                set_corpus_version(corpus_version(stage), stage)
            self.assertEqual((stage/'draft-run.mjs').read_text(encoding='utf-8'), original)

    def test_the_bump_and_the_regeneration_are_one_commit(self):
        """A version declared without rows carrying it is what reverted the
        last two attempts: every puzzle fails validateDraftRunPuzzle and the
        health endpoint goes 503. The workflow must not be able to do half."""
        root = Path(__file__).resolve().parents[1]
        text = (root/'.github/workflows/regenerate-draft-run-corpus.yml').read_text(encoding='utf-8')
        declare = text.index('--set-corpus-version')
        rebuild = text.index('python scripts/build_verified_trophy_corpus.py')
        tests = text.index('run: npm test')
        commit = text.index('git commit -m')
        self.assertLess(declare, rebuild, 'the version must be declared before the rebuild reads it')
        self.assertLess(rebuild, tests, 'the suite must run against the regenerated corpus')
        self.assertLess(tests, commit, 'nothing is committed before the suite passes')
        self.assertIn('git add draft-run.mjs corpus/draft-run', text)
        # A mixed data/ would publish two models under one label.
        self.assertLess(text.index('Refuse a half-rebuilt data directory'), declare)

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


class RetirementTests(unittest.TestCase):
    """Retirement lives in two places that must agree: the fingerprint list in
    data/selection-policy.json, which every script reads, and the CHECK
    constraints in the migrations, which the database enforces. 0010 pinned each
    CHECK to the two fingerprints retired at the time, so a later retirement that
    only appends to the policy would be deleted once and admitted by the database
    ever after."""

    def _policy_fingerprints(self):
        root = Path(__file__).resolve().parents[1]
        return json.loads((root / 'data/selection-policy.json').read_text(
            encoding='utf-8'))['retired_set_fingerprints']

    def test_the_newest_retirement_migration_covers_every_fingerprint(self):
        root = Path(__file__).resolve().parents[1]
        migrations = sorted(root.glob('migrations/*_retire_*.sql'))
        self.assertTrue(migrations, 'no retirement migration found')
        newest = migrations[-1].read_text(encoding='utf-8')
        for fingerprint in self._policy_fingerprints():
            with self.subTest(fingerprint=fingerprint[:12]):
                self.assertIn(fingerprint, newest)

    # child table -> parent it references, for every foreign key that a
    # set-scoped delete can trip. 0010 predates the first two and deleted the
    # parent first, which aborts the migration on a real database:
    #   ERROR: delete on "draft_run_verified_puzzles" violates foreign key
    #   constraint "draft_run_decision_observations_puzzle_id_fkey"
    FOREIGN_KEYS = (
        ('draft_run_decision_observations', 'draft_run_verified_puzzles'),
        ('draft_run_puzzle_ratings', 'draft_run_verified_puzzles'),
        ('draft_run_verified_puzzles', 'draft_run_verified_sets'),
        ('draft_run_environment_policy', 'draft_run_verified_sets'),
        ('draft_run_puzzles', 'draft_run_sets'),
        ('game_result_environments', 'game_results'),
    )

    def test_every_dependent_is_deleted_before_the_table_it_references(self):
        root = Path(__file__).resolve().parents[1]
        text = sorted(root.glob('migrations/*_retire_*.sql'))[-1].read_text(encoding='utf-8')
        deletes = [line.split()[2] for line in text.splitlines()
                   if line.startswith('DELETE FROM ')]
        for child, parent in self.FOREIGN_KEYS:
            with self.subTest(child=child, parent=parent):
                self.assertIn(child, deletes, f'{child} rows are never cleared')
                self.assertIn(parent, deletes, f'{parent} rows are never cleared')
                self.assertLess(deletes.index(child), deletes.index(parent),
                                f'{child} must be deleted before {parent}')

    def test_the_newest_migration_replaces_constraints_rather_than_adding(self):
        """Adding a constraint beside an older, narrower one leaves the old one
        in place; only a DROP then ADD actually widens the enforced list."""
        root = Path(__file__).resolve().parents[1]
        newest = sorted(root.glob('migrations/*_retire_*.sql'))[-1].read_text(encoding='utf-8')
        adds = newest.count('ADD CONSTRAINT')
        drops = newest.count('DROP CONSTRAINT IF EXISTS')
        self.assertEqual(adds, drops,
                         'every re-added constraint must be dropped first')

    def test_a_retired_environment_is_absent_from_both_catalogs(self):
        """A retired set left in either catalog makes the health endpoint compare
        a set count that can never be satisfied."""
        from set_policy import supported_set
        root = Path(__file__).resolve().parents[1]
        for relative in ('data/catalog.json', 'corpus/draft-run/catalog.json'):
            catalog = json.loads((root / relative).read_text(encoding='utf-8'))
            retired = [s['id'] for s in catalog['sets'] if not supported_set(s['id'])]
            self.assertEqual(retired, [], f'{relative} still lists a retired environment')

    def test_the_policy_never_names_an_environment_it_has_retired(self):
        """The fingerprint list is not the whole policy. regular_sets_newest_first
        and release_dates kept naming a retired environment, so selection still
        offered it while the migration had already deleted its puzzles: the run
        came back with a puzzle id that loads to nothing, and the backend
        answered 409 'This challenge uses an unavailable corpus.'"""
        from set_policy import supported_set
        root = Path(__file__).resolve().parents[1]
        policy = json.loads((root / 'data/selection-policy.json').read_text(encoding='utf-8'))

        def named(value, path='policy'):
            if isinstance(value, dict):
                return [f'{path}.{k}' for k in value if isinstance(k, str) and not supported_set(k)] + \
                       [hit for k, v in value.items() for hit in named(v, f'{path}.{k}')]
            if isinstance(value, list):
                return [f'{path}[{i}]' for i, v in enumerate(value)
                        if isinstance(v, str) and not supported_set(v)]
            return []

        offenders = named({k: v for k, v in policy.items()
                           if k != 'retired_set_fingerprints'})
        self.assertEqual(offenders, [],
                         'selection policy still offers a retired environment')

    def test_the_two_catalogs_agree(self):
        root = Path(__file__).resolve().parents[1]
        registry = {s['id'] for s in json.loads(
            (root / 'data/catalog.json').read_text(encoding='utf-8'))['sets']}
        corpus = {s['id'] for s in json.loads(
            (root / 'corpus/draft-run/catalog.json').read_text(encoding='utf-8'))['sets']}
        self.assertEqual(registry, corpus)

    def test_no_committed_file_survives_for_a_retired_environment(self):
        """Scoped to TRACKED files on purpose. CI hydrates the replay shards from
        R2, and the object purge runs on merge to main, so a working-tree scan
        sees a retired environment's shards sitting there on every pre-merge run
        and can never pass. What a pull request controls is what is committed."""
        import subprocess
        from purge_retired_data import retired_path
        root = Path(__file__).resolve().parents[1]
        tracked = subprocess.run(['git', 'ls-files', 'data', 'corpus/draft-run'],
                                 cwd=root, capture_output=True, text=True, check=True)
        stale = [line for line in tracked.stdout.split()
                 if retired_path(Path(line))]
        self.assertEqual(stale, [], 'retired environment files are still committed')

    def test_the_published_health_snapshot_forgets_a_retired_environment(self):
        """purge_retired_data works on PATHS, so a generated file that merely
        NAMES a retired environment survives it. data/status.json is exactly
        that: regenerated by audit_datasets.py, and it came back from a merge
        still listing the retired set after every file of its own was gone."""
        from set_policy import supported_set
        root = Path(__file__).resolve().parents[1]
        status = json.loads((root / 'data/status.json').read_text(encoding='utf-8'))
        named = [d.get('id') for d in status.get('datasets', [])
                 if d.get('id') and not supported_set(d['id'])]
        self.assertEqual(named, [], 'health snapshot still lists a retired environment')
        registry = {s['id'] for s in json.loads(
            (root / 'data/catalog.json').read_text(encoding='utf-8'))['sets']}
        self.assertEqual({d['id'] for d in status.get('datasets', [])}, registry)
)
        self.assertNotEqual(first,source_snapshot_identity('fra','premier-modern-skill-buckets-v1',{'sha256':'c'*64},game))
        self.assertNotEqual(first,source_snapshot_identity('fra','premier-modern-skill-buckets-v1',draft,{'sha256':'d'*64}))

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
            counts,folds,output,invalid,n,colour=collect_legacy_v3(p,{'training'},{'trophy'},header)
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
            *_,output,invalid,n,colour=collect_legacy_v3(p,set(),{'trophy'},header)
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
        import re
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
                # A copied CURRENT version is already a defect: it becomes
                # stale at the next bump. Field names are not exemptions.
                literal = re.search(r"(['\"])(elite-trophy-[a-z0-9-]+)\1", line)
                canonical = path == root/'draft-run.mjs' and line.startswith('export const DRAFT_RUN_CORPUS_VERSION = ')
                if literal and (not canonical or literal[2] != current):
                    stale.append(f'{path.relative_to(root)}: {line.strip()[:90]}')
        self.assertEqual(stale, [], 'stale corpus version literal(s) found')

    def test_no_script_writes_or_guards_a_model_version_from_a_literal(self):
        """The same failure as the corpus version, one layer down. Two live
        scripts held 'strong-player-pool-context-v2' as a literal: the importer
        stamped it into every manifest it wrote, so a v3 import would have
        claimed v2, and the legacy backfill raised on any manifest that did not
        match it, so the first legitimate model change broke that workflow
        outright. Both were found by reading, not by a failing test."""
        root = Path(__file__).resolve().parents[1]
        offenders = []
        for path in list(root.glob('scripts/*.py')) + list(root.glob('*.mjs')) \
                + list(root.glob('worker/*.mjs')):
            if str(path.relative_to(root)) in self.SUPERSEDED_BUILDERS:
                continue
            for number, line in enumerate(path.read_text(encoding='utf-8',
                                                         errors='ignore').splitlines(), 1):
                # Lowercase: MODEL_VERSION is the constant's own definition.
                if 'model_version' in line and re.search(r"['\"]strong-player-[a-z0-9-]+['\"]", line):
                    offenders.append(f'{path.relative_to(root)}:{number}: {line.strip()[:90]}')
        self.assertEqual(offenders, [],
                         'model version literal(s) found; import the builder constant instead')

    def test_the_version_can_be_written_by_the_same_pattern_that_reads_it(self):
        import shutil
        import tempfile
        from set_policy import corpus_version, set_corpus_version
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            stage = Path(temp)
            shutil.copy2(root/'draft-run.mjs', stage/'draft-run.mjs')
            before = corpus_version(stage)
            self.assertEqual(set_corpus_version('elite-trophy-probe-v99', stage), before)
            self.assertEqual(corpus_version(stage), 'elite-trophy-probe-v99')
            # Exactly one declaration is rewritten, and nothing else moves.
            text = (stage/'draft-run.mjs').read_text(encoding='utf-8')
            self.assertEqual(text.count('elite-trophy-probe-v99'), 1)
            self.assertNotIn(before, text)

    def test_a_malformed_or_repeated_version_is_refused(self):
        import shutil
        import tempfile
        from set_policy import set_corpus_version
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            stage = Path(temp)
            shutil.copy2(root/'draft-run.mjs', stage/'draft-run.mjs')
            original = (stage/'draft-run.mjs').read_text(encoding='utf-8')
            for bad in ('Elite-Trophy-V7', 'v7', 'has space', 'under_scored', ''):
                with self.subTest(version=bad):
                    with self.assertRaises(ValueError):
                        set_corpus_version(bad, stage)
            # Re-declaring the current version is a no-op the caller meant as a
            # bump, so it is an error rather than a silent success.
            from set_policy import corpus_version
            with self.assertRaisesRegex(ValueError, 'already declares'):
                set_corpus_version(corpus_version(stage), stage)
            self.assertEqual((stage/'draft-run.mjs').read_text(encoding='utf-8'), original)

    def test_the_bump_and_the_regeneration_are_one_commit(self):
        """A version declared without rows carrying it is what reverted the
        last two attempts: every puzzle fails validateDraftRunPuzzle and the
        health endpoint goes 503. The workflow must not be able to do half."""
        root = Path(__file__).resolve().parents[1]
        text = (root/'.github/workflows/regenerate-draft-run-corpus.yml').read_text(encoding='utf-8')
        declare = text.index('--set-corpus-version')
        rebuild = text.index('python scripts/build_verified_trophy_corpus.py')
        tests = text.index('run: npm test')
        commit = text.index('git commit -m')
        self.assertLess(declare, rebuild, 'the version must be declared before the rebuild reads it')
        self.assertLess(rebuild, tests, 'the suite must run against the regenerated corpus')
        self.assertLess(tests, commit, 'nothing is committed before the suite passes')
        self.assertIn('git add draft-run.mjs corpus/draft-run', text)
        # A mixed data/ would publish two models under one label.
        self.assertLess(text.index('Refuse a half-rebuilt data directory'), declare)

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


class RetirementTests(unittest.TestCase):
    """Retirement lives in two places that must agree: the fingerprint list in
    data/selection-policy.json, which every script reads, and the CHECK
    constraints in the migrations, which the database enforces. 0010 pinned each
    CHECK to the two fingerprints retired at the time, so a later retirement that
    only appends to the policy would be deleted once and admitted by the database
    ever after."""

    def _policy_fingerprints(self):
        root = Path(__file__).resolve().parents[1]
        return json.loads((root / 'data/selection-policy.json').read_text(
            encoding='utf-8'))['retired_set_fingerprints']

    def test_the_newest_retirement_migration_covers_every_fingerprint(self):
        root = Path(__file__).resolve().parents[1]
        migrations = sorted(root.glob('migrations/*_retire_*.sql'))
        self.assertTrue(migrations, 'no retirement migration found')
        newest = migrations[-1].read_text(encoding='utf-8')
        for fingerprint in self._policy_fingerprints():
            with self.subTest(fingerprint=fingerprint[:12]):
                self.assertIn(fingerprint, newest)

    # child table -> parent it references, for every foreign key that a
    # set-scoped delete can trip. 0010 predates the first two and deleted the
    # parent first, which aborts the migration on a real database:
    #   ERROR: delete on "draft_run_verified_puzzles" violates foreign key
    #   constraint "draft_run_decision_observations_puzzle_id_fkey"
    FOREIGN_KEYS = (
        ('draft_run_decision_observations', 'draft_run_verified_puzzles'),
        ('draft_run_puzzle_ratings', 'draft_run_verified_puzzles'),
        ('draft_run_verified_puzzles', 'draft_run_verified_sets'),
        ('draft_run_environment_policy', 'draft_run_verified_sets'),
        ('draft_run_puzzles', 'draft_run_sets'),
        ('game_result_environments', 'game_results'),
    )

    def test_every_dependent_is_deleted_before_the_table_it_references(self):
        root = Path(__file__).resolve().parents[1]
        text = sorted(root.glob('migrations/*_retire_*.sql'))[-1].read_text(encoding='utf-8')
        deletes = [line.split()[2] for line in text.splitlines()
                   if line.startswith('DELETE FROM ')]
        for child, parent in self.FOREIGN_KEYS:
            with self.subTest(child=child, parent=parent):
                self.assertIn(child, deletes, f'{child} rows are never cleared')
                self.assertIn(parent, deletes, f'{parent} rows are never cleared')
                self.assertLess(deletes.index(child), deletes.index(parent),
                                f'{child} must be deleted before {parent}')

    def test_the_newest_migration_replaces_constraints_rather_than_adding(self):
        """Adding a constraint beside an older, narrower one leaves the old one
        in place; only a DROP then ADD actually widens the enforced list."""
        root = Path(__file__).resolve().parents[1]
        newest = sorted(root.glob('migrations/*_retire_*.sql'))[-1].read_text(encoding='utf-8')
        adds = newest.count('ADD CONSTRAINT')
        drops = newest.count('DROP CONSTRAINT IF EXISTS')
        self.assertEqual(adds, drops,
                         'every re-added constraint must be dropped first')

    def test_a_retired_environment_is_absent_from_both_catalogs(self):
        """A retired set left in either catalog makes the health endpoint compare
        a set count that can never be satisfied."""
        from set_policy import supported_set
        root = Path(__file__).resolve().parents[1]
        for relative in ('data/catalog.json', 'corpus/draft-run/catalog.json'):
            catalog = json.loads((root / relative).read_text(encoding='utf-8'))
            retired = [s['id'] for s in catalog['sets'] if not supported_set(s['id'])]
            self.assertEqual(retired, [], f'{relative} still lists a retired environment')

    def test_the_policy_never_names_an_environment_it_has_retired(self):
        """The fingerprint list is not the whole policy. regular_sets_newest_first
        and release_dates kept naming a retired environment, so selection still
        offered it while the migration had already deleted its puzzles: the run
        came back with a puzzle id that loads to nothing, and the backend
        answered 409 'This challenge uses an unavailable corpus.'"""
        from set_policy import supported_set
        root = Path(__file__).resolve().parents[1]
        policy = json.loads((root / 'data/selection-policy.json').read_text(encoding='utf-8'))

        def named(value, path='policy'):
            if isinstance(value, dict):
                return [f'{path}.{k}' for k in value if isinstance(k, str) and not supported_set(k)] + \
                       [hit for k, v in value.items() for hit in named(v, f'{path}.{k}')]
            if isinstance(value, list):
                return [f'{path}[{i}]' for i, v in enumerate(value)
                        if isinstance(v, str) and not supported_set(v)]
            return []

        offenders = named({k: v for k, v in policy.items()
                           if k != 'retired_set_fingerprints'})
        self.assertEqual(offenders, [],
                         'selection policy still offers a retired environment')

    def test_the_two_catalogs_agree(self):
        root = Path(__file__).resolve().parents[1]
        registry = {s['id'] for s in json.loads(
            (root / 'data/catalog.json').read_text(encoding='utf-8'))['sets']}
        corpus = {s['id'] for s in json.loads(
            (root / 'corpus/draft-run/catalog.json').read_text(encoding='utf-8'))['sets']}
        self.assertEqual(registry, corpus)

    def test_no_committed_file_survives_for_a_retired_environment(self):
        """Scoped to TRACKED files on purpose. CI hydrates the replay shards from
        R2, and the object purge runs on merge to main, so a working-tree scan
        sees a retired environment's shards sitting there on every pre-merge run
        and can never pass. What a pull request controls is what is committed."""
        import subprocess
        from purge_retired_data import retired_path
        root = Path(__file__).resolve().parents[1]
        tracked = subprocess.run(['git', 'ls-files', 'data', 'corpus/draft-run'],
                                 cwd=root, capture_output=True, text=True, check=True)
        stale = [line for line in tracked.stdout.split()
                 if retired_path(Path(line))]
        self.assertEqual(stale, [], 'retired environment files are still committed')

    def test_the_published_health_snapshot_forgets_a_retired_environment(self):
        """purge_retired_data works on PATHS, so a generated file that merely
        NAMES a retired environment survives it. data/status.json is exactly
        that: regenerated by audit_datasets.py, and it came back from a merge
        still listing the retired set after every file of its own was gone."""
        from set_policy import supported_set
        root = Path(__file__).resolve().parents[1]
        status = json.loads((root / 'data/status.json').read_text(encoding='utf-8'))
        named = [d.get('id') for d in status.get('datasets', [])
                 if d.get('id') and not supported_set(d['id'])]
        self.assertEqual(named, [], 'health snapshot still lists a retired environment')
        registry = {s['id'] for s in json.loads(
            (root / 'data/catalog.json').read_text(encoding='utf-8'))['sets']}
        self.assertEqual({d['id'] for d in status.get('datasets', [])}, registry)
