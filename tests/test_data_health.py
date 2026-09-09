import json
import tempfile
import unittest
from pathlib import Path

from scripts import audit_datasets


class DataHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.originals = {
            "REPO_ROOT": audit_datasets.REPO_ROOT,
            "CATALOG_PATH": audit_datasets.CATALOG_PATH,
            "QUEUE_PATH": audit_datasets.QUEUE_PATH,
            "STATUS_PATH": audit_datasets.STATUS_PATH,
        }
        audit_datasets.REPO_ROOT = self.root
        audit_datasets.CATALOG_PATH = self.root / "data" / "catalog.json"
        audit_datasets.QUEUE_PATH = self.root / "data" / "import-queue.json"
        audit_datasets.STATUS_PATH = self.root / "data" / "status.json"
        (self.root / "data" / "abc" / "shards").mkdir(parents=True)

    def tearDown(self):
        for key, value in self.originals.items():
            setattr(audit_datasets, key, value)
        self.tmp.cleanup()

    def _write_json(self, path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")

    def _healthy_fixture(self):
        cards = [
            {
                "id": f"card-{i}",
                "name": f"Card {i}",
                "model_probability": 0.125,
                "image_url": f"https://example.invalid/{i}.jpg",
                "rarity": "common",
            }
            for i in range(8)
        ]
        replays = []
        for replay_index in range(100):
            rotated = []
            for i, card in enumerate(cards):
                clone = dict(card)
                clone["name"] = f"Card {(replay_index * 8) + i}"
                clone["id"] = f"card-{(replay_index * 8) + i}"
                rotated.append(clone)
            replays.append({
                "draft_id": f"draft-{replay_index}",
                "picks": [{
                    "pack_number": 1,
                    "pick_number": 1,
                    "historical_pick_id": rotated[0]["id"],
                    "consensus_pick_id": rotated[0]["id"],
                    "pool": {},
                    "candidates": rotated,
                }],
            })

        manifest = {
            "schema_version": 2,
            "set_id": "abc",
            "name": "ABC",
            "format": "PremierDraft",
            "source": {"data_date": "2026-01-01"},
            "cohort": {"training_drafts": 5000, "training_picks": 100000, "win_rate_cutoff": 0.6},
            "model": {"model_version": "strong-player-pool-context-v2"},
            "replay_count": 100,
            "shards": [{"path": "./data/abc/shards/000.json", "replay_count": 100}],
        }
        self._write_json(self.root / "data" / "abc" / "manifest.json", manifest)
        self._write_json(self.root / "data" / "abc" / "shards" / "000.json", {"replays": replays})
        self._write_json(self.root / "data" / "abc" / "path-model.json", {
            "model_version": audit_datasets.PATH_MODEL_VERSION,
            "cards": [f"Card {i}" for i in range(800)],
            "pairs": [[0, 1, 8, 4] for _ in range(100)],
            "training": {"excluded_replay_drafts": 100},
        })
        return {
            "id": "abc",
            "name": "ABC",
            "manifest_path": "./data/abc/manifest.json",
            "replay_count": 100,
            "data_date": "2026-01-01",
            "is_fixture": False,
        }

    def test_healthy_dataset_records_core_quality_metrics(self):
        entry = self._healthy_fixture()
        report = audit_datasets.audit_dataset(entry)
        self.assertEqual(report["status"], "healthy")
        self.assertEqual(report["metrics"]["replays"]["actual"], 100)
        self.assertEqual(report["metrics"]["cards"]["image_metadata_coverage"], 1.0)
        self.assertEqual(report["metrics"]["path_model"]["cards"], 800)
        self.assertEqual(report["errors"], [])

    def test_status_tracks_live_pending_and_blocked_queue_entries(self):
        entry = self._healthy_fixture()
        catalog = {"schema_version": 2, "sets": [entry]}
        self._write_json(audit_datasets.QUEUE_PATH, {"sets": ["ABC", "XYZ", "BAD"]})
        import_report = self.root / "generated" / "import-report.json"
        self._write_json(import_report, {"failures": [{"code": "BAD", "error": "archive unavailable"}]})
        report = audit_datasets.audit_dataset(entry)
        status = audit_datasets.build_status(catalog, [report], import_report=import_report, cube_report=None)
        by_code = {item["code"]: item for item in status["normal_queue"]}
        self.assertEqual(by_code["ABC"]["status"], "live")
        self.assertEqual(by_code["XYZ"]["status"], "pending")
        self.assertEqual(by_code["BAD"]["status"], "blocked")
        self.assertEqual(status["normal_queue_counts"], {"live": 1, "pending": 1, "blocked": 1})

    def test_catalog_signature_is_deterministic(self):
        entry = self._healthy_fixture()
        catalog = {"schema_version": 2, "sets": [entry]}
        self._write_json(audit_datasets.QUEUE_PATH, {"sets": ["ABC"]})
        report = audit_datasets.audit_dataset(entry)
        first = audit_datasets.build_status(catalog, [report], import_report=None, cube_report=None)
        second = audit_datasets.build_status(catalog, [report], import_report=None, cube_report=None)
        self.assertEqual(first, second)
        self.assertNotIn("generated_at", first)


if __name__ == "__main__":
    unittest.main()
