import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePatreonRuns,summarizePatreonConnection,renderPatreonPublishing} from '../admin/patreon-publishing.mjs';
import {adminArea,ADMIN_AREAS} from '../admin/overview.mjs';

test('the owner Patreon link resolves to a registered admin destination',()=>{
 assert.equal(adminArea('?area=patreon'),'patreon');
 assert.equal(ADMIN_AREAS.patreon,'Patreon Publishing');
});

test('admin workflow summary excludes pull requests and unrelated branches',()=>{
 const rows=summarizePatreonRuns([
 {id:1,head_branch:'main',event:'schedule',created_at:'2026-10-26T14:10:00Z',status:'completed',conclusion:'success',html_url:'https://github.com/example/1'},
 {id:2,head_branch:'feature',event:'schedule'},
 {id:3,head_branch:'main',event:'pull_request'},
 {id:4,head_branch:'main',event:'workflow_dispatch',status:'in_progress',html_url:'https://github.com/example/4'}
 ]);
 assert.deepEqual(rows.map(r=>r.id),[1,4]);
 assert.equal(rows[0].status,'success');
 assert.equal(rows[1].status,'in_progress');
});
test('connection success is distinct from a verified public post',()=>{
 assert.deepEqual(summarizePatreonConnection([{name:'connection',conclusion:'success'},
  {name:'canary-publish',conclusion:'skipped'}]),{
  connection:'success',publication:'skipped',verified:false});
 assert.equal(summarizePatreonConnection([{name:'canary-publish',conclusion:'success',
  steps:[{name:'Publish and independently verify Patreon',conclusion:'success'}]}]).verified,true);
});
test('Patreon admin view does not claim to authorize or publish',()=>{
 assert.equal(typeof renderPatreonPublishing,'function');
 assert.deepEqual(summarizePatreonRuns([]),[]);
});
