import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Daily generation workflow uses short-lived OIDC and sanitizes endpoint output',()=>{
  const source=fs.readFileSync('.github/workflows/daily-generation.yml','utf8');
  assert.match(source,/workflow_dispatch:/);
  assert.match(source,/id-token: write/);
  assert.match(source,/pack-one-daily-generation/);
  assert.match(source,/TZ=America\/Los_Angeles date \+%F/);
  assert.match(source,/br-twilight-hill-ayffyd2b-draftrunapi/);
  assert.match(source,/br-orange-feather-ayps8kep-draftrunapi/);
  assert.match(source,/Unexpected Daily generation response shape/);
  assert.match(source,/new Set\(\['environment','status','error_class','duration_ms'\]\)/);
  assert.match(source,/availability_error/);
  assert.match(source,/Daily generation incomplete/);
  assert.doesNotMatch(source,/cat .*daily-generation\.json/);
  assert.doesNotMatch(source,/echo .*TOKEN/);
});
