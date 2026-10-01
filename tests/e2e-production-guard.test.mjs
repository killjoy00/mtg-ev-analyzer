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

test('every browser test step in the e2e job preloads the guard',()=>{
  const workflow=read('.github/workflows/e2e.yml');
  const runs=[...workflow.matchAll(/^\s+run: (.*\bnode\b.*tests\/.*\.mjs.*)$/gm)].map(match=>match[1]);
  assert.ok(runs.length>=20);
  for(const run of runs)assert.match(run,/(^|\s)node --import \.\/tests\/e2e-production-guard\.mjs tests\/[\w-]+\.mjs$/,run);
  // GitHub rejects NODE_OPTIONS written to GITHUB_ENV, which silently left the guard off.
  assert.doesNotMatch(workflow,/NODE_OPTIONS=.*GITHUB_ENV/);
  assert.match(read('tests/e2e-production-guard.mjs'),/from '\.\/e2e-production-hosts\.mjs'/);
});
