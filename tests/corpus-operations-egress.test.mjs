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


test('production promotion validates the reviewed run with standalone jq',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-operations.yml',import.meta.url),'utf8');
  assert.match(workflow,/gh run view "\$VALIDATED_RUN_ID" --json conclusion,workflowName,headBranch,headSha \| jq -e --arg sha "\$GITHUB_SHA"/);
  assert.doesNotMatch(workflow,/gh run view[^\n]*--jq --arg/);
});


test('scheduled production health refresh is bounded to one exact snapshot and never publishes Live',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-health-refresh.yml',import.meta.url),'utf8');
  assert.match(workflow,/cron: '17 \\*\\/4 \\* \\* \\*'/);
  assert.match(workflow,/node scripts\/plan-corpus-health-refresh\.mjs "\$RUNNER_TEMP\/production-health\.connection"/);
  assert.match(workflow,/node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/production-health\.connection" --snapshot "\$snapshot"/);
  assert.doesNotMatch(workflow,/node scripts\/check-corpus-health\.mjs "\$RUNNER_TEMP\/production-health\.connection"\s*(?:\||$)/m);
  assert.match(workflow,/\.over_capacity == false/);
  assert.match(workflow,/\.hard_deadline_risk == false/);
  assert.doesNotMatch(workflow,/load_all_trophies|register-corpus-sources|candidate-gameplay-canary|\/v1\/admin\/corpus|\/snapshot|\/status/);
});

test('exact snapshot health mode cannot be combined with set-wide selection',()=>{
  const script=fs.readFileSync(new URL('../scripts/check-corpus-health.mjs',import.meta.url),'utf8');
  assert.match(script,/rawArgs\[i\]==='--snapshot'/);
  assert.match(script,/Choose exact --snapshot health or set IDs, not both\./);
  assert.match(script,/WHERE s\.source_snapshot_id=\$2 AND s\.corpus_version=\$1 AND s\.lifecycle_status<>'Retired'/);
});
