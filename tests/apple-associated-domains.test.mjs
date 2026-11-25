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
  assert.equal(result.paths.length,7);
});
test('a changed bundle ID must fail association validation',()=>{
  const altered=structuredClone(config);
  altered.expo.ios.bundleIdentifier='pro.packone.wrong';
  assert.match(inspectAssociation(association,altered).errors.join('\n'),/No Apple Team ID/);
});
test('a missing universal-link route must be flagged',()=>{
  const altered=structuredClone(association);
  altered.applinks.details[0].components=altered.applinks.details[0].components.filter(rule=>rule['/']!=='/creator/*');
  assert.match(inspectAssociation(altered,config).errors.join('\n'),/Missing required universal link prefix: \/creator\//);
});
test('associated domains config is mandatory, even with a matching AASA',()=>{
  const altered=structuredClone(config);
  altered.expo.ios.associatedDomains=[];
  assert.match(inspectAssociation(association,altered).errors.join('\n'),/Expected associated domain missing/);
});

test('short share paths require exact associations on both platforms',()=>{
  const altered=structuredClone(association);
  altered.applinks.details[0].components=altered.applinks.details[0].components.filter(rule=>rule['/']!=='/d/l/');
  assert.match(inspectAssociation(altered,config).errors.join('\n'),/Missing required exact universal link path: \/d\/l\//);
  const wrong=structuredClone(config);
  const latest=wrong.expo.android.intentFilters.find(item=>item.data.some(d=>d.path==='/d/l/'));
  latest.data[0].pathPrefix='/d/l/';
  delete latest.data[0].path;
  assert.match(inspectAssociation(association,wrong).errors.join('\n'),/Android intent missing exact Daily share path: \/d\/l\//);
});
