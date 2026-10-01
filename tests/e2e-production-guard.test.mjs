import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CHROMIUM_RESOLVER_RULES,PRODUCTION_API_HOST} from './e2e-production-hosts.mjs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const configHosts=[...new Set([...read('leaderboard-config.js').matchAll(/'(https:\/\/[^']+)'/g)].map(match=>new URL(match[1]).hostname))];
const resolverPatterns=[...CHROMIUM_RESOLVER_RULES.matchAll(/MAP (\S+) ~NOTFOUND/g)].map(match=>match[1]);
const resolverBlocks=host=>resolverPatterns.some(pattern=>pattern.startsWith('*.')?host.endsWith(pattern.slice(1)):host===pattern);

test('every API host the site config can select is blocked for browser e2e tests',()=>{
  assert.ok(configHosts.includes('api.packone.pro'));
  assert.ok(configHosts.some(host=>host.endsWith('-pack1growth.compute.c-5.us-east-2.aws.neon.tech')));
  for(const host of configHosts) {
    assert.match(host,PRODUCTION_API_HOST,`${host} is routed away`);
    assert.ok(resolverBlocks(host),`${host} is unresolvable in Chromium`);
  }
  for(const host of ['packone.pro','127.0.0.1','localhost','cards.scryfall.io','pagead2.googlesyndication.com'])
    assert.doesNotMatch(host,PRODUCTION_API_HOST,`${host} stays reachable`);
});

test('the e2e job preloads the guard for every browser test step and clears it afterwards',()=>{
  const workflow=read('.github/workflows/e2e.yml');
  const enable=workflow.indexOf('echo "NODE_OPTIONS=--import $GITHUB_WORKSPACE/tests/e2e-production-guard.mjs" >> "$GITHUB_ENV"');
  const disable=workflow.indexOf('echo "NODE_OPTIONS=" >> "$GITHUB_ENV"');
  const browserSteps=[...workflow.matchAll(/run: node tests\/[\w-]+-?e2e\.mjs/g)].map(match=>match.index);
  assert.ok(enable>0&&disable>enable,'guard is enabled, then cleared');
  assert.ok(browserSteps.length>=15);
  assert.ok(browserSteps.every(index=>index>enable&&index<disable),'every browser test runs with the guard');
  assert.match(workflow.slice(workflow.lastIndexOf('- name:',disable),disable),/if: always\(\)/,'the guard is cleared even after a failed test');
  assert.ok(disable<workflow.indexOf('uses: actions/upload-artifact'),'actions run without the preload');
  assert.match(read('tests/e2e-production-guard.mjs'),/from '\.\/e2e-production-hosts\.mjs'/);
});
