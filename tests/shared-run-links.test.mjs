import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedRunId,sharedRunInvitationId,sharedRunInvitationPath,sharedRunAppPath} from '../shared-run-links.mjs';
import {rewriteIncomingPath} from '../mobile/src/linking.ts';

const id='a'.repeat(24);

test('friend links use the associated app path and resolve to the exact native invitation',()=>{
  const url='https://packone.pro'+sharedRunAppPath(id);
  assert.equal(url,'https://packone.pro/open/shared/?id='+id);
  assert.equal(rewriteIncomingPath(url),'/shared-run?shared='+id);
  assert.equal(sharedRunInvitationPath(id),'/?game=draft-run&shared='+id);
});

test('authentication captures only unambiguous modern friend invitations',()=>{
  for(const key of ['shared','challenge'])assert.equal(sharedRunInvitationId(`https://packone.pro/?game=draft-run&${key}=${id}`),id);
  for(const query of [
    `shared=${id}`,`game=draft-run&shared=${id}&run=existing`,
    `game=draft-run&shared=${id}&creator=creator`,
    `game=draft-run&shared=${id}&board=daily`,
    `game=draft-run&shared=${id}&custom=1`,
    `game=draft-run&shared=${id}&challenge=${'b'.repeat(24)}`,
    'game=draft-run&challenge='+id.slice(0,12),
  ])assert.equal(sharedRunInvitationId('https://packone.pro/?'+query),null);
});

test('auth returns and app links reject arbitrary URLs and malformed identities',()=>{
  for(const value of [null,undefined,123,id.toUpperCase(),'https://example.com/',id+'?next=https://example.com/',id.slice(0,12)]) {
    assert.equal(sharedRunId(value),null);
    assert.throws(()=>sharedRunInvitationPath(value),/Invalid shared run/);
    assert.throws(()=>sharedRunAppPath(value),/Invalid shared run/);
  }
});
