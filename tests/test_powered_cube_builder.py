import csv
import gzip
import tempfile
import unittest
from pathlib import Path

from scripts import build_powered_cube


def card(index, probability=None):
    value = probability if probability is not None else 1 / 14
    return {"id": f"card-{index}", "name": f"Card {index}", "model_probability": value}


def replay(start_pick=2, pool=True):
    picks = []
    for offset in range(14):
        pick_number = start_pick + offset
        count = max(1, 14 - offset)
        candidates = [card(index, 1 / count) for index in range(count)]
        picks.append({
            "pack_number": 1,
            "pick_number": pick_number,
            "historical_pick_id": candidates[0]["id"],
            "consensus_pick_id": candidates[0]["id"],
            "pool": {"Inherited": 1} if pool else {},
            "candidates": candidates,
        })
    return {"draft_id": f"draft-{start_pick}-{pool}", "picks": picks}


class PoweredCubeBuilderTests(unittest.TestCase):
    def test_rendered_p1p2_already_at_pick_two_is_not_shifted_again(self):
        item = build_powered_cube.inspect_rendered_replay(replay(start_pick=2))
        self.assertTrue(item["accepted"])
        self.assertEqual(item["reason"], "first_visible_p1p2")
        self.assertEqual(item["pick_number_offset"], 0)
        prepared = build_powered_cube.prepare_rendered_replay(replay(start_pick=2))
        self.assertEqual([pick["pick_number"] for pick in prepared["picks"]], list(range(2, 16)))

    def test_rendered_p1p2_at_pick_one_gets_single_offset(self):
        item = build_powered_cube.inspect_rendered_replay(replay(start_pick=1))
        self.assertTrue(item["accepted"])
        self.assertEqual(item["pick_number_offset"], 1)
        prepared = build_powered_cube.prepare_rendered_replay(replay(start_pick=1))
        self.assertEqual([pick["pick_number"] for pick in prepared["picks"]], list(range(2, 16)))

    def test_empty_inherited_pool_has_specific_rejection_reason(self):
        item = build_powered_cube.inspect_rendered_replay(replay(start_pick=2, pool=False))
        self.assertFalse(item["accepted"])
        self.assertEqual(item["reason"], "empty_inherited_p1p1_pool")

    def test_training_archive_preserves_known_p1p1_as_pool_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.csv.gz"
            destination = Path(tmp) / "model.csv.gz"
            fields = [
                "draft_id", "pick", "pack_number", "pick_number",
                "pack_card_A", "pack_card_B", "pool_A", "pool_B",
            ]
            with gzip.open(source, "wt", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                for index in range(600):
                    draft_id = f"draft-{index:04d}"
                    writer.writerow({
                        "draft_id": draft_id,
                        "pick": "A",
                        "pack_number": 0,
                        "pick_number": 0,
                        "pack_card_A": 1,
                        "pack_card_B": 0,
                        "pool_A": 0,
                        "pool_B": 0,
                    })
                    writer.writerow({
                        "draft_id": draft_id,
                        "pick": "B",
                        "pack_number": 0,
                        "pick_number": 1,
                        "pack_card_A": 1,
                        "pack_card_B": 1,
                        "pool_A": 0,
                        "pool_B": 0,
                    })

            raw, inherited = build_powered_cube.analyze_raw_archive(source)
            self.assertEqual(raw["recovered_inherited_p1p1_picks"], 600)
            result = build_powered_cube.write_repaired_model_archive(source, destination, inherited)
            self.assertEqual(result["incomplete_p1p1_rows_removed"], 600)
            self.assertEqual(result["pool_rows_repaired"], 600)

            with gzip.open(destination, "rt", encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 600)
            self.assertEqual(rows[0]["pick"], "B")
            self.assertEqual(rows[0]["pool_A"], "1")


if __name__ == "__main__":
    unittest.main()
