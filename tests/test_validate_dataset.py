import argparse
import csv
import tempfile
import unittest
from pathlib import Path

from scripts.build_replays import build, write_sharded_dataset
from scripts.validate_dataset import validate


class DatasetValidationTests(unittest.TestCase):
    def test_valid_generated_dataset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_dir = root / "data" / "tst"
            csv_path = root / "fixture.csv"
            fields = ["draft_id","pack_number","pick_number","pick","user_game_win_rate_bucket","user_n_games_bucket","pack_card_A","pack_card_B","pool_A","pool_B"]
            rows = []
            for i in range(4):
                for pick_number in range(2):
                    rows.append({
                        "draft_id":f"d{i}","pack_number":"0","pick_number":str(pick_number),"pick":"A" if i < 3 else "B",
                        "user_game_win_rate_bucket":"0.70 - 0.72","user_n_games_bucket":"100 - 499",
                        "pack_card_A":"1","pack_card_B":"1","pool_A":"1" if pick_number else "0","pool_B":"0",
                    })
            with csv_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            args = argparse.Namespace(input=str(csv_path),output_dir=str(data_dir),catalog=None,expansion="TST",format="PremierDraft",source_date="2026-01-01",minimum_games=100,top_fraction=1.0,max_training_drafts=10,max_output_drafts=10,minimum_picks=2,folds=2,shard_size=2,card_metadata=None)
            dataset = build(args)
            write_sharded_dataset(dataset, data_dir, 2)
            result = validate(data_dir / "manifest.json", minimum_replays=4)
            self.assertEqual(result["replays"], 4)
            self.assertGreater(result["picks"], 0)


if __name__ == "__main__":
    unittest.main()
