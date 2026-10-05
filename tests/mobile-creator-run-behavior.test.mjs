import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const screen=fs.readFileSync('mobile/app/creator-run.tsx','utf8');
const storage=fs.readFileSync('mobile/src/storage/creatorChallenge.ts','utf8');
const draftRun=fs.readFileSync('mobile/app/draft-run.tsx','utf8');

test('native creator replay stays guest-playable and never forces account creation',()=>{
  assert.doesNotMatch(screen,/if\(!current\.session\.accountToken\)/);
  assert.doesNotMatch(screen,/Sign in to play this challenge/);
  assert.match(screen,/startCreatorChallenge\(current\.session,current\.info\.id\)/);
  assert.match(screen,/Play \$\{state\.info\.creator_name\}’s Run/);
});

test('native creator continuation recovers the authorized run before public invite lookup',()=>{
  const read=screen.indexOf('readCreatorChallengeContinuation(identifier,session)');
  const loadPersisted=screen.indexOf('loadDraftRun(runId,session)');
  const publicLookup=screen.indexOf('loadCreatorChallengeInfo(identifier,session)');
  assert.ok(read>=0&&loadPersisted>read&&publicLookup>loadPersisted,
    'kill/relaunch recovery must try the persisted server-authorized run before checking new-entry availability');
  assert.match(screen,/if\(!\(error instanceof ApiError\)\|\|error\.status!==404\)throw error/);
  assert.match(screen,/Privacy retirement remains a hard fail-closed 410/);
});

test('native account switches never trust the stored player id for authorization',()=>{
  assert.match(storage,/const matches=row\.challengeId\.toLowerCase\(\)===normalized\|\|row\.slug\?\.toLowerCase\(\)===normalized/);
  assert.doesNotMatch(storage,/row\.playerId\.toLowerCase\(\)!==player/);
  assert.match(screen,/const run=await loadDraftRun\(runId,session\)/,
    'the current server session, not local storage, authorizes a recovered run');
  assert.match(screen,/error\.status!==404\)throw error/,
    'only an authorization\/not-found miss may fall through to a fresh public invite');
});

test('creator self-open is rendered as the original Practice or Daily surface',()=>{
  assert.match(screen,/run\.creator_source_owner\?\.challenge_id===info\.id/);
  assert.match(screen,/kind:sourceOwner\?'source':'creator'/);
  assert.match(screen,/sourceType:run\.creator_source_owner\?\.source_type/);
  assert.match(draftRun,/shared\.kind==='source'/);
  assert.match(draftRun,/DAILY DRAFT RUN/);
  assert.match(draftRun,/PRACTICE DRAFT RUN/);
});

test('creator continuation persists both challenge id and vanity slug for relaunch',()=>{
  assert.match(screen,/writeCreatorChallengeContinuation\(current\.info\.id,run\.id,current\.session,current\.info\.slug\)/);
  assert.match(storage,/slug\?:string/);
  assert.match(storage,/row\.slug\?\.toLowerCase\(\)===normalized/);
});
