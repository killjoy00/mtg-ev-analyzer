import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKLOG = ROOT / ".github" / "workflows" / "build-more-sets.yml"
CUBE = ROOT / ".github" / "workflows" / "build-powered-cube.yml"


class DataPipelineWorkflowTests(unittest.TestCase):
    def test_backlog_fast_forwards_after_shared_lock(self):
        text = BACKLOG.read_text()
        self.assertIn("Fast-forward to latest main under import lock", text)
        self.assertIn('git reset --hard "origin/$GITHUB_REF_NAME"', text)

    def test_backlog_explicitly_dispatches_next_batch(self):
        text = BACKLOG.read_text()
        self.assertIn("actions: write", text)
        self.assertIn("Continue normal-set backlog", text)
        self.assertIn("gh workflow run build-more-sets.yml", text)
        self.assertIn("normal_queue_counts", text)
        self.assertIn("pending", text)

    def test_cube_fast_forwards_after_shared_lock(self):
        text = CUBE.read_text()
        self.assertIn("Fast-forward to latest main under import lock", text)
        self.assertIn('git reset --hard "origin/$GITHUB_REF_NAME"', text)

    def test_cube_regenerates_status_after_rebase(self):
        text = CUBE.read_text()
        publish = text.split("- name: Commit validated Cube data or health status", 1)[1]
        rebase = publish.index('git pull --rebase origin "$GITHUB_REF_NAME"')
        audit = publish.index("python scripts/audit_datasets.py", rebase)
        stage_status = publish.index("git add data/status.json", audit)
        amend = publish.index("git commit --amend --no-edit", stage_status)
        self.assertLess(rebase, audit)
        self.assertLess(audit, stage_status)
        self.assertLess(stage_status, amend)


if __name__ == "__main__":
    unittest.main()
