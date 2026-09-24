import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Practice copy and Learn guide cleanup are present',async()=>{
  const [practice,practiceHtml,learn,guide]=await Promise.all([
    read('practice-page.mjs'),
    read('practice/index.html'),
    read('learn/index.html'),
    read('learn/card-strength-vs-fit/index.html'),
  ]);
  assert.doesNotMatch(practice,/included with your free account/);
  assert.match(practice,/Eight-decision runs from real trophy drafts\.'/);
  assert.match(practiceHtml,/Regular Draft Run practice is free/);
  assert.match(learn,/Card strength vs\. deck fit: know what changed/);
  assert.match(learn,/\/learn\/card-strength-vs-fit\//);
  assert.match(guide,/Demand a bigger reason for a bigger downgrade/);
  assert.match(guide,/grade the adjustment, not memorize the answer/);
});

test('Elite acquisition routes through the Pack One Patreon landing page',async()=>{
  const [html,page,growth,myPack,profile,activation]=await Promise.all([
    read('patreon/index.html'),
    read('patreon-page.mjs'),
    read('growth.mjs'),
    read('my-pack-one.mjs'),
    read('profile-product.mjs'),
    read('patreon-activation.mjs'),
  ]);
  assert.match(html,/Pack One Elite/);
  assert.match(html,/Unlimited Powered Cube/);
  assert.match(html,/Choose the sets you want/);
  assert.match(html,/Joining Patreon and connecting Patreon to Pack One are two separate steps/);
  assert.match(html,/https:\/\/www\.patreon\.com\/c\/PackOne/);
  assert.match(page,/getAuthSession/);
  assert.match(page,/loadPatreonStatus/);
  assert.match(page,/startPatreonOAuth\('patreon_landing'\)/);
  assert.match(page,/Open Practice/);
  assert.match(growth,/location\.assign\('\/patreon\/'\)/);
  assert.doesNotMatch(growth,/handoffToPatreon/);
  assert.match(myPack,/membershipUrl=elite\?supportUrl:'\/patreon\/'/);
  assert.match(profile,/membershipUrl=elite\?supportUrl:'\/patreon\/'/);
  assert.match(activation,/export async function startPatreonOAuth/);
  assert.doesNotMatch(profile,/Upgrade to Elite on Patreon|Become Elite on Patreon/);
});
