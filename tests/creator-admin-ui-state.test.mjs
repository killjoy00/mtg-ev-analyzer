import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  mergeCreatorChallengeState,
  creatorChallengesForDisplay,
  creatorPublicationProgressText,
  creatorPublicationFailure,
  creatorCanaryMayBePurged,
} from '../admin/campaign-links.mjs';

test('reconciliation preserves list stats while taking current publication state',()=>{
  const listed={
    id:'11111111-1111-4111-8111-111111111111',
    slug:'pending-delete',
    status:'retired',
    publication_detail:{action:'retire',live_verified:false},
    opens:17,starts:11,attempts:9,completions:8,wins:3,ties:1,losses:4,
    beat_percentage:37.5,average_score:82.4,
  };
  const reconciled={
    id:listed.id,
    slug:listed.slug,
    status:'retired',
    publication_detail:{action:'retire',live_verified:false,workflow:{status:'in_progress'}},
  };
  const merged=mergeCreatorChallengeState(listed,reconciled);
  assert.equal(merged.publication_detail.workflow.status,'in_progress');
  assert.equal(merged.opens,17);
  assert.equal(merged.starts,11);
  assert.equal(merged.completions,8);
  assert.equal(merged.wins,3);
  assert.equal(merged.losses,4);
  assert.equal(merged.average_score,82.4);
});

test('verified deleted challenges are hidden by default and recoverable on demand',()=>{
  const active={slug:'active',status:'published',publication_detail:{live_verified:true}};
  const pending={slug:'pending',status:'retired',publication_detail:{live_verified:false}};
  const deleted={slug:'deleted',status:'retired',publication_detail:{live_verified:true}};
  assert.deepEqual(
    creatorChallengesForDisplay([active,pending,deleted]).visible.map(row=>row.slug),
    ['active','pending'],
  );
  const shown=creatorChallengesForDisplay([active,pending,deleted],{showDeleted:true});
  assert.equal(shown.deleted,1);
  assert.deepEqual(shown.visible.map(row=>row.slug),['active','pending','deleted']);
});

test('publication progress text changes over time for publish and delete',()=>{
  assert.match(creatorPublicationProgressText('published',0),/checks and Pages deployment are still running/);
  assert.match(creatorPublicationProgressText('published',10),/1m 00s elapsed/);
  assert.match(creatorPublicationProgressText('retired',20),/2m 00s elapsed/);
  assert.match(creatorPublicationProgressText('retired',20),/Deleting challenge safely/);
});

test('creator Admin exposes plain Delete and recovery-oriented Finish delete labels',()=>{
  const source=fs.readFileSync('admin/campaign-links.mjs','utf8');
  assert.match(source,/data-retire>Delete<\/button>/);
  assert.match(source,/data-resume-retire>Finish delete<\/button>/);
  assert.match(source,/id="creator-show-deleted"/);
});

test('failed retirement is actionable rather than waiting for ten minutes',()=>{
  const failed={
    state:'retired',live_verified:false,
    workflow:{status:'completed',conclusion:'failure'},
    challenge:{status:'retired',publication_error:'Synthetic CI retirement failure',publication_detail:{live_verified:false}},
  };
  assert.match(creatorPublicationFailure(failed,'retired'),/Synthetic CI retirement failure/);
  assert.equal(creatorPublicationFailure({...failed,live_verified:true,challenge:{...failed.challenge,publication_detail:{live_verified:true}}},'retired'),null);
  assert.match(creatorPublicationFailure({
    state:'retired',dispatch:{state:'rejected',error:'GitHub dispatch rejected'},
    challenge:{status:'retired',publication_detail:{live_verified:false}},
  },'retired'),/GitHub dispatch rejected/);
  assert.equal(creatorPublicationFailure({state:'retired',challenge:{status:'retired',publication_detail:{live_verified:false}}},'retired'),null);
});

test('permanent test removal is never offered to a customer challenge or unverified canary',()=>{
  const safe={slug:'canary-practice-1234abcd',purge_supported:true,status:'retired',creator_public_name:'A creator',acquisition_campaign:'release-canary',
    privacy_removed_at:'2026-10-09T00:00:00Z',publication_detail:{live_verified:true}};
  assert.equal(creatorCanaryMayBePurged(safe),true);
  for(const diff of [
    {slug:'personal-creator'}, {slug:'canary-practice-hello'}, {status:'published'},
    {purge_supported:false}, {purge_supported:undefined},
    {creator_public_name:'Customer'}, {acquisition_campaign:'organic'},
    {privacy_removed_at:null}, {publication_detail:{live_verified:false}},
  ])assert.equal(creatorCanaryMayBePurged({...safe,...diff}),false);
});

test('Admin creator delete requests cannot reuse cached API responses',()=>{
  const source=fs.readFileSync('admin/admin.mjs','utf8');
  assert.match(source,/credentials:firstPartyAuthEnabled\(\)\?'include':'omit',cache:'no-store',signal:AbortSignal.timeout\(45000\)/);
  const creator=fs.readFileSync('admin/campaign-links.mjs','utf8');
  assert.match(creator,/status==='retired'&&challenge.publication_detail\?\.live_verified!==true/);
  assert.match(creator,/const failure=creatorPublicationFailure\(status,expected\)/);
  assert.match(creator,/data-purge-test>Permanently remove test/);
});
