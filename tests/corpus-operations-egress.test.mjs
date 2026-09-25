import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('scheduled corpus operations only deep-scan newly ingested sets',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-operations.yml',import.meta.url),'utf8');
  assert.match(workflow,/name: Verify newly ingested Candidate health/);
  assert.match(workflow,/sets=\$\(cat generated\/corpus-operations\/pending\.txt\)/);
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
