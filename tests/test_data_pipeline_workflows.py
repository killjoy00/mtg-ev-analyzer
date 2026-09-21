import re
import unittest
from pathlib import Path


# This file is also an explicit, harmless restart trigger for the backlog workflow.
ROOT = Path(__file__).resolve().parents[1]
BACKLOG = ROOT / ".github" / "workflows" / "build-more-sets.yml"
CUBE = ROOT / ".github" / "workflows" / "build-powered-cube.yml"
V4_REBUILD = ROOT / ".github" / "workflows" / "rebuild-v4-draft-run-corpus.yml"


class DataPipelineWorkflowTests(unittest.TestCase):
    def test_v4_rebuild_is_checkpointed_and_refuses_mixed_release(self):
        text = V4_REBUILD.read_text()
        self.assertIn("strong-player-colour-stage-v4", text)
        self.assertIn("elite-trophy-colour-stage-v8", text)
        self.assertIn("scripts/import_sets.py", text)
        self.assertIn("scripts/backfill_legacy_sets.py", text)
        self.assertIn("scripts/build_powered_cube_v3.py", text)
        self.assertIn("scripts/build_verified_trophy_corpus.py", text)
        self.assertIn("bash scripts/r2_replay_shards.sh upload", text)
        self.assertIn("gh pr create", text)
        self.assertNotIn("git push origin HEAD:main", text)

        # Expensive work must survive a later runner timeout without exposing a
        # mixed-model candidate as a release PR.
        self.assertIn("max-parallel: 1", text)
        self.assertIn("Checkpoint rebuilt environments", text)
        self.assertIn("Checkpoint legacy environments", text)
        self.assertIn("Checkpoint Powered Cube", text)
        self.assertIn("v4-original-catalog.json", text)
        self.assertGreaterEqual(text.count('git push origin "HEAD:$BRANCH"'), 4)

        # Replay shards are intentionally gitignored, so every expensive rebuild
        # stage must durably checkpoint its shard subset before the next runner.
        for checkpoint in (
            "Checkpoint regular replay shards to versioned R2",
            "Checkpoint legacy replay shards to versioned R2",
            "Checkpoint Powered Cube replay shards to versioned R2",
        ):
            self.assertIn(checkpoint, text)
        self.assertGreaterEqual(text.count("REPLAY_MODEL_VERSION:"), 3)
        self.assertGreaterEqual(text.count("REPLAY_SETS:"), 3)

        finalize = text.split("  finalize:", 1)[1]
        hydrate = finalize.index("Hydrate checkpointed v4 replay shards from R2")
        verify = finalize.index("Verify complete v4 provenance")
        corpus = finalize.index("Build the separately versioned v8 corpus")
        tests = finalize.index("Validate the complete candidate")
        upload = finalize.index("Publish versioned v4 replay shards")
        commit = finalize.index("Commit final corpus candidate")
        release_pr = finalize.index("Open rollout pull request")
        self.assertLess(hydrate, verify)
        self.assertLess(verify, corpus)
        self.assertLess(corpus, tests)
        self.assertLess(tests, upload)
        self.assertLess(upload, commit)
        self.assertLess(commit, release_pr)

    def test_v4_rebuild_push_launch_is_explicitly_gated(self):
        text = V4_REBUILD.read_text()
        triggers = text.split("permissions:", 1)[0]
        self.assertIn(".github/workflows/rebuild-v4-draft-run-corpus.yml", triggers)
        self.assertIn("[launch-v4-rebuild]", text)
        self.assertIn("github.event_name == 'workflow_dispatch'", text)
        self.assertIn("contains(github.event.head_commit.message, '[launch-v4-rebuild]')", text)

    def test_replay_storage_keeps_v3_and_v4_separate(self):
        text = (ROOT / "scripts" / "r2_replay_shards.sh").read_text()
        self.assertIn('strong-player-colour-stage-v3', text)
        self.assertIn('replay-models/$model_version/data', text)
        self.assertIn('s3://${R2_BUCKET}/${replay_prefix}', text)
        self.assertIn('REPLAY_MODEL_VERSION', text)
        self.assertIn('REPLAY_SETS', text)
        self.assertIn('--delete', text)
        self.assertIn('Scoped replay set $sid has model', text)

    def test_backlog_routes_before_shared_lock(self):
        text = BACKLOG.read_text()
        route = text.index("  route:")
        import_job = text.index("  import-sets:")
        lock = text.index("    concurrency:")
        self.assertLess(route, import_job)
        self.assertLess(import_job, lock)
        self.assertIn("should_import", text)
        self.assertIn("backlog will not enter the shared catalog lock", text)
        self.assertIn("Cube already has", text)

    def test_backlog_fast_forwards_after_shared_lock(self):
        text = BACKLOG.read_text()
        self.assertIn("Fast-forward to latest main under import lock", text)
        self.assertIn('git reset --hard "origin/$GITHUB_REF_NAME"', text)

    def test_backlog_explicitly_dispatches_next_batch(self):
        text = BACKLOG.read_text()
        self.assertIn("actions: write", text)
        self.assertIn("Continue data migration", text)
        self.assertIn("gh workflow run build-more-sets.yml", text)
        self.assertIn("normal_queue_counts", text)
        self.assertIn("pending", text)

    def test_backlog_yields_to_unpublished_cube(self):
        text = BACKLOG.read_text()
        self.assertIn("Powered Cube is not live; backlog will not enter the shared catalog lock", text)
        self.assertIn("gh workflow run build-powered-cube.yml", text)
        cube_dispatch = text.index("gh workflow run build-powered-cube.yml")
        backlog_dispatch = text.index("gh workflow run build-more-sets.yml")
        self.assertLess(cube_dispatch, backlog_dispatch)

    def test_cube_fast_forwards_after_shared_lock(self):
        text = CUBE.read_text()
        self.assertIn("Fast-forward to latest main under import lock", text)
        self.assertIn('git reset --hard "origin/$GITHUB_REF_NAME"', text)

    def test_cube_skips_stale_duplicate_dispatches(self):
        text = CUBE.read_text()
        self.assertIn("force:", text)
        self.assertIn("  cube-route:", text)
        self.assertIn("skipping this non-forced dispatch before preflight", text)

        powered = text.split("  powered-cube:", 1)[1]
        fast_forward = powered.index("Fast-forward to latest main under import lock")
        gate = powered.index("Re-check Cube state under import lock")
        unit_tests = powered.index("Run unit tests")
        build = powered.index("Build and validate Powered Cube")
        self.assertLess(fast_forward, gate)
        self.assertLess(gate, unit_tests)
        self.assertLess(unit_tests, build)
        self.assertIn("became live while this run was waiting", powered)
        self.assertIn("steps.cube_gate.outputs.should_build == 'true'", powered)

    def test_cube_push_only_rebuilds_for_data_pipeline_changes(self):
        text = CUBE.read_text()
        triggers = text.split("permissions:", 1)[0]
        for path in (
            ".github/workflows/build-powered-cube.yml",
            "tests/test_data_pipeline_workflows.py",
            "cube-product.mjs",
            "leaderboard-product.mjs",
            "practice-product.mjs",
            "bootstrap.mjs",
            "package.json",
            "tests/powered-cube.test.mjs",
            "tests/test_powered_cube_builder.py",
        ):
            self.assertNotIn(path, triggers)
        self.assertIn("scripts/build_powered_cube_v3.py", triggers)
        self.assertIn("scripts/import_powered_cube.py", triggers)
        self.assertIn("scripts/audit_datasets.py", triggers)

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

    def test_cube_hands_control_back_to_backlog(self):
        text = CUBE.read_text()
        self.assertIn("actions: write", text)
        self.assertIn("Resume normal-set backlog after Cube", text)
        self.assertIn("Powered Cube is live; returning the shared catalog slot", text)
        self.assertIn("gh workflow run build-more-sets.yml", text)


