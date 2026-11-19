import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('daily status keeps the synchronized hold read fanout bounded', () => {
  const source=fs.readFileSync('worker/draft-run-function.mjs','utf8');
  const start=source.indexOf('async function dailyStatus(request)');
  const end=source.indexOf('\nasync function leaderboard(request)',start);
  assert.ok(start>=0&&end>start);
  const body=source.slice(start,end);
  assert.match(body,/const \[statusResult,rankingIdentity\]=await Promise\.all\(\[/);
  assert.match(body,/paid_capabilities/);
  assert.match(body,/membership_connected/);
  assert.match(body,/daily_history/);
  assert.doesNotMatch(body,/accountCapabilities\(account,query\)/);
  assert.doesNotMatch(body,/providerMembership\(account,query\)/);
  assert.equal((body.match(/rankingIdentityStatus\(query,owner\)/g)||[]).length,1);
});
