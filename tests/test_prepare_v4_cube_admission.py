from pathlib import Path
import gzip
import json
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import prepare_v4_cube_admission as prep


class PrepareV4CubeAdmissionTests(unittest.TestCase):
    def fixture(self, root: Path):
        source = root / "source"
        source.mkdir()
        source_hash = "a" * 32
        puzzles = [
            {
                "puzzle_id": f"research-{pick}",
                "source_draft_hash": source_hash,
                "pick_number": pick,
                "corpus_version": prep.COMPONENT,
            }
            for pick in range(2, 10)
        ]
        ledger = [{
            "source_draft_hash": source_hash,
            "status": "included",
            "qualified": True,
            "event_type": "TradDraft",
            "wins": 3,
            "losses": 0,
            "puzzles": 8,
        }]
        prep.write_gzip_jsonl(source / "puzzles.jsonl.gz", puzzles)
        prep.write_gzip_jsonl(source / "trophies.jsonl.gz", ledger)
        signature = "b" * 64
        manifest = {
            "id": "powered-cube",
            "component_version": prep.COMPONENT,
            "parent_corpus_version": prep.PARENT,
            "model_version": prep.MODEL,
            "model_input_signature": signature,
            "model_source_event": "PremierDraft",
            "source_event_type": "TradDraft",
            "publication_authorized": False,
            "source_archive": {
                "url": "https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.Cube_-_Powered.TradDraft.csv.gz"
            },
            "puzzle_file_sha256": prep.digest(source / "puzzles.jsonl.gz"),
            "ledger_file_sha256": prep.digest(source / "trophies.jsonl.gz"),
        }
        (source / "manifest.json").write_text(json.dumps(manifest))
        evidence = {
            "set": "powered-cube",
            "parent_corpus_version": prep.PARENT,
            "model_version": prep.MODEL,
            "traditional_used_for_training": False,
            "production_input_signature": signature,
            "v8_parity_picks": 256,
            "cube_snapshot": {"pass": True},
            "cube_windows": {
                "p2_p7": {
                    "pass": True,
                    "all_picks": {"pass": True},
                    "serving_picks": {"pass": True},
                    "quality": {
                        "usable_traditional_puzzles": 6,
                        "unusable_fraction": 0,
                        "pass": True,
                    },
                },
                "p8_p9": {"pass": False},
                "p8": {"pass": False},
                "p9": {"pass": False},
            },
            "traditional_cohort": {
                "trophy_outcomes": {"3-0": 1},
                "qualified_trophies": 1,
                "cutoff": 0.6,
            },
            "premier_source_audit": {},
        }
        with gzip.open(source / "measurements.json.gz", "wt") as handle:
            json.dump(evidence, handle)
        return source

    def test_prepares_only_p2_through_p7_under_new_component(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.fixture(root)
            out = root / "out"
            prep.prepare(source, out)

            manifest = json.loads((out / "powered-cube" / "manifest.json").read_text())
            report = json.loads((out / "report.json").read_text())
            with gzip.open(out / "powered-cube" / "puzzles.jsonl.gz", "rt") as handle:
                puzzles = [json.loads(line) for line in handle]
            with gzip.open(out / "powered-cube" / "trophies.jsonl.gz", "rt") as handle:
                ledger = [json.loads(line) for line in handle]

            self.assertEqual(manifest["component_version"], prep.CUBE_COMPONENT)
            self.assertEqual(manifest["parent_corpus_version"], prep.PARENT)
            self.assertEqual(manifest["model_version"], prep.MODEL)
            self.assertEqual(manifest["serving_window"], {"first_pick": 2, "last_pick": 7})
            self.assertEqual(manifest["admission_policy"], prep.POLICY)
            self.assertEqual([p["pick_number"] for p in puzzles], [2, 3, 4, 5, 6, 7])
            self.assertTrue(all(p["corpus_version"] == prep.CUBE_COMPONENT for p in puzzles))
            self.assertTrue(all("research_puzzle_id" in p for p in puzzles))
            self.assertEqual(ledger[0]["puzzles"], 6)
            self.assertEqual(ledger[0]["excluded_pick_numbers"], [8, 9])
            self.assertEqual(report["schema"], prep.POLICY)
            self.assertFalse(report["publication_authorized"])

    def test_rejects_changed_research_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.fixture(root)
            with gzip.open(source / "puzzles.jsonl.gz", "at") as handle:
                handle.write(json.dumps({"puzzle_id": "tamper", "pick_number": 2}) + "\n")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                prep.prepare(source, root / "out")


if __name__ == "__main__":
    unittest.main()
