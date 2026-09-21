import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
R2_SHARDS = ROOT / "scripts" / "r2_replay_shards.sh"


class ReplayShardPaginationTests(unittest.TestCase):
    def test_remote_verify_aggregates_paginated_object_keys(self):
        text = R2_SHARDS.read_text()
        self.assertNotIn("length(Contents[?", text)
        self.assertGreaterEqual(text.count("].Key'"), 2)
        self.assertGreaterEqual(text.count("count += NF"), 2)
        self.assertIn("Remote replay shards: $remote_count", text)


if __name__ == "__main__":
    unittest.main()