class ReplayBuilderCallerTests(unittest.TestCase):
    """build_replays.py gained a required input - the game archive the colour
    term is estimated from - and two of its seven callers did not get it.
    They were the two that build every normal and legacy set, so the whole
    published-set pipeline raised at the first rebuild. The commit that added
    the requirement said it had wired 'all five call sites'; there were seven.

    Counting call sites by hand is what failed, so this counts them."""

    BUILDER = "scripts/build_replays.py"
    # A subprocess argv, not a mention. import_all_trophies.py names the same
    # path to hash it into an input signature, and drives the model in process
    # rather than through the CLI, so it is not a caller in this sense - it
    # supplies its colour table by calling build_colour_table directly.
    ARGV = re.compile(r"""sys\.executable\s*,\s*["']scripts/build_replays\.py["']""")

    def callers(self):
        """Every place that shells out to the replay builder."""
        found = []
        for path in sorted((ROOT / "scripts").glob("*.py")):
            if self.ARGV.search(path.read_text(encoding="utf-8")):
                found.append(path)
        for path in sorted((ROOT / ".github" / "workflows").glob("*.yml")):
            text = path.read_text(encoding="utf-8")
            if f"python {self.BUILDER}" in text:
                found.append(path)
        return found

    def test_every_caller_supplies_the_colour_table_input(self):
        missing = [str(p.relative_to(ROOT)) for p in self.callers()
                   if "--game-data" not in p.read_text(encoding="utf-8")]
        self.assertEqual(missing, [],
                         "caller(s) of the fold-isolated replay builder omit --game-data")

    def test_the_requirement_this_guards_is_still_real(self):
        """If the builder ever stops requiring it, this whole class is noise
        and should go - it should not sit here passing vacuously."""
        text = (ROOT / "scripts" / "build_replays.py").read_text(encoding="utf-8")
        self.assertIn("Pass --game-data. Fold-isolated colour tables", text)

    def test_the_callers_are_actually_found(self):
        """A scan that silently matches nothing would pass the test above."""
        names = {p.name for p in self.callers()}
        for expected in ("import_sets.py", "backfill_legacy_sets.py",
                         "import_powered_cube.py", "build-replay-data.yml"):
            self.assertIn(expected, names)


if __name__ == "__main__":
    unittest.main()
