import copy
import csv
import gzip
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('trophy_draft_links', Path(__file__).parents[1] / 'scripts/backfill-trophy-draft-links.py')
links = importlib.util.module_from_spec(spec)
spec.loader.exec_module(links)


class TrophyDraftLinkTests(unittest.TestCase):
    def test_archive_resolves_exact_aliases_for_set_and_event(self):
        identity, other = '1' * 32, '2' * 32
        wanted = set(links.extractor.source_aliases('powered-cube', 'TradDraft', identity))
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / 'games.csv.gz'
            with gzip.open(archive, 'wt', newline='') as output:
                writer = csv.writer(output)
                writer.writerow(['expansion', 'event_type', 'draft_id', 'deck_Forest'])
                writer.writerows([['Cube_-_Powered', 'TradDraft', did, 40] for did in [identity, other, identity]])
            found = links.resolve_archive(archive, 'powered-cube', 'TradDraft', wanted)
            self.assertEqual(found, {alias: links.draft_url(identity) for alias in wanted})
            self.assertLess(len(links.resolve_archive(archive, 'powered-cube', 'PremierDraft', wanted)), len(wanted))
            self.assertEqual(links.resolve_archive(archive, 'fra', 'TradDraft', wanted), {})

    def test_missing_or_conflicting_aliases_fail_without_substitution(self):
        catalog = {'set_id': 'fra', 'sources': {'a': 0, 'b': 0},
                   'decks': [{'deck': [[0, 40]], 'sideboard': [[0, 1]], 'size': 40}]}
        original = copy.deepcopy(catalog)
        url = links.draft_url('1' * 32)
        for mapping in [{'a': url}, {'a': url, 'b': links.draft_url('2' * 32)}]:
            with self.assertRaises(ValueError):
                links.add_links(catalog, mapping)
            self.assertEqual(catalog, original)
        links.add_links(catalog, {'a': url, 'b': url})
        self.assertEqual(catalog['sources'], original['sources'])
        self.assertEqual(catalog['decks'][0], {**original['decks'][0], 'draft_url': url})

    def test_only_canonical_public_draft_identities_are_accepted(self):
        for identity in ['', 'not-an-id', '../account', 'a' * 31, 'a' * 33, 'A' * 32]:
            with self.subTest(identity=identity), self.assertRaises(ValueError):
                links.draft_url(identity)


if __name__ == '__main__':
    unittest.main()
