import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Google Play production preflight is uncommitted and discards its temporary edit',()=>{
  const script=readFileSync('.github/scripts/play-production-readiness.mjs','utf8');
  const workflow=readFileSync('.github/workflows/google-play-access.yml','utf8');
  assert.match(script,/countryAvailability\/production/);
  assert.match(script,/countryAvailability\/production-access/);
  assert.match(script,/tracks\/production/);
  assert.match(script,/PLAY_PRODUCTION_DRY_RUN/);
  assert.match(script,/\:validate/);
  assert.match(script,/finally\s*\{/);
  assert.match(script,/method:'DELETE'/);
  assert.doesNotMatch(script, /:commit/, 'temporary readiness must never commit a Google Play edit');
  assert.match(workflow,/Inspect production track and validate without publishing/);
  assert.match(workflow,/environment: pack-one-mobile-release/);
});
