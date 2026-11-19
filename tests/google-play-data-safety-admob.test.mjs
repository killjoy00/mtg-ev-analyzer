import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Android AdMob Data safety is an explicit, reviewable collected-and-shared declaration',()=>{
  const req=JSON.parse(readFileSync('.github/google-play-data-safety-request.json','utf8'));
  const workflow=readFileSync('.github/workflows/google-play-data-safety.yml','utf8');
  const generator=readFileSync('.github/scripts/google-play-data-safety.mjs','utf8');
  assert.equal(req.operation,'configure-google-play-data-safety');
  assert.equal(req.mode,'dry-run');
  assert.equal(req.android_admob,'enabled');
  assert.match(workflow,/PACKONE_PLAY_DATA_SAFETY_ADMOB: '1'/);
  assert.match(generator,/if\(mode==='submit'&&!admobEnabled\)throw Error/);
  for(const type of ['Approximate location','App interactions','Diagnostics','Device or other IDs']){
    assert.ok(generator.includes(type), 'missing Google Mobile Ads SDK data class: '+type);
  }
  for(const purpose of ['PSL_ADVERTISING','PSL_ANALYTICS','PSL_FRAUD_PREVENTION_SECURITY']){
    assert.ok(generator.includes(purpose), 'missing Google Mobile Ads SDK purpose: '+purpose);
  }
  assert.match(generator,/PSL_DATA_USAGE_ONLY_COLLECTED/);
  assert.match(generator,/PSL_DATA_USAGE_ONLY_SHARED/);
  assert.match(generator,/DATA_USAGE_SHARING_PURPOSE/);
  assert.match(generator,/selectedShared!==item.shared/);
  assert.match(generator,/Unexpected sharing declarations/);
});
