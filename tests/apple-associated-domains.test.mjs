import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectAssociation} from '../scripts/check-apple-associated-domains.mjs';

const config=JSON.parse(await readFile('mobile/app.json','utf8'));
const association=JSON.parse(await readFile('.well-known/apple-app-site-association','utf8'));

test('tracked iOS association matches production app and Android routes',()=>{
  const result=inspectAssociation(association,config);
  assert.deepEqual(result.errors,[]);
  assert.ok(result.matchedAppIDs.includes('3564X3VTDB.pro.packone.app'));
  assert.equal(result.paths.length,4);
});
test('a changed bundle ID must fail association validation',()=>{
  const altered=structuredClone(config);
  altered.expo.ios.bundleIdentifier='pro.packone.wrong';
  assert.match(inspectAssociation(association,altered).errors.join('\n'),/No Apple Team ID/);
});
test('a missing universal-link route must be flagged',()=>{
  const altered=structuredClone(association);
  altered.applinks.details[0].components.pop();
  assert.match(inspectAssociation(altered,config).errors.join('\n'),/Missing required universal link prefix: \/creator\//);
});
test('associated domains config is mandatory, even with a matching AASA',()=>{
  const altered=structuredClone(config);
  altered.expo.ios.associatedDomains=[];
  assert.match(inspectAssociation(association,altered).errors.join('\n'),/Expected associated domain missing/);
});
