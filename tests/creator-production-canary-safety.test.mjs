import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const script=fs.readFileSync('scripts/creator-production-canary.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/creator-production-canary.yml','utf8');
const request=JSON.parse(fs.readFileSync('.github/creator-production-canary-request.json','utf8'));

test('production creator canary is syntax-valid and cannot select customer sources',()=>{
  const checked=spawnSync(process.execPath,['--check','scripts/creator-production-canary.mjs'],{encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr||checked.stdout);
  const start=script.indexOf('async function candidatePools()');
  const end=script.indexOf('async function resolveCandidate',start);
  const block=script.slice(start,end);
  assert.match(block,/createFreshPracticeSource\(\)/);
  assert.match(block,/s\.measurement_qa=true/);
  assert.match(block,/p\.display_name=\$2/);
  assert.match(block,/QA release/);
  assert.match(block,/expectedRelease\.slice\(0,7\)/);
  assert.match(block,/NOT EXISTS\(SELECT 1 FROM account_links a WHERE a\.player_id=s\.player_id\)/);
  assert.match(block,/refusing customer fallback/);
  assert.doesNotMatch(block,/QA v5 owner/);
  assert.doesNotMatch(block,/NOT s\.measurement_qa/);
  assert.match(block,/s\.day::text AS source_day/);
});

test('production player traffic uses the gateway-approved player session transport',()=>{
  assert.match(script,/headers\['x-pack1-mobile-session'\]=player/);
  assert.doesNotMatch(script,/headers\.authorization='Bearer '\+player/);
});

test('fresh Practice source is played through live APIs and later marked QA/private',()=>{
  const start=script.indexOf('async function createFreshPracticeSource()');
  const end=script.indexOf('async function cleanupFreshPracticeSource()',start);
  const block=script.slice(start,end);
  assert.match(block,/QA Creator Source/);
  assert.match(block,/\/growth\/v1\/player\/session/);
  assert.match(block,/\/draft\/v1\/runs/);
  assert.match(block,/\/share/);
  assert.doesNotMatch(block,/INSERT INTO draft_run_sessions/);
  assert.match(script,/async function cleanupFreshPracticeSource\(\)/);
  assert.match(script,/UPDATE draft_run_sessions SET measurement_qa=true/);
  assert.match(script,/UPDATE players SET profile_public=false,username_owned=false/);
  assert.match(script,/await cleanupFreshPracticeSource\(\)/);
});

test('borrowed closed Daily eligibility is restored and canary is protected',()=>{
  assert.match(script,/async function restoreBorrowedSources\(\)/);
  assert.match(script,/UPDATE draft_run_sessions SET measurement_qa=\$2::boolean/);
  assert.match(script,/UPDATE players SET profile_public=\$2::boolean/);
  assert.match(script,/await restoreBorrowedSources\(\)/);
  assert.match(workflow,/environment: pack-one-mobile-release/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.doesNotMatch(workflow,/workflow_dispatch:/);
});

test('reviewed retry request explicitly forbids customer rows',()=>{
  assert.equal(request.operation,'run-creator-production-canary');
  assert.equal(request.expected_release,'f6ea0910d322f007f0ac0004b98fea6bab09422a');
  assert.match(request.reason,/fresh QA Practice/i);
  assert.match(request.reason,/retained (?:closed )?QA release Daily/i);
  assert.match(request.reason,/Never select or mutate customer rows/i);
});
