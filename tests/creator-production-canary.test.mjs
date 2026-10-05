import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const script=fs.readFileSync('tests/creator-production-canary.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/creator-production-canary.yml','utf8');
const request=JSON.parse(fs.readFileSync('.github/creator-canary-request.json','utf8'));

test('creator production canary is syntax-valid and fixed to owned production fixtures',()=>{
  const syntax=spawnSync(process.execPath,['--check','tests/creator-production-canary.mjs'],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(script,/const base='https:\/\/api\.packone\.pro'/);
  assert.match(script,/s\.measurement_qa=true/);
  assert.match(script,/p\.display_name LIKE 'QA release %'/);
  assert.match(script,/NOT EXISTS \(SELECT 1 FROM account_links a WHERE a\.player_id=s\.player_id\)/);
  assert.match(script,/assert\.ok\(row,'A retained closed QA release Daily is required; never fall back to customer data\.'\)/);
  assert.doesNotMatch(script,/PACK1_DELETION_ADMIN_EMAIL|PACK1_DELETION_ADMIN_PASSWORD/);
  assert.match(script,/slug:'creator-canary-practice-'\+tag/);
  assert.match(script,/slug:'creator-canary-daily-'\+tag/);
});

test('creator production canary runs only through the protected reviewed request path',()=>{
  assert.match(workflow,/paths:\s*\n\s*- '\.github\/creator-canary-request\.json'/);
  assert.doesNotMatch(workflow,/workflow_dispatch:/);
  assert.match(workflow,/environment: pack-one-mobile-release/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/Require exact current main and released ancestor/);
  assert.match(workflow,/git merge-base --is-ancestor "\$RELEASE_COMMIT"/);
  assert.match(workflow,/node --check tests\/creator-production-canary\.mjs/);
  assert.match(workflow,/if: always\(\)/);
});

test('reviewed canary request is pinned to the corrected #984 production release',()=>{
  assert.deepEqual(Object.keys(request).sort(),['operation','reason','release_commit']);
  assert.equal(request.operation,'run-creator-canary');
  assert.equal(request.release_commit,'f6ea0910d322f007f0ac0004b98fea6bab09422a');
  assert.match(request.reason,/temporary owned identities/i);
  assert.match(request.reason,/Never select or mutate customer data/i);
});
