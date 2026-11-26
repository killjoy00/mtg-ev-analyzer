"""Synthetic archive/adapter contracts, not a real-data model test."""
import csv
from datetime import timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from pool_aware_archive import (BaselineView, choice, load_manifest, phase_of,
    scan_baseline_games, scan_drafts, select_sources, sha256, shuffled, time_utc,
    fit_arms)


def write_csv(path, fields, rows):
    with path.open('w', newline='', encoding='utf8') as f:
        w = csv.writer(f)
        w.writerow(fields)
        w.writerows(rows)


def quantile(values, fraction):
    return sorted(values)[int((1-fraction)*len(values))]


class ArchiveContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = self.root/'manifest.json'
        self.draft = self.root/'draft.csv'
        self.game = self.root/'games.csv'
        self.metadata = self.root/'metadata.json'
        self.edges = self.root/'edges.json'
        self.metadata.write_text('{}')
        self.edges.write_text('{"schema":1,"edges":[]}')
        write_csv(self.draft, ['draft_id','draft_time','user_game_win_rate_bucket','user_n_games_bucket'], [
            ['b','2026-01-01 12:00:00',.7,100], ['c','2026-01-02',.9,100],
            ['bad','2026-01-03',.8,100], ['bad','2026-01-20',.8,100],
            ['r','2026-02-05',.8,100], ['v','2026-03-05',.8,100],
            ['o','2026-03-06',.5,100], ['a','2026-04-05',.9,100],
        ])
        write_csv(self.game, ['draft_id','game_time','main_colors','splash_colors'], [
            ['b','2026-01-01 13:00:00','W',''], ['c','2026-02-04','U',''],
            ['v','not read','W',''],
        ])
        self.config = {'schema':1,'set':'TEST','mode':'PremierDraft','windows':{
            'baseline':['2026-01-01','2026-01-15'], 'residual':['2026-02-01','2026-02-15'],
            'validation':['2026-03-01','2026-03-15'], 'assessment':['2026-04-01','2026-04-15']},
            'sources':{k:{'path':p.name,'origin':'synthetic','sha256':sha256(p)} for k,p in (
                ('draft',self.draft),('games',self.game),('metadata',self.metadata),('interactions',self.edges))}}
        self.save()

    def save(self):
        self.manifest.write_text(json.dumps(self.config))

    def test_temporal_split_and_game_purge(self):
        _, windows, _ = load_manifest(self.manifest)
        self.assertEqual(time_utc('2026-01-01').tzinfo,timezone.utc)
        self.assertIsNone(phase_of(time_utc('2026-04-05'),windows))
        sources, invalid = scan_drafts(self.draft,windows,float,int)
        self.assertEqual(invalid,1)
        self.assertNotIn('bad',sources)
        self.assertNotIn('a',sources)
        linked, crossed = scan_baseline_games(self.game,sources,windows['baseline'][1])
        self.assertEqual(crossed,{'c'})
        self.assertEqual(set(linked),{'b','c'})
        strong, control, cutoff = select_sources(sources,crossed,quantile)
        self.assertEqual(set(strong),{'b','r','v'})
        self.assertEqual(set(control),{'o'})
        self.assertEqual(cutoff,.7)

    def test_manifest_fails_closed(self):
        self.game.write_text('tampered')
        with self.assertRaisesRegex(ValueError,'checksum'):
            load_manifest(self.manifest)
        self.config['sources']['games']['sha256']=sha256(self.game)
        self.config['windows']['residual'][0]='2026-01-16'
        self.save()
        with self.assertRaisesRegex(ValueError,'purge'):
            load_manifest(self.manifest)

    def test_zero_gap_still_rejects_overlap_crossing_and_cutoff_games(self):
        self.config['purge_days']=0
        self.config['windows']={
            'baseline':['2026-01-01','2026-02-01'],
            'residual':['2026-02-01','2026-03-01'],
            'validation':['2026-03-01','2026-04-01'],
            'assessment':['2026-04-01','2026-05-01']}
        write_csv(self.draft,['draft_id','draft_time','user_game_win_rate_bucket','user_n_games_bucket'],[
            ['b','2026-01-01',.8,100],['c','2026-01-02',.9,100],
            ['bad','2026-01-31',.8,100],['bad','2026-02-01',.8,100],
            ['r','2026-02-01',.8,100],['v','2026-03-01',.8,100],
            ['a','2026-04-01',.8,100]])
        write_csv(self.game,['draft_id','game_time','main_colors','splash_colors'],[
            ['b','2026-01-31 23:59:59','W',''],
            ['c','2026-02-01','W',''],
            ['r','not read','W','']])
        self.config['sources']['draft']['sha256']=sha256(self.draft)
        self.config['sources']['games']['sha256']=sha256(self.game)
        self.save()
        _,windows,_=load_manifest(self.manifest)
        self.assertEqual(phase_of(time_utc('2026-02-01'),windows),'residual')
        self.assertEqual(phase_of(time_utc('2026-03-01'),windows),'validation')
        self.assertIsNone(phase_of(time_utc('2026-04-01'),windows))
        sources,invalid=scan_drafts(self.draft,windows,float,int)
        self.assertEqual(invalid,1)
        self.assertNotIn('bad',sources)
        self.assertNotIn('a',sources)
        _,crossed=scan_baseline_games(self.game,sources,windows['baseline'][1])
        self.assertEqual(crossed,{'c'})
        self.config['windows']['residual'][0]='2026-01-31'
        self.save()
        with self.assertRaisesRegex(ValueError,'overlaps'):
            load_manifest(self.manifest)
        self.config['windows']['residual'][0]='2026-02-01'
        self.config['purge_days']=-1
        self.save()
        with self.assertRaisesRegex(ValueError,'purge_days'):
            load_manifest(self.manifest)

    def test_candidate_parity_and_placebo(self):
        def meta(name, cost):
            return dict(id=name,layout='normal',type_line='Creature',oracle_text='',mana_cost=cost)
        metadata={'a':meta('a','{W}'),'b':meta('b','{B}{B}')}
        model=SimpleNamespace(card_tendency=lambda name,*_: .6 if name=='a' else .4)
        def normalize(d):
            return {k:v/sum(d.values()) for k,v in d.items()}
        def record(source,pool,pick=7):
            ex=SimpleNamespace(draft_id=source,raw_pack_number=0,raw_pick_number=6,
                candidates=['a','b'],historical_pick='a',pool=pool)
            row,prior,_=choice(ex,time_utc('2026-02-05'),model,metadata,[],normalize)
            return row,prior,pick
        first,second=record('a',{'a':6}),record('b',{'b':6})
        rotated=shuffled([first,second],metadata,[])
        self.assertEqual(len(rotated),2)
        by_id={r.source:r for r in rotated}
        self.assertEqual(by_id['a'].features,second[0].features)
        self.assertEqual(by_id['a'].support,first[0].support)
        report=fit_arms([first[0],second[0]],[first[0],second[0]],[],False)
        self.assertEqual(set(report),{'baseline','mana','opportunity'})
        self.assertEqual(report['baseline']['validation']['decisions'],2)


if __name__=='__main__':
    unittest.main()
