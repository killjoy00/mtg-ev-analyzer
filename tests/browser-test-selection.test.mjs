import test from 'node:test';
import assert from 'node:assert/strict';
import {BROWSER_GROUPS,FULL_BROWSER,PRESENTATION_BROWSER,selectedBrowserTests} from '../scripts/run-browser-tests.mjs';

test('domain browser groups avoid unrelated suites',()=>{
  assert.deepEqual(selectedBrowserTests({groups:['profile']}).map(x=>x.file),['tests/profile-e2e.mjs']);
  const practice=selectedBrowserTests({groups:['practice']}).map(x=>x.file);
  assert.ok(practice.every(file=>file.includes('practice')));
  assert.ok(!practice.includes('tests/account-e2e.mjs'));
  const account=selectedBrowserTests({groups:['account']}).map(x=>x.file);
  assert.ok(account.includes('tests/account-deletion-e2e.mjs'));
  assert.ok(!account.includes('tests/practice-e2e.mjs'));
});

test('mixed groups receive the union without duplicate invocations',()=>{
  const selected=selectedBrowserTests({groups:['daily','draft_run']});
  const identities=selected.map(x=>x.file+'|'+JSON.stringify(x.env));
  assert.equal(new Set(identities).size,identities.length);
  assert.ok(selected.some(x=>x.file==='tests/home-today-e2e.mjs'));
  assert.ok(selected.filter(x=>x.file==='tests/draft-run-e2e.mjs').length>=5);
});

test('full and presentation selections are explicit and nonempty',()=>{
  assert.deepEqual(selectedBrowserTests({full:true}),FULL_BROWSER.filter((test,index,all)=>all.findIndex(candidate=>candidate.file===test.file&&JSON.stringify(candidate.env)===JSON.stringify(test.env))===index));
  assert.deepEqual(selectedBrowserTests({presentation:true}),PRESENTATION_BROWSER);
  assert.ok(Object.keys(BROWSER_GROUPS).length>=7);
});

test('full and daily plans complete every current Daily environment',()=>{
  for(const selection of [{full:true},{groups:['daily']}]) {
    const daily=selectedBrowserTests(selection).filter(x=>x.file==='tests/draft-run-e2e.mjs'&&x.env.PACK1_TEST_DAILY==='1');
    assert.deepEqual(daily.map(x=>x.env.PACK1_TEST_ENVIRONMENT||'mixed').sort(),['latest','mixed','powered-cube']);
    assert.ok(daily.every(x=>!x.env.PACK1_TEST_SELECTION_VERSION||x.env.PACK1_TEST_SELECTION_VERSION==='eight-pick-v4'));
  }
  assert.ok(selectedBrowserTests({full:true}).some(x=>x.env.PACK1_TEST_SELECTION_VERSION==='first-pack-v2'));
});
