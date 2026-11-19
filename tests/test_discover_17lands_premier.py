import unittest

from scripts.discover_17lands_premier import discover


class DiscoverPremierTests(unittest.TestCase):
    def test_extracts_unique_premier_draft_archives_only(self):
        html = """
        <a href="https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.MSH.PremierDraft.csv.gz">MSH</a>
        <a href="https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.MSH.PremierDraft.csv.gz">MSH duplicate</a>
        <a href="https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.MSH.TradDraft.csv.gz">trad</a>
        <a href="https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.DSK.PremierDraft.csv.gz">DSK</a>
        """
        rows = discover(html)
        self.assertEqual([row["set_id"] for row in rows], ["MSH", "DSK"])
        self.assertTrue(all("PremierDraft" in row["url"] for row in rows))


if __name__ == "__main__":
    unittest.main()
