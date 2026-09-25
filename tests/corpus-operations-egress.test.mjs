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
  assert.doesNotMatch(workflow,/name: Verify retained corpus health\s+run: node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/corpus\.connection"\s*$/m);
});

test('explicit reviewed corpus health remains a full deep audit',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-health.yml',import.meta.url),'utf8');
  assert.match(workflow,/node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/health\.connection" \| tee corpus-health-summary\.jsonl/);
});


test('production promotion validates the reviewed run with standalone jq',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-operations.yml',import.meta.url),'utf8');
  assert.match(workflow,/gh run view "\$VALIDATED_RUN_ID" --json conclusion,workflowName,headBranch,headSha \| jq -e --arg sha "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow,/gh run view[^\n]*--jq --arg/);
});

test('scheduled corpus operations refresh production health without ingesting or publishing',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-operations.yml',import.meta.url),'utf8');
  const job=workflow.split(/\n  scheduled-production-health:\n/)[1];
  assert.ok(job,'scheduled production health job is missing');
  assert.match(job,/needs: corpus/);
  assert.match(job,/if: \$\{\{ always\(\) && github\.event_name == 'schedule' \}\}/);
  assert.match(job,/branch=br-orange-feather-ayps8kep/);
  assert.match(job,/node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/production-corpus-health\.connection"/);
  assert.doesNotMatch(job,/load_all_trophies|candidate-gameplay-canary|\/status|\/snapshot/);
});
