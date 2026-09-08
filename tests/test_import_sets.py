import unittest

from scripts import import_sets


class ImportSetsTests(unittest.TestCase):
    def test_parse_codes_normalizes_and_deduplicates(self):
        self.assertEqual(import_sets.parse_codes("msh, tla  MSH"), ["MSH", "TLA"])
        with self.assertRaises(ValueError):
            import_sets.parse_codes("not-a-set")

    def test_http_date_to_iso(self):
        self.assertEqual(
            import_sets.http_date_to_iso("Sun, 26 Jul 2026 03:14:15 GMT", "2000-01-01"),
            "2026-07-26",
        )
        self.assertEqual(import_sets.http_date_to_iso(None, "2026-01-01"), "2026-01-01")

    def test_discovery_skips_catalog_and_unavailable_sets(self):
        catalog = {"schema_version": 2, "sets": [{"id": "msh", "is_fixture": False}]}
        rows = [
            ("MSH", "2026-06-26"),
            ("TLA", "2025-11-21"),
            ("OM1", "2025-10-01"),
            ("EOE", "2025-08-01"),
            ("FIN", "2025-06-01"),
        ]
        probed = []

        def fetch_sets(_earliest):
            return rows

        def probe(code, format_name, released_at):
            probed.append(code)
            if code == "OM1":
                return None
            return import_sets.RemoteDataset(
                code=code,
                format=format_name,
                released_at=released_at,
                source_date=released_at,
                url=f"https://example.invalid/{code}.csv.gz",
            )

        selected = import_sets.discover_missing_sets(
            catalog,
            format_name="PremierDraft",
            earliest="2021-01-01",
            limit=2,
            fetch_sets=fetch_sets,
            probe=probe,
        )
        self.assertEqual([item.code for item in selected], ["TLA", "EOE"])
        self.assertEqual(probed, ["MSH", "TLA", "OM1", "EOE"])

    def test_discovery_refuses_to_hide_archive_probe_failure(self):
        catalog = {"schema_version": 2, "sets": [{"id": "msh", "is_fixture": False}]}

        def fetch_sets(_earliest):
            return [("MSH", "2026-06-26"), ("TLA", "2025-11-21")]

        def probe(_code, _format_name, _released_at):
            return None

        with self.assertRaises(RuntimeError):
            import_sets.discover_missing_sets(
                catalog,
                format_name="PremierDraft",
                earliest="2021-01-01",
                limit=1,
                fetch_sets=fetch_sets,
                probe=probe,
            )


if __name__ == "__main__":
    unittest.main()
