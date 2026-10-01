import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PROD_BRANCH,
  KNOWN_UNMANAGED_FUNCTIONS,
  auditInventory,
  manifestSlugs,
  runInventoryAudit,
} from '../scripts/neon-inventory-audit.mjs';

const manifest=manifestSlugs(fs.readFileSync(new URL('../.github/neon-functions.txt',import.meta.url),'utf8'));
const managedFunctions=manifest.map(slug=>({slug}));
const healthyBranches=[
  {id:PROD_BRANCH,default:true},
  {id:'br-twilight-hill-ayffyd2b',default:false},
  {id:'br-ci-temporary',default:false,expires_at:'2026-10-01T09:00:00Z'},
];
const beforeReview=new Date('2026-10-02T00:00:00Z');
const afterReview=new Date('2026-10-16T00:00:00Z');

test('manifest lists exactly the three managed production Functions',()=>{
  assert.deepEqual(manifest,['draftrunapi','pack1growth','pack1api']);
});

test('a healthy inventory passes and known unmanaged helpers only warn before the review date',()=>{
  assert.deepEqual(auditInventory({functions:managedFunctions,branches:healthyBranches,manifest,now:beforeReview}).problems,[]);
  const withHelpers=auditInventory({functions:[...managedFunctions,{slug:'drkick'}],branches:healthyBranches,manifest,now:beforeReview});
  assert.deepEqual(withHelpers.problems,[]);
  assert.equal(withHelpers.warnings.length,1);
  assert.equal(KNOWN_UNMANAGED_FUNCTIONS.size,14);
});

test('the audit fails on unowned Functions, missing managed Functions, default drift and unexpiring branches',()=>{
  const expired=auditInventory({functions:[...managedFunctions,{slug:'drkick'}],branches:healthyBranches,manifest,now:afterReview});
  assert.match(expired.problems.join('\n'),/unmanaged Function drkick/);
  assert.match(auditInventory({functions:[...managedFunctions,{slug:'surprise'}],branches:healthyBranches,manifest,now:beforeReview}).problems.join('\n'),/unmanaged Function surprise/);
  assert.match(auditInventory({functions:managedFunctions.slice(1),branches:healthyBranches,manifest,now:beforeReview}).problems.join('\n'),/managed Function draftrunapi is missing/);
  const drifted=healthyBranches.map(branch=>({...branch,default:branch.id==='br-restored-copy'}));
  drifted.push({id:'br-restored-copy',default:true});
  const result=auditInventory({functions:managedFunctions,branches:drifted,manifest,now:beforeReview}).problems.join('\n');
  assert.match(result,/default branch is br-restored-copy/);
  assert.match(result,/branch br-restored-copy has no expiry/);
  assert.match(auditInventory({functions:managedFunctions,branches:healthyBranches.slice(1),manifest,now:beforeReview}).problems.join('\n'),/long-lived branch br-orange-feather-ayps8kep is missing/);
});

test('the audit only reads the Neon control plane',async()=>{
  const calls=[];
  const result=await runInventoryAudit({
    key:'n'.repeat(32),
    manifestText:'draftrunapi:x\npack1growth:y\npack1api:z\n',
    now:beforeReview,
    fetcher:async(url,init)=>{
      calls.push({url:String(url),method:init.method});
      if(String(url).endsWith('/functions'))return Response.json({functions:managedFunctions});
      return Response.json({branches:healthyBranches});
    },
  });
  assert.deepEqual(result.problems,[]);
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.method==='GET'));
  assert.ok(calls.some(call=>call.url.endsWith('/branches/'+PROD_BRANCH+'/functions')));
  const workflow=fs.readFileSync(new URL('../.github/workflows/neon-inventory-audit.yml',import.meta.url),'utf8');
  assert.match(workflow,/permissions:\n  contents: read/);
  assert.equal((workflow.match(/\brun:/g)||[]).length,1);
  assert.doesNotMatch(workflow,/\b(?:contents|actions|issues|pull-requests): write\b/);
});
