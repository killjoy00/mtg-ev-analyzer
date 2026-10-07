import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {adminPath,adminGrowthPath} from '../edge/gateway.mjs';
import {normalizeDisplayName} from '../worker/username.mjs';
import {fetchCanaryHttp} from '../scripts/creator-canary-http.mjs';

const script=fs.readFileSync('scripts/creator-production-canary.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/creator-production-canary.yml','utf8');
const request=JSON.parse(fs.readFileSync('.github/creator-production-canary-request.json','utf8'));

test('owned Practice cleanup waits for static retirement before deleting its account',async()=>{
  const block=script.slice(script.indexOf('async function cleanupFreshPracticeSource()'),script.indexOf('async function borrowSource'));
  const execute=new Function('practiceFixture','createdChallenges','query','requestCreatorPrivacyRetirement','gameDateKey','parseJson','sleep','assert','normalizeDisplayName','fetchCanaryHttp',block+';return cleanupFreshPracticeSource();');
  const fixture={playerId:'owned-player',sessionId:'owned-run',shareId:'owned-share',authId:'owned-auth',name:'Creator Source 1234abcd',email:'qa-creator-source-1234abcd@example.invalid'};
  const events=[];let attempts=0;
  await execute(fixture,[{id:'owned-challenge',owner:fixture.playerId}],async(sql,params)=>{
    assert.equal(params[0],sql.startsWith('DELETE FROM account')||sql.startsWith('DELETE FROM neon_auth')?fixture.authId:sql.startsWith('DELETE FROM draft_run_shares')?fixture.shareId:fixture.playerId);
    if(sql.startsWith('SELECT'))return {rows:[{id:'owned-challenge',status:'retired',publication_detail:{live_verified:false}}]};
    events.push('cleanup');return {rows:[]};
  },async()=>{events.push('retirement');return ++attempts===2;},()=> '2026-10-05',x=>x,async()=>{events.push('wait');},assert,normalizeDisplayName,fetchCanaryHttp);
  assert.equal(attempts,2);
  assert.deepEqual(events.slice(0,3),['retirement','wait','retirement']);
  assert.ok(events.indexOf('cleanup')>2);
  let mutation=false;
  await assert.rejects(execute(fixture,[],async()=>({rows:[{id:'unrelated',status:'published'}]}),async()=>{mutation=true;},()=> '2026-10-05',x=>x,async()=>{},assert,normalizeDisplayName,fetchCanaryHttp),/unrelated creator work/);
  assert.equal(mutation,false);
});

test('production creator canary is syntax-valid and cannot select customer sources',()=>{
  const checked=spawnSync(process.execPath,['--check','scripts/creator-production-canary.mjs'],{encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr||checked.stdout);
  const start=script.indexOf('async function candidatePools()');
  const end=script.indexOf('async function resolveCandidate',start);
  const block=script.slice(start,end);
  assert.match(block,/createFreshPracticeSource\(\)/);
  assert.match(block,/s\.measurement_qa=true/);
  assert.match(block,/p\.display_name ~ '\^QA release \[0-9a-f\]\{7\}\$'/);
  assert.match(block,/LIMIT 25/);
  assert.doesNotMatch(block,/expectedRelease\.slice\(0,7\)/);
  assert.match(block,/NOT EXISTS\(SELECT 1 FROM account_links a WHERE a\.player_id=s\.player_id\)/);
  assert.match(block,/NOT EXISTS\(SELECT 1 FROM creator_challenges c WHERE c\.source_owner_player_id=s\.player_id\)/);
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
  assert.match(block,/practiceCanaryIdentity\(tag\)/);
  assert.match(block,/assert\.equal\(created\.displayName,name/);
  assert.doesNotMatch(block,/QA Creator Source/);
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

test('creator canary static cleanup dispatches exact-head green CI before merge',()=>{
  assert.match(workflow,/cleanup-creator-canary-static\.mjs/);
  assert.match(workflow,/gh workflow run test\.yml --ref "\$branch"/);
  assert.match(workflow,/gh workflow run e2e\.yml --ref "\$branch"/);
  assert.match(workflow,/actions\/runs\?event=workflow_dispatch&head_sha=\$\{head_sha\}/);
  assert.match(workflow,/Cleanup exact-head test\/e2e dispatches never registered; refusing to merge/);
  assert.match(workflow,/gh run watch "\$test_run" --exit-status/);
  assert.match(workflow,/gh run watch "\$e2e_run" --exit-status/);
  assert.match(workflow,/gh pr merge "\$pr_url" --squash --delete-branch --match-head-commit "\$head_sha"/);
  assert.match(workflow,/pages\/builds/);
  assert.match(workflow,/Live creator registry still contains a canary entry after cleanup/);
  assert.match(workflow,/Live canary route still exists after cleanup/);
  const dispatch=workflow.indexOf('gh workflow run test.yml');
  const register=workflow.indexOf('actions/runs?event=workflow_dispatch');
  const watch=workflow.indexOf('gh run watch "$test_run"');
  const merge=workflow.indexOf('gh pr merge');
  assert.ok(dispatch>=0&&dispatch<register&&register<watch&&watch<merge,'cleanup must dispatch exact-head CI, observe it, wait for it, then merge');
  assert.match(workflow,/permissions:\n  contents: write\n  pull-requests: write\n  actions: write\n  checks: read\n  pages: write/);
  assert.match(workflow,/GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow,/token: \$\{\{ secrets\.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN \}\}/);
});

test('reviewed retry request explicitly forbids customer rows',()=>{
  assert.equal(request.operation,'run-creator-production-canary');
  // The request pins the corrected protected release; live markerCheck enforces it.
  // A previous release's literal SHA is not the production safety contract.
  assert.match(request.expected_release,/^[a-f0-9]{40}$/);
  assert.match(request.reason,/fresh owned canary Practice/i);
  assert.match(request.reason,/strict `QA release <7-hex>` name contract/i);
  assert.match(request.reason,/Never select or mutate customer rows/i);
});

// Check every actual canary Admin call against the production routing contract.
// An allowlisted path on another service still returns 404 at the gateway.
test('all canary creator Admin calls use their authoritative gateway service',()=>{
  const routes=[...script.matchAll(/call\('\/(draft|growth)(\/v1\/admin\/creator-challenges[^']*)'([^;]*?)(?:;|\n\s*\})/g)];
  assert.ok(routes.length>=6,'all source/create/detail/publication/cleanup calls must be checked');
  for(const [,service,prefix,tail] of routes){
    const path=prefix.endsWith('creator-challenges/')
      ? prefix+'11111111-1111-4111-8111-111111111111'+(tail.includes("'/publication'")?'/publication':'')
      : prefix;
    const method=tail.includes("method:'GET'")?'GET':'POST';
    assert.equal(service==='draft'?adminPath(path,method):adminGrowthPath(path,method,'production'),true,service+path+' '+method);
  }
});
