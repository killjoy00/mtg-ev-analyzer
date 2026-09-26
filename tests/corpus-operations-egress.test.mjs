import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('scheduled corpus operations only deep-scan newly ingested sets',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-operations.yml',import.meta.url),'utf8');
  assert.match(workflow,/name: Verify newly ingested Candidate health/);
  assert.match(workflow,/pending=\$\(cat generated\/corpus-operations\/pending\.txt\)/);
  assert.match(workflow,/sets=\$\(cat generated\/corpus-operations\/validated-sets\.txt 2>\/dev\/null \|\| cat generated\/corpus-operations\/pending\.txt\)/);
  assert.match(workflow,/No newly ingested corpus candidates; skipping deep payload health scan\./);
  assert.match(workflow,/IFS=',' read -r -a set_args <<< "\$sets"/);
  assert.match(workflow,/node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/corpus\.connection" "\$\{set_args\[@\]\}"/);
  assert.doesNotMatch(workflow,/\n  retained-health:\n/);
  assert.doesNotMatch(workflow,/node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/corpus-health\.connection"/);
  assert.match(workflow,/if \[\[ "\$TARGET" == development \]\]; then\s+node scripts\/candidate-gameplay-canary\.mjs "\$RUNNER_TEMP\/corpus\.connection"/);
});

test('explicit reviewed corpus health remains a manual-only full deep audit',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-health.yml',import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/schedule:/);
  assert.match(workflow,/TARGET: \$\{\{ inputs\.target \}\}/);
  assert.match(workflow,/node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/health\.connection" \| tee corpus-health-summary\.jsonl/);
});


test('production promotion proves builder run provenance without pinning the whole repository SHA',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-operations.yml',import.meta.url),'utf8');
  assert.match(workflow,/run_json=\$\(gh run view "\$VALIDATED_RUN_ID" --json conclusion,workflowName,headBranch,headSha\)/);
  assert.match(workflow,/builder_sha=\$\(echo "\$run_json" \| jq -r '\.headSha'\)/);
  assert.match(workflow,/corpus_promotion_provenance\.py verify "\$root\/corpus-candidates\/catalog\.json" --run-id "\$VALIDATED_RUN_ID" --run-sha "\$builder_sha" --revision "\$revision"/);
  assert.doesNotMatch(workflow,/--arg sha "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow,/\.headSha==\$sha/);
});

test('development cache is revision-keyed and restored catalog provenance is never reused',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-operations.yml',import.meta.url),'utf8');
  assert.match(workflow,/id: ingestion-revision/);
  assert.match(workflow,/key: corpus-candidates-\$\{\{ steps\.ingestion-revision\.outputs\.revision \}\}-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow,/restore-keys: \|\s+corpus-candidates-\$\{\{ steps\.ingestion-revision\.outputs\.revision \}\}-/);
  assert.doesNotMatch(workflow,/restore-keys: \|[^]*?\n\s+corpus-candidates-\s*(?:\n|$)/);
  assert.match(workflow,/rm -f generated\/corpus-candidates\/catalog\.json/);
});

test('no-pending development rerun cannot mint a promotable artifact and has an explicit recovery path',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-operations.yml',import.meta.url),'utf8');
  assert.match(workflow,/recovery_sets:/);
  assert.match(workflow,/no promotable artifact was produced\. For cache eviction recovery, dispatch development with recovery_sets=<set-id>/);
  assert.match(workflow,/if \[\[ ! -f "\$catalog" \]\]; then\s+echo "promotable=false"/);
  assert.match(workflow,/steps\.artifact\.outputs\.promotable == 'true'/);
  assert.match(workflow,/Referenced development run has no promotable corpus artifact\. Dispatch development with recovery_sets=<set-id>/);
});


test('no scheduled workflow deep-scans retained corpus payloads',()=>{
  const directory=new URL('../.github/workflows/',import.meta.url);
  for(const name of fs.readdirSync(directory).filter(file=>file.endsWith('.yml'))) {
    const workflow=fs.readFileSync(new URL(name,directory),'utf8');
    if(!/^\s+schedule:/m.test(workflow))continue;
    if(name==='corpus-operations.yml') {
      // Only newly ingested sets are scanned, always with explicit set arguments.
      for(const call of workflow.match(/node scripts\/check-corpus-health\.mjs[^\n]*/g)||[])
        assert.match(call,/"\$\{set_args\[@\]\}"/,name+': '+call);
      continue;
    }
    assert.doesNotMatch(workflow,/check-corpus-health\.mjs|candidate-gameplay-canary|plan-corpus-health-refresh/,name);
  }
});

test('snapshot health check is manual and scans exactly one named snapshot',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-health-refresh.yml',import.meta.url),'utf8');
  assert.match(workflow,/^name: Corpus snapshot health check$/m);
  assert.doesNotMatch(workflow,/schedule:/);
  assert.match(workflow,/snapshot_id:\s+description:[^\n]*\n\s+type: string\n\s+required: true/);
  assert.match(workflow,/default: development/);
  assert.match(workflow,/\[\[ "\$SNAPSHOT_ID" =~ \^\(\[a-f0-9\]\{64\}\|historical-\[a-f0-9\]\{32\}\)\$ \]\]/);
  assert.match(workflow,/node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/snapshot-health\.connection" --snapshot "\$SNAPSHOT_ID"/);
  // The operator-supplied ID reaches the shell only through the validated env var.
  assert.deepEqual(workflow.match(/\$\{\{ inputs\.snapshot_id \}\}/g),['${{ inputs.snapshot_id }}']);
  assert.match(workflow,/SNAPSHOT_ID: \$\{\{ inputs\.snapshot_id \}\}/);
  assert.doesNotMatch(workflow,/load_all_trophies|register-corpus-sources|candidate-gameplay-canary|plan-corpus-health-refresh|\/v1\/admin\/corpus/);
});

test('scheduled health evidence report is metadata-only and never fails on old evidence',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-health-report.yml',import.meta.url),'utf8');
  assert.match(workflow,/schedule:\s+- cron: '37 8 \* \* \*'/);
  assert.match(workflow,/TARGET: \$\{\{ inputs\.target \|\| 'production' \}\}/);
  assert.match(workflow,/node scripts\/corpus-health-freshness\.mjs "\$RUNNER_TEMP\/health-report\.connection" --summary "\$GITHUB_STEP_SUMMARY"/);
  assert.doesNotMatch(workflow,/check-corpus-health|load_all_trophies|register-corpus-sources|candidate-gameplay-canary/);
  const script=fs.readFileSync(new URL('../scripts/corpus-health-freshness.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(script,/draft_run_verified_puzzles|INSERT INTO|UPDATE |DELETE FROM|process\.exit(Code)?\s*[=(]\s*[1-9]/);
});

test('exact snapshot health mode cannot be combined with set-wide selection',()=>{
  const script=fs.readFileSync(new URL('../scripts/check-corpus-health.mjs',import.meta.url),'utf8');
  assert.match(script,/rawArgs\[i\]==='--snapshot'/);
  assert.match(script,/Choose exact --snapshot health or set IDs, not both\./);
  assert.match(script,/WHERE s\.source_snapshot_id=\$2 AND s\.corpus_version=\$1 AND s\.lifecycle_status<>'Retired'/);
});
