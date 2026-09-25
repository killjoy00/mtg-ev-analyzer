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
