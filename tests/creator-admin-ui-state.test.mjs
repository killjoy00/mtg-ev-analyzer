import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  mergeCreatorChallengeState,
  creatorChallengesForDisplay,
  creatorPublicationProgressText,
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
