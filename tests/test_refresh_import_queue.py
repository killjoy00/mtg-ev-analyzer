import contextlib
import datetime as dt
import io
import json
import tempfile
import unittest
from pathlib import Path

from scripts import audit_datasets, import_sets, refresh_import_queue, set_policy

ROOT = Path(__file__).resolve().parents[1]
QUEUE_PATH = ROOT / "data" / "import-queue.json"


def fake_fetch(rows):
    return lambda _earliest: list(rows)


def probe_all(available):
    def probe(code, format_name, released):
        if code not in available:
            return None
        return import_sets.RemoteDataset(
            code=code, format=format_name, released_at=released,
            source_date=released, url=f"https://example.test/{code}",
        )
    return probe


class DiscoveryTests(unittest.TestCase):
    """Discovery exists because nothing watched 17Lands for a new release.

    The queue was edited by hand, so a published environment could sit
    unimported for as long as it took someone to notice.
    """

    released = [
        ("NEWB", "2026-09-01"),
        ("NEWA", "2026-08-20"),
        ("HOB", "2026-08-14"),
        ("MSH", "2026-06-26"),
    ]

    def discover(self, queued, *, available, today, minimum_age_days=21):
        with contextlib.redirect_stdout(io.StringIO()):
            return refresh_import_queue.discover_new_codes(
                queued,
                format_name="PremierDraft",
                minimum_age_days=minimum_age_days,
                today=dt.date.fromisoformat(today),
                fetch_sets=fake_fetch(self.released),
                probe=probe_all(available),
            )

    def test_queues_a_release_newer_than_everything_already_queued(self):
        found = self.discover(
            ["HOB", "MSH"], available={"NEWA", "NEWB"}, today="2026-10-01",
        )
        self.assertEqual(found, ["NEWB", "NEWA"], "newest first, matching the queue file")

    def test_waits_for_a_deeper_archive_before_freezing_a_set(self):
        # import_sets skips anything already catalogued, so a set imported in
        # its release week keeps that week's depth for good.
        found = self.discover(
            ["HOB", "MSH"], available={"NEWA", "NEWB"}, today="2026-09-05",
        )
        self.assertEqual(found, [], "nothing is 21 days old yet")
        found = self.discover(
            ["HOB", "MSH"], available={"NEWA", "NEWB"}, today="2026-09-12",
        )
        self.assertEqual(found, ["NEWA"], "NEWA has matured, NEWB has not")

    def test_a_release_without_a_published_archive_is_not_queued(self):
        found = self.discover(["HOB", "MSH"], available=set(), today="2026-10-01")
        self.assertEqual(found, [])

    def test_does_not_relitigate_sets_older_than_the_queue(self):
        # Everything below the queue's newest entry was already decided:
        # imported, or deliberately left out. Re-proposing them daily would
        # cost two hundred archive probes to rediscover the same answer.
        found = self.discover(
            ["NEWB"], available={"NEWA", "HOB", "MSH"}, today="2026-10-01",
        )
        self.assertEqual(found, [])

    def test_a_retired_environment_is_never_rediscovered(self):
        retired = next(
            code for code in ("STX", "stx") if not set_policy.supported_set(code)
        )
        with contextlib.redirect_stdout(io.StringIO()):
            found = refresh_import_queue.discover_new_codes(
                ["HOB"],
                format_name="PremierDraft",
                minimum_age_days=0,
                today=dt.date.fromisoformat("2026-10-01"),
                fetch_sets=fake_fetch([(retired.upper(), "2026-09-01"), ("HOB", "2026-08-14")]),
                probe=probe_all({retired.upper()}),
            )
        self.assertEqual(found, [])

    def test_refuses_to_treat_every_set_as_new_when_nothing_matches(self):
        # A Scryfall response that matched no queued code would otherwise make
        # the whole catalogue look like a new release.
        with self.assertRaises(RuntimeError):
            self.discover(["NOPE"], available={"NEWA"}, today="2026-10-01")

    def test_insert_keeps_the_rest_of_the_queue_intact(self):
        queue = {"format": "PremierDraft", "sets": ["HOB", "MSH"], "notes": "keep me"}
        updated = refresh_import_queue.insert_newest_first(queue, ["NEWB", "NEWA"])
        self.assertEqual(updated["sets"], ["NEWB", "NEWA", "HOB", "MSH"])
        self.assertEqual(updated["notes"], "keep me")
        self.assertEqual(queue["sets"], ["HOB", "MSH"], "input is not mutated")

    def test_written_queue_is_still_loadable_by_the_importer(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "queue.json"
            refresh_import_queue.write_queue(
                {"format": "PremierDraft", "sets": ["NEWA", "HOB"]}, path,
            )
            self.assertEqual(
                import_sets.load_import_queue(path), ("PremierDraft", ["NEWA", "HOB"]),
            )


class RetiredQueueEntryTests(unittest.TestCase):
    """A retired code in the queue wedged the importer while looking idle.

    audit_datasets counted it as pending, the router dispatched an import on
    that count, and import_sets refused the same code - so the run died on the
    queue before building anything. status.json only read clean because it had
    been patched by hand; the next audit would have put the entry back.
    """

    def test_the_published_queue_names_no_retired_environment(self):
        codes = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))["sets"]
        retired = [code for code in codes if not set_policy.supported_set(code)]
        self.assertEqual(retired, [], f"retired environments in the import queue: {retired}")

    def test_the_importer_can_load_the_published_queue(self):
        format_name, codes = import_sets.load_import_queue(QUEUE_PATH)
        self.assertTrue(format_name)
        self.assertTrue(codes)

    def test_the_audit_never_reports_a_retired_set_as_pending(self):
        retired = next(
            code for code in ("STX", "stx") if not set_policy.supported_set(code)
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "queue.json"
            path.write_text(json.dumps({
                "format": "PremierDraft",
                "sets": ["HOB", retired.upper()],
            }), encoding="utf-8")
            original = audit_datasets.QUEUE_PATH
            audit_datasets.QUEUE_PATH = path
            try:
                rows = audit_datasets.queue_status({"sets": []}, None, {})
            finally:
                audit_datasets.QUEUE_PATH = original
        self.assertEqual([row["code"] for row in rows], ["HOB"])


class BacklogRoutingTests(unittest.TestCase):
    BACKLOG = ROOT / ".github" / "workflows" / "build-more-sets.yml"

    def test_the_daily_run_looks_for_new_releases(self):
        text = self.BACKLOG.read_text()
        self.assertIn("scripts/refresh_import_queue.py", text)
        self.assertIn("Queue newly released environments", text)
        discovery = text.index("Queue newly released environments")
        route = text.index("Route catalog ownership")
        self.assertLess(discovery, route, "discovery must run before pending is counted")

    def test_pending_is_counted_from_the_queue_not_a_rewritten_status_file(self):
        text = self.BACKLOG.read_text()
        route = text[text.index("Route catalog ownership"):]
        self.assertIn("from set_policy import supported_set", route)
        self.assertIn("data/import-queue.json", route)
        self.assertIn("data/catalog.json", route)


class ProductionSmokeTests(unittest.TestCase):
    """The draft-run health aggregate scans every archived puzzle row.

    Asking for it with the same twenty-second budget as a liveness marker
    failed on a healthy production release, then passed unchanged on the next
    three pushes. A gate that red-flags a working deploy stops being read.
    """

    SMOKE = ROOT / ".github" / "workflows" / "production-smoke.yml"

    def test_the_liveness_contract_uses_the_quick_marker(self):
        text = self.SMOKE.read_text()
        self.assertIn("[draftrunapi]=\"/health?quick=1\"", text)
        self.assertIn("${health_paths[$name]}", text)

    def test_the_corpus_aggregate_is_still_checked_with_its_own_budget(self):
        text = self.SMOKE.read_text()
        self.assertIn("Verify the served Draft Run corpus is complete", text)
        self.assertIn("--max-time 90", text)
        for field in ("unrated_puzzles", "missing_sets", "corpus_version"):
            self.assertIn(field, text)

    def test_the_job_allows_time_for_the_retries_it_performs(self):
        text = self.SMOKE.read_text()
        minutes = int(text.split("timeout-minutes:")[1].split("\n")[0].strip())
        self.assertGreaterEqual(minutes, 6, "three 90s retries do not fit in five minutes")


if __name__ == "__main__":
    unittest.main()
