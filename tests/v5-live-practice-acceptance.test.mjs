import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const smoke=fs.readFileSync(new URL('./v5-live-practice-acceptance.mjs',import.meta.url),'utf8');
const deploy=fs.readFileSync(new URL('../.github/workflows/deploy-functions.yml',import.meta.url),'utf8');

test('v5 live Practice acceptance uses the protected connection file boundary',()=>{
  assert.match(smoke,/corpusDatabase\(connectionFile\)/);
  assert.doesNotMatch(smoke,/corpusDatabase\(connection\)/);
  assert.match(deploy,/printf '%s' "\$connection" > "\$RUNNER_TEMP\/target\.connection"/);
  assert.match(deploy,/v5-live-practice-acceptance\.mjs "\$TARGET_BRANCH" "\$RELEASE_COMMIT" "\$RUNNER_TEMP\/target\.connection"/);
  assert.match(deploy,/v5-live-practice-acceptance\.mjs br-twilight-hill-ayffyd2b "\$RELEASE_COMMIT" "\$RUNNER_TEMP\/development\.connection"/);
});

test('v5 live Practice acceptance completes and persists every required Practice family',()=>{
  assert.match(smoke,/mixed=await finish\(mixed,owner\)/);
  assert.match(smoke,/replay=await finish\(replay,peer\)/);
  assert.match(smoke,/cube=await finish\(cube,owner\)/);
  assert.match(smoke,/latestRun=await finish\(latestRun,owner\)/);
  assert.match(smoke,/archiveRun=await finish\(archiveRun,owner\)/);
  assert.match(smoke,/client_result_id=\$2/);
  assert.match(smoke,/Number\(ranked\.n\),0/);
  assert.match(smoke,/coverage\.active\),30/);
});
