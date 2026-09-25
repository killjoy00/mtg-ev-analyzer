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


test('scheduled reviewed corpus health refreshes production without ingesting or publishing',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-health.yml',import.meta.url),'utf8');
  assert.match(workflow,/schedule:\s+\- cron: '53 7 \* \* \*'/);
  assert.match(workflow,/default: development/);
  assert.match(workflow,/TARGET: \$\{\{ inputs\.target \|\| 'production' \}\}/);
  assert.match(workflow,/node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/health\.connection"/);
  assert.doesNotMatch(workflow,/load_all_trophies|register-corpus-sources|candidate-gameplay-canary|\/status|\/snapshot/);
});
