import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectSourceChecks,requireCiSource} from '../scripts/require-ci-source.mjs';
const head='a'.repeat(40),pull={head:{sha:head},state:'open',draft:false};
const check=(name,id,status='completed',conclusion='success')=>({name,id,status,conclusion,head_sha:head,app:{slug:'github-actions'}});
const options={head,requiredNames:['test','browser']};
test('source acceptance requires the latest exact-head checks, regardless of API ordering',()=>{
  const checks=[check('test',1),check('browser',2),check('test',3,'in_progress',null)];
  assert.equal(inspectSourceChecks(pull,checks,options),false);
  assert.equal(inspectSourceChecks(pull,[...checks,check('test',4)],options),true);
  assert.throws(()=>inspectSourceChecks({...pull,head:{sha:'b'.repeat(40)}},checks,options),/changed/);
  assert.throws(()=>inspectSourceChecks({...pull,draft:true},checks,options),/Draft/);
  assert.throws(()=>inspectSourceChecks(pull,[check('test',5,'completed','failure')],options),/failed/);
  assert.equal(inspectSourceChecks(pull,[check('test',1),{...check('browser',2),head_sha:'b'.repeat(40)}],options),false);
});
test('source inventory is paginated and waiting is bounded before acquiring the preview lock',async()=>{
  let now=0,pages=0;
  const result=await requireCiSource({head,pr:1,clock:()=>now,sleep:async ms=>{now+=ms;},get:async path=>{
    if(path.startsWith('/pulls'))return pull;
    pages++;return path.endsWith('page=1')?{check_runs:Array.from({length:100},(_,id)=>check('unrelated',id))}:{check_runs:[check('test',101),check('browser',102)]};
  }});assert.equal(result.head,head);assert.equal(pages,2);
  await assert.rejects(requireCiSource({head,pr:1,deadlineMs:20,clock:()=>now,sleep:async ms=>{now+=ms;},get:async path=>path.startsWith('/pulls')?pull:{check_runs:[]}}),/did not finish/);
  const parent=fs.readFileSync('.github/workflows/launch-distributed.yml','utf8');
  const child=fs.readFileSync('.github/workflows/launch-distributed-preview.yml','utf8');
  assert.ok(!parent.includes('group: pack1-gateway-preview'));
  assert.match(parent,/needs: \[scope, regression, checked-source\]/);
  assert.match(child,/group: pack1-gateway-preview/);assert.match(child,/require-ci-source.mjs --once/);
});
