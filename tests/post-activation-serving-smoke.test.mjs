import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {smokeActivatedSnapshot} from '../scripts/post-activation-serving-smoke.mjs';

test('post-activation smoke is callable and exercises real serving selectors',()=>{
  assert.equal(typeof smokeActivatedSnapshot,'function');
  const source=fs.readFileSync(new URL('../scripts/post-activation-serving-smoke.mjs',import.meta.url),'utf8');
  assert.match(source,/loadServingSnapshot/);
  assert.match(source,/selectCachedDatabaseRun/);
  assert.match(source,/selectDatabaseRun/);
  assert.match(source,/selectDatabaseReroll/);
  assert.match(source,/DAILY_SELECTION_VERSION/);
  assert.match(source,/'latest'/);
  assert.match(source,/expected snapshot is not active/);
  assert.match(source,/active snapshot is not Approved/);
  assert.doesNotMatch(source,/no_candidate_snapshots/);
});

test('post-activation smoke is operationally separate from activation',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-post-activation-smoke.yml',import.meta.url),'utf8');
  const admin=fs.readFileSync(new URL('../worker/corpus-admin.mjs',import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/default: production/);
  assert.match(workflow,/source_snapshot_id:/);
  assert.match(workflow,/post-activation-serving-smoke\.mjs/);
  assert.match(workflow,/test "\$GITHUB_REF" = refs\/heads\/main/);
  assert.doesNotMatch(admin,/post-activation-serving-smoke/);
});
